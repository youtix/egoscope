import { paths } from '@/lib/navigation';
import { formatDate, formatInstant } from '@/lib/time';
import { Badge, Card, GlossaryTerm, TextLink } from '@/lib/ui';
import { definition, label, sentence } from '@/lib/wording';

import { factOf, Facts, Part, TermHeading } from './case-block-facts';

import type { Fact } from './case-block-facts';
import type { CaseEventDetail, CaseEventSource } from '@/lib/sensitivity';
import type { ReactNode } from 'react';

type Indication = Readonly<{ value: string; origin: string | null }>;

/** A context indication with its origin, research, classification, you or calculation (SEN-18, H-09). */
function IndicationValue({ value, origin }: Indication): ReactNode {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>{value}</span>
      {origin !== null && <Badge label={origin} />}
    </span>
  );
}

/** A source of the event: its link, under its title when it has one, its outlet, its publication date and whether its link was found (VUE-04, IMP-17). */
function SourceItem({ source }: Readonly<{ source: CaseEventSource }>): ReactNode {
  return (
    <li className="flex flex-col gap-1">
      <TextLink href={new URL(source.url)} label={source.title ?? source.url} />
      {source.outlet !== null && <span>{source.outlet}</span>}
      <span className="text-ink-muted">
        {sentence('sensitivity.publishedOn', { date: formatDate(source.publicationDateOn) })}
      </span>
      {source.linkStatus !== null && <Badge label={label('LinkStatus', source.linkStatus)} />}
    </li>
  );
}

/**
 * Where the event comes from: its sources with their links, or for a calendar-derived
 * event the game it is derived from, which takes their place (VUE-04, CL-VUE-15).
 */
function origins(event: CaseEventDetail): readonly Fact[] {
  const term = sentence('sensitivity.sources');
  if (event.derivedGame !== null) {
    const day = formatDate(event.derivedGame.gameDay, 'full');
    const details = [label('EventOrigin', 'calendar'), day].map((line) => (
      <span key={line}>{line}</span>
    ));
    return [{ key: 'sources', term, details }];
  }
  const sources = event.sources.map((source) => <SourceItem key={source.url} source={source} />);
  return sources.length === 0
    ? []
    : [{ key: 'sources', term, details: <ul className="flex flex-col gap-3">{sources}</ul> }];
}

/**
 * When the event became public, in full: its instant when it is known, as a detected
 * event's always is, and its day otherwise (SEN-01, CL-IHM-04).
 */
function referenceDateOf(event: CaseEventDetail, zone: string): readonly Fact[] {
  const head = { key: 'date', term: sentence('sensitivity.referenceDate') };
  return event.referenceAt === null
    ? factOf(head, event.referenceDateOn, (day) => formatDate(day, 'full'))
    : [{ ...head, details: formatInstant(event.referenceAt, zone, 'full') }];
}

/** The facts of one event: its reference date, its sources or derived game, and its context indications with their origin (IHM-25, SEN-18). */
function eventFacts(event: CaseEventDetail, zone: string): readonly Fact[] {
  const originOf = (origin: CaseEventDetail['injuryReturnOrigin']) =>
    origin === null ? null : label('ContextIndicationOrigin', origin);
  return [
    ...referenceDateOf(event, zone),
    ...origins(event),
    ...factOf(
      { key: 'injury', term: sentence('sensitivity.returnFromInjury') },
      event.injuryReturn,
      (value) => (
        <IndicationValue
          value={label('InjuryReturn', value)}
          origin={originOf(event.injuryReturnOrigin)}
        />
      ),
    ),
    ...factOf(
      { key: 'stakes', term: sentence('sensitivity.gameStakes') },
      event.gameStakes,
      (value) => (
        <IndicationValue
          value={label('GameStakes', value)}
          origin={originOf(event.gameStakesOrigin)}
        />
      ),
    ),
  ];
}

/**
 * The events of a case (IHM-25, IHM-52, IHM-67, SEN-18, CL-VUE-15): each with its
 * description, its reference date, its sources with their links or the game it is
 * derived from, its context indications with their origin, and the link to its sheet.
 */
export function CaseEvents({
  events,
  zone,
}: Readonly<{ events: readonly CaseEventDetail[]; zone: string }>): ReactNode {
  return (
    <Part name={definition('event').label}>
      <Card>
        <TermHeading>
          <GlossaryTerm term="event" />
        </TermHeading>
        <ul className="flex flex-col gap-6">
          {events.map((event) => (
            <li key={event.id} className="flex flex-col gap-3">
              <p>{event.description}</p>
              <Facts facts={eventFacts(event, zone)} />
              <TextLink href={paths.event(event.id)} label={sentence('sensitivity.openTheEvent')} />
            </li>
          ))}
        </ul>
      </Card>
    </Part>
  );
}
