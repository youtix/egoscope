import { incidents } from '@/lib/db';

import type { IncidentKind, ServiceRole } from './kinds';
import type { OpenIncident } from './read';

/** The status of a service, the glossary's `ServiceStatus` (TRV-46). */
export type ServiceStatus = 'normal' | 'degraded' | 'unavailable';

/** A service and its status, as the status screen lists them (TRV-46). */
export type ServiceStatusLine = Readonly<{ service: ServiceRole; status: ServiceStatus }>;

type Effect = Readonly<{ service: ServiceRole | 'its_service'; status: ServiceStatus }>;

const unavailable = (service: Effect['service']): Effect => ({ service, status: 'unavailable' });
const degraded = (service: Effect['service']): Effect => ({ service, status: 'degraded' });

/**
 * What an open incident of each kind says of a service: the service stops its work
 * (unavailable), or does it in part or nears its limit (degraded). A quota incident
 * concerns its own service. A missed task, refused logins and the export reminder say
 * nothing of a service: the scheduled tasks and the task trigger have their own lines on
 * the status screen (TRV-46).
 */
const EFFECTS: ReadonlyMap<IncidentKind, Effect> = new Map<IncidentKind, Effect>([
  ['quota_reached', unavailable('its_service')],
  ['quota_warning', degraded('its_service')],
  ['database_volume_warning', degraded('database')],
  ['stats_source_unavailable', unavailable('stats_source')],
  ['stats_source_schema_changed', degraded('stats_source')],
  ['backup_failed', unavailable('backup_storage')],
  ['telegram_link_broken', unavailable('notifications')],
  ['collection_impossible', unavailable('news_feeds')],
  ['press_source_down', degraded('news_feeds')],
  ['press_source_silent', degraded('news_feeds')],
  ['feed_too_short', degraded('news_feeds')],
]);

type Concerned = Pick<OpenIncident, 'kind' | 'serviceRole'>;

/** The service that `incident` concerns and the status it gives it, or none. */
function effectOf(incident: Concerned): ServiceStatusLine | null {
  const effect = EFFECTS.get(incident.kind);
  if (effect === undefined) {
    return null;
  }
  const service = effect.service === 'its_service' ? incident.serviceRole : effect.service;
  return service === null ? null : { service, status: effect.status };
}

/** The worst of `statuses`, normal when there is none. */
function worstOf(statuses: readonly ServiceStatus[]): ServiceStatus {
  if (statuses.includes('unavailable')) {
    return 'unavailable';
  }
  return statuses.includes('degraded') ? 'degraded' : 'normal';
}

/**
 * The status of every service, in the glossary's order of `ServiceRole`, derived from the
 * open incidents `open`, hidden ones included: normal when none concerns it, otherwise the
 * worst that they say (TRV-46; TRV-45, CL-IHM-20).
 */
export function serviceStatuses(open: readonly Concerned[]): readonly ServiceStatusLine[] {
  const effects = open.map((incident) => effectOf(incident)).filter((effect) => effect !== null);
  return incidents.serviceRole.enumValues.map((service) => ({
    service,
    status: worstOf(
      effects.filter((effect) => effect.service === service).map((effect) => effect.status),
    ),
  }));
}
