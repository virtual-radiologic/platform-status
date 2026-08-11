/**
 * Behavior tests over the demo-critical paths, with the network boundary mocked so they stay
 * hermetic. The staleness cases carry the most weight: a page that keeps announcing
 * "all systems operational" from a document nobody is updating is the specific failure this
 * design exists to prevent, so it is asserted rather than assumed.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IncidentDocument, PublicStatusDocument } from './models/types';
import type { FeedFailure, StatusFeed } from './services/statusFeed';

const fetchStatusFeed = vi.hoisted(() => vi.fn());

vi.mock('./services/statusFeed', () => ({ fetchStatusFeed }));

const { App } = await import('./App');

function isoSecondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function status(overrides: Partial<PublicStatusDocument> = {}): PublicStatusDocument {
  return {
    schemaVersion: 1,
    generatedAt: isoSecondsAgo(30),
    staleAfterSeconds: 300,
    overall: 'AllOperational',
    services: [
      { key: 'imaging', label: 'Image Ingest', state: 'Operational' },
      { key: 'reporting', label: 'Reporting', state: 'Operational' },
    ],
    ...overrides,
  };
}

function incidents(overrides: Partial<IncidentDocument> = {}): IncidentDocument {
  return {
    schemaVersion: 1,
    generatedAt: isoSecondsAgo(30),
    incidents: [],
    serviceOverrides: [],
    maintenance: [],
    ...overrides,
  };
}

function serviceOverride(serviceKey: string, state: 'Operational' | 'Degraded' | 'Outage') {
  return {
    serviceKey,
    state,
    setAt: isoSecondsAgo(120),
    expiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString(),
  };
}

function feed(
  statusDocument: PublicStatusDocument | FeedFailure,
  incidentDocument: IncidentDocument | FeedFailure = incidents(),
): StatusFeed {
  const wrap = <T,>(value: T | FeedFailure) =>
    'kind' in (value as object)
      ? ({ ok: false, failure: value as FeedFailure } as const)
      : ({ ok: true, value: value as T } as const);

  return {
    status: wrap<PublicStatusDocument>(statusDocument),
    incidents: wrap<IncidentDocument>(incidentDocument),
  } as StatusFeed;
}

afterEach(() => {
  fetchStatusFeed.mockReset();
});

describe('healthy platform', () => {
  it('announces all systems operational and lists each service', async () => {
    fetchStatusFeed.mockResolvedValue(feed(status()));

    render(<App />);

    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
    expect(screen.getByText('Image Ingest')).toBeInTheDocument();
    expect(screen.getAllByText('Operational')).toHaveLength(2);
  });

  it('reports no active incidents when none are published', async () => {
    fetchStatusFeed.mockResolvedValue(feed(status()));

    render(<App />);

    expect(await screen.findByText('No active incidents.')).toBeInTheDocument();
  });
});

describe('degraded platform', () => {
  it('names the degraded service rather than only changing the headline', async () => {
    fetchStatusFeed.mockResolvedValue(
      feed(
        status({
          overall: 'Degraded',
          services: [
            { key: 'imaging', label: 'Image Ingest', state: 'Operational' },
            { key: 'reporting', label: 'Reporting', state: 'Degraded' },
          ],
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText('Some systems degraded')).toBeInTheDocument();
    expect(screen.getByText('Degraded performance')).toBeInTheDocument();
  });

  it('distinguishes a partial outage from a major one', async () => {
    // The headline is derived from the rows, not read from the document's own `overall`. That is
    // what lets it stay consistent with overrides and staleness, so the states are what drive it.
    fetchStatusFeed.mockResolvedValue(
      feed(
        status({
          services: [
            { key: 'imaging', label: 'Image Ingest', state: 'Outage' },
            { key: 'reporting', label: 'Reporting', state: 'Operational' },
          ],
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText('Partial platform outage')).toBeInTheDocument();
  });

  it('reports a major outage when every service is down', async () => {
    fetchStatusFeed.mockResolvedValue(
      feed(
        status({
          services: [
            { key: 'imaging', label: 'Image Ingest', state: 'Outage' },
            { key: 'reporting', label: 'Reporting', state: 'Outage' },
          ],
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText('Major platform outage')).toBeInTheDocument();
  });
});

describe('stale document', () => {
  it('refuses to report a state and warns instead', async () => {
    fetchStatusFeed.mockResolvedValue(
      feed(status({ generatedAt: isoSecondsAgo(1800), overall: 'AllOperational' })),
    );

    render(<App />);

    expect(await screen.findByText('Current status unavailable')).toBeInTheDocument();
    expect(screen.getByText('This status may be out of date')).toBeInTheDocument();
    expect(screen.queryByText('All systems operational')).not.toBeInTheDocument();
  });

  it('shows every service as unknown rather than as last published', async () => {
    fetchStatusFeed.mockResolvedValue(feed(status({ generatedAt: isoSecondsAgo(1800) })));

    render(<App />);

    await waitFor(() => expect(screen.getAllByText('Status unknown')).toHaveLength(2));
    expect(screen.queryByText('Operational')).not.toBeInTheDocument();
  });
});

describe('feed failures', () => {
  it('reports an unreachable status feed', async () => {
    fetchStatusFeed.mockResolvedValue(feed({ kind: 'unreachable', detail: 'HTTP 404' }));

    render(<App />);

    expect(await screen.findByText('Live status is unavailable')).toBeInTheDocument();
    expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
  });

  it('explains a schema mismatch and tells the reader to reload', async () => {
    fetchStatusFeed.mockResolvedValue(feed({ kind: 'unsupportedSchema', found: 2, supported: 1 }));

    render(<App />);

    expect(await screen.findByText(/published as format 2/)).toBeInTheDocument();
    expect(screen.getByText(/Reload the page/)).toBeInTheDocument();
  });

  it('still renders service states when only the incident feed fails', async () => {
    fetchStatusFeed.mockResolvedValue(feed(status(), { kind: 'unreachable', detail: 'HTTP 500' }));

    render(<App />);

    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
    expect(screen.getByText('Incident information is unavailable')).toBeInTheDocument();
  });
});

describe('maintenance', () => {
  it('overlays an open window onto the covered service and banners it', async () => {
    const openWindow = {
      id: 'w1',
      title: 'Reporting platform upgrade',
      body: 'Short interruptions expected.',
      affectedServiceKeys: ['reporting'],
      startsAt: isoSecondsAgo(600),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    fetchStatusFeed.mockResolvedValue(feed(status(), incidents({ maintenance: [openWindow] })));

    render(<App />);

    expect(await screen.findByText('Maintenance in progress')).toBeInTheDocument();
    expect(screen.getByText('Under maintenance')).toBeInTheDocument();
  });

  it('lists a future window as scheduled without overlaying any service', async () => {
    const future = {
      id: 'w2',
      title: 'Order management upgrade',
      body: '',
      affectedServiceKeys: ['imaging'],
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 90_000_000).toISOString(),
    };
    fetchStatusFeed.mockResolvedValue(feed(status(), incidents({ maintenance: [future] })));

    render(<App />);

    expect(await screen.findByText('Order management upgrade')).toBeInTheDocument();
    expect(screen.queryByText('Under maintenance')).not.toBeInTheDocument();
    expect(screen.queryByText('Maintenance in progress')).not.toBeInTheDocument();
  });
});

describe('operator overrides', () => {
  it('shows an overridden state even though the document is stale', async () => {
    // The scenario this exists for: the platform is entirely down, so nothing is publishing, so the
    // status document has aged out. An operator can still write the incident file, and what they say
    // there has to reach the page.
    fetchStatusFeed.mockResolvedValue(
      feed(
        status({ generatedAt: isoSecondsAgo(3600) }),
        incidents({ serviceOverrides: [serviceOverride('reporting', 'Outage')] }),
      ),
    );

    render(<App />);

    expect(await screen.findByText('Outage')).toBeInTheDocument();
    expect(screen.getByText('Status unknown')).toBeInTheDocument();
    expect(screen.getByText('Partial platform outage')).toBeInTheDocument();
  });

  it('ignores an expired override rather than pinning a recovered service', async () => {
    const expired = {
      ...serviceOverride('reporting', 'Outage'),
      expiresAt: isoSecondsAgo(60),
    };
    fetchStatusFeed.mockResolvedValue(feed(status(), incidents({ serviceOverrides: [expired] })));

    render(<App />);

    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
    expect(screen.queryByText('Outage')).not.toBeInTheDocument();
  });

  it('lets an override outrank an open maintenance window', async () => {
    const openWindow = {
      id: 'w1',
      title: 'Reporting platform upgrade',
      body: '',
      affectedServiceKeys: ['reporting'],
      startsAt: isoSecondsAgo(600),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    fetchStatusFeed.mockResolvedValue(
      feed(
        status(),
        incidents({
          maintenance: [openWindow],
          serviceOverrides: [serviceOverride('reporting', 'Outage')],
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText('Outage')).toBeInTheDocument();
    expect(screen.queryByText('Under maintenance')).not.toBeInTheDocument();
  });

  it('refuses an all-clear headline while some rows are unknown', async () => {
    fetchStatusFeed.mockResolvedValue(
      feed(
        status({ generatedAt: isoSecondsAgo(3600) }),
        incidents({ serviceOverrides: [serviceOverride('reporting', 'Operational')] }),
      ),
    );

    render(<App />);

    expect(await screen.findByText('Current status unavailable')).toBeInTheDocument();
  });
});

describe('incidents', () => {
  it('renders an open incident with its timeline newest first', async () => {
    const incident = {
      id: 'i1',
      title: 'Delayed study routing',
      impact: 'Minor' as const,
      status: 'Monitoring' as const,
      affectedServiceKeys: ['reporting'],
      startedAt: isoSecondsAgo(3600),
      resolvedAt: null,
      updates: [
        {
          postedAt: isoSecondsAgo(3000),
          status: 'Investigating' as const,
          body: 'Looking into it.',
        },
        { postedAt: isoSecondsAgo(600), status: 'Monitoring' as const, body: 'Backlog cleared.' },
      ],
    };
    fetchStatusFeed.mockResolvedValue(feed(status(), incidents({ incidents: [incident] })));

    render(<App />);

    expect(await screen.findByText('Delayed study routing')).toBeInTheDocument();

    const bodies = screen.getAllByText(/Looking into it\.|Backlog cleared\./);
    expect(bodies[0]).toHaveTextContent('Backlog cleared.');
  });

  it('resolves affected service keys to their published labels', async () => {
    const incident = {
      id: 'i1',
      title: 'Reporting slow',
      impact: 'Minor' as const,
      status: 'Investigating' as const,
      affectedServiceKeys: ['reporting'],
      startedAt: isoSecondsAgo(600),
      resolvedAt: null,
      updates: [],
    };
    fetchStatusFeed.mockResolvedValue(feed(status(), incidents({ incidents: [incident] })));

    render(<App />);

    await screen.findByText('Reporting slow');

    // Scoped to the affected line: "Reporting" is also a service row label, so an unscoped text
    // query matches both and proves nothing about the key having been resolved.
    const affected = screen.getByText(/^Affected:/).closest('p');
    expect(affected).toHaveTextContent('Affected: Reporting');
  });
});
