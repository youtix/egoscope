import { entriesOf } from '../entry';
import { modelId } from '../kinds';

import type { FamilyEntries } from '../entry';

// The models of the detection-model service sheet. Their bounds are the engineering's
// until the language-model adapter lists the models whose rates it knows.
const PRIMARY_MODEL = '@cf/zai-org/glm-4.7-flash';
const FALLBACK_MODEL = 'openai/gpt-oss-120b';
const LONGEST_MODEL_ID = 200;

const entry = entriesOf(2);

/** The language models of 04 Event detection (DET-08), read in Lot 2 only. */
export const LANGUAGE_MODEL = {
  'languageModel.primaryModel': entry({
    label: 'Primary language model',
    sentence: 'The Workers AI model that classifies the articles.',
    unit: 'Workers AI model ID',
    kind: modelId(LONGEST_MODEL_ID),
    defaultValue: PRIMARY_MODEL,
    requirement: 'DET-08',
    source: 'detection-model sheet',
    engineeringBounds: true,
  }),
  'languageModel.fallbackModel': entry({
    label: 'Fallback language model',
    sentence:
      'The Groq model that classifies when the primary one cannot, used only when a Groq key is set.',
    unit: 'Groq model ID, used only when `GROQ_API_KEY` is set',
    kind: modelId(LONGEST_MODEL_ID),
    defaultValue: FALLBACK_MODEL,
    requirement: 'DET-08',
    source: 'detection-model sheet',
    engineeringBounds: true,
  }),
} as const satisfies FamilyEntries<'languageModel'>;
