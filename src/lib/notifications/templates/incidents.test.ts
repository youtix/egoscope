import { describe, expect, it } from 'vitest';

import { paths } from '@/lib/navigation';
import { toEpochMs, toIsoDate } from '@/lib/time';

import { exportReminder, incident, incidentEnd } from './incidents';

import type {
  ExportReminderData,
  IncidentData,
  IncidentEndData,
  NotifiedIncidentKind,
} from './data';
import type { EpochMs } from '@/lib/time';

const PARIS = 'Europe/Paris';
const BASE = 'https://egoscope.example';
const SOURCES_URL = `${BASE}${paths.pressSources()}`;
const TASK_JOURNAL_URL = `${BASE}${paths.journal(9)}`;
const SOURCES_LINK = '<a href="https://egoscope.example/collection/sources">See the sources</a>';
const utc = (day: number, hour: number, minute = 0): EpochMs =>
  toEpochMs(Date.UTC(2026, 10, day, hour, minute));
const linesOf = (text: string): readonly string[] => text.split('\n');

const INCIDENT: IncidentData = {
  kind: 'incident_start',
  incidentKind: 'press_source_down',
  subjects: ['A national outlet, NBA section'],
  since: utc(16, 6),
  classification: null,
  url: SOURCES_URL,
};
const CLASSIFICATION: NonNullable<IncidentData['classification']> = {
  waitingArticles: 70,
  nearestPlayer: {
    playerName: 'Player C',
    // Thursday 19 November 2026, 02:00 in Paris: Wednesday evening in the US.
    game: {
      gameId: 7,
      scheduledStartAt: utc(19, 1),
      usDate: toIsoDate('2026-11-18'),
      opponentName: 'Team X',
      isHome: null,
    },
  },
  plannedResumeAt: utc(18, 6),
  cause: 'limit_reached',
};
const QUOTA_INCIDENT: IncidentData = {
  kind: 'incident_start',
  incidentKind: 'quota_reached',
  subjects: ['Language model'],
  since: utc(17, 6),
  classification: CLASSIFICATION,
  url: `${BASE}${paths.journal(42)}`,
};
const INCIDENT_END: IncidentEndData = {
  kind: 'incident_end',
  incidentKind: 'stats_source_unavailable',
  subjects: [],
  startedAt: utc(19, 5, 10),
  endedAt: utc(19, 10, 50),
  url: `${BASE}${paths.journal(43)}`,
};
const EXPORT_REMINDER: ExportReminderData = {
  kind: 'export_reminder',
  lastExportAt: utc(1, 9),
  exportUrl: `${BASE}${paths.settings()}`,
};

const OTHER_KINDS: readonly NotifiedIncidentKind[] = [
  'collection_impossible',
  'press_source_silent',
  'stats_source_unavailable',
  'stats_source_schema_changed',
  'backup_failed',
  'logins_refused',
];

/** The title and the consequence of an incident of `incidentKind` with no subject. */
const titleAndConsequence = (incidentKind: NotifiedIncidentKind): readonly string[] => {
  const lines = linesOf(incident({ ...INCIDENT, incidentKind, subjects: [] }, PARIS));
  return [lines[0] ?? '', lines[2] ?? ''];
};
/** The classification lines of the quota incident, between its consequence and its link. */
const classificationLines = (
  changes: Partial<NonNullable<IncidentData['classification']>>,
): readonly string[] =>
  linesOf(
    incident({ ...QUOTA_INCIDENT, classification: { ...CLASSIFICATION, ...changes } }, PARIS),
  ).slice(3, -1);

describe('the incident messages', () => {
  it('[TEL-08] [CL-TEL-02] writes an incident and its reminder: nature, since when, what is affected, the consequence, the link', () => {
    const expected = [
      '<b>Egoscope · Incident — Press source down</b>',
      'Since Monday 16 November 2026, 07:00 Paris time.',
      'Affected: A national outlet, NBA section.',
      'Articles from this source are no longer collected.',
      SOURCES_LINK,
    ];

    expect(linesOf(incident(INCIDENT, PARIS))).toStrictEqual(expected);
    expect(linesOf(incident({ ...INCIDENT, kind: 'incident_reminder' }, PARIS))).toStrictEqual(
      expected,
    );
    expect(
      linesOf(
        incident(
          {
            ...INCIDENT,
            incidentKind: 'task_not_run',
            subjects: [],
            url: TASK_JOURNAL_URL,
          },
          PARIS,
        ),
      ),
    ).toStrictEqual([
      '<b>Egoscope · Incident — Task not run</b>',
      'Since Monday 16 November 2026, 07:00 Paris time.',
      'The task did not run, so its work is late.',
      '<a href="https://egoscope.example/journal?entry=9">See the journal</a>',
    ]);
  });

  it('[TEL-08] names every incident by the function it touches, with what it means for the owner', () => {
    expect(OTHER_KINDS.map((kind) => titleAndConsequence(kind))).toStrictEqual([
      [
        '<b>Egoscope · Incident — Collection impossible</b>',
        'No article is collected until a source answers again.',
      ],
      [
        '<b>Egoscope · Incident — Silent press source</b>',
        'Events that only this source reports may be missed.',
      ],
      [
        '<b>Egoscope · Incident — Stats source unavailable</b>',
        'Statistics are no longer updated.',
      ],
      [
        '<b>Egoscope · Incident — Stats source format changed</b>',
        'The statistics file that changed is not read, so its figures are not updated.',
      ],
      ['<b>Egoscope · Incident — Backup failed</b>', 'Your data has no recent backup.'],
      [
        '<b>Egoscope · Incident — Logins refused</b>',
        'You cannot sign in until logins are allowed again.',
      ],
    ]);
  });

  it('[TEL-08] [CL-TEL-04] gives the classification quota incident its waiting articles, nearest player, planned resume and cause', () => {
    expect(linesOf(incident(QUOTA_INCIDENT, PARIS))).toStrictEqual([
      '<b>Egoscope · Incident — Quota reached — Language model</b>',
      'Since Tuesday 17 November 2026, 07:00 Paris time.',
      'The service stops working until this is resolved.',
      'Waiting articles: 70.',
      'Nearest player: Player C, next game Thursday 19 November 2026, 02:00 Paris time — Wednesday evening in the US, against Team X.',
      'Planned resume: Wednesday 18 November 2026, 07:00 Paris time.',
      'Cause: quota reached.',
      '<a href="https://egoscope.example/journal?entry=42">See the journal</a>',
    ]);
  });

  it('[CL-TEL-04] says when no concerned player has a next game, leaves out an unknown resume, and writes every cause', () => {
    expect(
      classificationLines({ nearestPlayer: null, plannedResumeAt: null, cause: 'not_answering' }),
    ).toStrictEqual([
      'Waiting articles: 70.',
      'No concerned player has a known next game.',
      'Cause: service not answering.',
    ]);
    expect(classificationLines({ cause: 'refused_before_limit' }).at(-1)).toBe(
      "Cause: refused before the declared limit: check the service's terms and update the limit.",
    );
  });

  it('[TEL-08] [CL-TEL-02] ends an incident with the whole interruption and the link of its start', () => {
    expect(linesOf(incidentEnd(INCIDENT_END, PARIS))).toStrictEqual([
      '<b>Egoscope · Incident resolved — Stats source unavailable</b>',
      'Interrupted from Thursday 19 November 2026, 06:10 Paris time to Thursday 19 November 2026, 11:50 Paris time (5 h 40).',
      '<a href="https://egoscope.example/journal?entry=43">See the journal</a>',
    ]);
    expect(
      linesOf(
        incidentEnd(
          {
            ...INCIDENT_END,
            incidentKind: 'press_source_down',
            subjects: ['A regional daily', 'A sports weekly'],
            url: SOURCES_URL,
          },
          PARIS,
        ),
      ).slice(2),
    ).toStrictEqual(['Affected: A regional daily; A sports weekly.', SOURCES_LINK]);
  });

  it('[TEL-08] writes the export reminder with the last full export, or that none was made', () => {
    expect(linesOf(exportReminder(EXPORT_REMINDER, PARIS))).toStrictEqual([
      '<b>Egoscope · Incident — Export reminder</b>',
      'Last full export: Sunday 1 November 2026, 10:00 Paris time.',
      'Your data has no recent full export.',
      '<a href="https://egoscope.example/settings">Open the export</a>',
    ]);
    expect(linesOf(exportReminder({ ...EXPORT_REMINDER, lastExportAt: null }, PARIS))[1]).toBe(
      'No full export yet.',
    );
  });
});
