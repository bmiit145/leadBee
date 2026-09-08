import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  ActivityIndicator,
  Modal,
  ScrollView,
  Pressable,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LeadCard } from '../../src/components/LeadCard';
import { leadService } from '../../src/services/lead.service';
import { useAuth } from '../../src/stores/auth.store';
import { Lead, LeadStage, LeadPriority, LeadDashboardStats } from '../../src/types';
import { colors, spacing, borderRadius } from '../../src/theme';
import { LEAD_STAGE_META, LEAD_STAGE_ORDER } from '../../src/config/leadStages';

// Derived from the shared stage config so a new stage shows up here automatically
// instead of being silently dropped from the filter strip.
const STAGE_TABS: { value: LeadStage | ''; label: string; statKey: string }[] = [
  { value: '', label: 'All', statKey: 'total' },
  ...LEAD_STAGE_ORDER.map((stage) => ({
    value: stage,
    label: LEAD_STAGE_META[stage].label,
    statKey: stage,
  })),
];

const SOURCES = [
  { value: 'walk_in',    label: 'Walk In' },
  { value: 'cold_call',  label: 'Cold Call' },
  { value: 'referral',   label: 'Referral' },
  { value: 'facebook',   label: 'Facebook' },
  { value: 'instagram',  label: 'Instagram' },
  { value: 'website',    label: 'Website' },
  { value: '99acres',    label: '99acres' },
  { value: 'magicbricks',label: 'MagicBricks' },
  { value: 'housing',    label: 'Housing.com' },
  { value: 'other',      label: 'Other' },
];

const QUALITY_OPTIONS = [
  { value: 'hot' as LeadPriority,  label: 'High',   color: '#EF4444' },
  { value: 'warm' as LeadPriority, label: 'Medium', color: '#F97316' },
  { value: 'cold' as LeadPriority, label: 'Low',    color: '#3B82F6' },
];

interface Filters {
  priority: LeadPriority | '';
  source: string;
  dateFrom: Date | null;
  dateTo: Date | null;
  budgetMin: string;
  budgetMax: string;
  overdue: boolean;
}

const DEFAULT_FILTERS: Filters = {
  priority: '',
  source: '',
  dateFrom: null,
  dateTo: null,
  budgetMin: '',
  budgetMax: '',
  overdue: false,
};

function fmtDate(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getTabCount(stats: LeadDashboardStats | undefined, statKey: string): number {
  if (!stats) return 0;
  if (statKey === 'total') return stats.total;
  return (stats.byStage as any)[statKey] ?? 0;
}

function countActiveFilters(f: Filters): number {
  return [
    f.priority !== '',
    f.source !== '',
    f.dateFrom !== null,
    f.dateTo !== null,
    f.budgetMin !== '',
    f.budgetMax !== '',
    f.overdue,
  ].filter(Boolean).length;
}

export default function LeadListScreen() {
  const router   = useRouter();
  const insets   = useSafeAreaInsets();
  const { isOrganizer } = useAuth();

  const [search, setSearch]             = useState('');
  const [debouncedSearch, setDebounced] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedStage, setSelectedStage] = useState<LeadStage | ''>('');

  const [showFilter, setShowFilter] = useState(false);
  const [applied, setApplied]       = useState<Filters>(DEFAULT_FILTERS);
  const [draft, setDraft]           = useState<Filters>(DEFAULT_FILTERS);

  const [datePickerFor, setDatePickerFor] = useState<'from' | 'to' | null>(null);

  const [page, setPage]         = useState(1);
  const [allLeads, setAllLeads] = useState<Lead[]>([]);

  const statsQuery = useQuery({
    queryKey: ['leads-stats'],
    queryFn: () => leadService.getDashboardStats(),
    staleTime: 60_000,
  });
  const stats = statsQuery.data;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['leads', selectedStage, applied, debouncedSearch, page],
    queryFn: async () => {
      const result = await leadService.getAll({
        stage:           selectedStage || undefined,
        priority:        applied.priority || undefined,
        source:          applied.source   || undefined,
        search:          debouncedSearch  || undefined,
        overdueFollowUp: applied.overdue  || undefined,
        dateFrom:        applied.dateFrom ? applied.dateFrom.toISOString() : undefined,
        dateTo:          applied.dateTo   ? applied.dateTo.toISOString()   : undefined,
        budgetMin:       applied.budgetMin ? Number(applied.budgetMin) : undefined,
        budgetMax:       applied.budgetMax ? Number(applied.budgetMax) : undefined,
        page,
        limit: 20,
      });
      if (page === 1) setAllLeads(result.data);
      else setAllLeads(prev => [...prev, ...result.data]);
      return result;
    },
    staleTime: 30_000,
  });

  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: (leadId: string) => leadService.remove(leadId),
    onSuccess: () => {
      setAllLeads((prev) => prev.filter((l) => l._id !== deleteMutation.variables));
      queryClient.invalidateQueries({ queryKey: ['leads-stats'] });
    },
    onError: () => Alert.alert('Error', 'Could not delete lead.'),
  });

  const handleDeleteLead = (lead: Lead) => {
    Alert.alert('Delete Lead', `Delete "${lead.contactName}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(lead._id) },
    ]);
  };

  const handleSearch = (text: string) => {
    setSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebounced(text);
      resetPagination();
    }, 350);
  };

  const resetPagination = () => { setPage(1); setAllLeads([]); };

  const handleStageTab = (stage: LeadStage | '') => {
    setSelectedStage(stage);
    resetPagination();
  };

  const handleRefresh = useCallback(() => { resetPagination(); refetch(); }, [refetch]);

  const handleLoadMore = () => {
    if (data && page < data.totalPages && !isFetching) setPage(p => p + 1);
  };

  const openFilter = () => { setDraft({ ...applied }); setShowFilter(true); };
  const applyFilter = () => {
    setApplied({ ...draft });
    setShowFilter(false);
    resetPagination();
  };
  const clearFilter = () => { setDraft(DEFAULT_FILTERS); };

  const activeFilterCount = countActiveFilters(applied);

  const handleDateChange = (event: any, date?: Date) => {
    if (Platform.OS === 'android') setDatePickerFor(null);
    if (!date || event.type === 'dismissed') return;
    if (datePickerFor === 'from') setDraft(p => ({ ...p, dateFrom: date }));
    else if (datePickerFor === 'to') setDraft(p => ({ ...p, dateTo: date }));
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>All Leads</Text>
          {!isOrganizer && <Text style={styles.headerSub}>My Leads</Text>}
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => router.push('/lead/add')} activeOpacity={0.8}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Stats strip */}
      {stats && (
        <View style={styles.statsRow}>
          {[
            { label: 'Total',   value: stats.total,                    color: colors.primary },
            { label: 'Hot',     value: stats.byPriority.hot,           color: '#EF4444' },
            { label: 'Won',     value: stats.byStage.order_received,   color: LEAD_STAGE_META.order_received.color },
            { label: 'Overdue', value: stats.overdueFollowUps,         color: '#F97316' },
          ].map(({ label, value, color }) => (
            <View key={label} style={styles.statCard}>
              <Text style={[styles.statValue, { color }]}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Search + Filter */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={17} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search name, phone, lead #..."
            placeholderTextColor={colors.textSecondary}
            value={search}
            onChangeText={handleSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => handleSearch('')}>
              <Ionicons name="close-circle" size={17} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]}
          onPress={openFilter}
          activeOpacity={0.8}
        >
          <Ionicons name="options-outline" size={19} color={activeFilterCount > 0 ? '#fff' : colors.primary} />
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Stage Tabs */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={STAGE_TABS}
        keyExtractor={item => item.value}
        style={styles.tabsRow}
        contentContainerStyle={{ paddingHorizontal: spacing.md, gap: 8 }}
        renderItem={({ item }) => {
          const isActive = selectedStage === item.value;
          const count    = getTabCount(stats, item.statKey);
          return (
            <TouchableOpacity
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => handleStageTab(item.value as LeadStage | '')}
              activeOpacity={0.75}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {item.label}{count > 0 ? ` (${count})` : ''}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {/* Lead List */}
      {isLoading && page === 1 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : allLeads.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={52} color={colors.border} />
          <Text style={styles.emptyTitle}>No leads found</Text>
          <Text style={styles.emptySub}>Adjust filters or add your first lead</Text>
        </View>
      ) : (
        <FlatList
          data={allLeads}
          keyExtractor={item => item._id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 90 }}
          renderItem={({ item }) => (
            <LeadCard
              lead={item}
              onPress={() => router.push(`/lead/${item._id}`)}
              onDelete={handleDeleteLead}
            />
          )}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && page === 1}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
            />
          }
          ListFooterComponent={
            isFetching && page > 1
              ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
              : null
          }
        />
      )}

      {/* Filter Modal */}
      <Modal visible={showFilter} transparent animationType="slide" onRequestClose={() => setShowFilter(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowFilter(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Filter</Text>
              <TouchableOpacity onPress={clearFilter}>
                <Text style={styles.clearText}>Clear All</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing.lg, paddingBottom: 8 }}>
              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>Date Range</Text>
                <View style={styles.dateRow}>
                  <TouchableOpacity style={styles.dateField} onPress={() => setDatePickerFor('from')}>
                    <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                    <Text style={draft.dateFrom ? styles.dateVal : styles.datePH}>
                      {draft.dateFrom ? fmtDate(draft.dateFrom) : 'From Date'}
                    </Text>
                    {draft.dateFrom && (
                      <TouchableOpacity onPress={() => setDraft(p => ({ ...p, dateFrom: null }))}>
                        <Ionicons name="close-circle" size={14} color={colors.textSecondary} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dateField} onPress={() => setDatePickerFor('to')}>
                    <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                    <Text style={draft.dateTo ? styles.dateVal : styles.datePH}>
                      {draft.dateTo ? fmtDate(draft.dateTo) : 'To Date'}
                    </Text>
                    {draft.dateTo && (
                      <TouchableOpacity onPress={() => setDraft(p => ({ ...p, dateTo: null }))}>
                        <Ionicons name="close-circle" size={14} color={colors.textSecondary} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                </View>
                {datePickerFor !== null && Platform.OS === 'android' && (
                  <DateTimePicker
                    value={(datePickerFor === 'from' ? draft.dateFrom : draft.dateTo) || new Date()}
                    mode="date"
                    display="calendar"
                    onChange={handleDateChange}
                  />
                )}
                {datePickerFor !== null && Platform.OS === 'ios' && (
                  <View style={styles.iosDatePicker}>
                    <View style={styles.iosDatePickerHeader}>
                      <Text style={styles.iosDatePickerTitle}>
                        {datePickerFor === 'from' ? 'Select Start Date' : 'Select End Date'}
                      </Text>
                      <TouchableOpacity onPress={() => setDatePickerFor(null)}>
                        <Text style={{ color: colors.primary, fontWeight: '700' }}>Done</Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
                      value={(datePickerFor === 'from' ? draft.dateFrom : draft.dateTo) || new Date()}
                      mode="date"
                      display="spinner"
                      onChange={handleDateChange}
                      style={{ height: 120 }}
                    />
                  </View>
                )}
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>Budget Range (₹)</Text>
                <View style={styles.budgetRow}>
                  <View style={styles.budgetField}>
                    <Text style={styles.budgetCurrency}>₹</Text>
                    <TextInput
                      style={styles.budgetInput}
                      placeholder="Min"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="numeric"
                      value={draft.budgetMin}
                      onChangeText={v => setDraft(p => ({ ...p, budgetMin: v }))}
                    />
                  </View>
                  <View style={styles.budgetSep} />
                  <View style={styles.budgetField}>
                    <Text style={styles.budgetCurrency}>₹</Text>
                    <TextInput
                      style={styles.budgetInput}
                      placeholder="Max"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="numeric"
                      value={draft.budgetMax}
                      onChangeText={v => setDraft(p => ({ ...p, budgetMax: v }))}
                    />
                  </View>
                </View>
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>Lead Source</Text>
                <View style={styles.chipGrid}>
                  {SOURCES.map(s => {
                    const isOn = draft.source === s.value;
                    return (
                      <TouchableOpacity
                        key={s.value}
                        style={[styles.chip, isOn && styles.chipActive]}
                        onPress={() => setDraft(p => ({ ...p, source: isOn ? '' : s.value }))}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.chipText, isOn && styles.chipTextActive]}>{s.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.filterSection}>
                <Text style={styles.filterLabel}>Leads Quality</Text>
                <View style={styles.qualityRow}>
                  {QUALITY_OPTIONS.map(q => {
                    const isOn = draft.priority === q.value;
                    return (
                      <TouchableOpacity
                        key={q.value}
                        style={[styles.qualityChip, isOn && { borderColor: q.color, backgroundColor: q.color + '15' }]}
                        onPress={() => setDraft(p => ({ ...p, priority: isOn ? '' : q.value }))}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.qualityText, isOn && { color: q.color, fontWeight: '700' }]}>
                          {q.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.filterSection}>
                <TouchableOpacity
                  style={styles.overdueToggle}
                  onPress={() => setDraft(p => ({ ...p, overdue: !p.overdue }))}
                  activeOpacity={0.8}
                >
                  <View>
                    <Text style={styles.filterLabel}>Overdue Follow-ups</Text>
                    <Text style={styles.overdueDesc}>Show only leads with missed follow-up dates</Text>
                  </View>
                  <View style={[styles.toggle, draft.overdue && styles.toggleOn]}>
                    <View style={[styles.toggleThumb, draft.overdue && styles.toggleThumbOn]} />
                  </View>
                </TouchableOpacity>
              </View>
            </ScrollView>

            <TouchableOpacity style={styles.applyBtn} onPress={applyFilter} activeOpacity={0.85}>
              <Text style={styles.applyBtnText}>Apply Filters</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 12, color: colors.primary, fontWeight: '600', marginTop: 1 },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  statsRow: { flexDirection: 'row', marginHorizontal: spacing.md, marginBottom: 12, gap: 8 },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    paddingVertical: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '500', marginTop: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: spacing.md, marginBottom: 10, gap: 10 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 46,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text },
  filterBtn: {
    width: 46, height: 46,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterBadge: {
    position: 'absolute', top: -4, right: -4,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#EF4444',
    justifyContent: 'center', alignItems: 'center',
  },
  filterBadgeText: { fontSize: 10, color: '#fff', fontWeight: '800' },
  tabsRow: { maxHeight: 44, marginBottom: 8 },
  tab: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 99, borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: '#fff', fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  emptySub: { fontSize: 13, color: colors.textSecondary },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: spacing.lg, paddingBottom: 0, maxHeight: '88%',
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: 16,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  clearText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  filterSection: { gap: 10 },
  filterLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  dateRow: { flexDirection: 'row', gap: 10 },
  dateField: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  dateVal: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '500' },
  datePH: { flex: 1, fontSize: 13, color: colors.textSecondary },
  iosDatePicker: { backgroundColor: colors.background, borderRadius: borderRadius.lg, overflow: 'hidden' },
  iosDatePickerHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  iosDatePickerTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  budgetField: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, height: 48, gap: 6,
  },
  budgetCurrency: { fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
  budgetInput: { flex: 1, fontSize: 14, color: colors.text },
  budgetSep: { width: 12, height: 1.5, backgroundColor: colors.border },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primary + '14' },
  chipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  qualityRow: { flexDirection: 'row', gap: 10 },
  qualityChip: { flex: 1, paddingVertical: 10, borderRadius: borderRadius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  qualityText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  overdueToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.border, padding: 14 },
  overdueDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  toggle: { width: 44, height: 24, borderRadius: 12, backgroundColor: colors.border, justifyContent: 'center', paddingHorizontal: 2 },
  toggleOn: { backgroundColor: colors.primary },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 2, elevation: 2 },
  toggleThumbOn: { alignSelf: 'flex-end' },
  applyBtn: { backgroundColor: colors.primary, borderRadius: borderRadius.xl, paddingVertical: 16, alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.lg, shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  applyBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
