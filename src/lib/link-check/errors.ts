// The expected failure of the link-check port. Whatever a page answers is a
// verdict, never an error: only a probe that its call context stopped, by its
// signal or its deadline, has no verdict, so that the caller checks the link again
// later (module map §5).

/** Why a probe gave no verdict: its call context stopped it. */
export type LinkCheckError = Readonly<{ kind: 'aborted' }>;
