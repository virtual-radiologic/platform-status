/**
 * Everything the page computes from the two documents. Kept apart from the fetch layer so the
 * rules that decide what a reader is told are testable without any network involved.
 */
import type {
  DisplayState,
  Incident,
  MaintenanceWindow,
  PublicOverallState,
  PublicServiceStatus,
  PublicStatusDocument,
  ServiceOverride,
} from '../models/types';
import { isWithinWindow, parseInstant } from './time';

/** How the published document's age compares to its own declared tolerance. */
export interface Freshness {
  ageSeconds: number;
  isStale: boolean;
  generatedAt: Date | null;
}

/**
 * Judges the document's age against the threshold it carries.
 *
 * This is the single most important computation on the page. If publishing stops, GitHub keeps
 * serving the last document forever, and every service in it will usually read "Operational".
 * A page that ignored this would go on cheerfully reporting a healthy platform straight through
 * an outage, which is worse than showing nothing at all.
 */
export function assessFreshness(document: PublicStatusDocument, now: Date): Freshness {
  const generatedAt = parseInstant(document.generatedAt);
  if (generatedAt === null) {
    // An unreadable timestamp cannot be shown to be recent, so it is treated as stale. Failing
    // the other way would let a malformed document present itself as current.
    return { ageSeconds: Number.POSITIVE_INFINITY, isStale: true, generatedAt: null };
  }

  const ageSeconds = Math.max(0, (now.getTime() - generatedAt.getTime()) / 1000);

  return { ageSeconds, isStale: ageSeconds > document.staleAfterSeconds, generatedAt };
}

/** The maintenance windows currently open. */
export function activeMaintenance(windows: MaintenanceWindow[], now: Date): MaintenanceWindow[] {
  return windows.filter((window) => {
    const startsAt = parseInstant(window.startsAt);
    const endsAt = parseInstant(window.endsAt);

    return startsAt !== null && endsAt !== null && isWithinWindow(startsAt, endsAt, now);
  });
}

/** Windows that have not started yet, soonest first. */
export function upcomingMaintenance(windows: MaintenanceWindow[], now: Date): MaintenanceWindow[] {
  return windows
    .filter((window) => {
      const startsAt = parseInstant(window.startsAt);

      return startsAt !== null && startsAt.getTime() > now.getTime();
    })
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

/** The overrides that have not expired, newest assertion first when a key repeats. */
export function activeOverrides(overrides: ServiceOverride[], now: Date): ServiceOverride[] {
  return overrides
    .filter((override) => {
      const expiresAt = parseInstant(override.expiresAt);

      return expiresAt !== null && expiresAt.getTime() > now.getTime();
    })
    .sort((left, right) => right.setAt.localeCompare(left.setAt));
}

/**
 * What a service row should show, resolving the four sources of truth in precedence order:
 *
 *  1. an unexpired operator override, because a person deliberately asserted it;
 *  2. an open maintenance window, which is planned and pre-announced;
 *  3. the published health, when the document is fresh;
 *  4. unknown, when it is stale.
 *
 * An override outranks maintenance because it is the later deliberate act: if something breaks
 * during a planned window, an operator saying "this is an outage" should not be masked by the
 * window that was scheduled hours earlier.
 *
 * An override also outranks staleness, which is the whole point of it existing. Staleness means
 * Nexus stopped telling us anything, and that is exactly when a human assertion is the only
 * information available.
 *
 * Maintenance and overrides are overlaid at RENDER time rather than baked into the feed because
 * both turn on and off at wall-clock boundaries with nothing to trigger a publish. Baked in, the
 * file would be wrong from the boundary until some unrelated write happened along.
 */
export function displayStateFor(
  service: PublicServiceStatus,
  openWindows: MaintenanceWindow[],
  unexpiredOverrides: ServiceOverride[],
  isStale: boolean,
): RowState {
  const override = unexpiredOverrides.find((candidate) => candidate.serviceKey === service.key);
  if (override !== undefined) {
    return override.state;
  }

  if (openWindows.some((window) => window.affectedServiceKeys.includes(service.key))) {
    return 'UnderMaintenance';
  }

  return isStale ? 'Unknown' : service.state;
}

/** What a row ends up showing, once every source has been resolved. */
export type RowState = DisplayState | 'Unknown';

/** A service paired with the state it will render as. */
export interface ServiceRow {
  service: PublicServiceStatus;
  state: RowState;
}

/** Resolves every service row once, so the rows and the headline cannot disagree. */
export function resolveRows(
  services: PublicServiceStatus[],
  openWindows: MaintenanceWindow[],
  unexpiredOverrides: ServiceOverride[],
  isStale: boolean,
): ServiceRow[] {
  return services.map((service) => ({
    service,
    state: displayStateFor(service, openWindows, unexpiredOverrides, isStale),
  }));
}

/**
 * The headline, derived from the resolved rows rather than read from the published document.
 *
 * The document carries its own `overall`, and in the ordinary fresh case this agrees with it. It is
 * recomputed here because the document cannot know about the two things resolved at render time: an
 * operator override, and its own staleness. Trusting the published value would let the page announce
 * "all systems operational" above a list of rows that say otherwise, which is worse than either
 * being wrong alone.
 *
 * Returns null for "cannot say", which the hero renders as unavailable. Note the ordering: any
 * unknown row blocks an all-clear, because claiming everything is fine while some rows are unknown
 * asserts more than the page actually knows. Maintenance rows are neutral, being planned and
 * separately banered.
 */
export function deriveOverall(rows: ServiceRow[]): PublicOverallState | null {
  if (rows.length === 0) {
    return null;
  }

  const outages = rows.filter((row) => row.state === 'Outage').length;
  if (outages > 0) {
    return outages === rows.length ? 'MajorOutage' : 'PartialOutage';
  }

  if (rows.some((row) => row.state === 'Degraded')) {
    return 'Degraded';
  }

  if (rows.some((row) => row.state === 'Unknown')) {
    return null;
  }

  return 'AllOperational';
}

/** Open incidents, most recently started first. */
export function openIncidents(incidents: Incident[]): Incident[] {
  return incidents
    .filter((incident) => incident.status !== 'Resolved')
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

/**
 * Incidents resolved within the given window, most recently resolved first. Keeping recent
 * history visible answers the question a client actually arrives with during a recovery: "was
 * that thing I just saw a known problem?"
 */
export function recentlyResolvedIncidents(
  incidents: Incident[],
  now: Date,
  withinDays = 7,
): Incident[] {
  const cutoff = now.getTime() - withinDays * 86400 * 1000;

  return incidents
    .filter((incident) => {
      if (incident.status !== 'Resolved') {
        return false;
      }

      const resolvedAt = parseInstant(incident.resolvedAt);

      return resolvedAt !== null && resolvedAt.getTime() >= cutoff;
    })
    .sort((left, right) => (right.resolvedAt ?? '').localeCompare(left.resolvedAt ?? ''));
}
