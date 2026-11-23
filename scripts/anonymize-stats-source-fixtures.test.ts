import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { anonymize } from './anonymize-stats-source-fixtures';
import { anonymizer, parseCsv, writeCsv } from './anonymize-stats-source-rows';

import type { RecordingPlan } from './anonymize-stats-source-fixtures';

// Release files of invented players, as the real ones are laid out: the names below
// stand for the real names that the originals hold.
const BOX_SCORES = [
  [
    'game_id',
    'game_date',
    'athlete_id',
    'athlete_display_name',
    'athlete_short_name',
    'team_id',
    'athlete_headshot_href',
    'reason',
    'minutes',
  ],
  [
    'g1',
    '2026-11-21',
    '111',
    'Zebulon Quartermaine',
    'Z. Quartermaine',
    '5',
    'https://cdn.example/i/headshots/111.png',
    '',
    '30',
  ],
  [
    'g2',
    '2026-11-10',
    '222',
    'Ignatius Fernsby',
    'I. Fernsby',
    '5',
    'https://cdn.example/i/headshots/222.png',
    'REST',
    '',
  ],
  ['g3', '2026-11-12', '222', 'Ignatius Fernsby', 'I. Fernsby', '7', '', '', '12'],
  ['g4', '2026-11-15', '333', 'Octavian Brimblecombe', 'O. Brimblecombe', '9', '', '', '20'],
];
const SCHEDULE = [
  ['game_id', 'uid', 'game_date', 'notes_headline', 'home_logo'],
  ['g1', 's:40~l:46~e:g1~c:g1', '2026-11-21', '', ''],
  ['g2', 's:40~l:46~e:g2~c:g2', '2026-11-10', '', ''],
  ['g3', 's:40~l:46~e:g3~c:g3', '2026-11-12', '', ''],
  ['g4', 's:40~l:46~e:g4~c:g4', '2026-11-15', '', ''],
  ['g5', 's:40~l:46~e:g5~c:g5', '2026-11-30', 'kept', ''],
];
const PLAYERS = [
  [
    'athlete_id',
    'display_name',
    'first_name',
    'last_name',
    'slug',
    'uid',
    'guid',
    'date_of_birth',
    'age',
    'headshot_href',
    'height',
    'highlights',
  ],
  [
    '111',
    'Zebulon Quartermaine',
    'Zebulon',
    'Quartermaine',
    'zebulon-quartermaine',
    's:40~l:46~a:111',
    'x',
    '1998-03-04T08:00Z',
    '28',
    'https://cdn.example/i/headshots/111.png',
    '201',
    '[{"title":"Zebulon Quartermaine dunks"}]',
  ],
  [
    '222',
    'Ignatius Fernsby',
    'Ignatius',
    'Fernsby',
    'ignatius-fernsby',
    's:40~l:46~a:222',
    'y',
    '',
    '',
    '',
    '',
    '',
  ],
  [
    '333',
    'Octavian Brimblecombe',
    'Octavian',
    'Brimblecombe',
    'octavian-brimblecombe',
    's:40~l:46~a:333',
    'z',
    '1990-01-01T08:00Z',
    '36',
    '',
    '',
    '',
  ],
];
const CROSSWALK = [
  [
    'espn_athlete_id',
    'espn_full_name',
    'nba_player_id',
    'nba_player_name',
    'fox_athlete_id',
    'yahoo_player_id',
    'match_method',
  ],
  ['111', 'Zebulon Quartermaine', '1630001', 'Zebulon Quartermaine', '4001', 'nba.p.5001', 'exact'],
  ['222', 'Ignatius Fernsby', '1630002', 'Ignatius Fernsby', '', 'nba.p.5002', 'fuzzy'],
  [
    '333',
    'Octavian Brimblecombe',
    '1630003',
    'Octavian Brimblecombe',
    '4003',
    'nba.p.5003',
    'exact',
  ],
];
const PROBE = '{"last_updated":"2026-11-22 07:33:59 EST"}';

const PLAN: RecordingPlan = {
  boxScores: [{ file: 'player_box_2027.csv', days: ['2026-11-21'], keepsTraded: true }],
  schedules: [
    { file: 'nba_schedule_2027.csv', isKept: (row) => row('notes_headline').startsWith('kept') },
  ],
  players: ['player_core_2027.csv'],
  crosswalks: ['nba_player_crosswalk_2025.csv'],
};

type Rows = readonly (readonly string[])[];

/** Folders of originals, with the schedule given, and of outputs, removed when the test ends. */
function foldersOf(schedule: Rows = SCHEDULE): Readonly<{ originals: string; output: string }> {
  const root = mkdtempSync(path.join(tmpdir(), 'egoscope-anonymize-'));
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const originals = path.join(root, 'originals');
  mkdirSync(originals);
  const files: readonly (readonly [string, Rows])[] = [
    ['player_box_2027.csv', BOX_SCORES],
    ['nba_schedule_2027.csv', schedule],
    ['player_core_2027.csv', PLAYERS],
    ['nba_player_crosswalk_2025.csv', CROSSWALK],
  ];
  for (const [file, rows] of files) {
    writeFileSync(path.join(originals, file), writeCsv(rows));
  }
  writeFileSync(path.join(originals, 'timestamp.json'), PROBE);
  return { originals, output: path.join(root, 'output') };
}

/** The rows of the fixture `file` written in `output`. */
const rowsOf = (output: string, file: string): string[][] =>
  parseCsv(readFileSync(path.join(output, file), 'utf8'));

describe('the anonymizer of the recorded statistics-source fixtures', () => {
  it('[TRV-15] keeps the planned rows, the games of the kept lines and the traded player, under their kebab-case names', async () => {
    const { originals, output } = foldersOf();
    expect(await anonymize(originals, output, PLAN)).toStrictEqual({
      ok: true,
      written: [
        'player-box-2027.csv',
        'nba-schedule-2027.csv',
        'player-core-2027.csv',
        'nba-player-crosswalk-2025.csv',
        'timestamp.json',
      ],
    });
    expect(rowsOf(output, 'nba-schedule-2027.csv').map(([game = '']) => game)).toStrictEqual([
      'game_id',
      'g1',
      'g2',
      'g3',
      'g5',
    ]);
    expect(readFileSync(path.join(output, 'timestamp.json'), 'utf8')).toBe(
      '{ "last_updated": "2026-11-22 07:33:59 EST" }\n',
    );
  });

  it('[TRV-15] gives every player the same invented id and name in every file, and blanks the personal and free-text columns', async () => {
    const { originals, output } = foldersOf();
    await anonymize(originals, output, PLAN);
    expect(rowsOf(output, 'player-box-2027.csv')).toStrictEqual([
      BOX_SCORES[0],
      ['g1', '2026-11-21', '9000001', 'Aran Braven', 'A. Braven', '5', '', '', '30'],
      ['g2', '2026-11-10', '9000002', 'Belan Calvex', 'B. Calvex', '5', '', '', ''],
      ['g3', '2026-11-12', '9000002', 'Belan Calvex', 'B. Calvex', '7', '', '', '12'],
    ]);
    expect(rowsOf(output, 'player-core-2027.csv')).toStrictEqual([
      PLAYERS[0],
      [
        '9000001',
        'Aran Braven',
        'Aran',
        'Braven',
        'aran-braven',
        's:40~l:46~a:9000001',
        'd5c28ab8-bf58-c419-77a2-a618df2d235b',
        '1999-06-14T07:00Z',
        '27',
        '',
        '',
        '[]',
      ],
      [
        '9000002',
        'Belan Calvex',
        'Belan',
        'Calvex',
        'belan-calvex',
        's:40~l:46~a:9000002',
        '0596732f-0b3b-42d5-5d8e-45219150840f',
        '',
        '',
        '',
        '',
        '',
      ],
    ]);
    expect(rowsOf(output, 'nba-player-crosswalk-2025.csv')).toStrictEqual([
      CROSSWALK[0],
      ['9000001', 'Aran Braven', '8000001', 'Aran Braven', '7000001', 'nba.p.6000001', 'exact'],
      ['9000002', 'Belan Calvex', '8000002', 'Belan Calvex', '', 'nba.p.6000002', 'fuzzy'],
    ]);
  });

  it('[TRV-15] keeps the game uid of every schedule row as recorded and invents no player for it', async () => {
    const { originals, output } = foldersOf();
    await anonymize(originals, output, PLAN);
    expect(rowsOf(output, 'nba-schedule-2027.csv')).toStrictEqual([
      SCHEDULE[0],
      SCHEDULE[1],
      SCHEDULE[2],
      SCHEDULE[3],
      SCHEDULE[5],
    ]);
    expect(rowsOf(output, 'player-core-2027.csv').map(([id = '']) => id)).toStrictEqual([
      'athlete_id',
      '9000001',
      '9000002',
    ]);
  });

  it('[TRV-15] blanks the player columns of a row without a player id, and gives the next player the first invented id', () => {
    const anonymized = anonymizer('2026-11-22');
    const header = ['athlete_id', 'display_name', 'uid', 'date_of_birth'];
    expect(
      anonymized({
        header,
        rows: [
          ['', 'Zebulon Quartermaine', 's:40~l:46~a:111', '1998-03-04T08:00Z'],
          ['222', 'Ignatius Fernsby', 's:40~l:46~a:222', ''],
        ],
      }),
    ).toStrictEqual({
      header,
      rows: [
        ['', '', '', ''],
        ['9000001', 'Aran Braven', 's:40~l:46~a:9000001', ''],
      ],
    });
    expect(
      anonymized({
        header: ['espn_athlete_id', 'espn_full_name'],
        rows: [['', 'Octavian Brimblecombe']],
      }).rows,
    ).toStrictEqual([['', '']]);
  });

  it('[TRV-15] removes every file it wrote and fails when a real name or a headshot address is left in one', async () => {
    const schedule = [
      ...SCHEDULE,
      [
        'g6',
        's:40~l:46~e:g6~c:g6',
        '2026-12-01',
        'kept: Zebulon Quartermaine returns',
        'https://cdn.example/i/headshots/logo.png',
      ],
    ];
    const { originals, output } = foldersOf(schedule);
    expect(await anonymize(originals, output, PLAN)).toStrictEqual({
      ok: false,
      matches: [{ file: 'nba-schedule-2027.csv', count: 2 }],
    });
    expect(readdirSync(output)).toStrictEqual([]);
  });

  it('[TRV-15] reads and writes CSV fields that hold separators, quotes and line breaks', () => {
    const rows = [
      ['a', 'b,"c"'],
      ['line\nbreak', '\r'],
      ['', ''],
    ];
    expect(writeCsv(rows)).toBe('a,"b,""c"""\n"line\nbreak","\r"\n,\n');
    expect(parseCsv(writeCsv(rows))).toStrictEqual(rows);
    expect(parseCsv('last,')).toStrictEqual([['last', '']]);
    expect(parseCsv('a,"b""\nc",d')).toStrictEqual([['a', 'b"\nc', 'd']]);
  });
});
