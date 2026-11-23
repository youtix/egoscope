import { ToneIcon } from './icons';
import { TONE_CLASSES } from './tone';

import type { Tone } from './tone';
import type { ReactNode } from 'react';

export type StatusPillProps = Readonly<{
  /** The state, written with the label of its state set in the glossary (IHM-15). */
  label: string;
  tone?: Tone;
}>;

/**
 * The state of an object, such as a player's or a request's: always written in
 * words, with an icon and a color that only add to them (IHM-61). Its text wraps
 * rather than being cut (IHM-60).
 */
export function StatusPill({ label, tone = 'neutral' }: StatusPillProps): ReactNode {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-medium ${TONE_CLASSES[tone]}`}
    >
      <ToneIcon tone={tone} />
      <span>{label}</span>
    </span>
  );
}
