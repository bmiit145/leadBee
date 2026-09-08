import React from 'react';
import { SectionBox } from '../ui/SectionBox';
import { CommentComposer } from '../ui/CommentComposer';
import { TaskComment } from '../../types';

interface Props {
  comments: TaskComment[];
  onSubmit: (text: string) => void;
  onEdit?: (commentId: string, text: string) => void;
  onDelete?: (commentId: string) => void;
  submitting?: boolean;
  /** "Meeting Purpose" on a meeting, "Add Comments" on a task. */
  label?: string;
}

/**
 * A commentable section. Meetings label this "Meeting Purpose" and tasks
 * label it "Add Comments", but the composer, feed and edit/delete behaviour
 * are identical — so they share one implementation.
 */
export function CommentsField({
  comments,
  onSubmit,
  onEdit,
  onDelete,
  submitting,
  label = 'Add Comments',
}: Props) {
  return (
    <SectionBox label={label}>
      <CommentComposer
        comments={comments}
        onSubmit={onSubmit}
        onEdit={onEdit}
        onDelete={onDelete}
        submitting={submitting}
      />
    </SectionBox>
  );
}
