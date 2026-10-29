# Chrome Web Store listing

Build the zip with `npm run zip` (needs `WXT_EXTENSION_KEY`). The file is `.output/klipkord-<version>-chrome.zip`. Raise `version` in `package.json` for every upload.

## Listing text
- **Name:** Klipkord
- **Short description (132 characters max):** Record your screen while you talk. Get a transcript, summary, notes and chapters, all on your computer.
- **Long description:**
  Klipkord records your screen and your voice, then writes it up for you.

  - Record a screen, window or tab, with computer sound and an optional camera bubble.
  - Add markers while you record, and pause when you need to.
  - A live transcript shows while you talk, and a better one replaces it after you stop.
  - Get a summary, notes and chapters shaped to the recording: how-to guide, bug report, team update or meeting.
  - Jump to any moment from the transcript, trim the video and add comments.
  - Recording, the video, the library, playback and trimming stay on your computer. No account, no server, no upload.
  - Transcription and notes run on your computer where it allows (on-device Whisper, Chrome's built-in AI, Ollama).
  - Optional: use Groq for speed and quality, with a key from Penv Cloud (https://penv.cloud) or your own.
  - Open source.
- **Category:** Productivity. **Language:** English.
- **Privacy policy URL:** the public URL of `docs/privacy.md`.

## Single purpose
Record the screen and turn the spoken words into a transcript, summary and notes.

## Permission justifications
- `sidePanel`: shows Klipkord beside the page.
- `offscreen`: keeps recording and transcribing while the panel is closed.
- `desktopCapture`: lets the user choose the screen, window or tab to record.
- `storage`: keeps settings and recordings on the user's computer.
- `unlimitedStorage`: screen videos are large.
- `identity`: signs in to Penv Cloud to fetch the user's keys.
- `activeTab`: after a keyboard shortcut, acts on the tab the user is on.
- `scripting`: draws a small marker toast in that tab.
- Host access (`huggingface.co`, `*.hf.co`): downloads the Whisper models.
- Optional host access (`penv.cloud`, Groq, OpenRouter, OpenAI, Anthropic, `localhost:11434`): asked only when the user turns that feature on; sends text or audio only to the service the user picked.
- Remote code: none is loaded. Models are data files.
- Data use: disclose audio and transcript text, sent only to the cloud AI the user turns on; none sold; none used for unrelated purposes.

## Assets to prepare
- Icons: `public/icon/` (16, 32, 48, 128).
- Screenshots 1280x800, at least one: recording, review with transcript, library.
- Small promo tile 440x280.
