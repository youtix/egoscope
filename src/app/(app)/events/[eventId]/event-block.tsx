import 'server-only';

import { notFound } from 'next/navigation';

import { getDb } from '@/lib/db';
import { getEvent } from '@/lib/events';
import { paths } from '@/lib/navigation';
import { getParam } from '@/lib/params';
import { get as getPlayer } from '@/lib/players';
import { caseOfEvent } from '@/lib/sensitivity';
import { getType } from '@/lib/taxonomy';
import { formatDate, formatDayAndMonth } from '@/lib/time';
import { Card, DefinitionList, GlossaryTerm, LinkButton, Notice, TextLink } from '@/lib/ui';
import { formatCount, label, sentence } from '@/lib/wording';

import { CorrectionHistory } from './correction-history';
import { contextFacts, derivedGameFacts, referenceFacts, Sources } from './event-facts';
import { ORIGIN_LABELS } from './event-labels';
import { correctionHistory, derivedGame, namesOfValues } from './queries';

import type { DerivationBasis } from './event-facts';
import type { DerivedGame } from './queries';
import type { Database } from '@/lib/db';
import type { CalendarDerivedEvent, PlayerEvent } from '@/lib/events';
import type { PlayerDetail } from '@/lib/players';
import type { TypeDetail } from '@/lib/taxonomy';
import type { DefinitionItem } from '@/lib/ui';
import type { ReactNode } from 'react';

// An identifier of an `events` row: a whole number of at least 1, which its integer
// identity column holds up to 2^31 - 1; any other text names no event.
const EVENT_ID = /^[1-9]\d{0,9}$/u;
const MAX_EVENT_ID = 2_147_483_647;

/** The event that `eventId`, the route's parameter, names, if it can name one. */
function eventIdOf(eventId: string): number | null {
  const id = EVENT_ID.test(eventId) ? Number(eventId) : null;
  return id !== null && id <= MAX_EVENT_ID ? id : null;
}

/** A row that a foreign key keeps, found missing: a bug. */
function kept<T>(row: T | null, what: string): T {
  if (row === null) {
    throw new Error(`An event names ${what} that the database does not hold.`);
  }
  return row;
}

/** The basis of a calendar-derived event's derivation, written (CL-VUE-15, CL-TAX-18). */
function basisOf(type: TypeDetail, player: PlayerDetail, game: DerivedGame): DerivationBasis {
  if (type.calendarDerivation === 'birthday') {
    return player.birthday === null
      ? null
      : sentence('interface.birthdayBasis', { date: formatDayAndMonth(player.birthday) });
  }
  const last = game.lastGameForOpponentOn;
  return last === null || game.opponent === null
    ? null
    : sentence('interface.formerTeamBasis', {
        team: sentence('interface.teamName', game.opponent.team),
        date: formatDate(last, 'full'),
      });
}

/** What the page needs beside the event, each read through its owner where it has one. */
async function readSheet(db: Database, event: PlayerEvent) {
  const player = kept(await getPlayer(db, event.playerId), 'a player');
  const type = kept(await getType(db, event.eventTypeId), 'a type');
  const history = await correctionHistory(db, event.playerEventId);
  return {
    player,
    type,
    held: await caseOfEvent(db, event.playerEventId),
    history,
    names: await namesOfValues(db, history),
    zone: await getParam(db, 'display.timeZone'),
  };
}

type Sheet = Awaited<ReturnType<typeof readSheet>>;

/** The player, linking to his page (VUE-04, CA-VUE-04), the type and its sheet version (TAX-23). */
function qualificationFacts(event: PlayerEvent, sheet: Sheet): readonly DefinitionItem[] {
  return [
    {
      term: <GlossaryTerm term="followedPlayer" />,
      key: 'player',
      details: <TextLink href={paths.player(sheet.player.id)} label={sheet.player.displayName} />,
    },
    {
      term: <GlossaryTerm term="eventType" />,
      key: 'type',
      details: <TextLink href={paths.typeSheet(sheet.type.id)} label={sheet.type.sheet.name} />,
    },
    {
      term: <GlossaryTerm term="sheetVersion" />,
      key: 'sheet-version',
      details: formatCount(event.sheetVersionNumber),
    },
    { term: sentence('interface.eventOrigin'), details: ORIGIN_LABELS[event.origin] },
  ];
}

/** The calendar-derived event's game, in place of sources (CL-IHM-21, CL-VUE-15). */
async function gameFacts(db: Database, event: CalendarDerivedEvent, sheet: Sheet) {
  const game = await derivedGame(db, event, sheet.type.calendarDerivation);
  return derivedGameFacts(game, basisOf(sheet.type, sheet.player, game), sheet.zone);
}

/** The sources of an event, or the game of a calendar-derived one (DSN-06, CL-DSN-20). */
async function evidenceFacts(db: Database, event: PlayerEvent, sheet: Sheet) {
  if (event.origin === 'calendar') {
    return gameFacts(db, event, sheet);
  }
  const term = sentence('interface.sources');
  return event.sources.length === 0
    ? []
    : [{ term, details: <Sources sources={event.sources} zone={sheet.zone} /> }];
}

/** The case's status, linking to the case (SEN-07, IHM-67), and the correction history. */
function caseAndHistoryFacts(sheet: Sheet): readonly DefinitionItem[] {
  const { held } = sheet;
  return [
    {
      term: <GlossaryTerm term="case" />,
      key: 'case',
      details:
        held === null ? (
          sentence('interface.notInCaseYet')
        ) : (
          <TextLink href={paths.case(held.id)} label={label('CaseStatus', held.status)} />
        ),
    },
    {
      term: sentence('interface.correctionHistory'),
      details: <CorrectionHistory entries={sheet.history} names={sheet.names} zone={sheet.zone} />,
    },
  ];
}

/**
 * The actions of the page (IHM-67, IHM-68, CL-IHM-21): correcting a historical event, or
 * only the context of a calendar-derived one, and withdrawing an event of any origin.
 */
function actionsOf(event: PlayerEvent): ReactNode {
  const correction =
    event.origin === 'historical'
      ? sentence('interface.correctTheEvent')
      : sentence('interface.correctTheContext');
  return (
    <>
      {event.origin === 'detected' ? null : (
        <LinkButton href={paths.correctEvent(event.playerEventId)} label={correction} />
      )}
      <LinkButton
        href={paths.withdrawEvent(event.playerEventId)}
        label={sentence('interface.withdrawEvent')}
        variant="secondary"
      />
    </>
  );
}

/**
 * The event block of the event page, for an event of every origin (IHM-67, CL-IHM-21):
 * its one followed player, linking to his page (VUE-04), its type and sheet version, its
 * origin, its reference date and precision, its description, its sources or, for a
 * calendar-derived event, its game, its context with the origin of each indication, its
 * case's status and its correction history, and the links to correct and to withdraw it.
 * An identifier that matches no event shows the one generic page (CL-DSN-05, CL-IHM-19).
 */
export async function EventBlock({ eventId }: Readonly<{ eventId: string }>): Promise<ReactNode> {
  const id = eventIdOf(eventId);
  if (id === null) {
    notFound();
  }
  const database = await getDb();
  if (!database.ok) {
    return <Notice tone="danger" message={sentence('interface.eventNotRead')} />;
  }
  const { db } = database;
  const event = (await getEvent(db, id)) ?? notFound();
  const sheet = await readSheet(db, event);
  const items = [
    ...qualificationFacts(event, sheet),
    ...referenceFacts(event, sheet.zone),
    { term: sentence('interface.description'), details: event.description },
    ...(await evidenceFacts(db, event, sheet)),
    ...contextFacts(event.context),
    ...caseAndHistoryFacts(sheet),
  ];
  return (
    <Card actions={actionsOf(event)}>
      <DefinitionList items={items} />
    </Card>
  );
}
