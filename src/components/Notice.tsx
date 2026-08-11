/** A banner for something the reader needs to know about the page itself, not about a service. */
import type { ReactNode } from 'react';

export type NoticeTone = 'warning' | 'error' | 'info';

const ACCENTS = new Map<NoticeTone, string>([
  ['warning', '--status-warning'],
  ['error', '--status-outage'],
  ['info', '--status-maintenance'],
]);

interface NoticeProps {
  tone: NoticeTone;
  title: string;
  children: ReactNode;
}

export function Notice({ tone, title, children }: NoticeProps) {
  return (
    <div
      className="notice"
      style={{ ['--notice-accent' as string]: `var(${ACCENTS.get(tone) ?? '--status-degraded'})` }}
      role="status"
    >
      <div>
        <p className="notice__title">{title}</p>
        <p className="notice__body">{children}</p>
      </div>
    </div>
  );
}
