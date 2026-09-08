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
    enums: ['meta-enums'] as const,
  },
  users: {
    all: ['users'] as const,
    list: (search: string) => ['users', search] as const,
  },
};
