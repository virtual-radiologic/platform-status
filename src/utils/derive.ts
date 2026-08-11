/**
 * Everything the page computes from the two documents. Kept apart from the fetch layer so the
 * rules that decide what a reader is told are testable without any network involved.
 */
import type {
  DisplayState,
  Incident,
  MaintenanceWindow,
  PublicServiceStatus,
  PublicStatusDocument,
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

/**
 * Overlays open maintenance windows onto published health.
 *
 * The overlay happens here, at render time, rather than in the published document, because a
 * window opens and closes on a wall-clock boundary with nothing to trigger a publish. Baking it
 * into the feed would leave the file wrong from the window's start until some unrelated write.
 */
export function displayStateFor(
  service: PublicServiceStatus,
  openWindows: MaintenanceWindow[],
): DisplayState {
  const covered = openWindows.some((window) => window.affectedServiceKeys.includes(service.key));

  return covered ? 'UnderMaintenance' : service.state;
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
