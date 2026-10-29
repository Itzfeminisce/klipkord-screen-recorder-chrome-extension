import { useRouter } from '../router';
import { BackBar } from './Export';

export default function LibraryEmpty() {
  const { replace } = useRouter();
  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      <BackBar label="Back to recorder" onBack={() => replace('Home')} title="Library" />
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '0 40px', textAlign: 'center' }}>
        <div style={{ position: 'relative', width: 168, height: 112 }} aria-hidden="true">
          <span style={{ position: 'absolute', left: 0, top: 16, width: 120, height: 76, borderRadius: 12, background: '#EBEBEE', transform: 'rotate(-6deg)' }} />
          <span style={{ position: 'absolute', right: 0, top: 8, width: 132, height: 84, borderRadius: 12, background: '#FFFFFF', border: '1px solid #E8E8EB', boxShadow: '0 6px 18px rgba(16,16,20,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#FFF1EA', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ width: 12, height: 12, borderRadius: '50%', background: '#C2410C' }} /></span>
          </span>
        </div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>No recordings yet</h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#5F6168' }}>Everything you record lands here with its notes, ready to watch, trim or save.</p>
        <button type="button" onClick={() => replace('Home')} style={{ marginTop: 8, height: 48, padding: '0 20px', border: 'none', borderRadius: 12, background: '#C2410C', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#FFFFFF' }} />Record your first video
        </button>
      </div>
      <div style={{ margin: '0 24px 24px', padding: 14, borderRadius: 14, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, lineHeight: 1.45, color: '#44464D' }}>
        <span style={{ fontWeight: 600, color: '#111114' }}>Ideas to try</span>
        <span>Walk a teammate through a feature you built.</span>
        <span>Show a bug as it happens, then send the notes.</span>
        <span>Record a two-minute update instead of a meeting.</span>
      </div>
    </main>
  );
}
