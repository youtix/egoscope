import { describe, expect, it } from 'vitest';

import { INCIDENT_KINDS, levelOf } from './kinds';

import type { IncidentKind } from './kinds';

type Level = ReturnType<typeof levelOf>;

// The Level column of glossary 9.2, written by hand: the code is never asked for it.
const LEVELS: readonly (readonly [IncidentKind, Level])[] = [
  ['press_source_down', 'incident'],
  ['collection_impossible', 'incident'],
  ['press_source_silent', 'warning'],
  ['feed_too_short', 'warning'],
  ['quota_reached', 'incident'],
  ['quota_warning', 'warning'],
  ['database_volume_warning', 'warning'],
  ['stats_source_unavailable', 'incident'],
  ['stats_source_schema_changed', 'incident'],
  ['task_not_run', 'incident'],
  ['backup_failed', 'incident'],
  ['logins_refused', 'incident'],
  ['telegram_link_broken', 'incident'],
  ['export_reminder', 'reminder'],
];

describe('levelOf', () => {
  it('[TRV-45] gives a level to exactly the kinds of the glossary, so that a new kind without one fails', () => {
    expect(LEVELS).toHaveLength(INCIDENT_KINDS.length);
    expect(new Set(LEVELS.map(([kind]) => kind))).toStrictEqual(new Set(INCIDENT_KINDS));
  });

  it.each(LEVELS)('[TRV-45] gives the kind %s the level %s', (kind, level) => {
    expect(levelOf(kind)).toBe(level);
  });
});
