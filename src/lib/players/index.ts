// The public API of the followed players (module map, section 2.4): the types of types.ts,
// then one slot per other file that the plan gives the module, with the operations
// it will export. A task adds its exports in its own file's slot only (section 9).

// types.ts
export type {
  FollowedPlayerRow,
  NewFollowedPlayerRow,
  NewPlayerNameVariantRow,
  NewPlayerStatusChangeRow,
  NewPlayerTeamChangeRow,
  PlayerNameVariantRow,
  PlayerStatusChangeRow,
  PlayerTeamChangeRow,
} from './types';

// add.ts: add
export { add } from './add';
export type {
  AddFieldErrors,
  Added,
  AddRefusal,
  NewNameVariant,
  NewPlayer,
  VariantProblem,
} from './add';

// identity.ts: updateIdentity, setBirthdayFromSource, recordDerivationRun
export { setBirthdayFromSource, updateIdentity } from './identity';
export type {
  Birthday,
  IdentityChange,
  IdentityFieldErrors,
  IdentityRefusal,
  IdentityUpdated,
  ImpossibleBirthday,
  SourceBirthday,
} from './identity';

// status.ts: pause, reactivate, withdraw, declinePauseSuggestion

// teams.ts: recordTeamChange, enterTeamChange
export { enterTeamChange, recordTeamChange } from './teams';
export type {
  GameEvidence,
  PlayerFileEvidence,
  PlayerNotFound,
  TeamChangeOutcome,
  TeamEvidence,
  TeamJudgment,
  TeamUnchanged,
} from './teams';

// delete.ts: deleteRows

// queries.ts: list, get, activeCount, statusGates, sharedVariants, history, variantsOfActivePlayers
export {
  activeCount,
  get,
  history,
  list,
  normalizeName,
  sharedVariants,
  variantsOfActivePlayers,
} from './queries';
export type {
  ActivePlayerNames,
  ListedPlayer,
  NameVariant,
  NameVariantKind,
  PlayerDetail,
  PlayerHistoryEntry,
  PlayerListPage,
  PlayerListQuery,
  PlayerStatus,
  SearchedVariant,
  SharedVariant,
  StatusHistoryEntry,
  TeamHistoryEntry,
} from './queries';
