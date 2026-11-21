// The design system: the accessible building blocks of every screen (decision
// record 0029). Every visible text is a prop, taken from @/lib/wording by the
// screen, and no component writes a date or a number.

// --- Actions -------------------------------------------------------------------
export { Button } from './button';
export type { ButtonVariant } from './button-styles';
export { CopyButton } from './copy-button';
export { LinkButton, TextLink } from './link-button';
export type { Href } from './link-button';
export { ShareButton } from './share-button';

// --- Forms ---------------------------------------------------------------------
export { Checkbox } from './checkbox';
export { ChangedElsewhereNotice } from './changed-elsewhere-notice';
export { ConfirmDialog } from './confirm-dialog';
export type { ConfirmationStep } from './confirm-dialog';
export { Form } from './form';
export type { FieldErrors } from './form-context';
export { FormField } from './form-field';
export { PasswordInput } from './password-input';
export { PasteArea } from './paste-area';
export { RadioGroup } from './radio-group';
export { Select } from './select';
export type { SelectOption } from './select';
export { Switch } from './switch';
export { Textarea } from './textarea';
export { TextInput } from './text-input';

// --- Dialogs and notices -------------------------------------------------------
export { Banner } from './banner';
export { Dialog } from './dialog';
export { Notice } from './notice';

// --- Content -------------------------------------------------------------------
export { Badge } from './badge';
export { Card } from './card';
export { DefinitionList } from './definition-list';
export type { DefinitionItem } from './definition-list';
export { EmptyState } from './empty-state';
export type { HeadingLevel } from './heading';
export { LongText } from './long-text';
export type { FoldLabels } from './long-text';
export { PageHeader } from './page-header';
export { Skeleton } from './skeleton';
export type { SkeletonLines } from './skeleton';
export { StatusPill } from './status-pill';
export type { Tone } from './tone';

// --- Lists and tables ----------------------------------------------------------
export { PagedList } from './paged-list';
export type { ListItem, NameSearch, StateFilter } from './paged-list';
export { Pagination } from './pagination';
export type { PageLink } from './pagination';
export { Table } from './table';
export type { TableColumn, TableRow } from './table';
export { Tabs } from './tabs';
export type { TabItem } from './tabs';

// --- Slot: the figures, which F-figures fills ------------------------------------
// The honest-display components of src/lib/ui/figures/, built on the components
// above and on @/lib/wording, with one sub-slot per planning area for its shared
// figures: the mean gap with its case count and range, the verdict with its
// confidence and case count, the written direction, the origin breakdown, counts
// below the threshold, the filter summary with its total, the short notice, the
// glossary term with its one-tap definition (GlossaryTerm) and the drill-down links.
