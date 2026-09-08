import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable } from 'react-native';
import { colors, spacing, borderRadius } from '../../theme';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  /** `bar` renders the title on a solid primary header strip (Choose Reminder,
   *  Select Meeting Type); `plain` puts it as centred text on the white card. */
  titleVariant?: 'bar' | 'plain';
  children: React.ReactNode;
}

/**
 * The centered white card + backdrop shell used by every "pick one" dialog.
 * Bottom sheets (Select meeting time, Select Lead) use BottomSheet instead —
 * this is only for the smaller, centered dialogs.
 */
export function CenterDialog({ visible, onDismiss, title, titleVariant = 'bar', children }: Props) {
  const bar = titleVariant === 'bar';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Pressable style={styles.card} onPress={() => {}}>
          {bar ? (
            <View style={styles.headerBar}>
              <Text style={styles.headerBarText}>{title}</Text>
            </View>
          ) : null}

          <View style={styles.body}>
            {bar ? null : <Text style={styles.plainTitle}>{title}</Text>}
            {children}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    maxHeight: '80%',
  },
  headerBar: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
  },
  headerBarText: {
    fontSize: 19,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  body: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  plainTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
});
