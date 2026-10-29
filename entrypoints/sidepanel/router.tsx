import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/** One screen per FRAMES.md frame, named as the frame. */
export type ScreenName =
  | 'Main'
  | 'Permissions'
  | 'Setup'
  | 'ModelDownload'
  | 'PenvConnect'
  | 'PasteKey'
  | 'PenvConnected'
  | 'Home'
  | 'Countdown'
  | 'Recording'
  | 'Paused'
  | 'Processing'
  | 'Review'
  | 'ReviewTranscript'
  | 'ReviewComments'
  | 'ReviewAsk'
  | 'NoteStyle'
  | 'Trim'
  | 'EditTranscript'
  | 'Cleanup'
  | 'Export'
  | 'GifClip'
  | 'Saved'
  | 'Library'
  | 'LibraryEmpty'
  | 'LibrarySearch'
  | 'Storage'
  | 'Settings'
  | 'Recovered'
  | 'Offline';

/** `recordingId` for recording screens; `atMs` to open the player at a time. */
export interface RouteParams { recordingId?: string; atMs?: number }
export interface Route { screen: ScreenName; params: RouteParams }

export interface Router {
  route: Route;
  /** Go to a screen, pushing the current one onto the back stack. */
  navigate: (screen: ScreenName, params?: RouteParams) => void;
  /** Go to a screen and clear the back stack (e.g. after first run). */
  replace: (screen: ScreenName, params?: RouteParams) => void;
  back: () => void;
  canGoBack: boolean;
}

const RouterContext = createContext<Router | null>(null);

export function RouterProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([initial]);
  const navigate = useCallback((screen: ScreenName, params: RouteParams = {}) => setStack((s) => [...s, { screen, params }]), []);
  const replace = useCallback((screen: ScreenName, params: RouteParams = {}) => setStack([{ screen, params }]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const value = useMemo<Router>(
    () => ({ route: stack[stack.length - 1] ?? initial, navigate, replace, back, canGoBack: stack.length > 1 }),
    [stack, initial, navigate, replace, back],
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): Router {
  const router = useContext(RouterContext);
  if (!router) throw new Error('useRouter must be used inside RouterProvider');
  return router;
}
