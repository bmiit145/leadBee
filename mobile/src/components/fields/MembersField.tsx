import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SectionBox } from '../ui/SectionBox';
import { FormField } from '../ui/FormField';
import { RemovableChip, ChipRow } from '../ui/RemovableChip';
import { MembersPickerModal } from '../ui/MembersPickerModal';
import { userService } from '../../services/user.service';
import { useAuth } from '../../stores/auth.store';

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}

/**
 * "Select Members" — the assignment field plus its picker and the chips for
 * whoever is already assigned. Owns its own modal state so screens only deal
 * in the selected ids.
 */
export function MembersField({ value, onChange, label = 'Meeting Assign' }: Props) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  const { data: members } = useQuery({
    queryKey: ['team-members'],
    queryFn: () => userService.list(),
    staleTime: 5 * 60_000,
  });

  const labelFor = (id: string) => {
    const m = members?.find((x) => x._id === id);
    if (!m) return 'Member';
    return m._id === user?._id ? `Self (${m.name})` : m.name;
  };

  return (
    <SectionBox label={label}>
      <FormField icon="person" placeholder="Select Members" onPress={() => setOpen(true)} />

      {value.length > 0 && (
        <ChipRow>
          {value.map((id) => (
            <RemovableChip
              key={id}
              label={labelFor(id)}
              onRemove={() => onChange(value.filter((x) => x !== id))}
            />
          ))}
        </ChipRow>
      )}

      <MembersPickerModal
        visible={open}
        onDismiss={() => setOpen(false)}
        selected={value}
        onChange={onChange}
      />
    </SectionBox>
  );
}
