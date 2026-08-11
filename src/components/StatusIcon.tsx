/**
 * State presentation: the words, the color, and a distinct icon SHAPE per state.
 *
 * The shapes matter. Color alone is not a signal a red-green colorblind reader can use, and this
 * page is read under pressure on whatever screen is to hand. Every state is therefore carried by
 * an icon silhouette plus a text label, with color as reinforcement only. The icons are
 * aria-hidden because the adjacent text already says the same thing, and announcing both makes
 * every row read twice.
 */
import type { DisplayState } from '../models/types';

export type IconState = DisplayState | 'Unknown';

interface StateDescriptor {
  label: string;
  colorVariable: string;
  textColorVariable: string;
}

const UNKNOWN_DESCRIPTOR: StateDescriptor = {
  label: 'Status unknown',
  colorVariable: '--status-unknown',
  textColorVariable: '--status-unknown-text',
};

// A Map rather than an object keyed by state: `security/detect-object-injection` flags computed
// member access, and that rule is never suppressed here, so lookups go through Map.get instead.
const DESCRIPTORS = new Map<IconState, StateDescriptor>([
  [
    'Operational',
    {
      label: 'Operational',
      colorVariable: '--status-operational',
      textColorVariable: '--status-operational-text',
    },
  ],
  [
    'Degraded',
    {
      label: 'Degraded performance',
      colorVariable: '--status-degraded',
      textColorVariable: '--status-degraded-text',
    },
  ],
  [
    'Outage',
    {
      label: 'Outage',
      colorVariable: '--status-outage',
      textColorVariable: '--status-outage-text',
    },
  ],
  [
    'UnderMaintenance',
    {
      label: 'Under maintenance',
      colorVariable: '--status-maintenance',
      textColorVariable: '--status-maintenance-text',
    },
  ],
  ['Unknown', UNKNOWN_DESCRIPTOR],
]);

/**
 * The words, color variable, and text color variable for a state. An unrecognized state falls
 * back to unknown, which is the safe direction: a state this bundle does not understand must not
 * render as though it were healthy.
 */
export function describeState(state: IconState): StateDescriptor {
  return DESCRIPTORS.get(state) ?? UNKNOWN_DESCRIPTOR;
}

interface StatusIconProps {
  state: IconState;
  size?: number;
}

/** The state's icon: a distinct silhouette per state, filled with the state color. */
export function StatusIcon({ state, size = 16 }: StatusIconProps) {
  const fill = `var(${describeState(state).colorVariable})`;
  const shared = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true,
    focusable: false,
    className: 'state__icon',
  } as const;

  if (state === 'Operational') {
    return (
      <svg {...shared}>
        <circle cx="8" cy="8" r="7" fill={fill} />
        <path
          d="M4.8 8.3l2 2 4.4-4.6"
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (state === 'Degraded') {
    return (
      <svg {...shared}>
        <path d="M8 1.2l6.6 12.2H1.4L8 1.2z" fill={fill} />
        <path d="M8 5.8v3.1" stroke="#ffffff" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="8" cy="11.4" r="0.95" fill="#ffffff" />
      </svg>
    );
  }

  if (state === 'Outage') {
    return (
      <svg {...shared}>
        <path d="M5.4 1h5.2L15 5.4v5.2L10.6 15H5.4L1 10.6V5.4L5.4 1z" fill={fill} />
        <path
          d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"
          stroke="#ffffff"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (state === 'UnderMaintenance') {
    return (
      <svg {...shared}>
        <circle cx="8" cy="8" r="7" fill={fill} />
        <path
          d="M8 4.4V8l2.4 1.6"
          stroke="#ffffff"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg {...shared}>
      <circle cx="8" cy="8" r="6.4" stroke={fill} strokeWidth="1.7" strokeDasharray="2.6 2.2" />
      <path
        d="M6.3 6.1a1.75 1.75 0 013.4.6c0 1.2-1.7 1.35-1.7 2.5"
        stroke={fill}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.5" r="0.95" fill={fill} />
    </svg>
  );
}
