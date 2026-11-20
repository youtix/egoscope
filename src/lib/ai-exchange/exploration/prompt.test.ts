import { describe, expect, it } from 'vitest';

import { buildExplorationPrompt } from './prompt';

import type {
  ExplorationArticleReference,
  ExplorationPromptInput,
  ExplorationTarget,
  ExplorationTypeEntry,
  TypeRejectionReason,
} from './prompt';

// Invented types in each state and the lists they make, and an invented detection
// proposal with two articles, one in English and one in French, as the taxonomy reads
// them: the rejected type keeps the owner's comment, the withdrawn type its reason and
// each article its text, none of which a prompt may hold.
const HUMILIATION = {
  name: 'Public humiliation',
  definition:
    'a public act or remark, by an identifiable author, that belittles or ridicules the followed player by name.',
};
const CONFLICT = {
  name: 'Conflict between players',
  definition: 'a public clash, verbal or physical, between the followed player and another player.',
};
const MEDIA_STORM = {
  name: 'Media storm',
  definition: 'a wave of negative coverage centered on the followed player.',
};
const NO_DEFINITION = { name: 'Trade request by a teammate', definition: null };
const COACH_CRITICISM = {
  name: 'Coach criticism',
  definition: 'a coach criticizes the followed player in public.',
  rejectionReason: 'duplicate_of_existing_type',
  rejectionComment: 'Already covered by public humiliation.',
} as const;
const HOSTILE_CROWD = {
  name: 'Hostile crowd',
  definition: 'the crowd of an away game boos the followed player.',
  withdrawalReason: 'Too rare in the press.',
};
const LISTS = {
  validatedTypes: [HUMILIATION, CONFLICT],
  pendingProposals: [MEDIA_STORM, NO_DEFINITION],
  rejectedTypes: [COACH_CRITICISM],
  withdrawnTypes: [HOSTILE_CROWD],
};
const ENGLISH_ARTICLE = {
  url: 'https://www.example.com/news/2026/11/10/critics-turn-on-player-a',
  outlet: 'Hoops Daily Ledger',
  title: 'Critics turn on player A after his remarks',
  publicationDate: '2026-11-10',
  text: 'The full text of the article, which no prompt holds.',
};
const FRENCH_ARTICLE = {
  url: 'https://www.example.org/basket/le-joueur-a-critique',
  outlet: 'Gazette des Paniers',
  title: 'Le joueur A sous le feu des critiques',
  publicationDate: '2026-11-11T08:30+01:00',
  text: 'Le texte complet de l’article.',
};

const targeted = (target: ExplorationTarget): ExplorationPromptInput => ({
  mode: 'targeted',
  target,
  ...LISTS,
});
const GENERAL: ExplorationPromptInput = { mode: 'general', ...LISTS };
const IDEA = targeted({ kind: 'idea', idea: 'A teammate publicly asks the team to trade him.' });
const proposalTarget = (
  proposal: ExplorationTypeEntry,
  articleReferences: readonly ExplorationArticleReference[],
): ExplorationPromptInput => targeted({ kind: 'proposal', proposal, articleReferences });
const PROPOSAL = proposalTarget(MEDIA_STORM, [ENGLISH_ARTICLE, FRENCH_ARTICLE]);

/** The block of `prompt` that starts with `heading`, line by line: a blank line parts two. */
function block(prompt: string, heading: string): readonly string[] {
  return (
    prompt
      .split('\n\n')
      .find((part) => part.startsWith(heading))
      ?.split('\n') ?? []
  );
}

/** The blocks of the prompt that `input` builds, but its goal. */
const allButGoal = (input: ExplorationPromptInput): readonly string[] =>
  buildExplorationPrompt(input).split('\n\n').toSpliced(1, 1);
const goalOf = (input: ExplorationPromptInput): readonly string[] =>
  block(buildExplorationPrompt(input), '1. GOAL');
const general = (heading: string): readonly string[] =>
  block(buildExplorationPrompt(GENERAL), heading);

type Lists = Omit<ExplorationPromptInput, 'mode' | 'target'>;

/** The lines of point 5 that the given lists, empty by default, write. */
function existingTypes(lists: Partial<Lists>): readonly string[] {
  const empty = { validatedTypes: [], pendingProposals: [], rejectedTypes: [], withdrawnTypes: [] };
  return block(buildExplorationPrompt({ mode: 'general', ...empty, ...lists }), '5. ');
}

/** The keys of a JSON value at every depth, as glossary section 6.2 writes them. */
function keysOf(value: unknown, path = ''): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => keysOf(item, `${path}[]`));
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, item]: [string, unknown]) => {
    const keyPath = path === '' ? key : `${path}.${key}`;
    return [keyPath, ...keysOf(item, keyPath)];
  });
}

const GOAL =
  "Propose types of public, individual and datable events that may affect an NBA player's ego. For each event of such a type, the app then measures the effect on the player's individual performance in the next game he plays.";
const PROPOSAL_MODE =
  'This exploration is targeted: deepen the proposal below rather than look for other types; it is the one type of point 5 that you may propose again.';
const MODES: [string, ExplorationPromptInput][] = [
  ['general mode', GENERAL],
  ['targeted mode, an idea', IDEA],
  ['targeted mode, a proposal', PROPOSAL],
];

describe('buildExplorationPrompt', () => {
  describe('[TAX-16] [CL-TAX-03] the English prompt in every mode', () => {
    it.each(MODES)(
      'writes its eight blocks in order, a blank line between two: %s',
      (_mode, input) => {
        const headings = buildExplorationPrompt(input)
          .split('\n\n')
          .map((part) => part.split('\n', 1)[0]);

        expect(headings).toStrictEqual([
          "DEEP RESEARCH — EVENT TYPES THAT MAY AFFECT AN NBA PLAYER'S EGO",
          '1. GOAL',
          '2. CLEAN AND DATABLE TYPES',
          '3. SOURCES',
          '4. EXCLUSIONS',
          '5. EXISTING TYPES',
          '6. WHAT TO GIVE FOR EACH TYPE',
          '7. ANSWER FORMAT',
        ]);
      },
    );

    it.each(MODES.slice(1))('keeps every block but the goal word for word: %s', (_mode, input) => {
      expect(allButGoal(input)).toStrictEqual(allButGoal(GENERAL));
    });
  });

  describe('[TAX-16] the fixed blocks', () => {
    it('heads the prompt and gives the goal: public, individual and datable types whose effect on the next game is measured', () => {
      expect(general('DEEP RESEARCH')).toStrictEqual([
        "DEEP RESEARCH — EVENT TYPES THAT MAY AFFECT AN NBA PLAYER'S EGO",
        'Request issued by Egoscope, a personal app.',
      ]);
      expect(general('1. GOAL')[1]).toBe(GOAL);
    });

    it('defines clean and datable, and bans every criterion that depends on the measured game', () => {
      expect(general('2. ')).toStrictEqual([
        '2. CLEAN AND DATABLE TYPES',
        'A type is clean when:',
        "- it is recognized by a public, observable fact, without assuming the player's state of mind: the app does not measure ego, it finds facts that may affect it;",
        "- its criteria allow a yes-or-no decision on reading an article, so that the app's automatic classification and its user file the same article under the same type;",
        '- the fact targets one player by name, not a team;',
        '- no fact can belong both to it and to another validated type: when two types are neighbors, the exclusion criteria of each say which one prevails.',
        'A type is datable when its dating rule gives each event a single reference date, the moment the fact became public, established by a dated press source. The rule places the event before or after the tip-off of the measured game, the first NBA game the player plays after the event became public; for a fact that unfolds over time, it names the moment that counts, such as the first publication by a national outlet. A type whose events cannot be dated at least to the day cannot be validated.',
        "No criterion may depend on what happened in the measured game: neither the player's performance, nor his response to criticism, nor the result of the game. A type defined by its outcome would keep only feel-good stories.",
      ]);
    });

    it('[D-10] [H-11] [CL-TAX-03] admits only public, dated press articles, in English or in French, by their exact address', () => {
      expect(general('3. ')).toStrictEqual([
        '3. SOURCES',
        'Only public, dated press articles, in English or in French: sports press, general press, news archives. No social networks, forums, collaborative encyclopedias, or videos without an article. Give the exact address of each article, never that of a home page or a search page. Never invent a fact, a date, an address, a title or an outlet, and cite only articles whose existence you have checked.',
      ]);
    });

    it('[D-06] asks for every element of each type and invites harder-to-document types, flagged by their difficulty', () => {
      expect(general('6. ')).toStrictEqual([
        '6. WHAT TO GIVE FOR EACH TYPE',
        'For each type you propose, give its name; its definition; its inclusion criteria; its exclusion criteria, naming the neighboring type that prevails, if any; its dating rule, which says whether its events are known in advance; a generic example that names no real person, written with player A, team X and a national outlet; its documentation difficulty; its possible overlaps with the types of point 5; and its illustration sources, public and dated articles that report real events of the type. Write short sentences, in English, that an AI can apply without interpretation.',
        'The documentation difficulty, easy, medium or hard, says how easily a search of dated press, archives included, finds every event of the type. Also propose types whose events are harder to document, provided they are clean and datable, and flag them by their difficulty: for such a type, a search mostly finds the events that people remember, often because a striking game followed, which threatens a complete count.',
      ]);
    });

    it('[CL-TAX-04] asks for the JSON object alone, in English, as its skeleton and rules say', () => {
      expect(general('7. ')).toStrictEqual([
        '7. ANSWER FORMAT',
        'Your answer consists only of one valid JSON object, written in English: no text before or after it, no formatting tags, no footnote calls or citation markers. If your tool still adds a report, the complete JSON must appear in one piece at the very end. Expected structure, where each value describes what to put there:',
        '{',
        '  "format": "egoscope-exploration",',
        '  "format_version": "1.0",',
        '  "proposed_types": [',
        '    {',
        '      "name": "short name of the type",',
        '      "definition": "what the type covers, in short sentences",',
        '      "inclusion_criteria": "the criteria that a fact must meet, each decided by yes or no",',
        '      "exclusion_criteria": "the facts left out, each with the neighboring type that prevails, if any",',
        '      "dating_rule": "how each event gets its single reference date",',
        '      "known_in_advance": false,',
        '      "generic_example": "an example with player A, team X and a national outlet",',
        '      "documentation_difficulty": "easy, medium or hard",',
        '      "possible_overlaps": ["one sentence per possible overlap with a type of point 5"],',
        '      "illustration_sources": [',
        '        {',
        '          "url": "full address of the article, starting with https:// or http://",',
        '          "outlet": "name of the outlet",',
        '          "title": "exact title of the article, in its own language",',
        '          "publication_date": "YYYY-MM-DD, or YYYY-MM-DDTHH:MM±HH:MM if the time is known"',
        '        }',
        '      ]',
        '    }',
        '  ]',
        '}',
        'Format rules: give each type a "name", and every other element you can establish; omit an element you cannot establish rather than leave it empty, and never write null; "known_in_advance" is true when the day of each event is known beforehand, as for a birthday, and false otherwise; write the enumerated values in lowercase; if no type meets these rules, send back the same object with "proposed_types": []; add no other field; use straight quotation marks only.',
      ]);
    });

    it('[CL-TAX-04] writes a skeleton that JSON reads, with the keys of glossary section 6.2', () => {
      const lines = general('7. ');
      const skeleton: unknown = JSON.parse(lines.slice(2, -1).join('\n'));

      expect(keysOf(skeleton)).toStrictEqual([
        'format',
        'format_version',
        'proposed_types',
        'proposed_types[].name',
        'proposed_types[].definition',
        'proposed_types[].inclusion_criteria',
        'proposed_types[].exclusion_criteria',
        'proposed_types[].dating_rule',
        'proposed_types[].known_in_advance',
        'proposed_types[].generic_example',
        'proposed_types[].documentation_difficulty',
        'proposed_types[].possible_overlaps',
        'proposed_types[].illustration_sources',
        'proposed_types[].illustration_sources[].url',
        'proposed_types[].illustration_sources[].outlet',
        'proposed_types[].illustration_sources[].title',
        'proposed_types[].illustration_sources[].publication_date',
      ]);
    });
  });

  it('[TAX-09] [Q-06] [Q-07] [D-08] excludes a fact that targets only a team, private life or health, another sport and anything about money put on games', () => {
    expect(general('4. ')).toStrictEqual([
      '4. EXCLUSIONS',
      'No type may be about:',
      '- a fact that targets only a team;',
      "- a fact about the player's private life or health;",
      '- a fact specific to another sport;',
      '- anything to do with putting money on the outcome of games or performances.',
    ]);
  });

  describe('[TAX-16] [CL-TAX-10] the existing types, by name and definition', () => {
    it('[CA-TAX-06] cites two validated types and, in the do-not-repropose list, a rejected type with its reason', () => {
      const lists = { validatedTypes: [HUMILIATION, CONFLICT], rejectedTypes: [COACH_CRITICISM] };

      expect(existingTypes(lists)).toStrictEqual([
        '5. EXISTING TYPES',
        '5.1 Validated types, by name and definition:',
        '- Public humiliation: a public act or remark, by an identifiable author, that belittles or ridicules the followed player by name.',
        '- Conflict between players: a public clash, verbal or physical, between the followed player and another player.',
        '5.2 Pending proposals, not to propose again: none.',
        '5.3 Rejected types, not to propose again, with their rejection reason:',
        '- Coach criticism (rejection reason: duplicate of an existing type): a coach criticizes the followed player in public.',
        '5.4 Withdrawn types, not to propose again: none.',
      ]);
    });

    it('names the validated types, then the pending proposals, the rejected types with their reason and the withdrawn types, each list in the order given', () => {
      expect(general('5. ')).toStrictEqual([
        '5. EXISTING TYPES',
        '5.1 Validated types, by name and definition:',
        '- Public humiliation: a public act or remark, by an identifiable author, that belittles or ridicules the followed player by name.',
        '- Conflict between players: a public clash, verbal or physical, between the followed player and another player.',
        '5.2 Pending proposals, not to propose again:',
        '- Media storm: a wave of negative coverage centered on the followed player.',
        '- Trade request by a teammate',
        '5.3 Rejected types, not to propose again, with their rejection reason:',
        '- Coach criticism (rejection reason: duplicate of an existing type): a coach criticizes the followed player in public.',
        '5.4 Withdrawn types, not to propose again:',
        '- Hostile crowd: the crowd of an away game boos the followed player.',
      ]);
    });

    it('says "none." of an empty list', () => {
      expect(existingTypes({})).toStrictEqual([
        '5. EXISTING TYPES',
        '5.1 Validated types, by name and definition: none.',
        '5.2 Pending proposals, not to propose again: none.',
        '5.3 Rejected types, not to propose again, with their rejection reason: none.',
        '5.4 Withdrawn types, not to propose again: none.',
      ]);
    });

    it.each([
      ['not_clean', 'not clean'],
      ['not_datable', 'not datable'],
      ['duplicate_of_existing_type', 'duplicate of an existing type'],
      ['out_of_scope', 'out of scope'],
      ['other', 'other'],
    ] satisfies [TypeRejectionReason, string][])(
      'writes the rejection reason %s as "%s"',
      (rejectionReason, text) => {
        const rejectedTypes = [{ ...COACH_CRITICISM, rejectionReason }];

        expect(existingTypes({ rejectedTypes })[4]).toBe(
          `- Coach criticism (rejection reason: ${text}): a coach criticizes the followed player in public.`,
        );
      },
    );

    it('sends no rejection comment, and no reason for a pending or withdrawn type', () => {
      const prompt = buildExplorationPrompt(GENERAL);

      expect(prompt).not.toContain(COACH_CRITICISM.rejectionComment);
      expect(prompt).not.toContain(HOSTILE_CROWD.withdrawalReason);
      expect(prompt.split('(rejection reason: ')).toHaveLength(2);
    });

    it.each([null, '', ' \n\t '])(
      'names a type whose definition is %j by its name alone',
      (definition) => {
        expect(existingTypes({ validatedTypes: [{ ...HUMILIATION, definition }] })[2]).toBe(
          '- Public humiliation',
        );
      },
    );

    it('trims each name and definition', () => {
      const padded: ExplorationTypeEntry = {
        name: ' \tMedia storm \n',
        definition: '\n a storm. ',
      };

      expect(existingTypes({ withdrawnTypes: [padded] }).at(-1)).toBe('- Media storm: a storm.');
    });
  });

  describe('[TAX-16] the modes', () => {
    it('general mode looks for new types and deepens no idea, proposal or article', () => {
      expect(goalOf(GENERAL)).toStrictEqual([
        '1. GOAL',
        GOAL,
        'This exploration is general: look for new types, other than those of point 5.',
      ]);
    });

    it('targeted mode deepens the idea it is given', () => {
      expect(goalOf(IDEA)).toStrictEqual([
        '1. GOAL',
        GOAL,
        'This exploration is targeted: deepen the idea below rather than look for other types.',
        'Idea to deepen: A teammate publicly asks the team to trade him.',
      ]);
    });

    it('targeted mode deepens a proposal with the references of its articles, never their text', () => {
      expect(goalOf(PROPOSAL)).toStrictEqual([
        '1. GOAL',
        GOAL,
        PROPOSAL_MODE,
        'Proposal to deepen: Media storm: a wave of negative coverage centered on the followed player.',
        'Articles that gave rise to this proposal, given by reference only:',
        '- https://www.example.com/news/2026/11/10/critics-turn-on-player-a (Hoops Daily Ledger, "Critics turn on player A after his remarks", 2026-11-10)',
        '- https://www.example.org/basket/le-joueur-a-critique (Gazette des Paniers, "Le joueur A sous le feu des critiques", 2026-11-11T08:30+01:00)',
      ]);
      expect(buildExplorationPrompt(PROPOSAL)).not.toContain(ENGLISH_ARTICLE.text);
      expect(buildExplorationPrompt(PROPOSAL)).not.toContain(FRENCH_ARTICLE.text);
    });

    it.each([
      [
        'without its outlet',
        { ...ENGLISH_ARTICLE, outlet: null },
        '("Critics turn on player A after his remarks", 2026-11-10)',
      ],
      [
        'without its title',
        { ...ENGLISH_ARTICLE, title: null },
        '(Hoops Daily Ledger, 2026-11-10)',
      ],
      [
        'without its outlet and title',
        { ...ENGLISH_ARTICLE, outlet: null, title: null },
        '(2026-11-10)',
      ],
    ])('targeted mode names an article %s by its other details', (_case, article, details) => {
      expect(goalOf(proposalTarget(MEDIA_STORM, [article])).at(-1)).toBe(
        `- ${ENGLISH_ARTICLE.url} ${details}`,
      );
    });

    it('targeted mode names no article for a proposal that has none, and a proposal by its name alone without a definition', () => {
      expect(goalOf(proposalTarget(NO_DEFINITION, [])).slice(2)).toStrictEqual([
        PROPOSAL_MODE,
        'Proposal to deepen: Trade request by a teammate',
      ]);
    });
  });
});
