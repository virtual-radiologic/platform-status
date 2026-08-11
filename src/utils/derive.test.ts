import { describe, expect, it } from 'vitest';

import type {
  Incident,
  MaintenanceWindow,
  PublicServiceStatus,
  PublicStatusDocument,
} from '../models/types';
import {
  activeMaintenance,
  assessFreshness,
  displayStateFor,
  openIncidents,
  recentlyResolvedIncidents,
  upcomingMaintenance,
} from './derive';

const NOW = new Date('2026-08-11T12:00:00Z');

function statusDocument(generatedAt: string, staleAfterSeconds = 300): PublicStatusDocument {
  return {
    schemaVersion: 1,
    generatedAt,
    staleAfterSeconds,
    overall: 'AllOperational',
    services: [],
  };
}

function window(overrides: Partial<MaintenanceWindow> = {}): MaintenanceWindow {
  return {
    id: 'w1',
    title: 'Window',
    body: '',
    affectedServiceKeys: ['reporting'],
    startsAt: '2026-08-11T11:00:00Z',
    endsAt: '2026-08-11T13:00:00Z',
    ...overrides,
  };
}

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    title: 'Incident',
    impact: 'Minor',
    status: 'Investigating',
    affectedServiceKeys: [],
    startedAt: '2026-08-11T10:00:00Z',
    resolvedAt: null,
    updates: [],
    ...overrides,
  };
}

describe('assessFreshness', () => {
  it('treats a document inside its tolerance as fresh', () => {
    const freshness = assessFreshness(statusDocument('2026-08-11T11:58:00Z'), NOW);

    expect(freshness.ageSeconds).toBe(120);
    expect(freshness.isStale).toBe(false);
  });

  it('treats a document past its tolerance as stale', () => {
    const freshness = assessFreshness(statusDocument('2026-08-11T11:50:00Z'), NOW);

    expect(freshness.isStale).toBe(true);
  });

  it('treats an unreadable timestamp as stale rather than as current', () => {
    const freshness = assessFreshness(statusDocument('not-a-date'), NOW);

    expect(freshness.isStale).toBe(true);
    expect(freshness.generatedAt).toBeNull();
  });

  it('clamps a future timestamp to zero age instead of reporting negative age', () => {
    const freshness = assessFreshness(statusDocument('2026-08-11T12:05:00Z'), NOW);

    expect(freshness.ageSeconds).toBe(0);
    expect(freshness.isStale).toBe(false);
  });
});

describe('maintenance windows', () => {
  it('reports a window containing now as active', () => {
    expect(activeMaintenance([window()], NOW)).toHaveLength(1);
  });

  it('excludes a window whose end has passed', () => {
    const past = window({ startsAt: '2026-08-11T09:00:00Z', endsAt: '2026-08-11T10:00:00Z' });

    expect(activeMaintenance([past], NOW)).toHaveLength(0);
  });

  it('treats the end instant as outside the window', () => {
    const ending = window({ startsAt: '2026-08-11T11:00:00Z', endsAt: '2026-08-11T12:00:00Z' });

    expect(activeMaintenance([ending], NOW)).toHaveLength(0);
  });

  it('treats the start instant as inside the window', () => {
    const starting = window({ startsAt: '2026-08-11T12:00:00Z', endsAt: '2026-08-11T13:00:00Z' });

    expect(activeMaintenance([starting], NOW)).toHaveLength(1);
  });

  it('orders upcoming windows soonest first', () => {
    const later = window({
      id: 'later',
      startsAt: '2026-08-13T00:00:00Z',
      endsAt: '2026-08-13T01:00:00Z',
    });
    const sooner = window({
      id: 'sooner',
      startsAt: '2026-08-12T00:00:00Z',
      endsAt: '2026-08-12T01:00:00Z',
    });

    expect(upcomingMaintenance([later, sooner], NOW).map((w) => w.id)).toEqual(['sooner', 'later']);
  });

  it('excludes an in-progress window from the upcoming list', () => {
    expect(upcomingMaintenance([window()], NOW)).toHaveLength(0);
  });
});

describe('displayStateFor', () => {
  const service: PublicServiceStatus = {
    key: 'reporting',
    label: 'Reporting',
    state: 'Operational',
  };

  it('overlays maintenance onto a covered service', () => {
    expect(displayStateFor(service, [window()])).toBe('UnderMaintenance');
  });

  it('leaves an uncovered service on its published state', () => {
    const elsewhere = window({ affectedServiceKeys: ['imaging'] });

    expect(displayStateFor(service, [elsewhere])).toBe('Operational');
  });

  it('shows maintenance even when the service is also unhealthy', () => {
    const down: PublicServiceStatus = { ...service, state: 'Outage' };

    expect(displayStateFor(down, [window()])).toBe('UnderMaintenance');
  });
});

describe('incident filtering', () => {
  it('excludes resolved incidents from the open list', () => {
    const open = incident({ id: 'open' });
    const closed = incident({
      id: 'closed',
      status: 'Resolved',
      resolvedAt: '2026-08-11T11:00:00Z',
    });

    expect(openIncidents([open, closed]).map((i) => i.id)).toEqual(['open']);
  });

  it('orders open incidents most recently started first', () => {
    const older = incident({ id: 'older', startedAt: '2026-08-11T08:00:00Z' });
    const newer = incident({ id: 'newer', startedAt: '2026-08-11T11:00:00Z' });

    expect(openIncidents([older, newer]).map((i) => i.id)).toEqual(['newer', 'older']);
  });

  it('includes a recently resolved incident', () => {
    const closed = incident({ status: 'Resolved', resolvedAt: '2026-08-10T12:00:00Z' });

    expect(recentlyResolvedIncidents([closed], NOW)).toHaveLength(1);
  });

  it('excludes an incident resolved outside the window', () => {
    const old = incident({ status: 'Resolved', resolvedAt: '2026-07-01T12:00:00Z' });

    expect(recentlyResolvedIncidents([old], NOW)).toHaveLength(0);
  });

  it('excludes a resolved incident with no resolution timestamp', () => {
    const malformed = incident({ status: 'Resolved', resolvedAt: null });

    expect(recentlyResolvedIncidents([malformed], NOW)).toHaveLength(0);
  });
});
