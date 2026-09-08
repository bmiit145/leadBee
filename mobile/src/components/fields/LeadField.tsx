import React, { useState } from 'react';
import { View } from 'react-native';
import { FieldLabel, FormField } from '../ui/FormField';
import { LeadPickerSheet } from '../LeadPickerSheet';
import { Lead } from '../../types';

interface Props {
  /** Currently chosen lead, when it has loaded. */
  lead?: Lead | null;
  selectedId?: string;
  onSelect: (lead: Lead) => void;
  label?: string;
  required?: boolean;
}

/** "Select Lead" — the field plus its searchable picker sheet. */
export function LeadField({ lead, selectedId, onSelect, label = 'Select Lead', required = true }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <View>
      <FieldLabel required={required}>{label}</FieldLabel>
      <FormField
        icon="person"
        value={lead?.contactName ?? null}
        placeholder="Select Lead"
        onPress={() => setOpen(true)}
      />
      <LeadPickerSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </View>
  );
}
