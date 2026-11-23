import { describe, expect, expectTypeOf, it } from 'vitest';

import { OVERRIDABLE_PARAMETER_KEYS } from '@/lib/db';
import registryKeys from '@data/fixtures/params/registry-keys.json';
import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { ALL_FACTS, CALCULATION_KEYS, ENTRIES, isOverridable, OVERRIDABLE_KEYS } from './catalog';

import type { ParamValue } from './catalog';
import type { EntryFacts, OverridableKey } from './entry';
import type { EngineParams } from '@/lib/stats-engine';

// The keys of module map section 6, in its order, with its Calc and Sched marks.
const SECTION_6_KEYS = registryKeys.map(({ key }) => key);
const SWITCH = 'taxonomy.switchedOffCriterion';

const ENGINE_DEFAULTS = Object.entries(engineParams).flatMap(([family, values]) =>
  Object.entries(values).map(([name, value]) => [`${family}.${name}`, value] as const),
);

// The keys that the Lot 2 modules alone read (ADR 0001).
const LOT_2_KEY =
  /^(?:collection|detection|languageModel|alerts|tracking|notifications)\.|^players\.exposureWindowDays$|^quotas\.(?:workersAi|groq|telegram)\./u;

/** The order of `left` and `right` by their code units. */
const byCodeUnits = (left: string, right: string): number => (left < right ? -1 : 1);

/** `keys` in code-point order. */
const sorted = (keys: readonly string[]) => keys.toSorted(byCodeUnits);

/** The keys of the entries whose facts `isSound` refuses. */
const failing = (isSound: (facts: EntryFacts) => boolean) =>
  ALL_FACTS.filter(([, facts]) => !isSound(facts)).map(([key]) => key);

describe('the parameter registry', () => {
  it('[TRV-38] [TRV-40] holds every key of module map section 6 and no other, in its order', () => {
    expect(ALL_FACTS.map(([key]) => key)).toStrictEqual(SECTION_6_KEYS);
    expect(OVERRIDABLE_KEYS).toStrictEqual(SECTION_6_KEYS.filter((key) => key !== SWITCH));
    expect(OVERRIDABLE_KEYS).toStrictEqual(OVERRIDABLE_PARAMETER_KEYS);
    expect([
      isOverridable('players.maxActive'),
      isOverridable(SWITCH),
      isOverridable('toString'),
    ]).toStrictEqual([true, false, false]);
  });

  it('[TRV-39] [CL-TRV-16] gives each parameter a default within its own bounds, and none to a quota limit', () => {
    const withDefault = OVERRIDABLE_KEYS.filter((key) => ENTRIES[key].defaultValue !== null);

    expect(
      withDefault.map((key) => ENTRIES[key].kind.parse(ENTRIES[key].defaultValue)),
    ).toStrictEqual(withDefault.map((key) => ENTRIES[key].defaultValue));
    expect(OVERRIDABLE_KEYS.filter((key) => !withDefault.includes(key))).toStrictEqual(
      OVERRIDABLE_KEYS.filter((key) => /^quotas\.[a-zA-Z]+\.[a-zA-Z]+$/u.test(key)),
    );
    expect(withDefault).toHaveLength(110);
  });

  it('[TRV-34] [TRV-38] states each fact of every entry, under a label of its own', () => {
    const labels = ALL_FACTS.map(([, facts]) => facts.label);

    expect(failing((facts) => /^[A-Z"]\S.*\S$/u.test(facts.label))).toStrictEqual([]);
    expect(failing((facts) => /^[A-Z].*\.$/u.test(facts.sentence))).toStrictEqual([]);
    expect(
      failing(
        (facts) =>
          /^\S.*\S$/u.test(facts.allowed) &&
          /^\S.*\S$/u.test(facts.unit) &&
          /^[A-Z]{3}-\d{2}$/u.test(facts.requirement),
      ),
    ).toStrictEqual([]);
    expect(
      failing((facts) =>
        /^(?:ADR \d{4}|[A-Z]{1,3}(?:-[A-Z]{3})?-\d{2}|.+ sheet)$/u.test(facts.source),
      ),
    ).toStrictEqual([]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('[CL-TRV-17] marks Calc every parameter of files 07, 08 and 10 and the criterion switch, as section 6 does', () => {
    const marks = ALL_FACTS.map(([key, facts]) => ({ key, calc: facts.affectsCalculations }));

    expect(marks).toStrictEqual(registryKeys.map(({ key, calc }) => ({ key, calc })));
    expect(
      OVERRIDABLE_KEYS.filter(
        (key) =>
          ENTRIES[key].affectsCalculations !== ['07', '08', '10'].includes(ENTRIES[key].file),
      ),
    ).toStrictEqual([]);
  });

  it('[TRV-25] marks Sched every parameter whose change moves a due instant, as section 6 does', () => {
    const marks = ALL_FACTS.map(([key, facts]) => ({ key, sched: facts.movesSchedule }));

    expect(marks).toStrictEqual(registryKeys.map(({ key, sched }) => ({ key, sched })));
  });

  it('[CL-TRV-17] holds as Calc exactly the parameters of the calculation engine, typed as the engine reads them', () => {
    // The keys of the engine's parameters, and its parameters as the registry types them.
    type EngineKey = {
      [F in keyof EngineParams]: `${F}.${keyof EngineParams[F] & string}`;
    }[keyof EngineParams];
    type EngineParamsOfRegistry = {
      readonly [F in keyof EngineParams]: {
        readonly [K in keyof EngineParams[F] & string]: ParamValue<`${F}.${K}` & OverridableKey>;
      };
    };

    expect(sorted(CALCULATION_KEYS)).toStrictEqual(sorted(ENGINE_DEFAULTS.map(([key]) => key)));
    expectTypeOf<EngineKey>().toExtend<OverridableKey>();
    expectTypeOf<EngineParamsOfRegistry>().toEqualTypeOf<EngineParams>();
  });

  it('[TRV-39] [CL-TRV-17] gives the engine parameters the defaults that the engine fixture holds', () => {
    const defaults = ENGINE_DEFAULTS.map(([key]) => [
      key,
      isOverridable(key) && ENTRIES[key].defaultValue,
    ]);

    expect(defaults).toStrictEqual(ENGINE_DEFAULTS);
  });

  it('[CL-IHM-23] gives each key the lot whose modules read it', () => {
    const lots = ALL_FACTS.map(([key, facts]) => [key, facts.lot]);

    expect(lots).toStrictEqual(ALL_FACTS.map(([key]) => [key, LOT_2_KEY.test(key) ? 2 : 1]));
  });

  it('[CL-IHM-23] [CL-TRV-17] names the screen of a value edited elsewhere: Display for the zone and the research tool, the types for the switch', () => {
    const elsewhere = ALL_FACTS.flatMap(([key, facts]) =>
      facts.editedOn === null ? [] : [[key, facts.editedOn]],
    );

    expect(elsewhere).toStrictEqual([
      [SWITCH, '/types'],
      ['display.timeZone', '/settings/display'],
      ['display.researchToolUrl', '/settings/display'],
    ]);
  });

  it('[TRV-34] gives the origin of each default from its source', () => {
    const origins = Object.fromEntries(
      [
        'players.maxActive',
        'collection.times',
        'display.timeZone',
        'languageModel.primaryModel',
      ].map((key) => [key, ALL_FACTS.find(([candidate]) => candidate === key)?.[1].origin]),
    );

    expect(origins).toStrictEqual({
      'players.maxActive': 'local_hypothesis',
      'collection.times': 'journal_decision',
      'display.timeZone': 'local_hypothesis',
      'languageModel.primaryModel': 'local_hypothesis',
    });
  });
});
