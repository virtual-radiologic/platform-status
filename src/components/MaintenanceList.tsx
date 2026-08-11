/** Maintenance windows, whether currently open or still upcoming. */
import type { MaintenanceWindow, PublicServiceStatus } from '../models/types';
import { absoluteTime, parseInstant, relativeTime } from '../utils/time';

interface MaintenanceListProps {
  windows: MaintenanceWindow[];
  services: PublicServiceStatus[];
  now: Date;
  emptyMessage: string;
}

function labelsFor(keys: string[], services: PublicServiceStatus[]): string {
  return keys
    .map((key) => services.find((service) => service.key === key)?.label ?? key)
    .join(', ');
}

export function MaintenanceList({ windows, services, now, emptyMessage }: MaintenanceListProps) {
  if (windows.length === 0) {
    return <p className="empty">{emptyMessage}</p>;
  }

  return (
    <>
      {windows.map((window) => {
        const startsAt = parseInstant(window.startsAt);
        const endsAt = parseInstant(window.endsAt);
        const isOpen =
          startsAt !== null &&
          endsAt !== null &&
          now.getTime() >= startsAt.getTime() &&
          now.getTime() < endsAt.getTime();

        return (
          <article
            className="card"
            key={window.id}
            style={{ ['--card-accent' as string]: 'var(--status-maintenance)' }}
          >
            <div className="card__head">
              <h3 className="card__title">{window.title}</h3>
              <span className="card__badge" style={{ color: 'var(--status-maintenance-text)' }}>
                {isOpen ? 'In progress' : 'Scheduled'}
              </span>
            </div>

            {startsAt !== null && endsAt !== null && (
              <p className="card__meta">
                <time dateTime={window.startsAt}>{absoluteTime(startsAt)}</time>
                {' to '}
                <time dateTime={window.endsAt}>{absoluteTime(endsAt)}</time>
                {!isOpen && (
                  <>
                    {' '}
                    {'·'} starts {relativeTime(startsAt, now)}
                  </>
                )}
              </p>
            )}

            {window.affectedServiceKeys.length > 0 && (
              <p className="card__affected">
                <strong>Affected:</strong> {labelsFor(window.affectedServiceKeys, services)}
              </p>
            )}

            {window.body && <p className="card__body">{window.body}</p>}
          </article>
        );
      })}
    </>
  );
}
