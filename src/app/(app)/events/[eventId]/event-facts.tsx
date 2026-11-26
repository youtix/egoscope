import { formatDate, formatGameTime, formatInstant } from '@/lib/time';
import { DefinitionList, TextLink } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import { INDICATION_LABELS, INDICATION_ORIGIN_LABELS, PRECISION_LABELS } from './event-labels';

import type { DerivedGame } from './queries';
import type {
  ContextIndications,
  DateOrInstant,
  OwnerAddedSource,
  PlayerEvent,
  PlayerEventSource,
} from '@/lib/events';
import type { DefinitionItem } from '@/lib/ui';
import type { ReactNode } from 'react';

/** A source of either origin that has some: a historical one, or one the owner added. */
type AnySource = PlayerEventSource | OwnerAddedSource;

/** A date as written, or an instant, in the form `form` (CL-IHM-04). */
function dateOrInstant(date: DateOrInstant, zone: string, form: 'full' | 'short'): string {
  return date.at === null ? formatDate(date.on, form) : formatInstant(date.at, zone, form);
}

/** The precision of a reference date, labeled from the glossary. */
function precisionFact(precision: keyof typeof PRECISION_LABELS): DefinitionItem {
  return { term: sentence('interface.precision'), details: PRECISION_LABELS[precision] };
}

/**
 * The reference date and its precision (IHM-67, CL-IHM-04): in full, naming the owner's
 * zone when it has a time; a calendar-derived event's is its game's day, before tip-off,
 * and has no precision (CL-IHM-21).
 */
export function referenceFacts(event: PlayerEvent, zone: string): readonly DefinitionItem[] {
  const term = sentence('interface.referenceDate');
  if (event.origin === 'calendar') {
    const date = formatDate(event.referenceDate, 'full');
    return [{ term, details: sentence('interface.beforeTipOff', { date }) }];
  }
  if (event.origin === 'historical') {
    const reference = event.referenceDate;
    return [
      { term, details: dateOrInstant(reference, zone, 'full') },
      precisionFact(reference.at === null ? 'approximate' : 'exact'),
    ];
  }
  return [
    { term, details: formatInstant(event.referenceDate.at, zone, 'full') },
    precisionFact(event.referenceDate.precision),
  ];
}

/** The facts of one source: its link, outlet and title as published, and its date (DSN-08). */
function sourceItems(source: AnySource, zone: string): readonly DefinitionItem[] {
  const items: DefinitionItem[] = [
    {
      term: sentence('interface.sourceLink'),
      details: <TextLink href={new URL(source.url)} label={source.url} />,
    },
  ];
  if (source.outlet !== null) {
    items.push({ term: sentence('interface.sourceOutlet'), details: source.outlet });
  }
  if (source.title !== null) {
    items.push({ term: sentence('interface.sourceTitle'), details: source.title });
  }
  items.push({
    term: sentence('interface.sourcePublished'),
    details: dateOrInstant(source.publicationDate, zone, 'short'),
  });
  return items;
}

/** The sources of an event, in their order, each with its facts (IHM-67, DSN-08). */
export function Sources({
  sources,
  zone,
}: Readonly<{ sources: readonly AnySource[]; zone: string }>): ReactNode {
  return (
    <ol className="flex flex-col gap-4">
      {sources.map((source) => (
        <li key={source.sourceId}>
          <DefinitionList items={sourceItems(source, zone)} />
        </li>
      ))}
    </ol>
  );
}

/** What the derivation of a calendar-derived event rests on, written (CL-VUE-15). */
export type DerivationBasis = string | null;

/**
 * The derived game that stands for a calendar-derived event's sources (CL-IHM-21,
 * CL-VUE-15): its day and tip-off, with its US day when that differs (CL-TRV-02), its
 * opponent and side, and the basis of the derivation.
 */
export function derivedGameFacts(
  game: DerivedGame,
  basis: DerivationBasis,
  zone: string,
): readonly DefinitionItem[] {
  const items: DefinitionItem[] = [
    { term: sentence('interface.derivedGame'), details: formatGameTime(game.tipOff, zone, 'full') },
  ];
  if (game.opponent !== null) {
    const { venue, team } = game.opponent;
    items.push(
      { term: sentence('interface.opponent'), details: sentence('interface.teamName', team) },
      {
        term: sentence('interface.homeOrAway'),
        details: sentence(venue === 'home' ? 'interface.venueHome' : 'interface.venueAway'),
      },
    );
  }
  if (basis !== null) {
    items.push({ term: sentence('interface.derivationBasis'), details: basis });
  }
  return items;
}

/** A context indication, its value and, once known, its origin (DSN-07, SEN-18, H-09). */
function indication(
  context: ContextIndications['injuryReturn'] | ContextIndications['gameStakes'],
): string {
  const value = INDICATION_LABELS[context.value];
  return context.origin === null
    ? value
    : sentence('interface.indicationWithOrigin', {
        value,
        origin: INDICATION_ORIGIN_LABELS[context.origin],
      });
}

/**
 * The context indications, each a closed value with its origin and nothing else, never
 * the nature of an injury (DSN-07, CA-DSN-03, H-09).
 */
export function contextFacts(context: ContextIndications): readonly DefinitionItem[] {
  return [
    { term: sentence('interface.returnFromInjury'), details: indication(context.injuryReturn) },
    { term: sentence('interface.gameStakes'), details: indication(context.gameStakes) },
  ];
}
