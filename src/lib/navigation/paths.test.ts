import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { paths } from './paths';

const ROOT = path.join(import.meta.dirname, '../../..');
const MODULE_MAP = readFileSync(path.join(ROOT, 'docs/engineering/module-map.md'), 'utf8');
// The screens of the (auth) group, which the access task builds (module map section 3.1).
const AUTH_SCREENS = new Set(['/log-in', '/choose-password']);

// An invented player's uuid, and a slug that needs encoding.
const PLAYER = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const TYPE = 'media-storm';

// Every route of module map section 3.3, by its pattern, and the path that `paths` builds
// for it with the parameters above or 7, 12, 31, 40, 52, 63 and 75.
const ROUTES: readonly (readonly [string, string, string])[] = [
  ['/log-in', paths.logIn('/players'), '/log-in?next=%2Fplayers'],
  ['/choose-password', paths.choosePassword(), '/choose-password'],
  ['/', paths.home(), '/'],
  ['/players', paths.players(), '/players'],
  ['/players/new', paths.newPlayer(), '/players/new'],
  ['/players/[playerId]', paths.player(PLAYER), `/players/${PLAYER}`],
  ['/players/[playerId]/edit', paths.editPlayer(PLAYER), `/players/${PLAYER}/edit`],
  ['/players/[playerId]/delete', paths.deletePlayerData(PLAYER), `/players/${PLAYER}/delete`],
  [
    '/players/[playerId]/profiles/[typeId]',
    paths.profile(PLAYER, TYPE),
    `/players/${PLAYER}/profiles/media-storm`,
  ],
  ['/profiles', paths.profiles(), '/profiles'],
  ['/cases/[caseId]', paths.case(7), '/cases/7'],
  ['/events/[eventId]', paths.event(12), '/events/12'],
  ['/events/[eventId]/edit', paths.correctEvent(12), '/events/12/edit'],
  ['/events/[eventId]/withdraw', paths.withdrawEvent(12), '/events/12/withdraw'],
  ['/backtests', paths.backtestRequests(), '/backtests'],
  ['/backtests/[requestId]', paths.request(31), '/backtests/31'],
  ['/backtests/[requestId]/import', paths.importResult(31), '/backtests/31/import'],
  ['/types', paths.types(), '/types'],
  ['/types/[typeId]', paths.typeSheet(TYPE), '/types/media-storm'],
  ['/types/[typeId]/edit', paths.editTypeSheet(TYPE), '/types/media-storm/edit'],
  ['/types/[typeId]/validate', paths.validateType(TYPE), '/types/media-storm/validate'],
  ['/types/[typeId]/split', paths.splitType(TYPE), '/types/media-storm/split'],
  ['/types/[typeId]/review-events', paths.eventsToReview(TYPE), '/types/media-storm/review-events'],
  ['/types/[typeId]/trend', paths.generalTrend(TYPE), '/types/media-storm/trend'],
  ['/types/merge', paths.mergeTypes(), '/types/merge'],
  ['/types/explore', paths.exploreTypes(), '/types/explore'],
  ['/more', paths.more(), '/more'],
  ['/settings', paths.settings(), '/settings'],
  ['/settings/account', paths.account(), '/settings/account'],
  ['/settings/display', paths.display(), '/settings/display'],
  ['/settings/parameters', paths.parameters(), '/settings/parameters'],
  ['/settings/notifications', paths.notifications(), '/settings/notifications'],
  ['/journal', paths.journal(), '/journal'],
  ['/status', paths.status(), '/status'],
  ['/method', paths.method(), '/method'],
  ['/help', paths.help(), '/help'],
  ['/alerts', paths.alerts(), '/alerts'],
  ['/alerts/[sheetId]', paths.alertSheet(40), '/alerts/40'],
  ['/detected-events', paths.detectedEvents(), '/detected-events'],
  ['/validation', paths.validationTable(), '/validation'],
  ['/collection', paths.collection(), '/collection'],
  ['/collection/sources', paths.pressSources(), '/collection/sources'],
  ['/collection/sources/new', paths.newPressSource(), '/collection/sources/new'],
  ['/collection/sources/[sourceId]', paths.pressSource(52), '/collection/sources/52'],
  ['/collection/runs', paths.collectionRuns(), '/collection/runs'],
  ['/collection/runs/[runId]', paths.collectionRun(63), '/collection/runs/63'],
  ['/collection/queue', paths.classificationQueue(), '/collection/queue'],
  ['/collection/not-relevant', paths.notRelevantArticles(), '/collection/not-relevant'],
  ['/collection/detection-journal', paths.detectionJournal(), '/collection/detection-journal'],
  ['/collection/instructions', paths.modelInstructions(), '/collection/instructions'],
  ['/collection/articles/[articleId]', paths.article(75), '/collection/articles/75'],
];

/** The path of every row of the screen table of module map section 3.3, in its order. */
function screenTable(): readonly string[] {
  const start = MODULE_MAP.indexOf('### 3.3 Screens');
  const section = MODULE_MAP.slice(start, MODULE_MAP.indexOf('### 3.4', start));
  return section
    .split('\n')
    .map((line) => /^\| `(?<route>\/[^`]*)`/u.exec(line)?.groups?.['route'])
    .filter((route) => route !== undefined);
}

describe('paths', () => {
  it('[IHM-16] [IHM-17] builds a path for every screen of module map section 3.3, in its order', () => {
    expect(ROUTES.map(([pattern]) => pattern)).toStrictEqual(screenTable());
  });

  it.each(ROUTES)('[IHM-17] builds the path of %s', (_pattern, built, expected) => {
    expect(built).toBe(expected);
  });

  it('[IHM-16] has a screen in the (app) group for every route outside the access screens', () => {
    const missing = ROUTES.map(([pattern]) => pattern).filter(
      (pattern) =>
        !AUTH_SCREENS.has(pattern) &&
        !existsSync(path.join(ROOT, 'src/app/(app)', pattern, 'page.tsx')),
    );

    expect(missing).toStrictEqual([]);
  });

  it('[IHM-17] opens one entry of the activity journal, the target of the links of IHM-51', () => {
    expect(paths.journal(1042)).toBe('/journal?entry=1042');
  });

  it('[IHM-10] encodes the path the login page returns to, query string included', () => {
    expect(paths.logIn('/journal?entry=8')).toBe('/log-in?next=%2Fjournal%3Fentry%3D8');
  });

  it('[IHM-17] encodes an identifier, so that it never changes the shape of the path', () => {
    expect(paths.typeSheet('a/b c')).toBe('/types/a%2Fb%20c');
    expect(paths.profile('x?y', 'z#w')).toBe('/players/x%3Fy/profiles/z%23w');
  });
});
