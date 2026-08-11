import { useCallback, useEffect, useMemo, useState } from 'react';

import { IncidentList } from './components/IncidentList';
import { MaintenanceList } from './components/MaintenanceList';
import { Notice } from './components/Notice';
import { OverallHero } from './components/OverallHero';
import { ServiceList } from './components/ServiceList';
import { fetchStatusFeed, type FeedFailure, type StatusFeed } from './services/statusFeed';
import {
  activeMaintenance,
  activeOverrides,
  assessFreshness,
  deriveOverall,
  openIncidents,
  recentlyResolvedIncidents,
  resolveRows,
  upcomingMaintenance,
} from './utils/derive';
import { absoluteTime, relativeTime } from './utils/time';

/** How often to re-fetch. The CDN bucket is 30s, so polling faster would only re-read one file. */
const POLL_INTERVAL_MILLISECONDS = 60_000;

/**
 * How often to advance the page's own clock. Relative times and, more importantly, the staleness
 * verdict have to keep moving when fetches are FAILING, which is exactly the case where no fetch
 * will ever arrive to trigger a re-render.
 */
const CLOCK_TICK_MILLISECONDS = 20_000;

function describeFailure(failure: FeedFailure): string {
  switch (failure.kind) {
    case 'unreachable':
      return `The status feed could not be reached (${failure.detail}).`;
    case 'unparseable':
      return `The status feed could not be read (${failure.detail}).`;
    case 'unsupportedSchema':
      return `This page understands status format ${failure.supported} but the feed is published as format ${failure.found}.`;
  }
}

export function App() {
  const [feed, setFeed] = useState<StatusFeed | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [now, setNow] = useState(() => new Date());

  const refresh = useCallback(async () => {
    setIsFetching(true);
    try {
      const result = await fetchStatusFeed();
      setFeed(result);
      setNow(new Date());
    } finally {
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const pollTimer = window.setInterval(() => void refresh(), POLL_INTERVAL_MILLISECONDS);

    // A tab left open for hours holds a document from hours ago. Re-reading on return means the
    // reader is not looking at history without being told.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    const clockTimer = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MILLISECONDS);

    return () => window.clearInterval(clockTimer);
  }, []);

  const statusDocument = feed?.status.ok === true ? feed.status.value : null;
  const incidentDocument = feed?.incidents.ok === true ? feed.incidents.value : null;

  const freshness = useMemo(
    () => (statusDocument === null ? null : assessFreshness(statusDocument, now)),
    [statusDocument, now],
  );
  const isStale = freshness === null || freshness.isStale;

  const services = statusDocument?.services ?? [];

  // These derive from `incidentDocument` rather than from a `?? []` local: an empty-array fallback
  // is a fresh reference on every render, so it would change the dependency identity each time and
  // the memos below would recompute constantly while looking like they cache.
  const openWindows = useMemo(
    () => activeMaintenance(incidentDocument?.maintenance ?? [], now),
    [incidentDocument, now],
  );
  const scheduledWindows = useMemo(
    () => upcomingMaintenance(incidentDocument?.maintenance ?? [], now),
    [incidentDocument, now],
  );
  const active = useMemo(
    () => openIncidents(incidentDocument?.incidents ?? []),
    [incidentDocument],
  );
  const resolved = useMemo(
    () => recentlyResolvedIncidents(incidentDocument?.incidents ?? [], now),
    [incidentDocument, now],
  );
  const overrides = useMemo(
    () => activeOverrides(incidentDocument?.serviceOverrides ?? [], now),
    [incidentDocument, now],
  );

  // Resolved once, so the rows and the headline above them cannot contradict each other. Depends on
  // `statusDocument` rather than the `services` local for the same empty-array-identity reason.
  const rows = useMemo(
    () => resolveRows(statusDocument?.services ?? [], openWindows, overrides, isStale, active),
    [statusDocument, openWindows, overrides, isStale, active],
  );
  const overall = useMemo(() => deriveOverall(rows), [rows]);

  const subtitle = (() => {
    if (freshness?.generatedAt == null) {
      return isFetching ? 'Loading the latest published status…' : 'No published status was read.';
    }

    return `Updated ${relativeTime(freshness.generatedAt, now)} · ${absoluteTime(freshness.generatedAt)}`;
  })();

  return (
    <div className="page">
      <header className="masthead">
        <h1 className="masthead__title">vRad Platform Status</h1>
        <div className="masthead__meta">
          <button
            type="button"
            className="refresh-button"
            onClick={() => void refresh()}
            disabled={isFetching}
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <OverallHero overall={overall} subtitle={subtitle} />

      {feed !== null && feed.status.ok === false && (
        <Notice tone="error" title="Live status is unavailable">
          {describeFailure(feed.status.failure)}
          {feed.status.failure.kind === 'unsupportedSchema'
            ? ' Reload the page to pick up the current version.'
            : ' Any incidents below are still accurate as published.'}
        </Notice>
      )}

      {statusDocument !== null && freshness !== null && freshness.isStale && (
        <Notice tone="warning" title="This status may be out of date">
          The last published update was {relativeTime(freshness.generatedAt ?? now, now)}, which is
          longer than the expected {statusDocument.staleAfterSeconds}-second interval. Service
          states are shown as unknown until publishing resumes
          {overrides.length > 0 ? ', except where a status has been confirmed manually' : ''}.
        </Notice>
      )}

      {feed !== null && feed.incidents.ok === false && (
        <Notice tone="warning" title="Incident information is unavailable">
          {describeFailure(feed.incidents.failure)} Service states above are unaffected.
        </Notice>
      )}

      {openWindows.length > 0 && (
        <Notice tone="info" title="Maintenance in progress">
          {openWindows.map((window) => window.title).join('; ')}
        </Notice>
      )}

      <section className="section">
        <h2 className="section__heading">Services</h2>
        <ServiceList rows={rows} />
      </section>

      <section className="section">
        <h2 className="section__heading">Active incidents</h2>
        <IncidentList
          incidents={active}
          services={services}
          now={now}
          emptyMessage="No active incidents."
        />
      </section>

      {scheduledWindows.length > 0 && (
        <section className="section">
          <h2 className="section__heading">Scheduled maintenance</h2>
          <MaintenanceList
            windows={scheduledWindows}
            services={services}
            now={now}
            emptyMessage="No scheduled maintenance."
          />
        </section>
      )}

      {resolved.length > 0 && (
        <section className="section">
          <h2 className="section__heading">Recently resolved</h2>
          <IncidentList
            incidents={resolved}
            services={services}
            now={now}
            emptyMessage="Nothing resolved recently."
          />
        </section>
      )}

      <footer className="footer">
        <p>
          This page is published independently of the vRad platform, so it stays available during an
          outage.
        </p>
        <p>Times are shown in your local time zone. Status refreshes automatically.</p>
      </footer>
    </div>
  );
}
