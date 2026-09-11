export const queryKeys = {
  leads: {
    /** Every lead list/stat query — broad invalidation target after a mutation. */
    all: ['leads'] as const,
    stats: ['leads-stats'] as const,
    detail: (id: string) => ['lead', id] as const,
    callLogs: (id: string) => ['lead-call-logs', id] as const,
    thread: (id: string, channel: string) => ['lead-thread', id, channel] as const,
    documents: (id: string, kind: string) => ['lead-documents', id, kind] as const,
  },
  /** Every file across leads — the drawer's Document screen. */
  documentLibrary: {
    all: ['document-library'] as const,
    list: (kind: string, search: string) => ['document-library', kind, search] as const,
  },
  quickReplies: {
    all: ['quick-replies'] as const,
    list: (search: string) => ['quick-replies', search] as const,
  },
  tasks: {
    all: ['tasks'] as const,
    statusCounts: ['tasks-status-counts'] as const,
    detail: (id: string) => ['task', id] as const,
  },
  meetings: {
    all: ['meetings'] as const,
    detail: (id: string) => ['meeting', id] as const,
    slots: (date: string, duration: number, userIds: string) =>
      ['meeting-slots', date, duration, userIds] as const,
  },
  lookups: {
    projects: ['projects'] as const,
    purposes: ['purposes'] as const,
    dropReasons: ['drop-reasons'] as const,
    enums: ['meta-enums'] as const,
  },
  users: {
    all: ['users'] as const,
    list: (search: string) => ['users', search] as const,
    /** Active members for pickers and filters. Nested under `users`, so adding
     *  or deactivating a member refreshes every picker too. */
    members: ['users', 'members'] as const,
    detail: (id: string) => ['users', 'detail', id] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
  },
};
