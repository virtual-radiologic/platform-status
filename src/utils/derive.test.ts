import { describe, expect, it } from 'vitest';

import type {
  Incident,
  MaintenanceWindow,
  PublicServiceStatus,
  PublicStatusDocument,
  ServiceOverride,
} from '../models/types';
import {
  activeMaintenance,
  activeOverrides,
  assessFreshness,
  TRANSPORT_LAG_ALLOWANCE_SECONDS,
  deriveOverall,
  displayStateFor,
  openIncidents,
  recentlyResolvedIncidents,
  resolveRows,
  upcomingMaintenance,
  type RowState,
  type ServiceRow,
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

function override(changes: Partial<ServiceOverride> = {}): ServiceOverride {
  return {
    serviceKey: 'reporting',
    state: 'Outage',
    setAt: '2026-08-11T11:00:00Z',
    expiresAt: '2026-08-11T19:00:00Z',
    ...changes,
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

  it('widens the threshold by the transport lag the delivery path can add', () => {
    // The published tolerance is 300s, but raw.githubusercontent.com can serve content 300s old
    // regardless, so the page tolerates 600s. Without this a healthy platform would intermittently
    // warn, since a 120s heartbeat plus 300s of CDN lag exceeds 300s on its own.
    const freshness = assessFreshness(statusDocument('2026-08-11T11:53:00Z'), NOW);

    expect(freshness.thresholdSeconds).toBe(300 + TRANSPORT_LAG_ALLOWANCE_SECONDS);
    expect(freshness.ageSeconds).toBe(420);
    expect(freshness.isStale).toBe(false);
  });

  it('treats a document past the widened tolerance as stale', () => {
    const freshness = assessFreshness(statusDocument('2026-08-11T11:40:00Z'), NOW);

    expect(freshness.ageSeconds).toBe(1200);
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
    expect(displayStateFor(service, [window()], [], false)).toBe('UnderMaintenance');
  });

  it('leaves an uncovered service on its published state', () => {
    const elsewhere = window({ affectedServiceKeys: ['imaging'] });

    expect(displayStateFor(service, [elsewhere], [], false)).toBe('Operational');
  });

  it('shows maintenance even when the service is also unhealthy', () => {
    const down: PublicServiceStatus = { ...service, state: 'Outage' };

    expect(displayStateFor(down, [window()], [], false)).toBe('UnderMaintenance');
  });

  it('falls back to unknown when the document is stale', () => {
    expect(displayStateFor(service, [], [], true)).toBe('Unknown');
  });

  it('applies an operator override over published health', () => {
    expect(displayStateFor(service, [], [override()], false)).toBe('Outage');
  });

  it('applies an override even when the document is stale, which is the point of it', () => {
    expect(displayStateFor(service, [], [override()], true)).toBe('Outage');
  });

  it('lets an override outrank an open maintenance window', () => {
    expect(displayStateFor(service, [window()], [override()], false)).toBe('Outage');
  });

  it('ignores an override aimed at a different service', () => {
    const elsewhere = override({ serviceKey: 'imaging' });

    expect(displayStateFor(service, [], [elsewhere], false)).toBe('Operational');
  });
});

describe('activeOverrides', () => {
  it('keeps an unexpired override', () => {
    expect(activeOverrides([override()], NOW)).toHaveLength(1);
  });

  it('drops an expired override so a forgotten one heals itself', () => {
    const stale = override({ expiresAt: '2026-08-11T11:00:00Z' });

    expect(activeOverrides([stale], NOW)).toHaveLength(0);
  });

  it('treats the expiry instant as already past', () => {
    const ending = override({ expiresAt: '2026-08-11T12:00:00Z' });

    expect(activeOverrides([ending], NOW)).toHaveLength(0);
  });

  it('drops an override with an unparseable expiry rather than applying it forever', () => {
    const malformed = override({ expiresAt: 'not-a-date' });

    expect(activeOverrides([malformed], NOW)).toHaveLength(0);
  });

  it('prefers the most recently asserted override when a key repeats', () => {
    const older = override({ setAt: '2026-08-11T10:00:00Z', state: 'Degraded' });
    const newer = override({ setAt: '2026-08-11T11:30:00Z', state: 'Outage' });

    expect(activeOverrides([older, newer], NOW)[0]?.state).toBe('Outage');
  });
});

describe('an open incident implies its services state', () => {
  const service: PublicServiceStatus = {
    key: 'imaging',
    label: 'Imaging',
    state: 'Operational',
  };

  const affecting = (impact: Incident['impact']) =>
    incident({ impact, affectedServiceKeys: ['imaging'] });

  it('shows a service as degraded while a minor incident names it', () => {
    // The bug this fixes: an incident about Imaging alongside an Imaging row reading Operational,
    // which tells a client two opposite things at once.
    expect(displayStateFor(service, [], [], false, [affecting('Minor')])).toBe('Degraded');
  });

  it.each([
    ['Major' as const, 'Outage'],
    ['Critical' as const, 'Outage'],
  ])('shows a service as outage for %s impact', (impact, expected) => {
    expect(displayStateFor(service, [], [], false, [affecting(impact)])).toBe(expected);
  });

  it('leaves the state alone for an informational incident', () => {
    expect(displayStateFor(service, [], [], false, [affecting('None')])).toBe('Operational');
  });

  it('never downgrades a worse live state', () => {
    // A Minor incident filed against a service Nexus can see is down must not move the page from
    // Outage to Degraded. Severity is a floor, not a replacement.
    const down: PublicServiceStatus = { ...service, state: 'Outage' };

    expect(displayStateFor(down, [], [], false, [affecting('Minor')])).toBe('Outage');
  });

  it('speaks for a service whose health is unknown', () => {
    expect(displayStateFor(service, [], [], true, [affecting('Major')])).toBe('Outage');
  });

  it('outranks an open maintenance window', () => {
    expect(
      displayStateFor(service, [window({ affectedServiceKeys: ['imaging'] })], [], false, [
        affecting('Major'),
      ]),
    ).toBe('Outage');
  });

  it('yields to an explicit operator override', () => {
    const overrides = [override({ serviceKey: 'imaging', state: 'Operational' })];

    expect(displayStateFor(service, [], overrides, false, [affecting('Major')])).toBe(
      'Operational',
    );
  });

  it('ignores an incident naming a different service', () => {
    const elsewhere = incident({ impact: 'Major', affectedServiceKeys: ['reporting'] });

    expect(displayStateFor(service, [], [], false, [elsewhere])).toBe('Operational');
  });

  it('takes the worst when several incidents name one service', () => {
    const both = [affecting('Minor'), affecting('Critical')];

    expect(displayStateFor(service, [], [], false, both)).toBe('Outage');
  });

  it('reverts once the incident is resolved, with nothing to clean up', () => {
    // openIncidents() filters resolved ones out, so an empty list is what a resolved incident
    // produces. No expiry to manage and no override left behind.
    expect(displayStateFor(service, [], [], false, [])).toBe('Operational');
  });
});

describe('deriveOverall', () => {
  const row = (key: string, state: RowState): ServiceRow => ({
    service: { key, label: key, state: 'Operational' },
    state,
  });

  it('reports all operational only when every row is operational', () => {
    expect(deriveOverall([row('a', 'Operational'), row('b', 'Operational')])).toBe(
      'AllOperational',
    );
  });

  it('refuses an all-clear while any row is unknown', () => {
    expect(deriveOverall([row('a', 'Operational'), row('b', 'Unknown')])).toBeNull();
  });

  it('reports degraded when something is impaired', () => {
    expect(deriveOverall([row('a', 'Operational'), row('b', 'Degraded')])).toBe('Degraded');
  });

  it('reports a partial outage when some rows are down', () => {
    expect(deriveOverall([row('a', 'Outage'), row('b', 'Operational')])).toBe('PartialOutage');
  });

  it('reports a major outage only when every row is down', () => {
    expect(deriveOverall([row('a', 'Outage'), row('b', 'Outage')])).toBe('MajorOutage');
  });

  it('lets an outage outrank an unknown row, since a known outage is still information', () => {
    expect(deriveOverall([row('a', 'Outage'), row('b', 'Unknown')])).toBe('PartialOutage');
  });

  it('treats maintenance rows as neutral rather than as problems', () => {
    expect(deriveOverall([row('a', 'Operational'), row('b', 'UnderMaintenance')])).toBe(
      'AllOperational',
    );
  });

  it('cannot say anything with no rows at all', () => {
    expect(deriveOverall([])).toBeNull();
  });
});

describe('resolveRows', () => {
  it('resolves each service once, in the order given', () => {
    const services: PublicServiceStatus[] = [
      { key: 'imaging', label: 'Imaging', state: 'Operational' },
      { key: 'reporting', label: 'Reporting', state: 'Degraded' },
    ];

    const rows = resolveRows(services, [], [override({ serviceKey: 'imaging' })], false);

    expect(rows.map((r) => [r.service.key, r.state])).toEqual([
      ['imaging', 'Outage'],
      ['reporting', 'Degraded'],
    ]);
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
