/** The single headline every visitor reads first. */
import type { PublicOverallState } from '../models/types';
import { describeState, StatusIcon, type IconState } from './StatusIcon';

interface Headline {
  headline: string;
  state: IconState;
}

const HEADLINES = new Map<PublicOverallState, Headline>([
  ['AllOperational', { headline: 'All systems operational', state: 'Operational' }],
  ['Degraded', { headline: 'Some systems degraded', state: 'Degraded' }],
  ['PartialOutage', { headline: 'Partial platform outage', state: 'Outage' }],
  ['MajorOutage', { headline: 'Major platform outage', state: 'Outage' }],
]);

interface OverallHeroProps {
  /** Null when no usable document was read, which reads as unknown rather than as healthy. */
  overall: PublicOverallState | null;
  /**
   * True when the document is older than its own tolerance. A stale document's states describe
   * the past, so the headline drops to unknown: continuing to announce "all systems operational"
   * from a document nobody has updated is the single worst thing this page could do.
   */
  isStale: boolean;
  subtitle: string;
}

export function OverallHero({ overall, isStale, subtitle }: OverallHeroProps) {
  // An overall value this bundle does not recognize is treated the same as none at all, so a feed
  // that gains a state resolves to "unavailable" rather than to a blank headline.
  const known = overall === null || isStale ? undefined : HEADLINES.get(overall);
  const iconState: IconState = known?.state ?? 'Unknown';
  const headline = known?.headline ?? 'Current status unavailable';
  const descriptor = describeState(iconState);

  return (
    <section
      className="hero"
      style={{
        ['--hero-accent' as string]: `var(${descriptor.colorVariable})`,
        ['--hero-text' as string]: `var(${descriptor.textColorVariable})`,
      }}
      aria-live="polite"
    >
      <StatusIcon state={iconState} size={26} />
      <div className="hero__text">
        <h2 className="hero__headline">{headline}</h2>
        <p className="hero__sub">{subtitle}</p>
      </div>
    </section>
  );
}
