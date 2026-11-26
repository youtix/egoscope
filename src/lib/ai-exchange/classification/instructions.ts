// The instructions given to the classifier (DET-23), in English whatever the language of
// the article (CL-DET-08): the system message of every classification call, the same
// text from one call to the next, so that the provider's prompt cache applies to it as
// to the static part of the request (detection.md section 5, detection-model service
// sheet, rule 4). They name the keys of the request (detection.md section 5.1) and of
// the answer (section 5.2).

/**
 * The version of the classification instructions, stored with each result of the model
 * (DET-23, DET-53): any change of their wording takes a new version. It names the
 * wording only, not the values of `InstructionsParameters` that the text states: a change
 * of one of those parameters keeps the version.
 */
export const INSTRUCTIONS_VERSION = '1.0';

/**
 * The parameters that the instructions state: the maximum length of a description,
 * `events.maxDescriptionLength` (DSN-20), and the grouping window,
 * `detection.groupingWindowHours` (DET-29), which dates an old fact (DET-20).
 */
export type InstructionsParameters = Readonly<{
  maxDescriptionLength: number;
  groupingWindowHours: number;
}>;

// The instructions, with the placeholders of the two parameters.
const MAX_TEXT_LENGTH = '{{MAX_TEXT_LENGTH}}';
const GROUPING_WINDOW = '{{GROUPING_WINDOW}}';
const TEMPLATE = `CLASSIFICATION OF PRESS ARTICLES ABOUT NBA PLAYERS
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
2.5 Novelty. When the fact is one of the player's events, whatever its age, set novelty to known_event and give that event's player_event_id. Otherwise, when the article returns, with no new element, to a fact that became public before the grouping window, that is more than ${GROUPING_WINDOW} before published_at, set novelty to old_fact. Otherwise set it to new_fact: an old fact that the article reveals for the first time is a new fact. Outside known_event, player_event_id is null.
2.6 No validated type. A fact that may affect the player's ego but fits no validated type goes in known_entry_facts when it matches an entry of do_not_repropose, with that entry's id, and otherwise in new_type_facts, with a suggested type name, a suggested one-sentence definition and a justification that says why no validated type fits.
2.7 Calendar types. A fact that matches an entry of calendar_types, such as a game on the player's birthday or against a former team, is handled by the calendar and is not to be reported, neither as a validated-type fact, nor as a known entry, nor as a new type: name its entry in calendar_facts at most.
2.8 Timing. When the article places the fact before its own publication (an earlier day, or earlier the same day), give in timing_hint the day, YYYY-MM-DD, on which the fact happened or became public, read in the article's own frame; otherwise give null.
2.9 Context. For the player's next game, say whether the article presents it as his return, or as one of his first games, after an absence due to an injury (injury_return: yes, no or unknown), without ever naming the injury, and whether its outcome directly decides a qualification, an elimination, a title or a final ranking (game_stakes: high, normal or unknown), every other game being normal, a playoff game that eliminates nobody included. Answer unknown when the article says nothing about it.
2.10 Confidence. detection_confidence is your own assessment, from 0 to 100, of how clearly the fact meets the criteria of its type; it is not a probability.
2.11 Identifiers. Use only the identifiers of the request, copied exactly.

3. WORDING
3.1 Write each description as one factual, neutral sentence, in English whatever the language of the article, of at most ${MAX_TEXT_LENGTH} characters: who, designated by role, did what to the player, and what kind of outlet reported it. Example: An opponent publicly says that player A is overrated; a national outlet reports it the day before the game against team X.
3.2 Designate every person other than the player by role (an opponent, a teammate, a coach, an executive, a spectator, a loved one), never by name.
3.3 Summarize what was said: never a quotation between quotation marks, never an insult copied.
3.4 No value judgment, no interpretation of the player's personality or state of mind, no forecast about a game.
3.5 No health detail and no intimate detail: no diagnosis, nature of an injury or illness, treatment or mental health; for a bereavement, only that a loved one died, with no name, family relationship, cause, circumstances or funeral; for racist remarks, neither the terms used nor the player's origin, skin color, nationality or religion; for a legal matter, only that the player is publicly implicated in a case the press reports, without the alleged facts or the identity of the other parties; nothing about family, love life, sexual orientation, home, private travel, finances, opinions or beliefs.
3.6 These rules also apply to every justification, suggested name and suggested definition. A justification is one sentence that cites the criterion of the sheet that the fact meets.

4. ANSWER
Answer with one JSON object that follows the schema given with the request: one result per article, with its article_id, and in each result one part per recognized player of that article, with his player_id and four lists, each possibly empty: validated_type_facts, known_entry_facts, new_type_facts and calendar_facts. A player for whom the article reports no fact gets four empty lists.`;

/** A number of hours in words: "1 hour", "72 hours". */
function hoursText(hours: number): string {
  return `${String(hours)} ${hours === 1 ? 'hour' : 'hours'}`;
}

/**
 * The classification instructions of version `INSTRUCTIONS_VERSION`, in English
 * (CL-DET-08), with the values of their parameters: the player the fact touches
 * (DET-17), no event for a fact that touches only a team (DET-18), the fact judged and
 * never the performance that followed it (DET-19), the old fact older than the grouping
 * window (DET-20), one fact and one best-fit type (DET-27), the known entries and new
 * types (DET-34), the calendar-handled types whose facts are not reported (CL-DET-22),
 * the timing hint (CL-DET-06), the context indications as SEN-13 and SEN-14 define them
 * (DET-16), and the wording rules of DSN-12 to DSN-23, which every justification,
 * suggested name and suggested definition follows too (DET-21, CL-DET-18, DSN-18). The
 * text is fixed by the version and read by the owner (DET-23).
 */
export function classificationInstructions(parameters: InstructionsParameters): string {
  const window = hoursText(parameters.groupingWindowHours);
  const maxLength = String(parameters.maxDescriptionLength);
  return TEMPLATE.replace(GROUPING_WINDOW, () => window).replace(MAX_TEXT_LENGTH, () => maxLength);
}
