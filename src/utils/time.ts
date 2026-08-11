/** Time formatting and window arithmetic. No external date library: the needs here are small. */

/** Parses an ISO 8601 instant, returning null rather than an Invalid Date for unusable input. */
export function parseInstant(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }

  const parsed = new Date(iso);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * "4 minutes ago" / "in 2 hours". Coarse on purpose: a status page that reads "just now" while
 * showing a stale document invites more trust than the data has earned.
 */
export function relativeTime(from: Date, now: Date): string {
  const seconds = Math.round((now.getTime() - from.getTime()) / 1000);
  const past = seconds >= 0;
  const magnitude = Math.abs(seconds);

  const phrase = describeDuration(magnitude);
  if (phrase === null) {
    return past ? 'just now' : 'in a moment';
  }

  return past ? `${phrase} ago` : `in ${phrase}`;
}

/** A bare duration phrase ("4 minutes"), or null when the span rounds to nothing worth naming. */
export function describeDuration(seconds: number): string | null {
  if (seconds < 45) {
    return null;
  }

  const units: [limit: number, perUnit: number, name: string][] = [
    [90, 60, 'minute'],
    [5400, 60, 'minute'],
    [129600, 3600, 'hour'],
    [Number.POSITIVE_INFINITY, 86400, 'day'],
  ];

  for (const [limit, perUnit, name] of units) {
    if (seconds < limit) {
      const count = Math.max(1, Math.round(seconds / perUnit));

      return `${count} ${name}${count === 1 ? '' : 's'}`;
    }
  }

  return null;
}

/**
 * An absolute timestamp in the reader's own time zone, with the zone named. Clients read this
 * page from several time zones, and an unlabeled local time is ambiguous exactly when it matters.
 */
export function absoluteTime(instant: Date): string {
  // Explicit components rather than dateStyle/timeStyle: the spec forbids combining those
  // shorthands with any individual component option, and timeZoneName is required here, so the
  // shorthand form throws a RangeError at format time.
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(instant);
}

/** Whether `now` falls inside [startsAt, endsAt). */
export function isWithinWindow(startsAt: Date, endsAt: Date, now: Date): boolean {
  return now.getTime() >= startsAt.getTime() && now.getTime() < endsAt.getTime();
}
