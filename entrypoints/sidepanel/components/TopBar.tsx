import type { ReactNode } from 'react';

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="3" stroke="#FFFFFF" strokeWidth="2" />
        <circle cx="12" cy="12" r="3" fill="#C2410C" />
      </svg>
    </span>
  );
}

/** Brand on the left, anything (step count, actions) on the right. */
export function TopBar({ right }: { right?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        Klipkord
      </div>
      {right && <div className="topbar-right">{right}</div>}
    </header>
  );
}
