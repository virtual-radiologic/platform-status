/** The per-service rows, with maintenance already overlaid onto published health. */
import type { MaintenanceWindow, PublicServiceStatus } from '../models/types';
import { displayStateFor } from '../utils/derive';
import { describeState, StatusIcon, type IconState } from './StatusIcon';

interface ServiceListProps {
  services: PublicServiceStatus[];
  openWindows: MaintenanceWindow[];
  /**
   * When the document is stale, every row is shown as unknown rather than as its last published
   * value. Showing a definite state from a document that stopped updating would present a guess
   * with the same confidence as a fact.
   */
  isStale: boolean;
}

export function ServiceList({ services, openWindows, isStale }: ServiceListProps) {
  if (services.length === 0) {
    return <p className="empty">No services are currently published.</p>;
  }

  return (
    <ul className="services">
      {services.map((service) => {
        const state: IconState = isStale ? 'Unknown' : displayStateFor(service, openWindows);
        const descriptor = describeState(state);

        return (
          <li className="services__row" key={service.key}>
            <span className="services__label">{service.label}</span>
            <span
              className={isStale ? 'state state--muted' : 'state'}
              style={{ ['--state-text' as string]: `var(${descriptor.textColorVariable})` }}
            >
              <StatusIcon state={state} />
              {descriptor.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
