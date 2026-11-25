// The checks of the leads and the limitations of a research result (IMP-15, CL-IMP-05,
// CL-IMP-07, CL-IMP-23): of the leads, only a count per type is kept; the limitations are
// kept as text, under the wording rules of the other stored texts (DSN-10, DSN-32).
import { canonicalValue } from '../conventions';
import { checkText, textLength } from '../text-rules';
import { hasPossibleCitationMarker } from './text-signals';

import type { ResearchResult, UnverifiedLead } from './format';

/**
 * A whole-result warning on a lead or a limitation (IMP-15, CL-IMP-07), a result-scope
 * code of the glossary's `ImportWarningKind`, with the 1-based position of the item in
 * its list; for a lead ignored with a text too long, the length in code points of its
 * longest text and the maximum (CL-IMP-02, CL-IMP-26).
 */
export type ResultTextWarning =
  | Readonly<{
      kind: 'lead_ignored' | 'limitation_ignored' | 'limitation_citation_marker';
      detail: number;
    }>
  | Readonly<{ kind: 'lead_ignored'; detail: number; length: number; maxLength: number }>;

/**
 * The leads counted under each requested type and under `none` (CL-IMP-23), a key only
 * for a count above zero; the limitations kept, trimmed; and the warnings, the leads'
 * first (IMP-15).
 */
export type ResultTextChecks = Readonly<{
  leadCounts: Readonly<Record<string, number>>;
  limitations: readonly string[];
  warnings: readonly ResultTextWarning[];
}>;

// The key under which the leads of no requested type count (CL-IMP-23).
const NO_TYPE = 'none';

/**
 * The warning of a lead at a 1-based position, if it is ignored (IMP-15, CL-IMP-23,
 * CL-IMP-26): with the length of its longest text and the maximum when a text of it,
 * its description, its reason or its approximate period, is too long; without them
 * when it is only incomplete, its description or its reason missing.
 */
function leadWarning(
  lead: UnverifiedLead,
  detail: number,
  maxLength: number,
): ResultTextWarning | undefined {
  const texts = [lead.description, lead.reason, lead.approximatePeriod];
  const length = Math.max(...texts.map((text) => (text === undefined ? 0 : textLength(text))));
  if (length > maxLength) {
    return { kind: 'lead_ignored', detail, length, maxLength };
  }
  const isIncomplete = lead.description === undefined || lead.reason === undefined;
  return isIncomplete ? { kind: 'lead_ignored', detail } : undefined;
}

/** The leads kept, counted under their requested type or under `none`, and the warnings of those ignored (IMP-15, CL-IMP-23). */
function checkLeads(
  leads: readonly UnverifiedLead[],
  requestedTypeIds: readonly string[],
  maxLength: number,
): Pick<ResultTextChecks, 'leadCounts' | 'warnings'> {
  const leadCounts = new Map<string, number>();
  const warnings: ResultTextWarning[] = [];
  for (const [index, lead] of leads.entries()) {
    const warning = leadWarning(lead, index + 1, maxLength);
    if (warning === undefined) {
      const key = canonicalValue(lead.eventType, requestedTypeIds) ?? NO_TYPE;
      leadCounts.set(key, (leadCounts.get(key) ?? 0) + 1);
    } else {
      warnings.push(warning);
    }
  }
  return { leadCounts: Object.fromEntries(leadCounts), warnings };
}

/** The limitations kept, trimmed, and their warnings (IMP-15, CL-IMP-05, CL-IMP-07). */
function checkLimitations(
  texts: readonly (string | undefined)[],
  maxLength: number,
): Pick<ResultTextChecks, 'limitations' | 'warnings'> {
  const limitations: string[] = [];
  const warnings: ResultTextWarning[] = [];
  for (const [index, text] of texts.entries()) {
    const detail = index + 1;
    if (text === undefined || checkText(text, maxLength).length > 0) {
      warnings.push({ kind: 'limitation_ignored', detail });
    } else {
      limitations.push(text.trim());
      if (hasPossibleCitationMarker(text)) {
        warnings.push({ kind: 'limitation_citation_marker', detail });
      }
    }
  }
  return { limitations, warnings };
}

/**
 * Checks the leads and the limitations of a research result (IMP-15, CL-IMP-05,
 * CL-IMP-07, CL-IMP-23, CL-IMP-26): an incomplete or too-long lead is ignored with a
 * warning, which gives the length of its longest text and the maximum when a text is too
 * long, and the others count under their type when the request holds it, compared as
 * CL-IMP-22 says, and under `none` otherwise; a limitation that is no text, too long or
 * holds a quotation mark is ignored with a warning, and one kept, trimmed, warns of a
 * possible citation marker.
 */
export function checkLeadsAndLimitations(
  result: Pick<ResearchResult, 'unverifiedLeads' | 'declaredLimitations'>,
  requestedTypeIds: readonly string[],
  maxLength: number,
): ResultTextChecks {
  const leads = checkLeads(result.unverifiedLeads, requestedTypeIds, maxLength);
  const limitations = checkLimitations(result.declaredLimitations, maxLength);
  return {
    leadCounts: leads.leadCounts,
    limitations: limitations.limitations,
    warnings: [...leads.warnings, ...limitations.warnings],
  };
}
