import type { Route } from 'next';

// The identifiers as the domain model stores them: a followed player's random uuid and an
// event type's slug are text (`playerId`, `typeId`), every other object's identifier is an
// integer.

/** One path segment: an identifier never changes the shape of the path it goes in. */
const segment = (id: string | number): string => encodeURIComponent(String(id));

/** The query string of `params`, its values encoded: `next=%2Fplayers`. */
const query = (params: Readonly<Record<string, string>>): string =>
  new URLSearchParams(params).toString();

/**
 * The path of every screen of module map section 3.3, built from its typed parameters, so
 * that every object a screen mentions links to its own screen (IHM-16, IHM-17). Each
 * builder's type is checked against the routes that exist (Next.js typed routes). The two
 * screens without navigation, login and choose password, are plain paths: their routes
 * belong to the access task and do not exist yet.
 */
export const paths = {
  logIn: (next: string): `/log-in?${string}` => `/log-in?${query({ next })}`,
  choosePassword: (): '/choose-password' => '/choose-password',
  home: (): Route => '/',
  players: (): Route => '/players',
  newPlayer: (): Route => '/players/new',
  player: (playerId: string): Route<`/players/${string}`> => `/players/${segment(playerId)}`,
  editPlayer: (playerId: string): Route<`/players/${string}/edit`> =>
    `/players/${segment(playerId)}/edit`,
  deletePlayerData: (playerId: string): Route<`/players/${string}/delete`> =>
    `/players/${segment(playerId)}/delete`,
  profile: (playerId: string, typeId: string): Route<`/players/${string}/profiles/${string}`> =>
    `/players/${segment(playerId)}/profiles/${segment(typeId)}`,
  profiles: (): Route => '/profiles',
  case: (caseId: number): Route<`/cases/${string}`> => `/cases/${segment(caseId)}`,
  event: (eventId: number): Route<`/events/${string}`> => `/events/${segment(eventId)}`,
  correctEvent: (eventId: number): Route<`/events/${string}/edit`> =>
    `/events/${segment(eventId)}/edit`,
  withdrawEvent: (eventId: number): Route<`/events/${string}/withdraw`> =>
    `/events/${segment(eventId)}/withdraw`,
  backtestRequests: (): Route => '/backtests',
  request: (requestId: number): Route<`/backtests/${string}`> => `/backtests/${segment(requestId)}`,
  importResult: (requestId: number): Route<`/backtests/${string}/import`> =>
    `/backtests/${segment(requestId)}/import`,
  types: (): Route => '/types',
  typeSheet: (typeId: string): Route<`/types/${string}`> => `/types/${segment(typeId)}`,
  editTypeSheet: (typeId: string): Route<`/types/${string}/edit`> =>
    `/types/${segment(typeId)}/edit`,
  validateType: (typeId: string): Route<`/types/${string}/validate`> =>
    `/types/${segment(typeId)}/validate`,
  splitType: (typeId: string): Route<`/types/${string}/split`> => `/types/${segment(typeId)}/split`,
  eventsToReview: (typeId: string): Route<`/types/${string}/review-events`> =>
    `/types/${segment(typeId)}/review-events`,
  generalTrend: (typeId: string): Route<`/types/${string}/trend`> =>
    `/types/${segment(typeId)}/trend`,
  mergeTypes: (): Route => '/types/merge',
  exploreTypes: (): Route => '/types/explore',
  more: (): Route => '/more',
  settings: (): Route => '/settings',
  account: (): Route => '/settings/account',
  display: (): Route => '/settings/display',
  parameters: (): Route => '/settings/parameters',
  notifications: (): Route => '/settings/notifications',
  /** The activity journal, or one of its entries, which IHM-51's links open. */
  journal: (entry?: number): Route =>
    entry === undefined ? '/journal' : `/journal?${query({ entry: String(entry) })}`,
  status: (): Route => '/status',
  method: (): Route => '/method',
  help: (): Route => '/help',
  alerts: (): Route => '/alerts',
  alertSheet: (sheetId: number): Route<`/alerts/${string}`> => `/alerts/${segment(sheetId)}`,
  detectedEvents: (): Route => '/detected-events',
  validationTable: (): Route => '/validation',
  collection: (): Route => '/collection',
  pressSources: (): Route => '/collection/sources',
  newPressSource: (): Route => '/collection/sources/new',
  pressSource: (sourceId: number): Route<`/collection/sources/${string}`> =>
    `/collection/sources/${segment(sourceId)}`,
  collectionRuns: (): Route => '/collection/runs',
  collectionRun: (runId: number): Route<`/collection/runs/${string}`> =>
    `/collection/runs/${segment(runId)}`,
  classificationQueue: (): Route => '/collection/queue',
  notRelevantArticles: (): Route => '/collection/not-relevant',
  detectionJournal: (): Route => '/collection/detection-journal',
  modelInstructions: (): Route => '/collection/instructions',
  article: (articleId: number): Route<`/collection/articles/${string}`> =>
    `/collection/articles/${segment(articleId)}`,
} as const;
