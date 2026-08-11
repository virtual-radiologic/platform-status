/**
 * Reads the two published documents from GitHub.
 *
 * They are fetched from raw.githubusercontent.com rather than from this Pages site, and that is
 * deliberate. Committing the data into the Pages branch would make every status change trigger a
 * Pages rebuild, and Pages allows only about 10 builds per hour. During an incident, when updates
 * cluster, the publisher would be queueing behind its own builds precisely when latency matters.
 * Reading from a non-published branch decouples the data entirely: Pages only rebuilds when the
 * site itself changes. raw.githubusercontent.com sends `Access-Control-Allow-Origin: *`, so the
 * cross-origin read needs no proxy.
 */
import {
  SUPPORTED_SCHEMA_VERSION,
  type IncidentDocument,
  type PublicStatusDocument,
} from '../models/types';

const DEFAULT_STATUS_URL =
  'https://raw.githubusercontent.com/virtual-radiologic/platform-status/data/status.json';
const DEFAULT_INCIDENTS_URL =
  'https://raw.githubusercontent.com/virtual-radiologic/platform-status/incidents/incidents.json';

/**
 * Cache-buster bucket width. raw.githubusercontent.com serves `Cache-Control: max-age=300`, so
 * without a buster the page could show five-minute-old status. A per-request unique buster would
 * fix freshness but send every visitor straight to origin, which during a real incident (when
 * traffic spikes) is the worst possible time to be doing that.
 *
 * Quantizing to a shared bucket gets both: every visitor within the same 30-second window
 * requests the identical URL, so the CDN serves all but the first from cache, and origin sees
 * roughly one request per bucket no matter how many people are watching.
 */
const CACHE_BUCKET_MILLISECONDS = 30_000;

const STATUS_URL: string = import.meta.env.VITE_STATUS_URL ?? DEFAULT_STATUS_URL;
const INCIDENTS_URL: string = import.meta.env.VITE_INCIDENTS_URL ?? DEFAULT_INCIDENTS_URL;

/** Why a document could not be used, kept distinct so the page can say something specific. */
export type FeedFailure =
  | { kind: 'unreachable'; detail: string }
  | { kind: 'unparseable'; detail: string }
  | { kind: 'unsupportedSchema'; found: number; supported: number };

export type FeedResult<T> = { ok: true; value: T } | { ok: false; failure: FeedFailure };

/** Both documents, fetched independently so one failing does not blank the whole page. */
export interface StatusFeed {
  status: FeedResult<PublicStatusDocument>;
  incidents: FeedResult<IncidentDocument>;
}

function bustedUrl(url: string, now: number): string {
  const bucket = Math.floor(now / CACHE_BUCKET_MILLISECONDS);
  const separator = url.includes('?') ? '&' : '?';

  return `${url}${separator}t=${bucket}`;
}

async function fetchDocument<T extends { schemaVersion: number }>(
  url: string,
  now: number,
): Promise<FeedResult<T>> {
  let response: Response;
  try {
    response = await fetch(bustedUrl(url, now));
  } catch (error) {
    return { ok: false, failure: { kind: 'unreachable', detail: describeError(error) } };
  }

  if (!response.ok) {
    return {
      ok: false,
      failure: { kind: 'unreachable', detail: `HTTP ${response.status}` },
    };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (error) {
    return { ok: false, failure: { kind: 'unparseable', detail: describeError(error) } };
  }

  if (!isSchemaVersioned(parsed)) {
    return {
      ok: false,
      failure: { kind: 'unparseable', detail: 'no schemaVersion field' },
    };
  }

  // A cached bundle can outlive the schema it was built against, so an unrecognized version is
  // reported rather than rendered: half-understanding a payload is worse than admitting to none.
  if (parsed.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return {
      ok: false,
      failure: {
        kind: 'unsupportedSchema',
        found: parsed.schemaVersion,
        supported: SUPPORTED_SCHEMA_VERSION,
      },
    };
  }

  return { ok: true, value: parsed as T };
}

function isSchemaVersioned(value: unknown): value is { schemaVersion: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    typeof (value as { schemaVersion: unknown }).schemaVersion === 'number'
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fetches both documents concurrently. Neither failure prevents the other from rendering. */
export async function fetchStatusFeed(now: number = Date.now()): Promise<StatusFeed> {
  const [status, incidents] = await Promise.all([
    fetchDocument<PublicStatusDocument>(STATUS_URL, now),
    fetchDocument<IncidentDocument>(INCIDENTS_URL, now),
  ]);

  return { status, incidents };
}
