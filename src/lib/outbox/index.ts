export { markConsumed, pending } from './consume';
export type { PendingFact } from './consume';
export { emit } from './emit';
export { OUTBOX_FACT_KINDS } from './facts';
export type { Lot2Fact, Lot2FactKind, OutboxFact, OutboxFactKind } from './facts';
export { deleteFactsOf, purgeConsumed } from './purge';
