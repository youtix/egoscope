import { notFound } from 'next/navigation';
import { cache } from 'react';
import { z } from 'zod';

import { getDb } from '@/lib/db';
import { getParam } from '@/lib/params';
import { getCase } from '@/lib/sensitivity';
import { getType } from '@/lib/taxonomy';
import { formatGameTime, formatInstant, formatZoneStatement } from '@/lib/time';
import { Badge, Card, GlossaryTerm, StatusPill } from '@/lib/ui';
import { definition, label, sentence } from '@/lib/wording';

import { CaseCalculation } from './case-block-calculation';
import { CaseCriteria, CaseFlags } from './case-block-criteria';
import { CaseEvents } from './case-block-events';
import { factOf, Facts, Part } from './case-block-facts';
import { CaseDecisions, CaseHistory } from './case-block-records';

import type { Fact } from './case-block-facts';
import type { Database } from '@/lib/db';
import type { CaseDetail, MeasuredGame } from '@/lib/sensitivity';
import type { ReactElement, ReactNode } from 'react';

// A case number as an address writes it, and the largest that an integer identifier
// holds: any other segment names no case (CL-IHM-19).
const CASE_NUMBER = /^[1-9]\d*$/u;
const LARGEST_IDENTIFIER = 2_147_483_647;
// The other types of a co-occurring case, as its criterion stores them (SEN-06).
const CO_OCCURRING = z.object({ coOccurringTypeIds: z.array(z.string()) });

/** The database of the request and the owner's zone, read once for the header and the block (IHM-14, CL-IHM-04). */
const screenContext = cache(async (): Promise<Readonly<{ db: Database; zone: string }>> => {
  const database = await getDb();
  if (!database.ok) {
    throw new Error(`The case detail cannot reach the database: ${database.error.kind}.`);
  }
  return { db: database.db, zone: await getParam(database.db, 'display.timeZone') };
});

/** The statement at the top of the case detail of the zone its times are written in, "Times in Paris time" (CL-IHM-04). */
export async function caseZoneStatement(): Promise<string> {
  const { zone } = await screenContext();
  return formatZoneStatement(zone);
}

/** The case that the address names, or null when it names none (CL-IHM-19). */
async function caseOf(db: Database, segment: string): Promise<CaseDetail | null> {
  const id = Number(segment);
  return CASE_NUMBER.test(segment) && id <= LARGEST_IDENTIFIER ? getCase(db, id) : null;
}

/** The names of the other types whose cases share the case's game, when it is co-occurring (SEN-06). */
async function coOccurringTypesOf(db: Database, detail: CaseDetail): Promise<readonly string[]> {
  const criterion = detail.criteria.find(({ criterion: name }) => name === 'co_occurring');
  const ids =
    criterion === undefined
      ? []
      : CO_OCCURRING.parse(criterion.triggeringValues).coOccurringTypeIds;
  const types = await Promise.all(ids.map(async (id) => getType(db, id)));
  return types.filter((type) => type !== null).map((type) => type.sheet.name);
}

/** The measured game in full, with its US date when it differs, and its opponent when his line names his team (CL-IHM-04, CL-IHM-07). */
function measuredGameOf(game: MeasuredGame, zone: string): ReactElement {
  return (
    <>
      <span>{formatGameTime(game, zone, 'full')}</span>
      {game.opponent !== null && <span>{sentence('sensitivity.againstTeam', game.opponent)}</span>}
    </>
  );
}

/** The reference instant in full with its origin, or the origin alone for an event known in advance (SEN-01, SEN-02, CL-SEN-02). */
function referenceInstantOf(detail: CaseDetail, zone: string): ReactElement | string {
  const origin = label('ReferenceInstantOrigin', detail.referenceInstantOrigin);
  if (detail.referenceInstantAt === null) {
    return origin;
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>{formatInstant(detail.referenceInstantAt, zone, 'full')}</span>
      <Badge label={origin} />
    </span>
  );
}

/** What the case is: its origin in full, its status with its reason, its reference instant and its measured game (IHM-25, IHM-46, SEN-07). */
function summaryOf(detail: CaseDetail, zone: string): readonly Fact[] {
  return [
    {
      key: 'origin',
      term: sentence('sensitivity.caseOrigin'),
      details: label('CaseOrigin', detail.origin),
    },
    {
      key: 'status',
      term: sentence('sensitivity.caseStatus'),
      details: <StatusPill label={label('CaseStatus', detail.status)} />,
    },
    ...factOf(
      { key: 'reason', term: sentence('sensitivity.statusReason') },
      detail.statusReason,
      (reason) => label('CaseStatusReason', reason),
    ),
    {
      key: 'reference',
      term: <GlossaryTerm term="referenceInstant" />,
      details: referenceInstantOf(detail, zone),
    },
    ...factOf(
      { key: 'game', term: <GlossaryTerm term="measuredGame" /> },
      detail.measuredGame,
      (game) => measuredGameOf(game, zone),
    ),
  ];
}

/**
 * The case block of the case detail (IHM-25, IHM-46, IHM-52, SEN-06, SEN-10, SEN-16 to
 * SEN-18, CL-SEN-11, CL-VUE-15): the case's origin, status and reference instant; its
 * events with their sources or derived game and their context indications with their
 * origin; the three numbers of its gap with the minutes behind them; its criteria with
 * their triggering values; its review flags and mentions; its manual decisions; its
 * history. An address that names no case shows "This item no longer exists" (CL-IHM-19).
 */
export async function CaseBlock({ caseId }: Readonly<{ caseId: string }>): Promise<ReactNode> {
  const { db, zone } = await screenContext();
  const detail = await caseOf(db, caseId);
  if (detail === null) {
    notFound();
  }
  const coOccurringTypes = await coOccurringTypesOf(db, detail);
  return (
    <div className="flex flex-col gap-6">
      <Part name={definition('case').label}>
        <Card>
          <Facts facts={summaryOf(detail, zone)} />
        </Card>
      </Part>
      <CaseEvents events={detail.events} zone={zone} />
      <CaseCalculation detail={detail} />
      <CaseCriteria detail={detail} coOccurringTypes={coOccurringTypes} />
      <CaseFlags detail={detail} />
      <CaseDecisions decisions={detail.decisions} zone={zone} />
      {/* --- Slot: the decision form, to exclude or reinstate the case with a reason of the
          closed list and its comment (SEN-17, IHM-25), which its own task adds --- */}
      <CaseHistory history={detail.history} zone={zone} />
    </div>
  );
}
