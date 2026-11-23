import type { IncidentCause, IncidentKind, ServiceRole } from './kinds';

type QuotaKind = 'quota_reached' | 'quota_warning';

/** How the journal names an incident: a quota incident with its service (glossary 9.2). */
type IncidentName =
  | Readonly<{ kind: QuotaKind; service: ServiceRole }>
  | Readonly<{ kind: Exclude<IncidentKind, QuotaKind> }>;

/** The journal's name of the incident of `cause`. */
export function nameOfCause(cause: IncidentCause): IncidentName {
  return 'serviceRole' in cause
    ? { kind: cause.kind, service: cause.serviceRole }
    : { kind: cause.kind };
}

/** Whether `kind` is a quota incident, whose name ends with its service. */
function isQuotaKind(kind: IncidentKind): kind is QuotaKind {
  return kind === 'quota_reached' || kind === 'quota_warning';
}

/**
 * The journal's name of a stored incident. `open` stores the service of every quota
 * incident, so one without it is a damaged row: a bug.
 */
export function nameOfRow(
  row: Readonly<{ kind: IncidentKind; serviceRole: ServiceRole | null }>,
): IncidentName {
  const { kind, serviceRole } = row;
  if (!isQuotaKind(kind)) {
    return { kind };
  }
  if (serviceRole === null) {
    throw new Error(`The ${kind} incident holds no service, which open always stores.`);
  }
  return { kind, service: serviceRole };
}
