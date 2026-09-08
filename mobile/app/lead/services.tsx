import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../../src/components/ui';
import { colors } from '../../src/theme';

interface ServiceItem {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  route: string;
  soon?: boolean;
}

const SERVICES: ServiceItem[] = [
  {
    label: 'Create Purpose',
    icon: 'chatbubbles-outline',
    route: '/lead/purposes',
  },
  // Future services go here
];

export default function ServicesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>

      <ScreenHeader title="Services" />

      {/* Service cards */}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {SERVICES.map((item) => (
          <TouchableOpacity
            key={item.label}
            style={[styles.card, item.soon && styles.cardDisabled]}
            onPress={() => !item.soon && router.push(item.route as any)}
            activeOpacity={item.soon ? 1 : 0.82}
            disabled={item.soon}
          >
            {/* Left icon circle */}
            <View style={styles.cardIconWrap}>
              <Ionicons name={item.icon} size={26} color="#fff" />
            </View>

            {/* Label */}
            <Text style={styles.cardLabel}>{item.label}</Text>

            {/* Right */}
            {item.soon ? (
              <View style={styles.soonBadge}>
                <Text style={styles.soonText}>SOON</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F6FA',
  },


  /* Cards */
  content: {
    padding: 16,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 18,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 5,
  },
  cardDisabled: {
    opacity: 0.6,
  },
  cardIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardLabel: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.2,
  },
  soonBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  soonText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
  },
});
