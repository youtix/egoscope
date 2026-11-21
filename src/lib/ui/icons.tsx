import type { Tone } from './tone';
import type { ReactNode } from 'react';

/** What an icon is drawn with: the path data of a 24-unit square, stroked in the text color. */
type IconProps = Readonly<{ paths: readonly string[] }>;

/**
 * A decorative icon, sized with the text around it and hidden from screen
 * readers: the words beside it carry its meaning, never the icon alone (IHM-61).
 */
function Icon({ paths }: IconProps): ReactNode {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[1.25em] shrink-0"
    >
      {paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

// The shape of each tone, so that two tones differ by more than their color (IHM-61).
const TONE_PATHS = {
  neutral: ['M12 12h.01', 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16'],
  info: ['M12 16v-5', 'M12 8h.01', 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18'],
  success: ['m5 12.5 4.5 4.5L19 7.5'],
  warning: [
    'M12 9v4',
    'M12 17h.01',
    'M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  ],
  danger: ['m15 9-6 6', 'm9 9 6 6', 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18'],
} as const satisfies Record<Tone, readonly string[]>;

/** The icon of a tone: a dot, an "i", a check mark, a warning sign or a cross. */
export function ToneIcon({ tone }: Readonly<{ tone: Tone }>): ReactNode {
  return <Icon paths={TONE_PATHS[tone]} />;
}

/** An arrow pointing down, for a select's list. */
export function ChevronIcon(): ReactNode {
  return <Icon paths={['m6 9 6 6 6-6']} />;
}

/** A spinning circle, while an action runs. */
export function SpinnerIcon(): ReactNode {
  return (
    <span className="inline-flex animate-spin">
      <Icon paths={['M21 12a9 9 0 1 1-6.2-8.6']} />
    </span>
  );
}
