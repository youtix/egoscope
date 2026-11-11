# 0013. Tool-agnostic research AI, import tested against AI output quirks

- Status: Accepted
- Date: 2026-11-11

## Context

- D-09: the owner runs each deep research in an AI, outside the application, which never calls it (TRV-19, VUE-07). BKT-19: the prompt is written for any research AI able to cite its sources, and none is assumed; a free access limits the number of searches.
- Q-BKT-02 ([05](../05-demande-de-backtest-et-prompt.md)): which free research AI will the owner use, and how many searches a month does its quota allow? The answer says whether 20 to 30 first backtests, then their complements, are realistic.
- BKT-25 and BKT-26 list the known output risks: a truncated or abridged answer, text around the JSON, code fences, footnote calls. IMP-04 isolates the JSON from surrounding text, code fences and invisible characters and corrects nothing else; IMP-05 recovers the complete events of a truncated result when its header is complete and its events are sorted.

## Decision

The research AI stays tool-agnostic, as specified (BKT-19). The import is tested against the usual output quirks of research AIs: citation markers, code fences, truncated answers.

## Consequences

- No research tool is named in the code, the screens, the prompt or the documentation; the optional address of IHM-44 stays the only link to the owner's tool. The quota question of Q-BKT-02 stays the owner's and is not modeled.
- `data/` holds fixtures for at least these quirks, plus those IMP-04 names: JSON in a fenced code block between an introduction and a report; citation markers around and inside the JSON; answers cut in the middle of an event and of a string; invisible characters.
- The tests assert the behavior IMP-04, IMP-05, IMP-09, IMP-20 and IMP-21 already define: surrounding text and fences ignored; a marker between JSON tokens reported as a syntax error with its approximate place; a truncated answer recovered under IMP-05 or refused with the correction message.

## Open points

- A citation marker inside a text value (a description, a title) passes every control of the specs and would be stored. Recommended handling: a warning on the event in the preview (IMP-19, "added with warning"), never a silent rewrite.

## Alternatives considered

- Choosing one research AI and tailoring the prompt and the import to it. Not retained.
