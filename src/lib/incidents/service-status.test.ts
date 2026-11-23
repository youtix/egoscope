import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { incidents } from '@/lib/db';

import { INCIDENT_KINDS } from './kinds';
import { serviceStatuses } from './service-status';

import type { IncidentKind, ServiceRole } from './kinds';
import type { ServiceStatus } from './service-status';

type Concerned = Readonly<{ kind: IncidentKind; serviceRole: ServiceRole | null }>;

const SERVICES = incidents.serviceRole.enumValues;
const ALL_NORMAL = SERVICES.map((service) => ({ service, status: 'normal' }));

/** The statuses of `open`, service by service, in the order of SERVICES. */
const statusesOf = (open: readonly Concerned[]) =>
  serviceStatuses(open).map(({ service, status }) => `${service}: ${status}`);

const incident = (kind: IncidentKind, serviceRole: ServiceRole | null = null): Concerned => ({
  kind,
  serviceRole,
});

// Any open incident, a quota incident with its service and the others without one.
const anIncident = fc
  .tuple(fc.constantFrom(...INCIDENT_KINDS), fc.constantFrom(...SERVICES))
  .map(([kind, service]) =>
    incident(kind, kind === 'quota_reached' || kind === 'quota_warning' ? service : null),
  );

const SEVERITY: readonly ServiceStatus[] = ['normal', 'degraded', 'unavailable'];

/** How bad the status of each service is after `open`, from 0 for normal. */
const ranks = (open: readonly Concerned[]) =>
  serviceStatuses(open).map(({ status }) => SEVERITY.indexOf(status));

describe('serviceStatuses', () => {
  it('[TRV-46] gives every service, in the glossary’s order, the status normal without an open incident', () => {
    expect(serviceStatuses([])).toStrictEqual(ALL_NORMAL);
  });

  it('[TRV-46] [TRV-45] derives degraded or unavailable from the open incidents, the worst of them winning', () => {
    expect(
      statusesOf([
        incident('press_source_down'),
        incident('collection_impossible'),
        incident('press_source_silent'),
        incident('quota_warning', 'language_model'),
        incident('quota_reached', 'stats_source'),
        incident('stats_source_schema_changed'),
        incident('database_volume_warning'),
        incident('backup_failed'),
        incident('telegram_link_broken'),
      ]),
    ).toStrictEqual([
      'hosting: normal',
      'database: degraded',
      'stats_source: unavailable',
      'language_model: degraded',
      'news_feeds: unavailable',
      'notifications: unavailable',
      'trigger_service: normal',
      'backup_storage: unavailable',
    ]);
    expect(
      statusesOf([incident('feed_too_short'), incident('stats_source_unavailable')]),
    ).toStrictEqual([
      'hosting: normal',
      'database: normal',
      'stats_source: unavailable',
      'language_model: normal',
      'news_feeds: degraded',
      'notifications: normal',
      'trigger_service: normal',
      'backup_storage: normal',
    ]);
  });

  it('[TRV-46] lets a missed task, refused logins, the export reminder and a quota incident without its service leave every service normal', () => {
    expect(
      serviceStatuses([
        incident('task_not_run'),
        incident('logins_refused'),
        incident('export_reminder'),
        incident('quota_reached'),
      ]),
    ).toStrictEqual(ALL_NORMAL);
  });

  it('[TRV-46] depends on no order of the incidents, and never makes a service better for one more', () => {
    fc.assert(
      fc.property(fc.array(anIncident, { size: 'medium' }), anIncident, (open, added) => {
        expect(serviceStatuses(open.toReversed())).toStrictEqual(serviceStatuses(open));
        const before = ranks(open);
        const after = ranks([...open, added]);
        expect(after.every((rank, index) => rank >= (before[index] ?? rank))).toBe(true);
      }),
    );
  });
});
