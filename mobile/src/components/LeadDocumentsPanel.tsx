import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leadService } from '../services/lead.service';
import { queryKeys } from '../lib/queryKeys';
import { LeadDocument, LeadDocumentKind } from '../types';
import { CenterDialog, EmptyState, PrimaryButton } from './ui';
import { TextField } from './fields/TextField';
import { colors, spacing, borderRadius } from '../theme';

interface Props {
  leadId: string;
  kind: LeadDocumentKind;
}

function fmtSize(bytes?: number): string | null {
  if (!bytes) return null;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * The "Document" / "Attachment" tabs — the same list, discriminated by `kind`.
 *
 * Files are captured as links (Drive/Cloudinary/S3 URL). Direct device upload
 * needs a storage backend to be chosen first — see LeadDocument model.
 */
export function LeadDocumentsPanel({ leadId, kind }: Props) {
  const qc = useQueryClient();
  const key = queryKeys.leads.documents(leadId, kind);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => leadService.getDocuments(leadId, kind),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const addMutation = useMutation({
    mutationFn: () => leadService.addDocument(leadId, { kind, name: name.trim(), url: url.trim() }),
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setName('');
      setUrl('');
    },
    onError: (err: any) => Alert.alert('Error', err?.response?.data?.message || 'Could not add the file link.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => leadService.deleteDocument(leadId, docId),
    onSuccess: invalidate,
    onError: () => Alert.alert('Error', 'Could not delete.'),
  });

  const open = (doc: LeadDocument) =>
    Linking.openURL(doc.url).catch(() => Alert.alert('Cannot open this link.'));

  const rowMenu = (doc: LeadDocument) =>
    Alert.alert(doc.name, undefined, [
      { text: 'Open', onPress: () => open(doc) },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(doc._id) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const label = kind === 'document' ? 'Document' : 'Attachment';
  const rows = data ?? [];

  return (
    <View style={styles.wrap}>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={kind === 'document' ? 'document-text-outline' : 'attach-outline'}
          title={`No ${label.toLowerCase()}s`}
          message={`Add a link to a ${label.toLowerCase()} for this lead.`}
          actionLabel={`Add ${label}`}
          onAction={() => setDialogOpen(true)}
        />
      ) : (
        <>
          {rows.map((doc) => (
            <View key={doc._id} style={styles.row}>
              <View style={styles.fileIcon}>
                <Ionicons name="document" size={18} color={colors.textSecondary} />
              </View>
              <TouchableOpacity style={styles.rowBody} onPress={() => open(doc)}>
                <Text style={styles.name} numberOfLines={1}>{doc.name}</Text>
                <Text style={styles.meta}>
                  {doc.uploadedByName}
                  {fmtSize(doc.size) ? ` · ${fmtSize(doc.size)}` : ''}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shareBtn} onPress={() => open(doc)} accessibilityLabel="Open">
                <Ionicons name="arrow-redo" size={15} color="#1E8E5A" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => rowMenu(doc)} hitSlop={8}>
                <Ionicons name="ellipsis-vertical" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ))}
          <PrimaryButton label={`Add ${label}`} onPress={() => setDialogOpen(true)} style={styles.addBtn} />
        </>
      )}

      <CenterDialog visible={dialogOpen} onDismiss={() => setDialogOpen(false)} title={`Add ${label}`}>
        <View style={styles.dialogBody}>
          <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Booking form" />
          <TextField label="File link" value={url} onChangeText={setUrl} placeholder="https://…" />
          <PrimaryButton
            label="Add"
            onPress={() => addMutation.mutate()}
            disabled={!name.trim() || !url.trim() || addMutation.isPending}
          />
        </View>
      </CenterDialog>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  loader: { marginVertical: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  fileIcon: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  name: { fontSize: 14, fontWeight: '600', color: colors.text },
  meta: { fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  shareBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1E8E5A14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: { marginTop: spacing.md },
  dialogBody: { gap: spacing.md },
});
