import { markInterrupted } from '@/lib/db';
import { commandMessage, send } from '@/lib/messages';

export default defineBackground(() => {
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Klipkord: could not set side panel behaviour', error));

  browser.commands.onCommand.addListener((command) => {
    const msg = commandMessage(command);
    if (msg) void send(msg);
  });

  // A browser restart ends any capture, so whatever was live is now unfinished (Recovered offers it).
  browser.runtime.onStartup.addListener(() => {
    markInterrupted().catch((error) => console.error('Klipkord: could not mark interrupted recordings', error));
  });
});
