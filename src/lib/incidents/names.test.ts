import { describe, expect, it } from 'vitest';

import { nameOfRow } from './names';

describe('nameOfRow', () => {
  it.each(['quota_warning', 'quota_reached'] as const)(
    '[TRV-09] calls a %s row without its service a bug',
    (kind) => {
      expect(() => nameOfRow({ kind, serviceRole: null })).toThrow(
        new Error(`The ${kind} incident holds no service, which open always stores.`),
      );
    },
  );

  it.each(['quota_warning', 'quota_reached'] as const)(
    '[TRV-09] names a %s row with its service',
    (kind) => {
      expect(nameOfRow({ kind, serviceRole: 'stats_source' })).toStrictEqual({
        kind,
        service: 'stats_source',
      });
    },
  );

  it('[TRV-09] names a row of another kind by its kind alone, whatever service it holds', () => {
    expect(nameOfRow({ kind: 'backup_failed', serviceRole: null })).toStrictEqual({
      kind: 'backup_failed',
    });
    expect(nameOfRow({ kind: 'database_volume_warning', serviceRole: 'database' })).toStrictEqual({
      kind: 'database_volume_warning',
    });
  });
});
