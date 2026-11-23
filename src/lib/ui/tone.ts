/**
 * The tones of notices, banners and status pills. A tone adds a color and an icon
 * to words that already say everything: no information rests on color alone
 * (IHM-61). None says that a figure is good or bad news (IHM-47): tones describe
 * states and results, never a direction.
 */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** The surface, text and border classes of each tone, all of WCAG 2.2 AA contrast (IHM-61). */
export const TONE_CLASSES = {
  neutral: 'border-line bg-surface-muted text-ink',
  info: 'border-info-line bg-info-surface text-info-ink',
  success: 'border-success-line bg-success-surface text-success-ink',
  warning: 'border-warning-line bg-warning-surface text-warning-ink',
  danger: 'border-danger-line bg-danger-surface text-danger-ink',
} as const satisfies Record<Tone, string>;
