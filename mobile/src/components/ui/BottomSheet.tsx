import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Animated,
  Pressable,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius } from '../../theme';

const SCREEN_HEIGHT = Dimensions.get('window').height;

interface Props {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
  maxHeightRatio?: number;
}

/**
 * Slide-up sheet with a drag handle — used for "Select meeting time", the
 * thread composer, and any sheet that needs more room than CenterDialog.
 *
 * Owns keyboard avoidance for every caller: the sheet floats above the
 * keyboard instead of being covered by it (same KeyboardAvoidingView setup as
 * QuickNoteModal — `padding` on iOS, `height` on Android). Callers must NOT add
 * their own KeyboardAvoidingView inside.
 */
export function BottomSheet({ visible, onDismiss, children, maxHeightRatio = 0.85 }: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : SCREEN_HEIGHT,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [visible, translateY]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onDismiss}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onDismiss}>
          <Animated.View
            style={[
              styles.sheet,
              {
                maxHeight: SCREEN_HEIGHT * maxHeightRatio,
                paddingBottom: Math.max(spacing.lg, insets.bottom + spacing.md),
                transform: [{ translateY }],
              },
            ]}
          >
            <Pressable onPress={() => {}}>
              <View style={styles.handle} />
              {children}
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
});
