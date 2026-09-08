import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Ellipse, Rect, Path, Circle, Line, G } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purposeService, PurposeOfInquiry } from '../../src/services/purpose.service';
import { useAuth } from '../../src/stores/auth.store';
import { ScreenHeader } from '../../src/components/ui';
import { colors } from '../../src/theme';

// ─── Empty-state illustration ─────────────────────────────────────────────────

function NoDataIllustration() {
  return (
    <Svg width={220} height={220} viewBox="0 0 220 220">
      <Ellipse cx="108" cy="128" rx="88" ry="72" fill="#DDEEFF" opacity="0.85" />
      <G transform="rotate(-8 95 110)">
        <Rect x="42" y="52" width="102" height="126" rx="8" ry="8" fill="#EBF4FF" stroke="#B8D8F8" strokeWidth="1.5" />
        <Path d="M118 52 L144 78 L118 78 Z" fill="#C8DEEF" />
        <Path d="M118 52 L118 78 L144 78" fill="none" stroke="#B8D8F8" strokeWidth="1.5" />
      </G>
      <Rect x="52" y="42" width="108" height="134" rx="8" ry="8" fill="#F4F9FF" stroke="#A8CBEF" strokeWidth="1.8" />
      <Path d="M132 42 L160 70 L132 70 Z" fill="#D6EBF9" />
      <Path d="M132 42 L132 70 L160 70" fill="none" stroke="#A8CBEF" strokeWidth="1.8" />
      <Path d="M100 102 C100 94 108 88 116 90 C124 92 128 100 122 106 C118 110 112 112 112 118" fill="none" stroke="#A0BFDF" strokeWidth="8" strokeLinecap="round" />
      <Circle cx="112" cy="128" r="4" fill="#A0BFDF" />
      <Circle cx="148" cy="148" r="26" fill="#2196F3" />
      <Circle cx="148" cy="148" r="22" fill="#42A5F5" />
      <Line x1="140" y1="140" x2="156" y2="156" stroke="white" strokeWidth="4" strokeLinecap="round" />
      <Line x1="156" y1="140" x2="140" y2="156" stroke="white" strokeWidth="4" strokeLinecap="round" />
      <Circle cx="148" cy="148" r="26" fill="none" stroke="#E3F2FD" strokeWidth="3" />
      <Rect x="166" y="161" width="10" height="36" rx="5" ry="5" fill="#1565C0" transform="rotate(45 171 179)" />
    </Svg>
  );
}

// ─── Drag handle dots icon ────────────────────────────────────────────────────

function DragHandle() {
  return (
    <View style={styles.dragHandle}>
      {[0, 1, 2].map(row => (
        <View key={row} style={styles.dragRow}>
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
      ))}
    </View>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

type RowProps = RenderItemParams<PurposeOfInquiry> & {
  canEdit: boolean;
  onEdit: (item: PurposeOfInquiry) => void;
  onDelete: (item: PurposeOfInquiry) => void;
};

const PurposeRow = React.memo(function PurposeRow({
  item,
  drag,
  isActive,
  canEdit,
  onEdit,
  onDelete,
}: RowProps) {
  return (
    <ScaleDecorator activeScale={1.03}>
      <View style={[styles.row, isActive && styles.rowActive]}>
        {/* Drag handle */}
        <TouchableOpacity
          onLongPress={canEdit ? drag : undefined}
          delayLongPress={120}
          activeOpacity={0.6}
          disabled={!canEdit}
        >
          <DragHandle />
        </TouchableOpacity>

        {/* Name */}
        <Text style={styles.rowName} numberOfLines={2}>{item.name}</Text>

        {/* Action buttons */}
        {canEdit && (
          <View style={styles.rowActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.editBtn]}
              onPress={() => onEdit(item)}
              activeOpacity={0.82}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="pencil" size={15} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.deleteBtn]}
              onPress={() => onDelete(item)}
              activeOpacity={0.82}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash" size={15} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScaleDecorator>
  );
});

// ─── Bottom sheet ─────────────────────────────────────────────────────────────

type SheetMode = 'create' | 'edit';

interface SheetState {
  visible: boolean;
  mode: SheetMode;
  editItem: PurposeOfInquiry | null;
}

const SHEET_CLOSED: SheetState = { visible: false, mode: 'create', editItem: null };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PurposesScreen() {
  const router      = useRouter();
  const insets      = useSafeAreaInsets();
  const { isOrganizer } = useAuth();
  const queryClient = useQueryClient();

  const [sheet, setSheet]     = useState<SheetState>(SHEET_CLOSED);
  const [inputValue, setInput] = useState('');
  const inputRef  = useRef<TextInput>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  // Local data for optimistic reorder
  const [localData, setLocalData] = useState<PurposeOfInquiry[] | null>(null);

  // ── Queries ──

  const { data: serverData = [], isLoading, refetch, isRefetching } = useQuery<PurposeOfInquiry[]>({
    queryKey: ['purposes'],
    queryFn: purposeService.getAll,
    staleTime: 30_000,
  });

  const purposes = localData ?? serverData;

  const createMutation = useMutation({
    mutationFn: (name: string) => purposeService.create(name),
    onSuccess: () => {
      setLocalData(null);
      queryClient.invalidateQueries({ queryKey: ['purposes'] });
      closeSheet();
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.error?.message || 'Failed to create purpose');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => purposeService.update(id, name),
    onSuccess: () => {
      setLocalData(null);
      queryClient.invalidateQueries({ queryKey: ['purposes'] });
      closeSheet();
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.error?.message || 'Failed to update purpose');
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => purposeService.reorder(orderedIds),
    onError: () => {
      setLocalData(null); // rollback
      queryClient.invalidateQueries({ queryKey: ['purposes'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => purposeService.remove(id),
    onSuccess: () => {
      setLocalData(null);
      queryClient.invalidateQueries({ queryKey: ['purposes'] });
    },
    onError: (err: any) => {
      Alert.alert('Error', err?.response?.data?.error?.message || 'Failed to delete');
    },
  });

  // ── Sheet helpers ──

  const openSheet = (mode: SheetMode, item?: PurposeOfInquiry) => {
    setSheet({ visible: true, mode, editItem: item ?? null });
    setInput(item?.name ?? '');
    setTimeout(() => {
      Animated.spring(sheetAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 68,
        friction: 12,
      }).start(() => inputRef.current?.focus());
    }, 20);
  };

  const closeSheet = () => {
    Animated.timing(sheetAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setSheet(SHEET_CLOSED);
      setInput('');
    });
  };

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [340, 0],
  });

  // ── Handlers ──

  const handleSubmit = () => {
    const name = inputValue.trim();
    if (!name) { Alert.alert('Required', 'Please enter a purpose name.'); return; }
    if (sheet.mode === 'create') {
      createMutation.mutate(name);
    } else {
      updateMutation.mutate({ id: sheet.editItem!._id, name });
    }
  };

  const handleDelete = useCallback((item: PurposeOfInquiry) => {
    Alert.alert('Delete', `Remove "${item.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(item._id) },
    ]);
  }, []);

  const handleDragEnd = useCallback(({ data }: { data: PurposeOfInquiry[] }) => {
    setLocalData(data);
    reorderMutation.mutate(data.map(p => p._id));
  }, []);

  const renderItem = useCallback((params: RenderItemParams<PurposeOfInquiry>) => (
    <PurposeRow
      {...params}
      canEdit={isOrganizer}
      onEdit={(item) => openSheet('edit', item)}
      onDelete={handleDelete}
    />
  ), [isOrganizer, handleDelete]);

  const keyExtractor = useCallback((item: PurposeOfInquiry) => item._id, []);

  const isPending = createMutation.isPending || updateMutation.isPending;

  // ── Render ──

  return (
    <GestureHandlerRootView style={styles.flex}>
      <View style={styles.container}>

        <ScreenHeader title="Purposes" />

        {/* Body */}
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>

        ) : purposes.length === 0 ? (
          <View style={styles.emptyWrap}>
            <NoDataIllustration />
            <Text style={styles.emptyLabel}>NO DATA FOUND</Text>
          </View>

        ) : (
          <DraggableFlatList
            data={purposes}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            onDragEnd={handleDragEnd}
            activationDistance={10}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: insets.bottom + 96 },
            ]}
            refreshing={isRefetching}
            onRefresh={() => { setLocalData(null); refetch(); }}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}

        {/* FAB */}
        {isOrganizer && (
          <TouchableOpacity
            style={[styles.fab, { bottom: Math.max(28, insets.bottom + 20) }]}
            onPress={() => openSheet('create')}
            activeOpacity={0.88}
          >
            <Ionicons name="add" size={30} color="#fff" />
          </TouchableOpacity>
        )}

        {/* Bottom sheet modal */}
        <Modal
          visible={sheet.visible}
          transparent
          animationType="none"
          statusBarTranslucent
          onRequestClose={closeSheet}
        >
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <Pressable style={styles.backdrop} onPress={closeSheet} />

            <Animated.View
              style={[
                styles.sheet,
                { paddingBottom: Math.max(insets.bottom + 20, 28) },
                { transform: [{ translateY: sheetTranslateY }] },
              ]}
            >
              <View style={styles.handle} />

              <Text style={styles.sheetTitle}>
                {sheet.mode === 'create' ? 'Create Purpose of Inquiry' : 'Edit Purpose'}
              </Text>

              <Text style={styles.fieldLabel}>Purpose of Inquiry</Text>
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder="Enter Your Purpose of Inquiry"
                placeholderTextColor="#A0AEC0"
                value={inputValue}
                onChangeText={setInput}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                maxLength={120}
                autoCapitalize="words"
              />

              <TouchableOpacity
                style={[styles.submitBtn, isPending && { opacity: 0.65 }]}
                onPress={handleSubmit}
                disabled={isPending}
                activeOpacity={0.86}
              >
                {isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.submitBtnText}>
                      {sheet.mode === 'create' ? 'Create' : 'Save'}
                    </Text>
                }
              </TouchableOpacity>
            </Animated.View>
          </KeyboardAvoidingView>
        </Modal>

      </View>
    </GestureHandlerRootView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BLUE = colors.primary;

const styles = StyleSheet.create({
  flex: { flex: 1 },

  container: {
    flex: 1,
    backgroundColor: '#fff',
  },


  /* Loading */
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* Empty */
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingBottom: 60,
  },
  emptyLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#A0AEC0',
    letterSpacing: 1.5,
  },

  /* List */
  listContent: {
    paddingTop: 8,
    paddingHorizontal: 12,
  },
  separator: {
    height: 1,
    backgroundColor: '#E8F0FE',
  },

  /* Row */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F0FE',
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 10,
    borderRadius: 4,
    marginVertical: 1,
  },
  rowActive: {
    backgroundColor: '#D0E4FF',
    shadowColor: '#2196F3',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },

  /* Drag handle */
  dragHandle: {
    gap: 3,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  dragRow: {
    flexDirection: 'row',
    gap: 3,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#7A9BBF',
  },

  rowName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1A202C',
    lineHeight: 21,
  },

  rowActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editBtn: {
    backgroundColor: BLUE,
  },
  deleteBtn: {
    backgroundColor: '#EF4444',
  },

  /* FAB */
  fab: {
    position: 'absolute',
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: BLUE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: BLUE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.42,
    shadowRadius: 12,
    elevation: 10,
  },

  /* Modal */
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },

  /* Sheet */
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 24,
  },
  handle: {
    width: 46,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#CBD5E0',
    alignSelf: 'center',
    marginBottom: 22,
  },
  sheetTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#1A202C',
    textAlign: 'center',
    marginBottom: 22,
    lineHeight: 28,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4A5568',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1.8,
    borderColor: BLUE,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 15 : 13,
    fontSize: 15,
    color: '#1A202C',
    backgroundColor: '#fff',
    marginBottom: 20,
  },
  submitBtn: {
    backgroundColor: BLUE,
    borderRadius: 12,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: BLUE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 10,
    elevation: 6,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.4,
  },
});
