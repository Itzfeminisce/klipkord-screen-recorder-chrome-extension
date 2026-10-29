import type { ReviewContext } from '../components/Player';
import NotesBody from '../components/NotesBody';

export const notesTab = ({ rec, seek }: ReviewContext) => <NotesBody recordingId={rec.id} onSeek={seek} />;
