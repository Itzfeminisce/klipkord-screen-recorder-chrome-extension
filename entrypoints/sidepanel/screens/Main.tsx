import { BrandMark } from '../components/TopBar';
import { useRouter } from '../router';
import { PrimaryButton } from './Setup';

const POINT_ICON = { width: 32, height: 32, borderRadius: 10, background: '#FFF1EA', color: '#9A3412', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } as const;
const svg = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

function Point({ icon, children }: { icon: React.ReactNode; children: string }) {
  return (
    <li style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span style={POINT_ICON}>{icon}</span>
      <span style={{ fontSize: 14, lineHeight: 1.45, paddingTop: 6 }}>{children}</span>
    </li>
  );
}

export default function Main() {
  const { navigate } = useRouter();

  function openPrivacy() {
    // Settings scrolls to the privacy section when it opens with this hash.
    location.hash = 'privacy';
    navigate('Settings');
  }

  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 24px 0' }}>
        <BrandMark />
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>Klipkord</span>
      </div>

      <div aria-hidden="true" style={{ margin: '24px 24px 0', height: 210, borderRadius: 20, background: '#111114', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 20, top: 20, right: 20, height: 120, borderRadius: 10, background: '#26262B', display: 'flex', flexDirection: 'column', gap: 8, padding: 14, boxSizing: 'border-box' }}>
          <span style={{ width: '60%', height: 8, borderRadius: 4, background: '#3A3A41' }} />
          <span style={{ width: '82%', height: 8, borderRadius: 4, background: '#3A3A41' }} />
          <span style={{ width: '45%', height: 8, borderRadius: 4, background: '#3A3A41' }} />
          <span style={{ marginTop: 6, width: 96, height: 28, borderRadius: 8, background: '#C2410C' }} />
        </div>
        <span style={{ position: 'absolute', right: 28, top: 104, width: 64, height: 64, borderRadius: '50%', background: '#F2C9A8', border: '3px solid #FFFFFF', boxSizing: 'border-box' }} />
        <div style={{ position: 'absolute', left: 20, right: 20, bottom: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="live-badge"><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FFFFFF' }} />REC 02:14</span>
          <span style={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 3, height: 20 }}>
            {[6, 12, 18, 10, 14, 8, 16, 6].map((h, i) => (
              <span key={i} style={{ width: 3, height: h, borderRadius: 2, background: h >= 14 ? '#FFFFFF' : h >= 10 ? '#9A9BA3' : '#6E7079' }} />
            ))}
          </span>
        </div>
      </div>

      <div style={{ padding: '28px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.025em' }}>Record your screen. Keep it on your computer.</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#5F6168' }}>Talk while you record. Klipkord writes the transcript, notes and chapters for you, and nothing leaves your computer unless you say so.</p>
      </div>

      <ul style={{ listStyle: 'none', margin: '22px 24px 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Point icon={<svg {...svg}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>}>Your screen, voice and camera in one video</Point>
        <Point icon={<svg {...svg}><path d="M5 4h14M5 9h14M5 14h9M5 19h6" /></svg>}>Notes shaped to what you recorded: a how-to, a bug report, an update or a meeting</Point>
        <Point icon={<svg {...svg}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></svg>}>No account. Nothing uploaded.</Point>
      </ul>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PrimaryButton onClick={() => navigate('Permissions')}>Get started</PrimaryButton>
        <span style={{ textAlign: 'center', fontSize: 12, color: '#6E7079' }}>
          Free and open source · <a href="#privacy" onClick={(e) => { e.preventDefault(); openPrivacy(); }} style={{ textDecoration: 'none', fontWeight: 500 }}>Where your data goes</a>
        </span>
      </div>
    </main>
  );
}
