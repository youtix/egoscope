/**
 * The fixed sentences of 05 Backtest request and prompt in English (glossary section
 * 7), by name, in commented groups, one per screen or task, each naming the
 * requirements it serves.
 */
export const backtestsSentences = {
  // Why no backtest request can be created, on the Types screen without a validated type
  // and wherever a request is offered (BKT-02, CL-BKT-03, IHM-55)
  noRequestPossible:
    'To request a backtest, first validate an event type that research can look for. Types derived from the calendar need no backtest.',

  // An area adds its groups above this line, one commented group per screen or task.
} as const;
