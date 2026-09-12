/**
 * Primitive layer — generic, domain-free building blocks.
 * Anything that knows about leads/meetings/tasks belongs in ../fields instead.
 */
export { Avatar, initialsOf } from './Avatar';
export { ScreenHeader } from './ScreenHeader';
export type { HeaderAction } from './ScreenHeader';
export { FormField, FieldLabel } from './FormField';
export { SearchBar } from './SearchBar';
export { SectionBox } from './SectionBox';
export { PrimaryButton, StickyFooter, STICKY_FOOTER_SPACE } from './PrimaryButton';
export { RemovableChip, ChipRow } from './RemovableChip';
export { SegmentedTabs } from './SegmentedTabs';
export type { SegmentedTab } from './SegmentedTabs';
export { FolderTabs } from './FolderTabs';
export type { FolderTab } from './FolderTabs';
export { UnderlineTabs } from './UnderlineTabs';
export type { UnderlineTab } from './UnderlineTabs';

export { StatusChip } from './StatusChip';
export type { ChipSize } from './StatusChip';
export { FilterTabs } from './FilterTabs';
export type { FilterTab } from './FilterTabs';
export { EmptyState } from './EmptyState';
export { ReminderRow } from './ReminderRow';
export { LeadQuickActions } from './LeadQuickActions';
export { CenterDialog } from './CenterDialog';
export { ConfirmDialog } from './ConfirmDialog';
export { SelectListDialog } from './SelectListDialog';
export type { SelectOption } from './SelectListDialog';
export { CalendarPickerModal } from './CalendarPickerModal';
export { BottomSheet } from './BottomSheet';
export { MultiReminderPicker } from './MultiReminderPicker';
export { CommentComposer } from './CommentComposer';
export { ThreadComposer } from './ThreadComposer';
export { SegmentedToggle } from './SegmentedToggle';
export { MembersPickerModal } from './MembersPickerModal';
export { ListCard, ListRow, ListSectionTitle } from './ListRow';
