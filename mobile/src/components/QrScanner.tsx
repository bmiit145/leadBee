import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  Linking,
} from 'react-native';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, borderRadius } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VIEWFINDER_SIZE = SCREEN_WIDTH * 0.68;
const CORNER_SIZE = 28;
const CORNER_RADIUS = 14;
const CORNER_WIDTH = 4;

interface QrScannerProps {
  /** Called once a QR code has been recognized. Receives the raw QR data string. */
  onScanned: (data: string) => void;
  /** Close the scanner and go back to the input form. */
  onClose: () => void;
}

/**
 * Full-screen QR code scanner with a Paytm-style viewfinder overlay.
 *
 * Uses `expo-camera` `CameraView` with built-in barcode scanning —
 * no deprecated `expo-barcode-scanner` dependency.
 *
 * A pulsing scan-line animation gives visual feedback that the camera is active.
 * The viewfinder corners are drawn with absolute-positioned views
 * so the dark overlay has a transparent cut-out in the centre.
 */
export function QrScanner({ onScanned, onClose }: QrScannerProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [hasScanned, setHasScanned] = useState(false);
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  // Start the scan-line animation when the camera is ready.
  const startScanLineAnimation = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: 1,
          duration: 2200,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineAnim, {
          toValue: 0,
          duration: 2200,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [scanLineAnim]);

  const handleBarCodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (hasScanned) return;
      setHasScanned(true);
      onScanned(result.data);
    },
    [hasScanned, onScanned],
  );

  const translateY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, VIEWFINDER_SIZE - 4],
  });

  // ── Permission states ──────────────────────────────────────────────
  if (!permission) {
    // Still loading permission status.
    return <View style={[styles.fullScreen, { backgroundColor: '#000' }]} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.fullScreen, styles.permissionScreen]}>
        <TouchableOpacity
          style={[styles.closeBtn, { top: insets.top + spacing.sm }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </TouchableOpacity>

        <Ionicons name="camera-outline" size={56} color="#FFFFFF" style={{ marginBottom: 16 }} />
        <Text style={styles.permissionTitle}>{t('join.scanQr')}</Text>
        <Text style={styles.permissionBody}>
          {permission.canAskAgain
            ? t('join.cameraPermission')
            : t('join.cameraPermissionSettings')}
        </Text>

        <TouchableOpacity
          style={styles.permissionBtn}
          onPress={() =>
            permission.canAskAgain ? requestPermission() : Linking.openSettings()
          }
          accessibilityRole="button"
        >
          <Text style={styles.permissionBtnText}>
            {permission.canAskAgain ? t('common.allow') : t('common.openSettings')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Camera active ──────────────────────────────────────────────────
  return (
    <View style={styles.fullScreen}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={hasScanned ? undefined : handleBarCodeScanned}
        onCameraReady={startScanLineAnimation}
      />

      {/* Dark overlay with transparent viewfinder */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Top */}
        <View style={styles.overlaySection} />
        {/* Middle row: left | viewfinder | right */}
        <View style={styles.overlayMiddle}>
          <View style={styles.overlaySide} />
          <View style={styles.viewfinder}>
            {/* Corner decorations */}
            <Corner position="topLeft" />
            <Corner position="topRight" />
            <Corner position="bottomLeft" />
            <Corner position="bottomRight" />

            {/* Scanning line animation */}
            <Animated.View
              style={[styles.scanLine, { transform: [{ translateY }] }]}
            />
          </View>
          <View style={styles.overlaySide} />
        </View>
        {/* Bottom */}
        <View style={styles.overlaySection} />
      </View>

      {/* Header: close button + hint */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        >
          <Ionicons name="close" size={26} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Bottom hint */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.hintText}>{t('join.scanHint')}</Text>
      </View>
    </View>
  );
}

// ── Corner decoration component ───────────────────────────────────────
function Corner({
  position,
}: {
  position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
}) {
  const isTop = position.startsWith('top');
  const isLeft = position.endsWith('Left');

  return (
    <View
      style={[
        styles.corner,
        isTop ? { top: -CORNER_WIDTH / 2 } : { bottom: -CORNER_WIDTH / 2 },
        isLeft ? { left: -CORNER_WIDTH / 2 } : { right: -CORNER_WIDTH / 2 },
        {
          borderColor: '#FFFFFF',
          ...(isTop && isLeft && {
            borderTopWidth: CORNER_WIDTH,
            borderLeftWidth: CORNER_WIDTH,
            borderTopLeftRadius: CORNER_RADIUS,
          }),
          ...(isTop && !isLeft && {
            borderTopWidth: CORNER_WIDTH,
            borderRightWidth: CORNER_WIDTH,
            borderTopRightRadius: CORNER_RADIUS,
          }),
          ...(!isTop && isLeft && {
            borderBottomWidth: CORNER_WIDTH,
            borderLeftWidth: CORNER_WIDTH,
            borderBottomLeftRadius: CORNER_RADIUS,
          }),
          ...(!isTop && !isLeft && {
            borderBottomWidth: CORNER_WIDTH,
            borderRightWidth: CORNER_WIDTH,
            borderBottomRightRadius: CORNER_RADIUS,
          }),
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    backgroundColor: '#000000',
  },
  // ── Overlay ──
  overlaySection: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  overlayMiddle: {
    flexDirection: 'row',
    height: VIEWFINDER_SIZE,
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  viewfinder: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
  },
  // ── Corners ──
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  // ── Scan line ──
  scanLine: {
    width: '100%',
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 2,
  },
  // ── Header / footer ──
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  closeBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  hintText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  // ── Permission screen ──
  permissionScreen: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  permissionTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  permissionBody: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
  permissionBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.full,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
  },
  permissionBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '700',
  },
});
