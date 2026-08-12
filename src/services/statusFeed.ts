/**
 * Reads the two published documents from GitHub, over TWO delivery paths with different trade-offs.
 *
 * Neither path is on this Pages site, and that is deliberate: committing the data into the published
 * branch would make every status change trigger a Pages rebuild, and Pages allows only about ten
 * builds an hour, so during an incident the publisher would queue behind its own builds exactly when
 * latency matters.
 *
 * BACKGROUND POLLING USES raw.githubusercontent.com. Unlimited and anonymous, but it caches per path
 * for up to 300s and - measured, not assumed - IGNORES query-string cache-busters: `x-cache: HIT` on
 * three unique query strings from three different cache nodes, and a request-level
 * `Cache-Control: no-cache` is ignored as well. So this path can be five minutes behind, which is why
 * the published document's `staleAfterSeconds` has to clear the heartbeat PLUS that window.
 *
 * A MANUAL REFRESH USES api.github.com, which DOES honour a cache-buster and returns the current
 * commit's content immediately. Verified against a scratch branch: write v2, then in the same second
 * the API with a buster returns v2 while the API without one and raw both still return v1.
 *
 * The split is forced by the API's rate limit: 60 requests an hour PER CLIENT IP, unauthenticated,
 * and each refresh reads two documents. That is ample for a button a person presses and far too
 * little for background polling, especially since everyone behind one corporate egress shares the
 * budget. Authenticating is not an option: a token in a public page is a published token.
 *
 * A rate-limited or otherwise failed API read falls back to raw, so the worst case is a refresh that
 * behaves like the old one rather than a page that breaks.
 */
import {
  SUPPORTED_SCHEMA_VERSION,
  type IncidentDocument,
  type PublicStatusDocument,
} from '../models/types';

const DEFAULT_OWNER = 'virtual-radiologic';
const DEFAULT_REPOSITORY = 'platform-status';

const DEFAULT_STATUS_URL = `https://raw.githubusercontent.com/${DEFAULT_OWNER}/${DEFAULT_REPOSITORY}/data/status.json`;
const DEFAULT_INCIDENTS_URL = `https://raw.githubusercontent.com/${DEFAULT_OWNER}/${DEFAULT_REPOSITORY}/incidents/incidents.json`;

/**
 * Cache-buster bucket width for the raw path.
 *
 * Kept even though raw ignores it, because it costs nothing and the browser's OWN cache is keyed on
 * the full URL: rotating the bucket stops a tab that has been open for hours from serving its local
 * copy indefinitely. It does not defeat the CDN, and the comment above says why.
 */
const CACHE_BUCKET_MILLISECONDS = 30_000;

const STATUS_URL: string = import.meta.env.VITE_STATUS_URL ?? DEFAULT_STATUS_URL;
const INCIDENTS_URL: string = import.meta.env.VITE_INCIDENTS_URL ?? DEFAULT_INCIDENTS_URL;

/** The API equivalents of the two raw URLs, used only for a manual refresh. */
const STATUS_API_URL: string =
  import.meta.env.VITE_STATUS_API_URL ??
  `https://api.github.com/repos/${DEFAULT_OWNER}/${DEFAULT_REPOSITORY}/contents/status.json?ref=data`;
const INCIDENTS_API_URL: string =
  import.meta.env.VITE_INCIDENTS_API_URL ??
  `https://api.github.com/repos/${DEFAULT_OWNER}/${DEFAULT_REPOSITORY}/contents/incidents.json?ref=incidents`;

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

/**
 * Reads a document through api.github.com with a unique cache-buster, which is the only combination
 * measured to return the current commit's content immediately.
 *
 * Returns null rather than a failure so the caller can fall back to raw: a 403 here means the IP has
 * spent its hourly budget, which is a reason to use the slower path, not a reason to tell the reader
 * anything is wrong.
 */
async function fetchDocumentFresh<T extends { schemaVersion: number }>(
  apiUrl: string,
): Promise<FeedResult<T> | null> {
  const separator = apiUrl.includes('?') ? '&' : '?';
  const url = `${apiUrl}${separator}cb=${crypto.randomUUID()}`;

  try {
    const response = await fetch(url, {
      // The raw media type returns the file itself instead of the JSON envelope with base64 content.
      headers: { Accept: 'application/vnd.github.raw' },
    });
    if (!response.ok) {
      return null;
    }

    return validate<T>(await response.json());
  } catch {
    return null;
  }
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

  return validate<T>(parsed);
}

/** Shared schema checks, so both delivery paths accept and reject exactly the same payloads. */
function validate<T extends { schemaVersion: number }>(parsed: unknown): FeedResult<T> {
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

/**
 * Fetches both documents concurrently. Neither failure prevents the other from rendering.
 *
 * `fresh: true` is for a MANUAL refresh only, and takes the api.github.com path so the reader
 * actually gets the current state instead of whatever the CDN is still holding. Background polling
 * must leave it false: the API's 60-per-hour-per-IP budget cannot support a timer, and spending it
 * would make the button stop working precisely when someone reaches for it.
 */
export async function fetchStatusFeed(
  now: number = Date.now(),
  options: { fresh?: boolean } = {},
): Promise<StatusFeed> {
  if (options.fresh === true) {
    const [freshStatus, freshIncidents] = await Promise.all([
      fetchDocumentFresh<PublicStatusDocument>(STATUS_API_URL),
      fetchDocumentFresh<IncidentDocument>(INCIDENTS_API_URL),
    ]);

    // Per document, not all-or-nothing: if only one API read was refused, the other still gets to be
    // current rather than both dropping back to the cached path.
    const [status, incidents] = await Promise.all([
      freshStatus ?? fetchDocument<PublicStatusDocument>(STATUS_URL, now),
      freshIncidents ?? fetchDocument<IncidentDocument>(INCIDENTS_URL, now),
    ]);

    return { status, incidents };
  }

  const [status, incidents] = await Promise.all([
    fetchDocument<PublicStatusDocument>(STATUS_URL, now),
    fetchDocument<IncidentDocument>(INCIDENTS_URL, now),
  ]);

  return { status, incidents };
}
