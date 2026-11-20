/**
 * The fixed sentences of 14 Cross-cutting requirements in English (glossary section 7),
 * by name, in commented groups, one per screen or task, each naming the requirements it
 * serves.
 */
export const crossCuttingSentences = {
  // The activity journal: how an entry names an item that an erasure removed, a deleted
  // player and any other item, and how it records a withdrawal, which names nothing
  // (CL-TRV-10, CL-JOU-24)
  eventWithdrawn: 'an event was withdrawn',
  itemNoLongerExists: 'an item that no longer exists',
  deletedPlayer: 'a deleted player',

  // An area adds its groups below, one commented group per screen or task.
} as const;
