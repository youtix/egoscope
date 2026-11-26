import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import registryKeys from '@data/fixtures/params/registry-keys.json';
import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { sheetCaveats } from './caveats';

import type { ContextIndications } from '../cases/doubtful-criteria';
import type { Verdict } from '../profiles/verdict';
import type { EventTypeId, PlayerEventId } from '../types';
import type { CaveatProfile, CaveatThresholds, CaveatTrend } from './caveat-thresholds';
import type { Caveat, CaveatEvent, CaveatKind, CaveatSection, SheetCaveatsInput } from './caveats';

/** The registry's default of a parameter that is no calculation parameter. */
function registryDefault(key: string): number {
  const entry = registryKeys.find((candidate) => candidate.key === key);
  if (typeof entry?.default !== 'number') {
    throw new TypeError(`The registry fixture gives ${key} no number default.`);
  }
  return entry.default;
}

// The registry's defaults: 5 valid cases, 3 players, 70 points and a margin of 10.
const THRESHOLDS: CaveatThresholds = {
  minValidCases: engineParams.sensitivity.minValidCases,
  trendMinPlayers: engineParams.sensitivity.trendMinPlayers,
  detectionThreshold: registryDefault('detection.threshold'),
  confidenceVigilanceMargin: registryDefault('alerts.confidenceVigilanceMargin'),
};
const VIGILANCE_LIMIT = THRESHOLDS.detectionThreshold + THRESHOLDS.confidenceVigilanceMargin;
const ENOUGH = THRESHOLDS.minValidCases;
const TOO_FEW = THRESHOLDS.minValidCases - 1;

// Invented event types: two from the press, one derived from the calendar.
const FEUD = 'public-feud';
const SNUB = 'contract-snub';
const BIRTHDAY = 'birthday-game';

const PLAIN: ContextIndications = { injuryReturn: 'no', gameStakes: 'normal' };
const INCREASE: Verdict = { level: 'possible', direction: 'increase' };
const DECREASE: Verdict = { level: 'probable', direction: 'decrease' };
const INCONCLUSIVE: Verdict = { level: 'inconclusive', direction: null };
const PLAIN_GAME = { isHighStakes: false, isOpponentDoubtful: false };

/** A profile with a verdict on just enough valid cases, complete and current. */
const DECIDED: CaveatProfile = {
  validCount: ENOUGH,
  verdict: INCREASE,
  profileConfidence: 'medium',
  isIncomplete: false,
  earlierVersionCaseCount: 0,
};
/** A general trend just broad enough to rest on no small sample. */
const BROAD: CaveatTrend = {
  validCount: ENOUGH,
  playerCount: THRESHOLDS.trendMinPlayers,
  profileConfidence: 'medium',
};
/** The decided profile at a low confidence, and trends each small on one count of CL-ALE-05. */
const LOW_PROFILE: CaveatProfile = { ...DECIDED, profileConfidence: 'low' };
const FEW_CASES: CaveatTrend = { ...BROAD, validCount: TOO_FEW };
const FEW_PLAYERS: CaveatTrend = { ...BROAD, playerCount: THRESHOLDS.trendMinPlayers - 1 };
const LOW_TREND: CaveatTrend = { ...BROAD, profileConfidence: 'low' };

/** A detected event of a model's confidence of 100, the highest score, with no mark. */
function detected(playerEventId: PlayerEventId, change: Partial<CaveatEvent> = {}): CaveatEvent {
  return {
    playerEventId,
    origin: 'detected',
    isDismissed: false,
    context: PLAIN,
    detectionConfidence: 100,
    isDatingToVerify: false,
    ...change,
  };
}

/** A section of a covered type, its profile decided and its trend broad, unless changed. */
function section(
  eventTypeId: EventTypeId,
  events: readonly CaveatEvent[],
  change: Partial<CaveatSection> = {},
): CaveatSection {
  return {
    eventTypeId,
    isTypeNotCovered: false,
    isCalendarDerived: false,
    hasSwitchedOffCriterion: false,
    events,
    profile: DECIDED,
    trend: BROAD,
    ...change,
  };
}

/** The caveats of a sheet that is not late, related to no sheet, before a plain game unless changed. */
function caveatsOf(
  sections: readonly CaveatSection[],
  change: Partial<SheetCaveatsInput> = {},
): readonly Caveat[] {
  return sheetCaveats(
    { sections, expectedGame: PLAIN_GAME, isLate: false, hasRelatedSheet: false, ...change },
    THRESHOLDS,
  );
}

const SURE = detected(1);

/** The caveats of a sheet of one section of FEUD, holding one sure event, its section as changed. */
function caveatsOfSection(change: Partial<CaveatSection>): readonly Caveat[] {
  return caveatsOf([section(FEUD, [SURE], change)]);
}

function kindsOf(caveats: readonly Caveat[]): readonly CaveatKind[] {
  return caveats.map(({ kind }) => kind);
}

const OPPOSITE: Caveat = {
  kind: 'effect_direction',
  eventTypeId: FEUD,
  form: 'opposite_effect_possible',
};
const EITHER_WAY: Caveat = { kind: 'effect_direction', eventTypeId: FEUD, form: 'either_way' };
const SMALL_SAMPLE: Caveat = { kind: 'small_sample', eventTypeId: FEUD };

describe('sheetCaveats', () => {
  it('[ALE-16] gives a decided profile of a covered type, with a sure event before a plain game, the direction caveat alone', () => {
    const caveats = caveatsOf([section(FEUD, [SURE])]);

    expect(caveats).toStrictEqual([OPPOSITE]);
  });

  it('[ALE-16] [CL-ALE-05] marks a small sample for a player below the threshold whatever the general trend, as for player B of the spec, or of low confidence', () => {
    // docs/09-fiche-d-alerte.md, "Variante pour un joueur sous le seuil": 2 valid cases of the
    // 5 needed, beside a trend on 48 valid cases of 15 players at a medium confidence.
    const playerB: CaveatProfile = { ...DECIDED, validCount: 2, verdict: INCONCLUSIVE };
    const trend: CaveatTrend = { validCount: 48, playerCount: 15, profileConfidence: 'medium' };
    const below: CaveatProfile = { ...DECIDED, validCount: TOO_FEW, verdict: INCONCLUSIVE };
    const high = caveatsOfSection({ profile: { ...DECIDED, profileConfidence: 'high' } });

    expect(caveatsOfSection({ profile: playerB, trend })).toStrictEqual([SMALL_SAMPLE, EITHER_WAY]);
    expect(caveatsOfSection({ profile: below })).toStrictEqual([SMALL_SAMPLE, EITHER_WAY]);
    expect(caveatsOfSection({ profile: LOW_PROFILE })).toStrictEqual([SMALL_SAMPLE, OPPOSITE]);
    expect(high).toStrictEqual([OPPOSITE]);
  });

  it('[ALE-16] [CL-ALE-05] reads no general trend for a covered player who has the cases a verdict needs', () => {
    expect(caveatsOfSection({ trend: FEW_PLAYERS })).toStrictEqual([OPPOSITE]);
    expect(caveatsOfSection({ trend: null })).toStrictEqual([OPPOSITE]);
  });

  it.each<Readonly<{ label: string; change: Partial<CaveatSection>; isSmall: boolean }>>([
    { label: 'a broad trend', change: {}, isSmall: false },
    { label: 'too few valid cases', change: { trend: FEW_CASES }, isSmall: true },
    { label: 'too few players', change: { trend: FEW_PLAYERS }, isSmall: true },
    { label: 'a low confidence', change: { trend: LOW_TREND }, isSmall: true },
    { label: 'no trend', change: { trend: null }, isSmall: true },
    { label: "the player's low confidence", change: { profile: LOW_PROFILE }, isSmall: true },
  ])(
    "[ALE-16] [CL-ALE-05] [ALE-14] judges the general trend of a type not covered, as well as the player's profile: $label",
    ({ change, isSmall }) => {
      const kinds = kindsOf(caveatsOfSection({ isTypeNotCovered: true, ...change }));
      const small = isSmall ? ['small_sample'] : [];

      expect(kinds).toStrictEqual([...small, 'effect_direction', 'type_not_covered']);
    },
  );

  it('[ALE-16] [CL-ALE-03] words the direction caveat as the opposite effect for every possible or probable profile, increase and decrease alike', () => {
    const increase = caveatsOfSection({ profile: { ...DECIDED, verdict: INCREASE } });
    const decrease = caveatsOfSection({ profile: { ...DECIDED, verdict: DECREASE } });

    expect([increase, decrease]).toStrictEqual([[OPPOSITE], [OPPOSITE]]);
  });

  it('[ALE-16] [CL-ALE-03] words it as either way for an inconclusive profile, and follows the verdict frozen, not a case threshold raised since', () => {
    const inconclusive = caveatsOfSection({ profile: { ...DECIDED, verdict: INCONCLUSIVE } });
    const raised = { ...THRESHOLDS, minValidCases: ENOUGH + 1 };
    const input = { sections: [section(FEUD, [SURE])], expectedGame: PLAIN_GAME };
    const afterRaise = sheetCaveats({ ...input, isLate: false, hasRelatedSheet: false }, raised);

    expect(inconclusive).toStrictEqual([EITHER_WAY]);
    expect(afterRaise.filter(({ kind }) => kind === 'effect_direction')).toStrictEqual([OPPOSITE]);
  });

  it('[ALE-16] [ALE-05] gives a section waiting for its values the either-way direction and what its type alone says', () => {
    const caveats = caveatsOfSection({
      profile: null,
      trend: null,
      isTypeNotCovered: true,
      hasSwitchedOffCriterion: true,
    });

    expect(caveats).toStrictEqual([
      EITHER_WAY,
      { kind: 'type_not_covered', eventTypeId: FEUD },
      { kind: 'confounder_not_separable', eventTypeId: FEUD },
    ]);
  });

  it('[ALE-16] [D-19] lists high stakes that the statistics give the expected game, as for an elimination game, and an opponent that would make the case doubtful, in that order', () => {
    const flagged = detected(1, { context: { injuryReturn: 'yes', gameStakes: 'normal' } });
    const stakes = caveatsOf([section(FEUD, [SURE])], {
      expectedGame: { isHighStakes: true, isOpponentDoubtful: false },
    });
    const opponent = caveatsOf([section(FEUD, [SURE])], {
      expectedGame: { isHighStakes: false, isOpponentDoubtful: true },
    });
    const all = caveatsOf([section(FEUD, [flagged])], {
      expectedGame: { isHighStakes: true, isOpponentDoubtful: true },
    });

    expect(stakes).toStrictEqual([
      OPPOSITE,
      { kind: 'known_context', knownContextReasons: ['high_stakes'] },
    ]);
    expect(opponent).toContainEqual({
      kind: 'known_context',
      knownContextReasons: ['opponent_strength'],
    });
    expect(all).toContainEqual({
      kind: 'known_context',
      knownContextReasons: ['high_stakes', 'injury_return_flagged', 'opponent_strength'],
    });
  });

  it('[ALE-16] [CL-SEN-28] lists high stakes and a return from injury that any non-dismissed event flags', () => {
    const events = [
      SURE,
      detected(2, { context: { injuryReturn: 'yes', gameStakes: 'unknown' } }),
      detected(3, { context: { injuryReturn: 'unknown', gameStakes: 'high' } }),
    ];

    expect(caveatsOf([section(FEUD, events)])).toContainEqual({
      kind: 'known_context',
      knownContextReasons: ['high_stakes', 'injury_return_flagged'],
    });
  });

  it('[ALE-16] [ALE-22] reads no context, confidence or dating from a dismissed event', () => {
    const dismissed = detected(2, {
      isDismissed: true,
      context: { injuryReturn: 'yes', gameStakes: 'high' },
      detectionConfidence: THRESHOLDS.detectionThreshold,
      isDatingToVerify: true,
    });

    expect(caveatsOf([section(FEUD, [dismissed])])).toStrictEqual([OPPOSITE]);
    expect(caveatsOf([section(FEUD, [dismissed, SURE])])).toStrictEqual([OPPOSITE]);
  });

  it('[ALE-16] [ALE-20] [H-ALE-02] [CL-ALE-13] warns of several events when more than one non-dismissed event, or a related sheet, shares the game', () => {
    const several: Caveat = { kind: 'several_events' };
    const twoSections = caveatsOf([section(FEUD, [SURE]), section(SNUB, [detected(2)])]);
    const oneSection = caveatsOf([section(FEUD, [SURE, detected(2)])]);
    const oneDismissed = caveatsOf([section(FEUD, [SURE, detected(2, { isDismissed: true })])]);
    const related = caveatsOf([section(FEUD, [SURE])], { hasRelatedSheet: true });
    const calendar = detected(2, { origin: 'calendar', detectionConfidence: null });
    const withCalendar = caveatsOf([
      section(FEUD, [SURE]),
      section(BIRTHDAY, [calendar], { isCalendarDerived: true }),
    ]);

    expect(twoSections).toContainEqual(several);
    expect(oneSection).toContainEqual(several);
    expect(oneDismissed).not.toContainEqual(several);
    expect(related).toStrictEqual([OPPOSITE, several]);
    expect(withCalendar).toContainEqual(several);
  });

  it('[ALE-16] [H-ALE-06] [CL-DET-07] flags a model confidence below the detection threshold plus the vigilance margin, never an owner classification, which has none', () => {
    const events = [
      detected(1, { detectionConfidence: VIGILANCE_LIMIT }),
      detected(2, { detectionConfidence: VIGILANCE_LIMIT - 1 }),
      detected(3, { detectionConfidence: THRESHOLDS.detectionThreshold }),
      detected(4, { detectionConfidence: null }),
    ];

    expect(caveatsOf([section(FEUD, events)])).toStrictEqual([
      OPPOSITE,
      { kind: 'several_events' },
      { kind: 'confidence_near_threshold', playerEventId: 2 },
      { kind: 'confidence_near_threshold', playerEventId: 3 },
    ]);
  });

  it('[ALE-16] [DET-32] flags the dating to verify of an event that carries the mark', () => {
    const caveats = caveatsOf([section(FEUD, [detected(1, { isDatingToVerify: true })])]);

    expect(caveats).toStrictEqual([OPPOSITE, { kind: 'dating_to_verify', playerEventId: 1 }]);
  });

  it('[ALE-16] [SEN-46] warns of an incomplete profile or one resting in part on an earlier sheet version', () => {
    const warning: Caveat = { kind: 'incomplete_or_earlier_version', eventTypeId: FEUD };
    const incomplete = caveatsOfSection({ profile: { ...DECIDED, isIncomplete: true } });
    const earlier = caveatsOfSection({ profile: { ...DECIDED, earlierVersionCaseCount: 1 } });

    expect(incomplete).toStrictEqual([OPPOSITE, warning]);
    expect(earlier).toStrictEqual([OPPOSITE, warning]);
  });

  it('[ALE-16] [ALE-24] adds the late sheet caveat exactly when the sheet is late', () => {
    const caveats = caveatsOf([section(FEUD, [SURE])], { isLate: true });

    expect(caveats).toStrictEqual([OPPOSITE, { kind: 'late_sheet' }]);
  });

  it('[ALE-16] [ALE-14] [CL-ALE-13] names a type not covered by the backtest, on a section left with no event too, never a calendar-derived type', () => {
    const narrow: Partial<CaveatSection> = { isTypeNotCovered: true, trend: null };
    const caveats = caveatsOf([section(FEUD, [], narrow)]);
    const derived = caveatsOf([section(BIRTHDAY, [], { ...narrow, isCalendarDerived: true })]);

    expect(kindsOf(caveats)).toStrictEqual([
      'small_sample',
      'effect_direction',
      'type_not_covered',
    ]);
    expect(derived).toStrictEqual([
      { kind: 'effect_direction', eventTypeId: BIRTHDAY, form: 'opposite_effect_possible' },
    ]);
  });

  it('[ALE-16] warns of a criterion switched off for the type, whose effect cannot be separated (ADR 0016)', () => {
    expect(caveatsOfSection({ hasSwitchedOffCriterion: true })).toStrictEqual([
      OPPOSITE,
      { kind: 'confounder_not_separable', eventTypeId: FEUD },
    ]);
  });

  it('[ALE-16] [CL-ALE-13] gives a calendar-derived event no confidence, dating or type-not-covered caveat, and every other one', () => {
    const derived: CaveatEvent = {
      ...SURE,
      origin: 'calendar',
      context: { injuryReturn: 'unknown', gameStakes: 'high' },
      detectionConfidence: 0,
      isDatingToVerify: true,
    };
    const birthday = section(BIRTHDAY, [derived], {
      isTypeNotCovered: true,
      isCalendarDerived: true,
      hasSwitchedOffCriterion: true,
      profile: { ...DECIDED, profileConfidence: 'low', isIncomplete: true },
    });

    expect(caveatsOf([birthday], { isLate: true })).toStrictEqual([
      { kind: 'small_sample', eventTypeId: BIRTHDAY },
      { kind: 'effect_direction', eventTypeId: BIRTHDAY, form: 'opposite_effect_possible' },
      { kind: 'known_context', knownContextReasons: ['high_stakes'] },
      { kind: 'incomplete_or_earlier_version', eventTypeId: BIRTHDAY },
      { kind: 'late_sheet' },
      { kind: 'confounder_not_separable', eventTypeId: BIRTHDAY },
    ]);
  });

  it('[ALE-16] lists every caveat that applies in the order of ALE-16, each kind in the order of the sections and events', () => {
    const atThreshold = THRESHOLDS.detectionThreshold;
    const feud = section(
      FEUD,
      [detected(4, { isDatingToVerify: true, detectionConfidence: atThreshold })],
      {
        profile: { ...DECIDED, verdict: DECREASE, profileConfidence: 'low', isIncomplete: true },
      },
    );
    const snub = section(
      SNUB,
      [detected(2, { isDatingToVerify: true }), detected(3, { detectionConfidence: atThreshold })],
      {
        isTypeNotCovered: true,
        hasSwitchedOffCriterion: true,
        profile: {
          ...DECIDED,
          validCount: TOO_FEW,
          verdict: INCONCLUSIVE,
          earlierVersionCaseCount: 2,
        },
        trend: null,
      },
    );
    const opponent = { isHighStakes: false, isOpponentDoubtful: true };

    expect(caveatsOf([feud, snub], { expectedGame: opponent, isLate: true })).toStrictEqual([
      { kind: 'small_sample', eventTypeId: FEUD },
      { kind: 'small_sample', eventTypeId: SNUB },
      { kind: 'effect_direction', eventTypeId: FEUD, form: 'opposite_effect_possible' },
      { kind: 'effect_direction', eventTypeId: SNUB, form: 'either_way' },
      { kind: 'known_context', knownContextReasons: ['opponent_strength'] },
      { kind: 'several_events' },
      { kind: 'confidence_near_threshold', playerEventId: 4 },
      { kind: 'confidence_near_threshold', playerEventId: 3 },
      { kind: 'dating_to_verify', playerEventId: 4 },
      { kind: 'dating_to_verify', playerEventId: 2 },
      { kind: 'incomplete_or_earlier_version', eventTypeId: FEUD },
      { kind: 'incomplete_or_earlier_version', eventTypeId: SNUB },
      { kind: 'late_sheet' },
      { kind: 'type_not_covered', eventTypeId: SNUB },
      { kind: 'confounder_not_separable', eventTypeId: SNUB },
    ]);
  });
});

// --- Random sheets ----------------------------------------------------------------

// The caveat kinds in the order of ALE-16's list, the glossary's.
const KIND_ORDER: readonly CaveatKind[] = [
  'small_sample',
  'effect_direction',
  'known_context',
  'several_events',
  'confidence_near_threshold',
  'dating_to_verify',
  'incomplete_or_earlier_version',
  'late_sheet',
  'type_not_covered',
  'confounder_not_separable',
];
const TYPES = [FEUD, SNUB, BIRTHDAY, 'former-team-game'];
const MAX_EVENTS_PER_SECTION = 4;

const confidenceArbitrary = fc.constantFrom('low', 'medium', 'high');
const verdictArbitrary: fc.Arbitrary<Verdict> = fc.oneof(
  fc.constant(INCONCLUSIVE),
  fc.record({
    level: fc.constantFrom('possible', 'probable'),
    direction: fc.constantFrom('increase', 'decrease'),
  }),
);
const contextArbitrary = fc.record({
  injuryReturn: fc.constantFrom('yes', 'no', 'unknown'),
  gameStakes: fc.constantFrom('high', 'normal', 'unknown'),
});
const rawEventArbitrary = fc.record({
  isDismissed: fc.boolean(),
  context: contextArbitrary,
  detectionConfidence: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  isDatingToVerify: fc.boolean(),
});
const profileArbitrary = fc.record({
  validCount: fc.nat({ max: 2 * THRESHOLDS.minValidCases }),
  verdict: verdictArbitrary,
  profileConfidence: confidenceArbitrary,
  isIncomplete: fc.boolean(),
  earlierVersionCaseCount: fc.nat({ max: 2 }),
});
const trendArbitrary = fc.record({
  validCount: fc.nat({ max: 2 * THRESHOLDS.minValidCases }),
  playerCount: fc.nat({ max: 2 * THRESHOLDS.trendMinPlayers }),
  profileConfidence: confidenceArbitrary,
});
const rawSectionArbitrary = fc.record({
  eventTypeId: fc.constantFrom(...TYPES),
  isTypeNotCovered: fc.boolean(),
  isCalendarDerived: fc.boolean(),
  hasSwitchedOffCriterion: fc.boolean(),
  events: fc.array(rawEventArbitrary, { maxLength: MAX_EVENTS_PER_SECTION, size: 'max' }),
  profile: fc.option(profileArbitrary, { nil: null }),
  trend: fc.option(trendArbitrary, { nil: null }),
});

type RawSection = typeof rawSectionArbitrary extends fc.Arbitrary<infer Raw> ? Raw : never;

/**
 * The sections of a sheet, one per type, each event numbered from 1 in the sheet's order and
 * derived from the calendar exactly when its type is.
 */
function numbered(raw: readonly RawSection[]): readonly CaveatSection[] {
  let next = 0;
  return raw.map((rawSection) => ({
    ...rawSection,
    events: rawSection.events.map((event) => {
      next += 1;
      const origin = rawSection.isCalendarDerived ? 'calendar' : 'detected';
      return { ...event, playerEventId: next, origin };
    }),
  }));
}

const sectionsArbitrary = fc
  .uniqueArray(rawSectionArbitrary, {
    selector: ({ eventTypeId }) => eventTypeId,
    minLength: 1,
    maxLength: TYPES.length,
    size: 'max',
  })
  .map((raw) => numbered(raw));
const sheetArbitrary: fc.Arbitrary<SheetCaveatsInput> = fc.record({
  sections: sectionsArbitrary,
  expectedGame: fc.record({ isHighStakes: fc.boolean(), isOpponentDoubtful: fc.boolean() }),
  isLate: fc.boolean(),
  hasRelatedSheet: fc.boolean(),
});

/** The key that `alert_sheet_caveats_uq` keeps unique: kind, type and event. */
function keyOf(caveat: Caveat): string {
  return JSON.stringify([
    caveat.kind,
    'eventTypeId' in caveat ? caveat.eventTypeId : null,
    'playerEventId' in caveat ? caveat.playerEventId : null,
  ]);
}

/** The events of a sheet that are detected and not dismissed. */
function liveDetectedEventIds({ sections }: SheetCaveatsInput): readonly PlayerEventId[] {
  return sections
    .flatMap(({ events }) => events)
    .filter(({ origin, isDismissed }) => origin === 'detected' && !isDismissed)
    .map(({ playerEventId }) => playerEventId);
}

/** The types of the sections that are derived from the calendar, whatever events they hold. */
function calendarTypesOf({ sections }: SheetCaveatsInput): readonly EventTypeId[] {
  return sections
    .filter(({ isCalendarDerived }) => isCalendarDerived)
    .map(({ eventTypeId }) => eventTypeId);
}

/** The form of the direction caveat that CL-ALE-03 gives a profile, by its frozen verdict level. */
function formOf(profile: CaveatProfile | null): string {
  return profile === null || profile.verdict.level === 'inconclusive'
    ? 'either_way'
    : 'opposite_effect_possible';
}

describe('sheetCaveats over random sheets', () => {
  it('[ALE-16] [CL-ALE-03] gives every section one direction caveat, in its order, either way exactly when no verdict with a direction applies', () => {
    fc.assert(
      fc.property(sheetArbitrary, (input) => {
        const directions = sheetCaveats(input, THRESHOLDS).filter(
          ({ kind }) => kind === 'effect_direction',
        );

        expect(directions).toStrictEqual(
          input.sections.map(({ eventTypeId, profile }) => ({
            kind: 'effect_direction',
            eventTypeId,
            form: formOf(profile),
          })),
        );
      }),
    );
  });

  it('[ALE-16] gives a set in the order of ALE-16: no caveat twice, and each kind in its place', () => {
    fc.assert(
      fc.property(sheetArbitrary, (input) => {
        const caveats = sheetCaveats(input, THRESHOLDS);
        const ranks = caveats.map(({ kind }) => KIND_ORDER.indexOf(kind));

        expect(new Set(caveats.map((caveat) => keyOf(caveat))).size).toBe(caveats.length);
        expect(ranks).toStrictEqual(ranks.toSorted((left, right) => left - right));
      }),
    );
  });

  it('[ALE-16] [CL-ALE-13] names only its own sections, its non-dismissed detected events, and no calendar-derived type as not covered', () => {
    fc.assert(
      fc.property(sheetArbitrary, (input) => {
        const caveats = sheetCaveats(input, THRESHOLDS);
        const types = new Set(input.sections.map(({ eventTypeId }) => eventTypeId));
        const liveDetected = liveDetectedEventIds(input);
        const calendarTypes = calendarTypesOf(input);

        expect(
          caveats.filter((caveat) => 'eventTypeId' in caveat && !types.has(caveat.eventTypeId)),
        ).toStrictEqual([]);
        expect(
          caveats.filter(
            (caveat) => 'playerEventId' in caveat && !liveDetected.includes(caveat.playerEventId),
          ),
        ).toStrictEqual([]);
        expect(
          caveats.filter(
            (caveat) =>
              caveat.kind === 'type_not_covered' && calendarTypes.includes(caveat.eventTypeId),
          ),
        ).toStrictEqual([]);
      }),
    );
  });
});
