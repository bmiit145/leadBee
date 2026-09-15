import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { User } from '../types';
import { colors } from '../theme';
import { Avatar } from './ui';

interface Props {
  members: Pick<User, '_id' | 'name'>[];
  /** Avatars drawn before the rest collapse into "+N". */
  max?: number;
  size?: number;
}

/** Overlapping initials for the people on a task or meeting, with "+N" for the rest. */
export function MemberStack({ members, max = 3, size = 26 }: Props) {
  if (members.length === 0) return null;
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;

  return (
    <View
      style={styles.row}
      accessibilityLabel={members.map((m) => m.name).join(', ')}
    >
      {shown.map((member, i) => (
        <Avatar
          key={member._id}
          name={member.name}
          size={size}
          variant="solid"
          style={[styles.ring, i > 0 && { marginLeft: -size * 0.3 }]}
        />
      ))}
      {rest > 0 ? (
        <View
          style={[
            styles.ring,
            styles.more,
            { width: size, height: size, borderRadius: size / 2, marginLeft: -size * 0.3 },
          ]}
        >
          <Text style={[styles.moreText, { fontSize: size * 0.36 }]}>+{rest}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  ring: { borderWidth: 2, borderColor: colors.surface },
  more: { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontWeight: '800', color: colors.text },
});
