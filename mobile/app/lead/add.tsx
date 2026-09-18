import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput as RNTextInput,
  Alert,
  Modal,
  FlatList,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { queryClient } from '../../src/lib/queryClient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { leadService } from '../../src/services/lead.service';
import { purposeService, PurposeOfInquiry } from '../../src/services/purpose.service';
import { useAuth } from '../../src/stores/auth.store';
import { LeadSource, LeadPriority, LeadStage } from '../../src/types';
import { colors, spacing, borderRadius } from '../../src/theme';
import { LEAD_STAGE_META, LEAD_STAGE_ORDER } from '../../src/config/leadStages';
import { isValidPhone } from '../../src/utils/validators';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { userService } from '../../src/services/user.service';
import { queryKeys } from '../../src/lib/queryKeys';
import { DuplicateLeadDialog } from '../../src/components/DuplicateLeadDialog';
import type { DuplicateLeadDetails, DuplicateResult } from '../../src/services/lead.service';
import { useDebouncedValue } from '../../src/hooks/useDebouncedValue';

// ─── Constants ───────────────────────────────────────────────────────────────

const SOURCES: { value: LeadSource; label: string; icon: string }[] = [
  { value: 'walk_in',    label: 'Walk In',     icon: 'walk-outline' },
  { value: 'cold_call',  label: 'Cold Call',   icon: 'call-outline' },
  { value: 'referral',   label: 'Referral',    icon: 'people-outline' },
  { value: 'facebook',   label: 'Facebook',    icon: 'logo-facebook' },
  { value: 'instagram',  label: 'Instagram',   icon: 'logo-instagram' },
  { value: 'website',    label: 'Website',     icon: 'globe-outline' },
  { value: '99acres',    label: '99acres',     icon: 'business-outline' },
  { value: 'magicbricks',label: 'MagicBricks', icon: 'business-outline' },
  { value: 'housing',    label: 'Housing.com', icon: 'home-outline' },
  { value: 'other',      label: 'Other',       icon: 'ellipsis-horizontal-outline' },
];

const QUALITIES: { value: LeadPriority; label: string; desc: string; color: string }[] = [
  { value: 'hot',  label: 'High',   desc: 'Hot lead — urgent',  color: '#EF4444' },
  { value: 'warm', label: 'Medium', desc: 'Warm — interested',  color: '#F97316' },
  { value: 'cold', label: 'Low',    desc: 'Cold — exploratory', color: '#3B82F6' },
];

const STAGES: { value: LeadStage; label: string }[] = LEAD_STAGE_ORDER.map((stage) => ({
  value: stage,
  label: LEAD_STAGE_META[stage].label,
}));

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sStyles.section}>
      <Text style={sStyles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function FieldRow({
  icon,
  label,
  required,
  error,
  children,
}: {
  icon: string;
  label: string;
  required?: boolean;
  /** Draws the row in the error colour — the number already belongs to a lead. */
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[sStyles.fieldRow, error && sStyles.fieldRowError]}>
      <View style={[sStyles.fieldIcon, error && sStyles.fieldIconError]}>
        <Ionicons name={icon as any} size={18} color={error ? colors.error : colors.primary} />
      </View>
      <View style={sStyles.fieldBody}>
        <Text style={sStyles.fieldLabel}>
          {label}
          {required && <Text style={{ color: colors.error }}> *</Text>}
        </Text>
        {children}
      </View>
    </View>
  );
}

function PickerRow({
  icon,
  label,
  value,
  placeholder,
  onPress,
  required,
}: {
  icon: string;
  label: string;
  value?: string;
  placeholder: string;
  onPress: () => void;
  required?: boolean;
}) {
  return (
    <TouchableOpacity style={sStyles.fieldRow} onPress={onPress} activeOpacity={0.7}>
      <View style={sStyles.fieldIcon}>
        <Ionicons name={icon as any} size={18} color={colors.primary} />
      </View>
      <View style={sStyles.fieldBody}>
        <Text style={sStyles.fieldLabel}>
          {label}
          {required && <Text style={{ color: colors.error }}> *</Text>}
        </Text>
        <Text style={value ? sStyles.pickerVal : sStyles.pickerPH}>{value || placeholder}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

const sStyles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    marginBottom: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: 12,
  },
  fieldRowError: { borderBottomColor: colors.error, borderBottomWidth: 1.5 },
  fieldIconError: { backgroundColor: `${colors.error}14` },
  fieldIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.primary + '12',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fieldBody: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  pickerVal: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  pickerPH: {
    fontSize: 15,
    color: colors.textDisabled,
  },
});

// ─── Generic Picker Modal ─────────────────────────────────────────────────────

function PickerModal<T extends string>({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: { value: T; label: string; desc?: string; color?: string; icon?: string }[];
  selected: T | '';
  onSelect: (v: T) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={pmStyles.overlay} onPress={onClose}>
        <Pressable style={pmStyles.sheet} onPress={() => {}}>
          <View style={pmStyles.handle} />
          <Text style={pmStyles.title}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={item => item.value}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const isSelected = selected === item.value;
              return (
                <TouchableOpacity
                  style={[pmStyles.item, isSelected && pmStyles.itemSelected]}
                  onPress={() => { onSelect(item.value); onClose(); }}
                  activeOpacity={0.7}
                >
                  {item.icon && (
                    <View style={[pmStyles.itemIcon, isSelected && { backgroundColor: colors.primary + '20' }]}>
                      <Ionicons name={item.icon as any} size={18} color={isSelected ? colors.primary : colors.textSecondary} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[pmStyles.itemLabel, isSelected && { color: colors.primary, fontWeight: '700' }]}>
                      {item.label}
                    </Text>
                    {item.desc && <Text style={pmStyles.itemDesc}>{item.desc}</Text>}
                  </View>
                  {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                </TouchableOpacity>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Purpose of Inquiry Modal ─────────────────────────────────────────────────
// Dynamic picker backed by /api/purposes. Organizers see "+ Add New" button.

function PurposePickerModal({
  visible,
  selected,
  onSelect,
  onClose,
  isOrganizer,
}: {
  visible: boolean;
  selected: string;
  onSelect: (name: string) => void;
  onClose: () => void;
  isOrganizer: boolean;
}) {
  const [purposes, setPurposes] = useState<PurposeOfInquiry[]>([]);
  const [loading, setLoading]   = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName]   = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await purposeService.getAll();
      setPurposes(data);
    } catch {
      // silent — list shows empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await purposeService.create(newName.trim());
      setPurposes(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      onSelect(created.name);
      setNewName('');
      setShowCreate(false);
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to create purpose');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={pmStyles.overlay} onPress={onClose}>
        <Pressable style={pmStyles.sheet} onPress={() => {}}>
          <View style={pmStyles.handle} />
          <Text style={pmStyles.title}>Select Purpose of Inquiry</Text>

          {/* Add New — only visible to organizers */}
          {isOrganizer && !showCreate && (
            <TouchableOpacity
              style={purposeStyles.addBtn}
              onPress={() => setShowCreate(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
              <Text style={purposeStyles.addBtnText}>Add New Purpose</Text>
            </TouchableOpacity>
          )}

          {/* Inline create form */}
          {showCreate && (
            <View style={purposeStyles.createBox}>
              <RNTextInput
                style={purposeStyles.createInput}
                placeholder="Enter purpose name…"
                placeholderTextColor={colors.textDisabled}
                value={newName}
                onChangeText={setNewName}
                autoFocus
              />
              <View style={purposeStyles.createBtns}>
                <TouchableOpacity
                  style={purposeStyles.cancelBtn}
                  onPress={() => { setShowCreate(false); setNewName(''); }}
                >
                  <Text style={purposeStyles.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[purposeStyles.createBtn, creating && { opacity: 0.6 }]}
                  onPress={handleCreate}
                  disabled={creating}
                >
                  {creating
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={purposeStyles.createTxt}>Create</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {loading ? (
            <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} />
          ) : purposes.length === 0 ? (
            <View style={purposeStyles.empty}>
              <Ionicons name="search-outline" size={48} color={colors.textDisabled} />
              <Text style={purposeStyles.emptyText}>No purposes found</Text>
              {isOrganizer && (
                <Text style={purposeStyles.emptyHint}>Tap "Add New Purpose" to create one</Text>
              )}
            </View>
          ) : (
            <FlatList
              data={purposes}
              keyExtractor={item => item._id}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isSelected = selected === item.name;
                return (
                  <TouchableOpacity
                    style={[pmStyles.item, isSelected && pmStyles.itemSelected]}
                    onPress={() => { onSelect(item.name); onClose(); }}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[pmStyles.itemLabel, isSelected && { color: colors.primary, fontWeight: '700' }]}>
                        {item.name}
                      </Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const purposeStyles = StyleSheet.create({
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.primary + '10',
    borderRadius: borderRadius.lg,
  },
  addBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
  },
  createBox: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  createInput: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  createBtns: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  cancelTxt: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  createBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  createTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  emptyHint: {
    fontSize: 13,
    color: colors.textDisabled,
    textAlign: 'center',
  },
});

const pmStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: spacing.md,
    paddingBottom: 32,
    maxHeight: '75%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: borderRadius.lg,
    marginBottom: 4,
    gap: 12,
  },
  itemSelected: {
    backgroundColor: colors.primary + '0D',
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemLabel: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  itemDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
});

// ─── Form State ───────────────────────────────────────────────────────────────

interface FormData {
  contactName: string;
  contactPhone: string;
  contactSecondPhone: string;
  contactEmail: string;
  source: LeadSource;
  sourceDetail: string;
  priority: LeadPriority;
  stage: LeadStage;
  interestedIn: string;
  nextFollowUpAt: Date | null;
  notes: string;
  estimateAmount: string;
  /** A member's id; empty means the creator, which is also the API's default. */
  assignedTo: string;
}

const DEFAULT_FORM: FormData = {
  contactName: '',
  contactPhone: '',
  contactSecondPhone: '',
  contactEmail: '',
  source: 'other',
  sourceDetail: '',
  priority: 'warm',
  stage: 'new',
  interestedIn: '',
  nextFollowUpAt: null,
  notes: '',
  estimateAmount: '',
  assignedTo: '',
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AddLeadScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { isOrganizer, user } = useAuth();
  const { t } = useTranslation();
  const { edit } = useLocalSearchParams<{ edit?: string }>();

  const [form, setForm]             = useState<FormData>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);

  // Duplicates are checked while the number is typed, so the person learns
  // before filling in the rest — and again on save, which is the rule.
  const [duplicates, setDuplicates] = useState<DuplicateResult | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  // Which save button the override continues: "Save" or "Save & create new".
  const [pendingCreateNew, setPendingCreateNew] = useState(false);
  // `live` opened while typing — the form is not finished, so the override
  // means "carry on"; `save` opened by saving — the override saves.
  const [duplicateMode, setDuplicateMode] = useState<'live' | 'save'>('live');
  // A number the person has already chosen to keep, so saving does not ask again.
  const [acknowledgedPhone, setAcknowledgedPhone] = useState<string | null>(null);

  const typedPhone = useDebouncedValue(form.contactPhone.trim(), 450);
  const liveDuplicates = useQuery({
    queryKey: ['lead-duplicates', typedPhone, edit ?? ''],
    queryFn: () => leadService.findDuplicates(typedPhone, undefined, edit),
    // A partial number matches nothing worth warning about.
    enabled: isValidPhone(typedPhone),
    // Never an old answer: another lead with this number may have been saved
    // a minute ago, by this person or anyone else.
    staleTime: 0,
  });
  const liveMatch = isValidPhone(typedPhone) ? liveDuplicates.data : undefined;
  const [announcedFor, setAnnouncedFor] = useState<string | null>(null);

  // Editing loads the lead into this same form. Without it, "Edit lead" opened a
  // blank create form and saving made a second lead.
  const editQuery = useQuery({
    queryKey: ['lead', edit ?? ''],
    queryFn: () => leadService.getById(edit!),
    enabled: !!edit,
  });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Like the reference app: the moment a complete number turns out to be
  // taken, the details open by themselves — once per number, so closing the
  // dialog is respected. Editing a lead does not raise it for the number the
  // lead already had.
  useEffect(() => {
    if (!liveMatch || liveMatch.total === 0) return;
    if (announcedFor === typedPhone) return;
    if (edit && editQuery.data?.contactPhone === typedPhone) return;
    setAnnouncedFor(typedPhone);
    setDuplicates(liveMatch);
    setDuplicateMode('live');
    setDuplicateOpen(true);
  }, [liveMatch, typedPhone, announcedFor, edit, editQuery.data?.contactPhone]);

  React.useEffect(() => {
    const lead = editQuery.data;
    if (!lead || loadedFor === lead._id) return;
    const assigned =
      lead.assignedTo && typeof lead.assignedTo === 'object' ? lead.assignedTo._id : lead.assignedTo ?? '';
    setForm({
      contactName: lead.contactName,
      contactPhone: lead.contactPhone,
      contactSecondPhone: lead.contactSecondPhone ?? '',
      contactEmail: lead.contactEmail ?? '',
      source: lead.source,
      sourceDetail: lead.sourceDetail ?? '',
      priority: lead.priority,
      stage: lead.stage,
      interestedIn: lead.interestedIn ?? '',
      nextFollowUpAt: lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null,
      notes: lead.notes ?? '',
      estimateAmount: lead.budgetMax != null ? String(lead.budgetMax) : '',
      assignedTo: assigned,
    });
    setLoadedFor(lead._id);
  }, [editQuery.data, loadedFor]);

  // Picker modal state
  const [showSourcePicker, setShowSourcePicker]   = useState(false);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const [showStagePicker, setShowStagePicker]     = useState(false);
  const [showPurposePicker, setShowPurposePicker] = useState(false);
  const [showAssignPicker, setShowAssignPicker]   = useState(false);

  // Handing a new lead to someone else is an organizer's call; the API refuses
  // it from anyone else, so nobody else is offered the picker.
  const membersQuery = useQuery({
    queryKey: queryKeys.users.members,
    queryFn: () => userService.list(),
    enabled: isOrganizer,
    staleTime: 5 * 60_000,
  });
  const memberLabel = (id: string, name: string) =>
    id === user?._id ? t('memberFilter.self', { name }) : name;

  // Date picker state
  const [showDatePicker, setShowDatePicker] = useState(false);

  const set = <K extends keyof FormData>(key: K) => (value: FormData[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const sourceName  = SOURCES.find(s => s.value === form.source)?.label ?? 'Other';
  const qualityName = QUALITIES.find(q => q.value === form.priority)?.label ?? 'Medium';
  const stageName   = STAGES.find(s => s.value === form.stage)?.label ?? 'New';
  const assignee    = membersQuery.data?.find(m => m._id === form.assignedTo);
  const assigneeName = assignee
    ? memberLabel(assignee._id, assignee.name)
    : t('memberFilter.self', { name: user?.name ?? '' });

  // ── Validation ──

  const validate = (): string | null => {
    if (!form.contactName.trim()) return 'Contact name is required.';
    if (!form.contactPhone.trim()) return 'Contact phone is required.';
    // A landline or a foreign number is a legitimate lead contact, so this only
    // rejects what is not a phone number at all — matching the API's rule.
    if (!isValidPhone(form.contactPhone)) return 'Enter a valid contact phone number.';
    if (form.contactSecondPhone.trim() && !isValidPhone(form.contactSecondPhone))
      return 'Enter a valid alternate phone number.';
    if (form.contactEmail.trim() && !/\S+@\S+\.\S+/.test(form.contactEmail))
      return 'Invalid email address.';
    if (form.estimateAmount && isNaN(Number(form.estimateAmount)))
      return 'Estimate amount must be a number.';
    return null;
  };

  // ── Submit ──

  const refreshLeadQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ['leads'] });
    void queryClient.invalidateQueries({ queryKey: ['leads-stats'] });
    // The lead just saved is now a duplicate of its own number.
    void queryClient.invalidateQueries({ queryKey: ['lead-duplicates'] });
    if (edit) void queryClient.invalidateQueries({ queryKey: ['lead', edit] });
  };

  const submit = async (andCreateNew: boolean, allowDuplicate = false) => {
    const error = validate();
    if (error) { Alert.alert('Validation', error); return; }
    if (edit && !loadedFor) return;

    const original = editQuery.data;
    if (form.stage === 'drop' && (!edit || original?.stage !== 'drop')) {
      // Dropping needs a reason, which the lead's own screen asks for.
      Alert.alert(
        'Drop from the lead screen',
        edit
          ? 'To drop this lead, use Drop on its detail screen and give the reason.'
          : 'Create the lead first, then drop it from its detail screen with the reason.'
      );
      return;
    }

    const estimate = form.estimateAmount.trim() ? Number(form.estimateAmount) : undefined;
    const details = {
      contactName:        form.contactName.trim(),
      contactPhone:       form.contactPhone.trim(),
      contactEmail:       form.contactEmail.trim() || undefined,
      source:             form.source,
      sourceDetail:       form.sourceDetail.trim() || undefined,
      priority:           form.priority,
      interestedIn:       form.interestedIn.trim() || undefined,
      // One estimate on the form; the lead models a budget range and the
      // list's budget filter matches on overlap, so a single figure is stored
      // as a range of one.
      budgetMin:          estimate,
      budgetMax:          estimate,
      nextFollowUpAt:     form.nextFollowUpAt ? form.nextFollowUpAt.toISOString() : undefined,
      notes:              form.notes.trim() || undefined,
      allowDuplicate:
        allowDuplicate || acknowledgedPhone === form.contactPhone.trim() || undefined,
    };

    try {
      setSubmitting(true);

      if (edit && original) {
        await leadService.update(edit, {
          ...details,
          // '' clears a second number that was removed.
          contactSecondPhone: form.contactSecondPhone.trim(),
          assignedTo: isOrganizer && form.assignedTo ? form.assignedTo : undefined,
        });
        // Stage has its own endpoint, where its transition rules apply.
        if (form.stage !== original.stage) {
          await leadService.updateStage(edit, form.stage);
        }
        refreshLeadQueries();
        Alert.alert('Lead Updated', 'Your changes are saved.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }

      await leadService.create({
        ...details,
        contactSecondPhone: form.contactSecondPhone.trim() || undefined,
        stage:              form.stage,
        assignedTo:
          isOrganizer && form.assignedTo && form.assignedTo !== user?._id
            ? form.assignedTo
            : undefined,
      });
      refreshLeadQueries();

      if (andCreateNew) {
        setForm(DEFAULT_FORM);
        Alert.alert('Lead Created', 'Lead saved. Add another one.');
      } else {
        Alert.alert('Lead Created', 'Lead created successfully.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (err: any) {
      const apiError = err?.response?.data?.error;
      if (apiError?.code === 'DUPLICATE_LEAD') {
        const found: DuplicateLeadDetails = apiError.details ?? { leadNumber: '' };
        // Older servers send one match at the top level and no list.
        const matches = found.matches ?? [
          {
            leadNumber: found.leadNumber,
            stage: 'new' as const,
            createdAt: new Date().toISOString(),
            matchedPhone: form.contactPhone.trim(),
            assignedToName: found.assignedToName,
            leadId: found.leadId,
            contactName: found.contactName,
            canView: Boolean(found.leadId),
          },
        ];
        setDuplicates({ total: found.total ?? matches.length, matches });
        setPendingCreateNew(andCreateNew);
        setDuplicateMode('save');
        setDuplicateOpen(true);
        return;
      }
      Alert.alert('Error', apiError?.message || (edit ? 'Failed to save the lead.' : 'Failed to create lead.'));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Date picker handler ──

  const handleDateChange = (event: any, date?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (date && event.type !== 'dismissed') set('nextFollowUpAt')(date);
  };

  // ── Render ──

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Nav */}
      <View style={[styles.navBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>{edit ? 'Edit Lead' : 'Create Lead'}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 140 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Customer Info ── */}
        <SectionCard title="Customer Information">
          <FieldRow icon="person-outline" label="Customer Name" required>
            <RNTextInput
              style={styles.fieldInput}
              placeholder="Enter customer name"
              placeholderTextColor={colors.textDisabled}
              value={form.contactName}
              onChangeText={set('contactName')}
            />
          </FieldRow>

          <FieldRow
            icon="logo-whatsapp"
            label="WhatsApp Number"
            required
            error={!!liveMatch && liveMatch.total > 0}
          >
            <RNTextInput
              style={styles.fieldInput}
              placeholder="Enter WhatsApp mobile number"
              placeholderTextColor={colors.textDisabled}
              keyboardType="phone-pad"
              value={form.contactPhone}
              onChangeText={set('contactPhone')}
            />
          </FieldRow>
          {liveMatch && liveMatch.total > 0 ? (
            <TouchableOpacity
              style={styles.duplicateHint}
              onPress={() => {
                setDuplicates(liveMatch);
                setDuplicateMode('live');
                setDuplicateOpen(true);
              }}
              accessibilityRole="button"
            >
              <Ionicons name="alert-circle" size={15} color={colors.error} />
              <Text style={styles.duplicateHintText}>
                {t('duplicates.inline', { count: liveMatch.total })}
              </Text>
              <Text style={styles.duplicateHintLink}>{t('duplicates.details')}</Text>
            </TouchableOpacity>
          ) : null}

          <FieldRow icon="call-outline" label="Second Number">
            <RNTextInput
              style={styles.fieldInput}
              placeholder="Enter alternate mobile number"
              placeholderTextColor={colors.textDisabled}
              keyboardType="phone-pad"
              value={form.contactSecondPhone}
              onChangeText={set('contactSecondPhone')}
            />
          </FieldRow>

          <FieldRow icon="mail-outline" label="Customer Email">
            <RNTextInput
              style={styles.fieldInput}
              placeholder="Enter customer email"
              placeholderTextColor={colors.textDisabled}
              keyboardType="email-address"
              autoCapitalize="none"
              value={form.contactEmail}
              onChangeText={set('contactEmail')}
            />
          </FieldRow>
        </SectionCard>

        {/* ── Lead Info ── */}
        <SectionCard title="Lead Information">
          <PickerRow
            icon="funnel-outline"
            label="Lead Status"
            value={stageName}
            placeholder="Select lead status"
            onPress={() => setShowStagePicker(true)}
          />

          {isOrganizer ? (
            <PickerRow
              icon="person-add-outline"
              label={t('leadForm.assignTo')}
              value={assigneeName}
              placeholder={t('leadForm.assignTo')}
              onPress={() => setShowAssignPicker(true)}
            />
          ) : null}

          <PickerRow
            icon="globe-outline"
            label="Lead Source"
            value={sourceName}
            placeholder="Select lead source"
            onPress={() => setShowSourcePicker(true)}
          />

          {form.source === 'referral' && (
            <FieldRow icon="people-outline" label="Referred By">
              <RNTextInput
                style={styles.fieldInput}
                placeholder="Enter referrer name"
                placeholderTextColor={colors.textDisabled}
                value={form.sourceDetail}
                onChangeText={set('sourceDetail')}
              />
            </FieldRow>
          )}

          <PickerRow
            icon="ribbon-outline"
            label="Leads Quality"
            value={qualityName}
            placeholder="Select quality"
            onPress={() => setShowQualityPicker(true)}
          />
        </SectionCard>

        {/* ── Requirement ── */}
        <SectionCard title="Requirement">
          <PickerRow
            icon="search-outline"
            label="Purpose of Inquiry"
            value={form.interestedIn || undefined}
            placeholder="Select purpose of inquiry"
            onPress={() => setShowPurposePicker(true)}
          />

          <FieldRow icon="cash-outline" label="Estimate Amount (₹)">
            <RNTextInput
              style={styles.fieldInput}
              placeholder="Enter estimate amount"
              placeholderTextColor={colors.textDisabled}
              keyboardType="numeric"
              value={form.estimateAmount}
              onChangeText={set('estimateAmount')}
            />
          </FieldRow>
        </SectionCard>

        {/* ── Follow-up & Notes ── */}
        <SectionCard title="Follow-up & Notes">
          {/* Lead Date (today, read-only display) */}
          <FieldRow icon="calendar-outline" label="Lead Date">
            <Text style={sStyles.pickerVal}>
              {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-')}
            </Text>
          </FieldRow>

          {/* Next Follow-up Date */}
          <TouchableOpacity style={sStyles.fieldRow} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
            <View style={sStyles.fieldIcon}>
              <Ionicons name="alarm-outline" size={18} color={colors.primary} />
            </View>
            <View style={sStyles.fieldBody}>
              <Text style={sStyles.fieldLabel}>Next Follow-up Date</Text>
              <Text style={form.nextFollowUpAt ? sStyles.pickerVal : sStyles.pickerPH}>
                {form.nextFollowUpAt
                  ? form.nextFollowUpAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                  : 'Select follow-up date'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {form.nextFollowUpAt && (
                <TouchableOpacity onPress={() => set('nextFollowUpAt')(null)}>
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>

          {/* iOS date picker shows inline */}
          {showDatePicker && Platform.OS === 'ios' && (
            <View style={styles.iosDateWrap}>
              <View style={styles.iosDateHeader}>
                <Text style={styles.iosDateTitle}>Select Follow-up Date</Text>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={form.nextFollowUpAt || new Date()}
                mode="date"
                display="spinner"
                minimumDate={new Date()}
                onChange={handleDateChange}
                style={{ height: 130 }}
              />
            </View>
          )}

          {/* Android date picker dialog */}
          {showDatePicker && Platform.OS === 'android' && (
            <DateTimePicker
              value={form.nextFollowUpAt || new Date()}
              mode="date"
              display="calendar"
              minimumDate={new Date()}
              onChange={handleDateChange}
            />
          )}

          <FieldRow icon="document-text-outline" label="Notes">
            <RNTextInput
              style={[styles.fieldInput, styles.notesInput]}
              placeholder="Add notes about this lead..."
              placeholderTextColor={colors.textDisabled}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              value={form.notes}
              onChangeText={set('notes')}
            />
          </FieldRow>
        </SectionCard>

      </ScrollView>

      {/* ── Fixed bottom buttons ── */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.saveViewBtn, submitting && styles.btnDisabled]}
          onPress={() => submit(false)}
          disabled={submitting}
          activeOpacity={0.85}
        >
          <Text style={styles.saveViewText}>
            {submitting ? 'Saving…' : 'Save & View Leads'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveNewBtn, submitting && styles.btnDisabled]}
          onPress={() => submit(true)}
          disabled={submitting}
          activeOpacity={0.85}
        >
          <Text style={styles.saveNewText}>Save & Create New Lead</Text>
        </TouchableOpacity>
      </View>

      {/* ── Picker Modals ── */}
      <PickerModal
        visible={showStagePicker}
        title="Select Lead Status"
        options={STAGES.map(s => ({ value: s.value, label: s.label }))}
        selected={form.stage}
        onSelect={set('stage')}
        onClose={() => setShowStagePicker(false)}
      />

      <PickerModal
        visible={showSourcePicker}
        title="Select Lead Source"
        options={SOURCES.map(s => ({ value: s.value, label: s.label, icon: s.icon }))}
        selected={form.source}
        onSelect={set('source')}
        onClose={() => setShowSourcePicker(false)}
      />

      <PickerModal
        visible={showQualityPicker}
        title="Select Leads Quality"
        options={QUALITIES.map(q => ({ value: q.value, label: q.label, desc: q.desc, color: q.color }))}
        selected={form.priority}
        onSelect={set('priority')}
        onClose={() => setShowQualityPicker(false)}
      />

      <PurposePickerModal
        visible={showPurposePicker}
        selected={form.interestedIn}
        onSelect={set('interestedIn')}
        onClose={() => setShowPurposePicker(false)}
        isOrganizer={isOrganizer}
      />

      <PickerModal
        visible={showAssignPicker}
        title={t('leadForm.assignTitle')}
        options={(membersQuery.data ?? []).map(m => ({
          value: m._id,
          label: memberLabel(m._id, m.name),
          desc: t(`team.roles.${m.role}`, { defaultValue: m.role }),
          icon: 'person-outline',
        }))}
        selected={form.assignedTo || user?._id || ''}
        onSelect={set('assignedTo')}
        onClose={() => setShowAssignPicker(false)}
      />

      <DuplicateLeadDialog
        visible={duplicateOpen && !!duplicates}
        // While typing, the dialog follows the latest check rather than the
        // first answer it opened with.
        total={(duplicateMode === 'live' && liveMatch ? liveMatch : duplicates)?.total ?? 0}
        matches={(duplicateMode === 'live' && liveMatch ? liveMatch : duplicates)?.matches ?? []}
        editing={!!edit}
        mode={duplicateMode}
        onClose={() => setDuplicateOpen(false)}
        onViewLead={(leadId) => {
          setDuplicateOpen(false);
          router.replace(`/lead/${leadId}`);
        }}
        onCreateAnyway={() => {
          setDuplicateOpen(false);
          if (duplicateMode === 'live') {
            // Carry on with the form; the save will not ask about this number again.
            setAcknowledgedPhone(form.contactPhone.trim());
            return;
          }
          void submit(pendingCreateNew, true);
        }}
      />

    </KeyboardAvoidingView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Under the number, while it is typed: the duplicate is news before Save.
  duplicateHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // Below the row's red underline, never on it.
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: spacing.md,
    backgroundColor: `${colors.error}08`,
  },
  duplicateHintText: { flex: 1, fontSize: 12.5, color: colors.error },
  duplicateHintLink: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  scroll: {
    padding: spacing.md,
    gap: 0,
  },
  fieldInput: {
    fontSize: 15,
    color: colors.text,
    paddingVertical: 2,
    paddingHorizontal: 0,
    minHeight: 24,
  },
  notesInput: {
    minHeight: 72,
    marginTop: 4,
  },
  iosDateWrap: {
    backgroundColor: colors.background,
    marginHorizontal: spacing.md,
    marginBottom: 8,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  iosDateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iosDateTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  saveViewBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveViewText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  saveNewBtn: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: borderRadius.xl,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  saveNewText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
