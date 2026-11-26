/**
 * The fixed sentences of 02 Event taxonomy in English (glossary section 7), by name, in
 * commented groups, one per screen or task, each naming the requirements it serves.
 */
export const taxonomySentences = {
  // Appended to the dating rule of a sheet that has a coverage threshold, wherever the
  // sheet is sent, {N} distinct outlets within {D} days (CL-TAX-14, TAX-33)
  coverageThreshold: 'Coverage threshold: {N} distinct outlets within {D} days.',

  // The Types screen (IHM-31, TAX-10, TAX-15, CL-TAX-20): the number of types of a state,
  // the label of a type's origin and the UI labels of the EventTypeOrigin set (glossary
  // section 4.1), and the mark of the dating rule of a calendar-derived type
  typeCount: '{k} {k|type|types}',
  origin: 'Origin',
  originScoping: 'Scoping',
  originExploration: 'Exploration',
  originDetection: 'Detection',
  derivedFromCalendar: 'derived from the calendar',

  // An area adds its groups above this line, one commented group per screen or task.
} as const;
