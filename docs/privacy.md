# Klipkord privacy policy

Klipkord is a Chrome extension that records your screen and turns your words into notes. This page says what stays on your computer, what leaves it, and when.

Nothing leaves your computer unless you switch it on. There is no account, no analytics and no telemetry.

| Data | Where it stays | What can leave, and when |
| --- | --- | --- |
| Screen video and camera video | Your computer (browser storage, then your folder) | Nothing. Leaves only inside a video file you export or share yourself. |
| Your voice and computer sound | Your computer | Voice audio chunks go to Groq or another provider only if you turn on cloud AI. |
| Transcript, notes, markers, comments | Your computer | Transcript text goes to the cloud AI you chose, only if you turn it on. |
| Keys | `chrome.storage.session`, cleared when Chrome closes | Fetched from Penv Cloud after "Connect Penv Cloud", or pasted. Never printed, logged or committed. |
| Shared copy (later) | Your Google Drive | Only the one video you choose to share. |

Each service you turn on handles what it receives under its own privacy policy. Klipkord does not sell or share your data with anyone else.

## Model downloads
The first time on-device Whisper runs, Chrome downloads its model files from Hugging Face (`huggingface.co` and its CDN `hf.co`). No recording data is sent in that request.

## Permissions and why
- `sidePanel`: shows Klipkord beside the page.
- `offscreen`: keeps recording and transcribing while the panel is closed.
- `desktopCapture`: lets you choose the screen, window or tab to record.
- `storage` and `unlimitedStorage`: keep your settings and recordings on your computer. Videos are large.
- `identity`: signs you in to Penv Cloud so your keys can be fetched.
- `activeTab` and `scripting`: after you press a shortcut, show a small marker toast in the tab you are on. Nothing else is read from the page.
- Host access to `huggingface.co` and `*.hf.co`: downloads the Whisper models.
- Optional host access, asked only when you turn the feature on:
  - `penv.cloud`: fetches your keys after "Connect Penv Cloud".
  - `api.groq.com`, `openrouter.ai`, `api.openai.com`, `api.anthropic.com`: the cloud AI you choose.
  - `localhost:11434`: your own Ollama.

## What Klipkord does not do
- No tracking, analytics, advertising or crash reporting.
- No reading of the pages you visit.
- No recording unless you start it.

## Your control
Delete a recording in Klipkord and it is gone from your computer. Turn off cloud AI or disconnect Penv Cloud at any time in Settings. Removing the extension removes its data.

## Questions
Use the contact details on Klipkord's Chrome Web Store page, or open an issue at https://github.com/Itzfeminisce/klipkord-screen-recorder-chrome-extension/issues.

Last updated: 2026-10-29
