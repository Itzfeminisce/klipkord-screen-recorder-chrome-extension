import { useRouter } from '../router';
import NotesBody from '../components/NotesBody';

// T8 replaces this screen and mounts NotesBody in its Notes tab.
export default function Review() {
  const { route } = useRouter();
  return (
    <main className="screen">
      <h1 className="placeholder">Review</h1>
      <NotesBody recordingId={route.params.recordingId} />
    </main>
  );
}
