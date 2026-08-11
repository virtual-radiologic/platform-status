/** The per-service rows, rendered from states already resolved by the caller. */
import type { ServiceRow } from '../utils/derive';
import { describeState, StatusIcon } from './StatusIcon';

interface ServiceListProps {
  /**
   * Rows with their states already resolved (override, then maintenance, then published health,
   * then unknown). Resolved once by the caller so these rows and the headline above them are
   * guaranteed to agree.
   */
  rows: ServiceRow[];
}

export function ServiceList({ rows }: ServiceListProps) {
  if (rows.length === 0) {
    return <p className="empty">No services are currently published.</p>;
  }

  return (
    <ul className="services">
      {rows.map(({ service, state }) => {
        const descriptor = describeState(state);
        const muted = state === 'Unknown';

        return (
          <li className="services__row" key={service.key}>
            <span className="services__label">{service.label}</span>
            <span
              className={muted ? 'state state--muted' : 'state'}
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
