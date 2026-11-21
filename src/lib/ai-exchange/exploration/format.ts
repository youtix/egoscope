// The exploration-response format 1.0, the one contract between the exploration prompt
// and its reader (TAX-17, CL-TAX-04): its name and its version, its keys at every level
// and its closed values, those of glossary section 6.2. The prompt writes the name and
// the version in its answer skeleton, and the reader compares a response with all of them.
import { valuesOf } from '../conventions';

/** The name of the exploration-response format, the value of its `format` member (TAX-17, CL-TAX-04). */
export const EXPLORATION_FORMAT = 'egoscope-exploration';

/** The version of the format that the exploration prompt asks for and its reader reads, its only one (TAX-17, CL-TAX-04). */
export const EXPLORATION_FORMAT_VERSION = '1.0';

/** The keys of a response at its root (CL-TAX-04, glossary section 6.2). */
export const RESPONSE_KEYS: readonly string[] = ['format', 'format_version', 'proposed_types'];

/** The elements of a proposed type, by their keys, in the order of the format (CL-TAX-04, glossary section 6.2). */
export const PROPOSED_TYPE_ELEMENTS = valuesOf([
  'name',
  'definition',
  'inclusion_criteria',
  'exclusion_criteria',
  'dating_rule',
  'known_in_advance',
  'generic_example',
  'documentation_difficulty',
  'possible_overlaps',
  'illustration_sources',
]);

/** The keys of an illustration source, those of a research-result source (CL-TAX-04, glossary section 6.2). */
export const SOURCE_KEYS: readonly string[] = ['url', 'outlet', 'title', 'publication_date'];

/** How hard a type is to document (TAX-08), in the glossary's values. */
export const DIFFICULTIES = valuesOf(['easy', 'medium', 'hard']);
