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

  // What an open incident of each kind says of a service, written by hand from TRV-46 and
  // the glossary (9.2): the one service it concerns and its status, or no service at all.
  const EFFECTS_BY_KIND: readonly (readonly [
    IncidentKind,
    ServiceRole | null,
    ServiceStatus | null,
  ])[] = [
    ['database_volume_warning', 'database', 'degraded'],
    ['stats_source_unavailable', 'stats_source', 'unavailable'],
    ['stats_source_schema_changed', 'stats_source', 'degraded'],
    ['backup_failed', 'backup_storage', 'unavailable'],
    ['telegram_link_broken', 'notifications', 'unavailable'],
    ['collection_impossible', 'news_feeds', 'unavailable'],
    ['press_source_down', 'news_feeds', 'degraded'],
    ['press_source_silent', 'news_feeds', 'degraded'],
    ['feed_too_short', 'news_feeds', 'degraded'],
    ['task_not_run', null, null],
    ['logins_refused', null, null],
    ['export_reminder', null, null],
  ];

  /** The statuses of every service with `service` at `status` and the rest normal. */
  const only = (service: ServiceRole | null, status: ServiceStatus | null) =>
    SERVICES.map((each) => ({ service: each, status: each === service ? status : 'normal' }));

  it('[TRV-46] tables the effects of exactly the kinds of the glossary, the quota kinds apart', () => {
    const tabled = [...EFFECTS_BY_KIND.map(([kind]) => kind), 'quota_reached', 'quota_warning'];

    expect(tabled).toHaveLength(INCIDENT_KINDS.length);
    expect(new Set(tabled)).toStrictEqual(new Set(INCIDENT_KINDS));
  });

  it.each(EFFECTS_BY_KIND)(
    '[TRV-46] lets an open %s incident alone say %s is %s and every other service normal',
    (kind, service, status) => {
      expect(serviceStatuses([incident(kind)])).toStrictEqual(only(service, status));
    },
  );

  it.each([
    ['quota_reached', 'unavailable'],
    ['quota_warning', 'degraded'],
  ] as const)(
    '[TRV-46] [TRV-09] lets an open %s incident alone say its own service is %s, whichever it is',
    (kind, status) => {
      for (const service of SERVICES) {
        expect(serviceStatuses([incident(kind, service)])).toStrictEqual(only(service, status));
      }
    },
  );

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
