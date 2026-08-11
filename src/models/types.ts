/**
 * The published feed contract, mirroring the C# records in `Nexus.Contracts/PublicStatus.cs`.
 *
 * Two serialization requirements the publishing side must honor, because both are silent
 * breakages rather than loud ones:
 *
 *  - Enums are STRINGS. System.Text.Json writes enums as numbers by default, so the publisher
 *    must register a JsonStringEnumConverter. A numeric payload still parses as valid JSON and
 *    every state comparison here quietly fails, leaving a page that renders every service as
 *    unrecognized.
 *  - Property names are camelCase, via JsonNamingPolicy.CamelCase. The C# default is PascalCase,
 *    which would leave every field on this side undefined.
 *
 * `schemaVersion` is the guard for the case these types drift from the C# side: a published page
 * is cached in browsers nobody controls, so an old bundle will eventually read a new document.
 */

/** The current schema this bundle understands. A document declaring anything else is not rendered. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** Per-service health as published. Deliberately coarser than the internal five-state model. */
export type PublicServiceState = 'Operational' | 'Degraded' | 'Outage';

/** The whole-platform indicator, derived from the service states by the publisher. */
export type PublicOverallState = 'AllOperational' | 'Degraded' | 'PartialOutage' | 'MajorOutage';

/** How far an incident reaches. A human judgement, independent of the machine-read state. */
export type IncidentImpact = 'None' | 'Minor' | 'Major' | 'Critical';

/** Where an incident sits in its lifecycle. */
export type IncidentStatus = 'Investigating' | 'Identified' | 'Monitoring' | 'Resolved';

/** One published service row. */
export interface PublicServiceStatus {
  /** Stable identity referenced by incidents and maintenance windows. Survives a label change. */
  key: string;
  /** Display text as clients see it. */
  label: string;
  state: PublicServiceState;
}

/** The machine-written half of the feed, republished on change plus a heartbeat. */
export interface PublicStatusDocument {
  schemaVersion: number;
  /** ISO 8601. The staleness signal: if publishing stops, this stops advancing. */
  generatedAt: string;
  /** How old `generatedAt` may get before these states must stop being presented as current. */
  staleAfterSeconds: number;
  overall: PublicOverallState;
  services: PublicServiceStatus[];
}

/** One posting on an incident timeline. Append-only upstream. */
export interface IncidentUpdate {
  /** ISO 8601. */
  postedAt: string;
  status: IncidentStatus;
  body: string;
}

/** An operator-authored incident. */
export interface Incident {
  id: string;
  title: string;
  impact: IncidentImpact;
  status: IncidentStatus;
  affectedServiceKeys: string[];
  /** ISO 8601. */
  startedAt: string;
  /** ISO 8601, or null while the incident is open. */
  resolvedAt: string | null;
  updates: IncidentUpdate[];
}

/**
 * A planned maintenance window. Carries its own start and end rather than an "in maintenance"
 * flag, so this page is correct at the boundary instants without anything being republished.
 */
export interface MaintenanceWindow {
  id: string;
  title: string;
  body: string;
  affectedServiceKeys: string[];
  /** ISO 8601, inclusive. */
  startsAt: string;
  /** ISO 8601, exclusive. */
  endsAt: string;
}

/** The human-authored half of the feed, written far less often than the status document. */
export interface IncidentDocument {
  schemaVersion: number;
  generatedAt: string;
  incidents: Incident[];
  maintenance: MaintenanceWindow[];
}

/**
 * What a service row actually displays, after maintenance is overlaid on published health.
 * `UnderMaintenance` exists only here and never in the feed: it is a presentation state derived
 * from window times at render time, not something the publisher can know in advance.
 */
export type DisplayState = PublicServiceState | 'UnderMaintenance';
