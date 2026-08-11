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
  /**
   * The headline state, derived by the caller from the resolved rows rather than read from the
   * published document. Null means "cannot say", which covers no readable document, a stale one,
   * and a mix where some rows are unknown. Claiming an all-clear in any of those cases would assert
   * more than the page actually knows.
   */
  overall: PublicOverallState | null;
  subtitle: string;
}

export function OverallHero({ overall, subtitle }: OverallHeroProps) {
  // An overall value this bundle does not recognize is treated the same as none at all, so a feed
  // that gains a state resolves to "unavailable" rather than to a blank headline.
  const known = overall === null ? undefined : HEADLINES.get(overall);
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
      <div className="hero__top">
        <StatusIcon state={iconState} size={26} />
        <h2 className="hero__headline">{headline}</h2>
      </div>
      <p className="hero__sub">{subtitle}</p>
    </section>
  );
}
