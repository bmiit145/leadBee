import React from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing } from '../src/theme';
import { leadService } from '../src/services/lead.service';
import { Lead } from '../src/types';
import { LeadCard } from '../src/components/LeadCard';
import { ScreenHeader, EmptyState } from '../src/components/ui';

/** Dedicated bookmarked-leads list — separate from the per-card bookmark
 *  toggle in LeadQuickActions. */
export default function BookMarksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['bookmarked-leads'],
    queryFn: () => leadService.getAll({ bookmarked: true, limit: 100 }),
  });

  return (
    <View style={styles.screen}>
      <ScreenHeader title="BookMarks" />

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={data?.data ?? []}
          keyExtractor={(item: Lead) => item._id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + 24 }}
          refreshing={isFetching}
          onRefresh={refetch}
          renderItem={({ item }) => (
            <LeadCard lead={item} onPress={() => router.push(`/lead/${item._id}`)} />
          )}
          ListEmptyComponent={
            <EmptyState title="No Bookmarks" message="Bookmark a lead to see it here." icon="bookmark-outline" />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
