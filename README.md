# Klipkord

Klipkord is a Chrome side-panel extension that records your screen while you talk.
It turns your words into a transcript, a summary, notes and chapters you can jump through.
Think of it as a private, local Loom with Rekord's notes built in.

## What Klipkord does

- Record your screen, with your voice, computer sound and an optional camera bubble.
- Pause, resume and add markers while you record.
- Get a live transcript while you talk and a better one after you stop.
- Get a summary, notes and chapters that fit the kind of recording: how-to guide, bug report, team update or meeting.
- Play the recording back and jump to any moment from the transcript.
- Trim and cut a recording, and add comments.
- Keep recordings in a library, and save them to a folder you choose.
- Export a video file when you want to share it.

## Install

You need Chrome with the side panel.

From a release zip:

1. Download the zip from the GitHub releases page and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder.

From source (needs Node.js and npm):

```bash
npm install
npm run build
```

Then load `.output/chrome-mv3` with **Load unpacked**.

## First run

1. Click the Klipkord icon to open the side panel.
2. Follow the setup. Klipkord checks your computer and picks an AI option for you.
3. Press Record and choose a screen, window or tab to share.
4. Press Record again to stop. The review opens when the notes are ready.

## Keyboard shortcuts

- `Alt+Shift+R`: start or stop recording.
- `Alt+Shift+P`: pause or resume.
- `Alt+Shift+M`: add a marker.

You can change them at `chrome://extensions/shortcuts`.

## AI options

- **On this computer** (default where your hardware allows): Whisper tiny transcribes live, and Whisper base re-transcribes after you stop.
- **Chrome's built-in AI**: writes notes on this computer when the machine supports it.
- **Ollama**: writes notes with a model running on your own computer.
- **Groq**: faster and better, and opt-in. Use "Connect Penv Cloud" to fetch a key, or paste your own key.

## Privacy

Nothing leaves your computer unless you switch it on.
There is no account, no analytics and no telemetry.

| Data | Where it stays | What can leave, and when |
| --- | --- | --- |
| Screen video and camera video | Your computer (browser storage, then your folder) | Nothing. Leaves only inside a video file you export or share yourself. |
| Your voice and computer sound | Your computer | Voice audio chunks go to Groq or another provider only if you turn on cloud AI. |
| Transcript, notes, markers, comments | Your computer | Transcript text goes to the cloud AI you chose, only if you turn it on. |
| Keys | `chrome.storage.session`, cleared when Chrome closes | Fetched from Penv Cloud after "Connect Penv Cloud", or pasted. Never printed, logged or committed. |
| Shared copy (later) | Your Google Drive | Only the one video you choose to share. |

The first time on-device Whisper runs, Chrome downloads its model files from Hugging Face.
The full policy is in [docs/privacy.md](docs/privacy.md).

## Development

```bash
npm run dev        # build and reload the extension while you edit
npm run compile    # type-check
npm test           # unit tests (vitest)
npm run build      # build to .output/chrome-mv3
npm run zip        # store-ready zip in .output/
```

- The manifest carries Klipkord's public key, so the extension id is always `iapgbifdchhmidblniddncnagghloepi`. Google Drive uses Klipkord's OAuth client by default; `WXT_GOOGLE_CLIENT_ID` overrides it.
  It fixes the extension ID, and so the Penv Cloud redirect URL. Plain builds work without it.
- The release zip leaves out the developer machine check. See [CHECK.md](CHECK.md).
- `node scripts/make-icons.mjs` rewrites the icons in `public/icon/`.
- Store listing text is in [STORE.md](STORE.md).

## Plans and specs

Plans, specs, handoffs and design frames live in the specs repo:
https://github.com/Itzfeminisce/productivity-apps-engineering-specs/tree/main/apps/klipkord

Klipkord is open source.
