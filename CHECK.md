# Klipkord machine check (T0)

A developer page that measures whether this computer can run Klipkord v1: MP4 recording, computer sound,
1080p30 with a camera bubble, live Whisper and Chrome's built-in AI. Whisper models download from Hugging Face
the first time test 4 runs (a few hundred MB for both). Nothing is uploaded; results stay on the page until you copy them.

1. Build it: `npm install` then `npm run build`. The extension is in `.output/chrome-mv3`.
2. In Chrome open `chrome://extensions`, turn on Developer mode, press Load unpacked and pick `.output/chrome-mv3`.
3. On the Klipkord card press Details, then Extension options. The "Klipkord machine check" page opens.
   Press Run on each test in turn and follow the hint under its name. Then press Copy results.

Paste the copied JSON into the project thread. It goes into the Log of `apps/klipkord/v1/HANDOFF.md` in the specs repo.
