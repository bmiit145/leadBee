import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { leadService } from '../services/lead.service';
import { queryKeys } from '../lib/queryKeys';
import { Lead } from '../types';
import { SectionBox, PrimaryButton } from './ui';
import { TextField } from './fields/TextField';
import { colors, spacing } from '../theme';

interface Props {
  lead: Lead;
}

/**
 * The "Client Details" tab: the address + GST fields the reference app captures
 * here (editable, saved back onto the lead), plus the read-only lead facts that
 * belong with them.
 */
export function LeadClientDetailsPanel({ lead }: Props) {
  const qc = useQueryClient();
  const [address, setAddress] = useState(lead.address ?? '');
  const [gstNumber, setGstNumber] = useState(lead.gstNumber ?? '');

  const dirty = address !== (lead.address ?? '') || gstNumber !== (lead.gstNumber ?? '');

  const saveMutation = useMutation({
    mutationFn: () =>
      leadService.update(lead._id, {
        address: address.trim(),
        gstNumber: gstNumber.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.leads.detail(lead._id) });
      qc.invalidateQueries({ queryKey: queryKeys.leads.all });
    },
    onError: (err: any) => Alert.alert('Error', err?.response?.data?.message || 'Could not save client details.'),
  });

  const assignedUser =
    typeof lead.assignedTo === 'object' && lead.assignedTo ? (lead.assignedTo as any) : null;

  const facts = [
    { label: 'Interested In', value: lead.interestedIn },
    {
      label: 'Budget',
      value:
        lead.budgetMin || lead.budgetMax
          ? `₹${(lead.budgetMin || 0).toLocaleString('en-IN')} – ₹${(lead.budgetMax || 0).toLocaleString('en-IN')}`
          : null,
    },
    { label: 'Config', value: lead.preferredConfig },
    { label: 'Assigned To', value: assignedUser?.name },
    { label: 'Lost Reason', value: lead.lostReason },
  ].filter((f) => f.value);

  return (
    <View style={styles.wrap}>
      <View style={styles.fields}>
        <TextField label="Address" value={address} onChangeText={setAddress} placeholder="Client address" multiline />
        <TextField label="GST Number" value={gstNumber} onChangeText={setGstNumber} placeholder="e.g. 24ABCDE1234F1Z5" />
        <PrimaryButton
          label="Save Details"
          onPress={() => saveMutation.mutate()}
          disabled={!dirty || saveMutation.isPending}
          loading={saveMutation.isPending}
        />
      </View>

      {facts.length > 0 && (
        <SectionBox label="Lead">
          {facts.map(({ label, value }) => (
            <View key={label} style={styles.factRow}>
              <Text style={styles.factLabel}>{label}</Text>
              <Text style={styles.factValue}>{value}</Text>
            </View>
          ))}
        </SectionBox>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  fields: { gap: spacing.md },
  factRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderLight,
    gap: spacing.sm,
  },
  factLabel: { fontSize: 14, color: colors.textSecondary, flex: 1 },
  factValue: { fontSize: 14, color: colors.text, fontWeight: '500', flex: 2, textAlign: 'right' },
});
