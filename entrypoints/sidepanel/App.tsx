import { useEffect, useState, type ComponentType } from 'react';
import { listRecordings, listUnfinished } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { isFirstRun } from '@/lib/setup';
import { Spinner } from './components';
import { RouterProvider, useRouter, type Route, type ScreenName } from './router';
import Main from './screens/Main';
import Permissions from './screens/Permissions';
import Setup from './screens/Setup';
import ModelDownload from './screens/ModelDownload';
import PenvConnect from './screens/PenvConnect';
import PasteKey from './screens/PasteKey';
import PenvConnected from './screens/PenvConnected';
import Home from './screens/Home';
import Countdown from './screens/Countdown';
import Recording from './screens/Recording';
import Paused from './screens/Paused';
import Processing from './screens/Processing';
import Overlay from './screens/Overlay';
import ReviewTabs, { isReviewTab } from './screens/ReviewTabs';
import NoteStyle from './screens/NoteStyle';
import Trim from './screens/Trim';
import EditTranscript from './screens/EditTranscript';
import Cleanup from './screens/Cleanup';
import Export from './screens/Export';
import GifClip from './screens/GifClip';
import Saved from './screens/Saved';
import Library from './screens/Library';
import LibraryEmpty from './screens/LibraryEmpty';
import LibrarySearch from './screens/LibrarySearch';
import Storage from './screens/Storage';
import Settings from './screens/Settings';
import Recovered from './screens/Recovered';
import Offline from './screens/Offline';
import StatesRecording from './screens/StatesRecording';
import StatesSetup from './screens/StatesSetup';

export const SCREENS: Record<ScreenName, ComponentType> = {
  Main,
  Permissions,
  Setup,
  ModelDownload,
  PenvConnect,
  PasteKey,
  PenvConnected,
  Home,
  Countdown,
  Recording,
  Paused,
  Processing,
  Overlay,
  Review: ReviewTabs,
  ReviewTranscript: ReviewTabs,
  ReviewComments: ReviewTabs,
  ReviewAsk: ReviewTabs,
  NoteStyle,
  Trim,
  EditTranscript,
  Cleanup,
  Export,
  GifClip,
  Saved,
  Library,
  LibraryEmpty,
  LibrarySearch,
  Storage,
  Settings,
  Recovered,
  Offline,
  StatesRecording,
  StatesSetup,
};

/** First screen: Recovered when an unfinished recording is waiting, Main (welcome) on first run, otherwise Home. */
export async function initialRoute(): Promise<Route> {
  try {
    const [unfinished] = await listUnfinished();
    if (unfinished) return { screen: 'Recovered', params: { recordingId: unfinished.id } };
  } catch (error) {
    console.error('Klipkord: could not check for unfinished recordings', error);
  }
  try {
    const [settings, recordings] = await Promise.all([getSettings(), listRecordings()]);
    if (!isFirstRun(settings, recordings.length)) return { screen: 'Home', params: {} };
  } catch (error) {
    console.error('Klipkord: could not check for first run', error);
  }
  return { screen: 'Main', params: {} };
}

function CurrentScreen() {
  const { route } = useRouter();
  const Screen = SCREENS[route.screen];
  // One key for the Review tabs, so the player stays mounted between them.
  const name = isReviewTab(route.screen) ? 'Review' : route.screen;
  return <Screen key={`${name}:${route.params.recordingId ?? ''}`} />;
}

export default function App() {
  const [initial, setInitial] = useState<Route | null>(null);
  useEffect(() => {
    void initialRoute().then(setInitial);
  }, []);

  if (!initial) {
    return (
      <main className="screen screen-center">
        <Spinner />
      </main>
    );
  }
  return (
    <RouterProvider initial={initial}>
      <CurrentScreen />
    </RouterProvider>
  );
}
