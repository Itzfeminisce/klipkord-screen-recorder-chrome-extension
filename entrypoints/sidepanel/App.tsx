import { useEffect, useState, type ComponentType } from 'react';
import { listUnfinished } from '@/lib/db';
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
import Review from './screens/Review';
import ReviewTranscript from './screens/ReviewTranscript';
import ReviewComments from './screens/ReviewComments';
import NoteStyle from './screens/NoteStyle';
import Trim from './screens/Trim';
import Export from './screens/Export';
import Saved from './screens/Saved';
import Library from './screens/Library';
import LibraryEmpty from './screens/LibraryEmpty';
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
  Review,
  ReviewTranscript,
  ReviewComments,
  NoteStyle,
  Trim,
  Export,
  Saved,
  Library,
  LibraryEmpty,
  Storage,
  Settings,
  Recovered,
  Offline,
  StatesRecording,
  StatesSetup,
};

/** First screen: Recovered when an unfinished recording is waiting, otherwise Main. */
export async function initialRoute(): Promise<Route> {
  try {
    const [unfinished] = await listUnfinished();
    if (unfinished) return { screen: 'Recovered', params: { recordingId: unfinished.id } };
  } catch (error) {
    console.error('Klipkord: could not check for unfinished recordings', error);
  }
  return { screen: 'Main', params: {} };
}

function CurrentScreen() {
  const { route } = useRouter();
  const Screen = SCREENS[route.screen];
  return <Screen key={`${route.screen}:${route.params.recordingId ?? ''}`} />;
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
