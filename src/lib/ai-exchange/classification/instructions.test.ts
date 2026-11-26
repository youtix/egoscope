import { describe, expect, it } from 'vitest';

import { classificationInstructions, INSTRUCTIONS_VERSION } from './instructions';

import type { InstructionsParameters } from './instructions';

// The default parameters: a description of at most 200 characters (DSN-20) and a
// grouping window of 72 hours (DET-29).
const DEFAULTS: InstructionsParameters = { maxDescriptionLength: 200, groupingWindowHours: 72 };

// The text of each version of the instructions, written with the default parameters:
// the snapshot that a change of the wording breaks until it comes with a new
// INSTRUCTIONS_VERSION and that version's text here (DET-23, DET-53).
const PUBLISHED: Readonly<Record<string, string>> = {
  '1.0': `CLASSIFICATION OF PRESS ARTICLES ABOUT NBA PLAYERS
You classify press articles for Egoscope, a personal app that studies whether NBA players play better, worse or neither after an event that may have affected their ego. The study is worth something only if every fact is judged in the same way, whatever happened next.

1. WHAT THE REQUEST HOLDS
- validated_types: the event types you classify into, each with its whole sheet: definition, inclusion criteria, exclusion criteria, dating rule, whether it is known in advance, and a generic example.
- do_not_repropose: types already proposed, rejected or withdrawn, each by name and definition; never suggest one of them again as a new type.
- calendar_types: the types that the app derives from the game schedule itself, each by name and definition.
- articles: one or more press articles, in English or French, each with its article_id, title, excerpt (null when there is none), outlet, published_at (ISO 8601 with the UTC offset of the outlet's time zone, or +00:00 when that zone is unknown) and published_precision (exact, approximate or none: how far you can trust published_at), then its recognized players, each with his player_id, his names (display name first, then spelling variants and nicknames) and his events, each with its player_event_id, event_type, reference_date and description.

2. RULES
2.1 The player. A fact belongs to the recognized player it touches, not merely to a player the article cites. A fact that touches two recognized players is reported for each of them.
2.2 Teams. A fact that touches a whole team without personally targeting the player is not reported: team events are out of scope.
2.3 The fact, never the performance. Judge the fact, never the performance that followed it. Ignore every mention of that performance (score, statistics, an answer on the court) when you decide whether there is a fact and which type it gets.
2.4 One fact, one type. Report each fact once per player, even when the article tells it several times. A fact that seems to belong to two validated types gets only one, the type whose sheet fits it best.
2.5 Novelty. When the fact is one of the player's events, whatever its age, set novelty to known_event and give that event's player_event_id. Otherwise, when the article returns, with no new element, to a fact that became public before the grouping window, that is more than 72 hours before published_at, set novelty to old_fact. Otherwise set it to new_fact: an old fact that the article reveals for the first time is a new fact. Outside known_event, player_event_id is null.
2.6 No validated type. A fact that may affect the player's ego but fits no validated type goes in known_entry_facts when it matches an entry of do_not_repropose, with that entry's id, and otherwise in new_type_facts, with a suggested type name, a suggested one-sentence definition and a justification that says why no validated type fits.
2.7 Calendar types. A fact that matches an entry of calendar_types, such as a game on the player's birthday or against a former team, is handled by the calendar and is not to be reported, neither as a validated-type fact, nor as a known entry, nor as a new type: name its entry in calendar_facts at most.
2.8 Timing. When the article places the fact before its own publication (an earlier day, or earlier the same day), give in timing_hint the day, YYYY-MM-DD, on which the fact happened or became public, read in the article's own frame; otherwise give null.
2.9 Context. For the player's next game, say whether the article presents it as his return, or as one of his first games, after an absence due to an injury (injury_return: yes, no or unknown), without ever naming the injury, and whether its outcome directly decides a qualification, an elimination, a title or a final ranking (game_stakes: high, normal or unknown), every other game being normal, a playoff game that eliminates nobody included. Answer unknown when the article says nothing about it.
2.10 Confidence. detection_confidence is your own assessment, from 0 to 100, of how clearly the fact meets the criteria of its type; it is not a probability.
2.11 Identifiers. Use only the identifiers of the request, copied exactly.

3. WORDING
3.1 Write each description as one factual, neutral sentence, in English whatever the language of the article, of at most 200 characters: who, designated by role, did what to the player, and what kind of outlet reported it. Example: An opponent publicly says that player A is overrated; a national outlet reports it the day before the game against team X.
3.2 Designate every person other than the player by role (an opponent, a teammate, a coach, an executive, a spectator, a loved one), never by name.
3.3 Summarize what was said: never a quotation between quotation marks, never an insult copied.
3.4 No value judgment, no interpretation of the player's personality or state of mind, no forecast about a game.
3.5 No health detail and no intimate detail: no diagnosis, nature of an injury or illness, treatment or mental health; for a bereavement, only that a loved one died, with no name, family relationship, cause, circumstances or funeral; for racist remarks, neither the terms used nor the player's origin, skin color, nationality or religion; for a legal matter, only that the player is publicly implicated in a case the press reports, without the alleged facts or the identity of the other parties; nothing about family, love life, sexual orientation, home, private travel, finances, opinions or beliefs.
3.6 These rules also apply to every justification, suggested name and suggested definition. A justification is one sentence that cites the criterion of the sheet that the fact meets.

4. ANSWER
Answer with one JSON object that follows the schema given with the request: one result per article, with its article_id, and in each result one part per recognized player of that article, with his player_id and four lists, each possibly empty: validated_type_facts, known_entry_facts, new_type_facts and calendar_facts. A player for whom the article reports no fact gets four empty lists.`,
};

/** The line of the instructions, written with `parameters`, that starts with `start`. */
function lineOf(start: string, parameters: InstructionsParameters = DEFAULTS): string {
  const lines = classificationInstructions(parameters).split('\n');
  return lines.find((line) => line.startsWith(start)) ?? '';
}

describe('classificationInstructions', () => {
  it('[DET-17] [DET-18] [DET-19] [DET-20] [DET-27] [CL-DET-22] writes the text of its version word for word, so that a change of the wording without a new INSTRUCTIONS_VERSION fails', () => {
    expect(INSTRUCTIONS_VERSION).toBe('1.0');
    expect(classificationInstructions(DEFAULTS)).toBe(PUBLISHED[INSTRUCTIONS_VERSION]);
  });

  it('[CL-DET-08] is written in English, in plain ASCII with no French letter', () => {
    expect(classificationInstructions(DEFAULTS)).not.toMatch(/\P{ASCII}/u);
    expect(lineOf('3.1 ')).toContain('in English whatever the language of the article');
    expect(lineOf('- articles: ')).toContain('one or more press articles, in English or French');
  });

  it('[DET-17] attaches a fact to the player it touches, and to each of two players it touches', () => {
    expect(lineOf('2.1 ')).toBe(
      '2.1 The player. A fact belongs to the recognized player it touches, not merely to a player the article cites. A fact that touches two recognized players is reported for each of them.',
    );
  });

  it('[DET-18] reports no fact that touches a whole team without targeting the player', () => {
    expect(lineOf('2.2 ')).toBe(
      '2.2 Teams. A fact that touches a whole team without personally targeting the player is not reported: team events are out of scope.',
    );
  });

  it('[DET-19] judges the fact and ignores the performance that followed it', () => {
    expect(lineOf('2.3 ')).toBe(
      '2.3 The fact, never the performance. Judge the fact, never the performance that followed it. Ignore every mention of that performance (score, statistics, an answer on the court) when you decide whether there is a fact and which type it gets.',
    );
  });

  it('[DET-27] gives each fact one type, the one whose sheet fits it best', () => {
    expect(lineOf('2.4 ')).toBe(
      '2.4 One fact, one type. Report each fact once per player, even when the article tells it several times. A fact that seems to belong to two validated types gets only one, the type whose sheet fits it best.',
    );
  });

  it('[DET-20] makes an old fact one public before the grouping window, in hours of the parameter', () => {
    expect(lineOf('2.5 ')).toContain(
      'that is more than 72 hours before published_at, set novelty to old_fact.',
    );
    const oneHour = { ...DEFAULTS, groupingWindowHours: 1 };
    expect(lineOf('2.5 ', oneHour)).toContain('that is more than 1 hour before published_at,');
    const tenDays = { ...DEFAULTS, groupingWindowHours: 240 };
    expect(lineOf('2.5 ', tenDays)).toContain('that is more than 240 hours before published_at,');
    expect(lineOf('2.5 ')).toContain(
      'an old fact that the article reveals for the first time is a new fact.',
    );
  });

  it('[DET-44] [CL-DET-11] lets a fact attach to any event of the player that the request sends, a dismissed one of any age included', () => {
    expect(lineOf('- articles: ')).toContain(
      'his names (display name first, then spelling variants and nicknames) and his events, each with its player_event_id,',
    );
    expect(lineOf('2.5 ')).toContain(
      "2.5 Novelty. When the fact is one of the player's events, whatever its age, set novelty to known_event and give that event's player_event_id.",
    );
    expect(classificationInstructions(DEFAULTS)).not.toContain('recent');
  });

  it('[SEN-13] [SEN-14] [DET-16] asks for the injury return and the game stakes as SEN-13 and SEN-14 define them', () => {
    expect(lineOf('2.9 ')).toBe(
      "2.9 Context. For the player's next game, say whether the article presents it as his return, or as one of his first games, after an absence due to an injury (injury_return: yes, no or unknown), without ever naming the injury, and whether its outcome directly decides a qualification, an elimination, a title or a final ranking (game_stakes: high, normal or unknown), every other game being normal, a playoff game that eliminates nobody included. Answer unknown when the article says nothing about it.",
    );
  });

  it('[DSN-12] [DSN-16] [DSN-18] keeps out the funeral of a bereavement and the alleged facts and parties of a legal matter', () => {
    expect(lineOf('3.5 ')).toBe(
      "3.5 No health detail and no intimate detail: no diagnosis, nature of an injury or illness, treatment or mental health; for a bereavement, only that a loved one died, with no name, family relationship, cause, circumstances or funeral; for racist remarks, neither the terms used nor the player's origin, skin color, nationality or religion; for a legal matter, only that the player is publicly implicated in a case the press reports, without the alleged facts or the identity of the other parties; nothing about family, love life, sexual orientation, home, private travel, finances, opinions or beliefs.",
    );
  });

  it('[CL-DET-22] reports no fact of a calendar-handled type but as its calendar entry', () => {
    expect(lineOf('2.7 ')).toBe(
      "2.7 Calendar types. A fact that matches an entry of calendar_types, such as a game on the player's birthday or against a former team, is handled by the calendar and is not to be reported, neither as a validated-type fact, nor as a known entry, nor as a new type: name its entry in calendar_facts at most.",
    );
  });

  it('[DSN-19] [DSN-20] [DSN-21] [DSN-22] [DSN-23] states the wording rules of a description, its maximum length from the parameter', () => {
    const shorter = { ...DEFAULTS, maxDescriptionLength: 150 };
    expect(lineOf('3.1 ', shorter)).toBe(
      '3.1 Write each description as one factual, neutral sentence, in English whatever the language of the article, of at most 150 characters: who, designated by role, did what to the player, and what kind of outlet reported it. Example: An opponent publicly says that player A is overrated; a national outlet reports it the day before the game against team X.',
    );
    expect(lineOf('3.3 ')).toBe(
      '3.3 Summarize what was said: never a quotation between quotation marks, never an insult copied.',
    );
    expect(lineOf('3.4 ')).toBe(
      "3.4 No value judgment, no interpretation of the player's personality or state of mind, no forecast about a game.",
    );
  });

  it('[CL-DET-18] applies the wording rules to justifications, suggested names and definitions', () => {
    expect(lineOf('3.6 ')).toBe(
      '3.6 These rules also apply to every justification, suggested name and suggested definition. A justification is one sentence that cites the criterion of the sheet that the fact meets.',
    );
  });
});
