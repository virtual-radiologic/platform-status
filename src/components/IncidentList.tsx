/** Incident cards with their update timelines, oldest update first within each card. */
import type { Incident, IncidentImpact, PublicServiceStatus } from '../models/types';
import { absoluteTime, parseInstant, relativeTime } from '../utils/time';

interface ImpactDescriptor {
  colorVariable: string;
  label: string;
}

const UNKNOWN_IMPACT: ImpactDescriptor = {
  colorVariable: '--status-unknown-text',
  label: 'Unknown impact',
};

// Map lookups rather than computed member access, matching StatusIcon: the
// security/detect-object-injection rule is never suppressed in this repo.
const IMPACTS = new Map<IncidentImpact, ImpactDescriptor>([
  ['None', { colorVariable: '--status-maintenance-text', label: 'Informational' }],
  ['Minor', { colorVariable: '--status-degraded-text', label: 'Minor' }],
  ['Major', { colorVariable: '--status-outage-text', label: 'Major' }],
  ['Critical', { colorVariable: '--status-outage-text', label: 'Critical' }],
]);

function describeImpact(impact: IncidentImpact): ImpactDescriptor {
  return IMPACTS.get(impact) ?? UNKNOWN_IMPACT;
}

/**
 * Resolves service keys to their published labels. Falls back to the raw key so an incident
 * naming a service that is no longer published still says something, rather than rendering an
 * empty affected-services line that looks like an incident affecting nothing.
 */
function labelsFor(keys: string[], services: PublicServiceStatus[]): string {
  return keys
    .map((key) => services.find((service) => service.key === key)?.label ?? key)
    .join(', ');
}

function Timestamp({ iso, now }: { iso: string; now: Date }) {
  const instant = parseInstant(iso);
  if (instant === null) {
    return null;
  }

  return (
    <time dateTime={iso} title={absoluteTime(instant)}>
      {relativeTime(instant, now)}
    </time>
  );
}

interface IncidentCardProps {
  incident: Incident;
  services: PublicServiceStatus[];
  now: Date;
}

function IncidentCard({ incident, services, now }: IncidentCardProps) {
  const impact = describeImpact(incident.impact);
  const impactColor = `var(${impact.colorVariable})`;
  const startedAt = parseInstant(incident.startedAt);
  const resolvedAt = parseInstant(incident.resolvedAt);

  return (
    <article className="card" style={{ ['--card-accent' as string]: impactColor }}>
      <div className="card__head">
        <h3 className="card__title">{incident.title}</h3>
        <span className="card__badge" style={{ color: impactColor }}>
          {impact.label}
        </span>
      </div>

      <p className="card__meta">
        {incident.status}
        {startedAt !== null && (
          <>
            {' · started '}
            <Timestamp iso={incident.startedAt} now={now} />
          </>
        )}
        {resolvedAt !== null && incident.resolvedAt !== null && (
          <>
            {' · resolved '}
            <Timestamp iso={incident.resolvedAt} now={now} />
          </>
        )}
      </p>

      {incident.affectedServiceKeys.length > 0 && (
        <p className="card__affected">
          <strong>Affected:</strong> {labelsFor(incident.affectedServiceKeys, services)}
        </p>
      )}

      {incident.updates.length > 0 && (
        <ul className="timeline">
          {[...incident.updates]
            .sort((left, right) => right.postedAt.localeCompare(left.postedAt))
            .map((update) => (
              <li className="timeline__entry" key={`${update.postedAt}-${update.status}`}>
                <div className="timeline__head">
                  <span className="timeline__status">{update.status}</span>
                  <span className="timeline__time">
                    <Timestamp iso={update.postedAt} now={now} />
                  </span>
                </div>
                <p className="timeline__body">{update.body}</p>
              </li>
            ))}
        </ul>
      )}
    </article>
  );
}

interface IncidentListProps {
  incidents: Incident[];
  services: PublicServiceStatus[];
  now: Date;
  emptyMessage: string;
}

export function IncidentList({ incidents, services, now, emptyMessage }: IncidentListProps) {
  if (incidents.length === 0) {
    return <p className="empty">{emptyMessage}</p>;
  }

  return (
    <>
      {incidents.map((incident) => (
        <IncidentCard key={incident.id} incident={incident} services={services} now={now} />
      ))}
    </>
  );
}
