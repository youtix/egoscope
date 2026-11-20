// The fixed English wording of the research prompt (BKT-21, CL-BKT-02): the template of
// glossary section 6.3, the reference text of 05 translated rule by rule, and the texts
// that its placeholders take (glossary sections 6.3, 7.2 and 7.3). build-prompt.ts
// decides which text goes where.

/**
 * The research prompt with its placeholders, `{{NAME}}` (glossary section 6.1), as
 * glossary section 6.3 writes it (BKT-21, CL-BKT-02). The lines from
 * `{{TYPE_BLOCK_START}}` to `{{TYPE_BLOCK_END}}` are the block written once per
 * requested type (BKT-22).
 */
export const RESEARCH_PROMPT_TEMPLATE = `DEEP RESEARCH — EVENT HISTORY OF AN NBA PLAYER
Request issued by Egoscope, a personal app.
Request reference: {{REFERENCE}}
Today's date: {{TODAY}}
Player: {{PLAYER_NAME}} (ID {{PLAYER_ID}}), {{PLAYER_MARKER}}

1. MISSION
Draw up the exhaustive list of the events that may have affected this player's ego and that became public {{PERIOD}}, for each of the types defined in point 3, over the period given for each type. This list will feed a statistical study: does this player play better, worse, or neither after this kind of event? The study is worth something only if the list is complete and true.

2. MANDATORY RULES
2.1 Exhaustiveness. Report every event that meets the criteria of a type, whether the player then played well, played badly or did not play. Never leave out an event because of the game that followed, and do not limit yourself to striking stories: a sorted history would distort the study.
2.2 No statistics. Do not look for, use or cite game statistics or scores. They will be fetched elsewhere, and knowing them could steer your sorting.
2.3 Sources. Only public, dated press articles: sports press, general press, news archives, in every useful language, English in particular. No social networks, forums, collaborative encyclopedias, or videos without an article. Each event you keep must have at least one source published before the first NBA game the player played after the event: keep the oldest sources possible. Give the exact address of the article, never that of a home page or a search page. For each source, give its publication date, with the time and the UTC offset when the article shows them.
2.4 Nothing invented. Never invent a fact, a date, an address, a title or an outlet, and cite only articles whose existence you have checked. A fact you cannot support this way, or whose sources all postdate the game that followed, goes in "unverified_leads", never in "events". What remains doubtful about a kept event goes in its "unverified_note" field. The seasons, types or sources you could not explore properly go in "limitations". A shorter but true list is better than a list completed with guesses.
2.5 Public date. It is the moment the fact became public, according to the dating rule of the type (point 3): usually the date of the first source that reports it; for a fact known in advance, the day it happens. Add the time and the UTC offset when a source gives them.
2.6 Discretion. Describe each event in one factual, neutral sentence, in English, of at most {{MAX_TEXT_LENGTH}} characters: who, designated by role, did what to the player, and what kind of outlet reported it. Designate every person other than the player by role (an opponent, a teammate, a coach, an executive, a spectator, a loved one), never by name. Summarize what was said: no quotation between quotation marks, no insult copied. No value judgment, no interpretation of the player's feelings, no forecast. No intimate detail: for a bereavement, say only that a loved one died, with no name, family relationship, cause, circumstances or funeral; for racist remarks, neither the terms used nor the player's origin, skin color, nationality or religion; no health information (diagnosis, nature of an injury or illness, treatment, mental health); nothing about family, love life, home, finances, opinions or beliefs; for a legal matter, say only that the player is publicly implicated, without the alleged facts or the other parties. These rules also apply to the "detail" and "unverified_note" fields, the leads and the limitations; article titles, however, are copied as published.
2.7 Context. For the first NBA game the player played after the event, say whether he was returning from injury, that is whether the press presents this game as his return, or as one of his first games, after an absence due to an injury, without ever specifying the injury; and whether the game stakes were high, that is whether the outcome of this game directly decided a qualification, an elimination, a title or a final ranking. Answer "unknown" when you cannot establish it, or when this game has not been played yet. No statistics, no score.
2.8 Confidence. "high": at least two sources from different outlets, an established public date, the criteria of the type clearly met. "medium": a single source, or a slight doubt about the date or a criterion. "low": a fact established by a source, but its type or its public date uncertain.
2.9 One fact, one event. A fact reported by several articles is one event, with at most {{MAX_SOURCES}} sources, oldest first. A fact that seems to belong to two types goes under the one type whose sheet fits it best.
2.10 Out of scope. Ignore the facts that became public outside the requested period, those that target the whole team rather than the player (unless the sheet of the type provides for it) and any type not defined in point 3.
2.11 Length. Never shorten the list: no ellipsis, no "etc.", no summary. If everything does not fit in one answer, process the period in chronological order, stop at the end of a complete season and give in "covered_period" the end date actually covered: the rest will be requested separately.

3. EVENT TYPES TO RESEARCH
{{TYPE_BLOCK_START}}
Type "{{TYPE_ID}}": {{TYPE_NAME}}
Period to cover: {{TYPE_PERIOD}}
Definition: {{TYPE_DEFINITION}}
Inclusion criteria: {{TYPE_INCLUSION}}
Exclusion criteria: {{TYPE_EXCLUSION}}
Dating rule: {{TYPE_DATING_RULE}}
Example: {{TYPE_EXAMPLE}}
{{TYPE_BLOCK_END}}

4. ANSWER FORMAT
Your answer consists only of one valid JSON object: no text before or after it, no formatting tags, no footnote calls or citation markers. If your tool still adds a report, the complete JSON must appear in one piece at the very end. Expected structure, where each value describes what to put there:
{
  "format": "egoscope-backtest",
  "format_version": "{{FORMAT_VERSION}}",
  "request_reference": "{{REFERENCE}}",
  "player": { "id": "{{PLAYER_ID}}", "name": "{{PLAYER_NAME}}" },
  "covered_types": {{TYPE_LIST}},
  "covered_period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "events": [
    {
      "event_type": "ID of a type of point 3",
      "public_date": "YYYY-MM-DD, or YYYY-MM-DDTHH:MM±HH:MM if the time is known",
      "description": "one factual sentence in English",
      "sources": [
        {
          "url": "full address of the article, starting with https:// or http://",
          "outlet": "name of the outlet",
          "title": "exact title of the article, in its own language",
          "publication_date": "same format as public_date"
        }
      ],
      "context": {
        "injury_return": "yes, no or unknown",
        "game_stakes": "high, normal or unknown",
        "detail": "optional: one sentence, with no statistic, score or health detail"
      },
      "confidence": "high, medium or low",
      "unverified_note": "optional: what you could not verify"
    }
  ],
  "unverified_leads": [
    {
      "event_type": "optional: ID of a type of point 3",
      "approximate_period": "optional: for example the 2020-21 season",
      "description": "one factual sentence in English",
      "reason": "why this fact could not be supported"
    }
  ],
  "limitations": ["one sentence per limitation of your research"]
}
Format rules: keep in "covered_types" only the types actually researched; "covered_period" gives the period actually processed; sort the events by ascending public date, all types mixed; write [] for a list without content; omit an optional field rather than leave it empty; add no other field; use straight quotation marks only.

5. IF YOU FIND NOTHING
If no fact meets the criteria, send back the same object with "events": []. It is a valid and useful answer: invent nothing to fill it.

6. BEFORE ANSWERING, CHECK
- that your answer contains only the JSON, complete and valid;
- that the reference {{REFERENCE}} and the ID {{PLAYER_ID}} are copied exactly;
- that each event has at least one source published before the NBA game that followed it;
- that no field contains a statistic, a score or an intimate detail;
- that no person other than the player is named and that no description, detail, unverified note, lead or limitation contains quotation marks;
- that you left out no event because of the game that followed.`;

/** What an empty element of a type sheet reads in the prompt (BKT-22, glossary section 7.3). */
export const NOT_PROVIDED = 'not provided';

/**
 * The player marker, `{{PLAYER_MARKER}}`, which tells the player from a namesake
 * (BKT-29): the date of his first NBA game, or that it is still to be established
 * while it is unknown (STA-47).
 */
export function playerMarker(firstNbaGameOn: string | null): string {
  return firstNbaGameOn === null
    ? 'first NBA game date to be established'
    : `first NBA game on ${firstNbaGameOn}`;
}

/**
 * A period of the prompt, `{{PERIOD}}` or `{{TYPE_PERIOD}}`, both days included: from
 * its first day, or from the player's first NBA game while its date is unknown, which
 * keeps the facts before his career out (BKT-08, BKT-11).
 */
export function periodText(startOn: string | null, endOn: string): string {
  return `from ${startOn ?? 'his first NBA game'} to ${endOn} inclusive`;
}

/**
 * A dating rule with the "known in advance" mark of its sheet, which rule 2.5 reads
 * (TAX-01, TAX-33), in the words the starter sheets give that mark.
 */
export function withKnownInAdvanceMark(datingRule: string): string {
  return `known in advance: ${datingRule}`;
}

/**
 * The coverage-threshold sentence that ends the dating rule of a sheet with a
 * threshold, so that its text and its values cannot differ (CL-TAX-14, glossary
 * section 7.2).
 */
export function coverageThresholdSentence(outlets: number, days: number): string {
  const unit = days === 1 ? 'day' : 'days';
  return `Coverage threshold: ${String(outlets)} distinct outlets within ${String(days)} ${unit}.`;
}
