import type { ReactNode } from 'react';

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FFFFFF' }} />
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
