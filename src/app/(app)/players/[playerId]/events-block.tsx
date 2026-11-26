import 'server-only';

import { inArray } from 'drizzle-orm';
import { notFound } from 'next/navigation';

import { eventTypes, getDb } from '@/lib/db';
import { eventsOfPlayer } from '@/lib/events';
import { paths } from '@/lib/navigation';
import { getParam } from '@/lib/params';
import { get as getPlayer } from '@/lib/players';
import { listCases } from '@/lib/sensitivity';
import { formatDate, gameDayStart, userDay } from '@/lib/time';
import {
  Card,
  DefinitionList,
  EmptyState,
  GlossaryTerm,
  Notice,
  StatusPill,
  TextLink,
} from '@/lib/ui';
import { label, sentence } from '@/lib/wording';

import type { Database } from '@/lib/db';
import type { PlayerEvent } from '@/lib/events';
import type { CaseStatus } from '@/lib/sensitivity';
import type { EpochMs, IsoDate } from '@/lib/time';
import type { ReactNode } from 'react';

/** An event as the list shows it: its type's name, its day in the owner's zone, its case's status. */
type ListedEvent = Readonly<{
  event: PlayerEvent;
  typeName: string;
  day: IsoDate;
  at: EpochMs;
  caseStatus: CaseStatus | null;
}>;

/**
 * The day an event is listed under and the instant it is sorted by: the date of a
 * calendar-derived event's game and of a historical public date written without a time,
 * from the start of that US day, or the owner's day of a reference instant (CL-TRV-03,
 * IHM-14).
 */
function referenceOf(event: PlayerEvent, zone: string): Readonly<{ day: IsoDate; at: EpochMs }> {
  if (event.origin === 'calendar') {
    return { day: event.referenceDate, at: gameDayStart(event.referenceDate) };
  }
  const reference = event.referenceDate;
  return reference.at === null
    ? { day: reference.on, at: gameDayStart(reference.on) }
    : { day: userDay(reference.at, zone), at: reference.at };
}

/** The current name of each type of `events`, by identifier. */
async function typeNames(db: Database, typeIds: readonly string[]) {
  const rows = await db
    .select({ id: eventTypes.id, name: eventTypes.name })
    .from(eventTypes)
    .where(inArray(eventTypes.id, [...typeIds]));
  return new Map(rows.map(({ id, name }) => [id, name]));
}

/** The status of each case of the player's profiles of `typeIds`, by case, read through `sensitivity` (SEN-07). */
async function caseStatuses(db: Database, playerId: string, typeIds: readonly string[]) {
  const statuses = new Map<number, CaseStatus>();
  for (const eventTypeId of typeIds) {
    const groups = await listCases(db, { playerId, eventTypeId });
    for (const line of Object.values(groups).flat()) {
      statuses.set(line.id, line.status);
    }
  }
  return statuses;
}

/** The player's events of every origin, newest first, each with its type and its case's status. */
async function listedEvents(db: Database, playerId: string): Promise<readonly ListedEvent[]> {
  const events = await eventsOfPlayer(db, playerId);
  const typeIds = [...new Set(events.map(({ eventTypeId }) => eventTypeId))];
  const names = typeIds.length === 0 ? new Map<string, string>() : await typeNames(db, typeIds);
  const statuses = await caseStatuses(db, playerId, typeIds);
  const zone = await getParam(db, 'display.timeZone');
  return events
    .map((event) => ({
      event,
      typeName: names.get(event.eventTypeId) ?? event.eventTypeId,
      ...referenceOf(event, zone),
      caseStatus: event.caseId === null ? null : (statuses.get(event.caseId) ?? null),
    }))
    .toSorted((a, b) =>
      b.at === a.at ? b.event.playerEventId - a.event.playerEventId : b.at - a.at,
    );
}

/** One event: its type, linking to its page, a dismissed detected event's status, its day and its case's status. */
function EventItem({ listed, first }: Readonly<{ listed: ListedEvent; first: boolean }>) {
  const { event, caseStatus } = listed;
  const isDismissed = event.origin === 'detected' && event.detectedStatus === 'dismissed';
  const type = (
    <span className="flex flex-wrap items-center gap-2">
      <TextLink href={paths.event(event.playerEventId)} label={listed.typeName} />
      {isDismissed ? <StatusPill label={label('DetectedEventStatus', 'dismissed')} /> : null}
    </span>
  );
  return (
    <DefinitionList
      items={[
        { term: <GlossaryTerm term="eventType" plain={!first} />, key: 'type', details: type },
        { term: sentence('interface.referenceDate'), details: formatDate(listed.day) },
        {
          term: <GlossaryTerm term="case" plain={!first} />,
          key: 'case',
          details:
            caseStatus === null
              ? sentence('interface.notInCaseYet')
              : label('CaseStatus', caseStatus),
        },
      ]}
    />
  );
}

/**
 * The events block of the player page (IHM-22, IHM-67): his events of every origin,
 * newest first, each with its type, its reference date and its case's status, linking to
 * its page; a dismissed detected event shows its status (DET-43). An identifier that
 * matches no player shows the one generic page (CL-IHM-19).
 */
export async function EventsBlock({
  playerId,
}: Readonly<{ playerId: string }>): Promise<ReactNode> {
  const database = await getDb();
  if (!database.ok) {
    return <Notice tone="danger" message={sentence('interface.eventsNotRead')} />;
  }
  const player = await getPlayer(database.db, playerId);
  if (player === null) {
    notFound();
  }
  const listed = await listedEvents(database.db, player.id);
  return (
    <Card title={sentence('interface.playerEvents')}>
      {listed.length === 0 ? (
        <EmptyState
          title={sentence('interface.noEventYet')}
          reason={sentence('interface.noEventReason')}
          headingLevel="h3"
        />
      ) : (
        <ol className="flex flex-col gap-4">
          {listed.map((item, index) => (
            <li key={item.event.playerEventId}>
              <EventItem listed={item} first={index === 0} />
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
