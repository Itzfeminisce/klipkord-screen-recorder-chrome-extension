import { ReviewShell } from '../components/Player';
import NotesBody from '../components/NotesBody';

export default function Review() {
  return (
    <ReviewShell tab="Review">
      {({ rec, seek }) => <NotesBody recordingId={rec.id} onSeek={seek} />}
    </ReviewShell>
  );
}
