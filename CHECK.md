# Klipkord machine check (T0)

A developer page that measures whether this computer can run Klipkord v1: MP4 recording, computer sound,
1080p30 with a camera bubble, live Whisper and Chrome's built-in AI. Whisper models (tiny, base and small, quantized)
download from Hugging Face the first time test 4 runs (a few hundred MB in all). Nothing is uploaded; results stay on the page until you copy them.

1. Build it: `npm install` then `npm run build`. The extension is in `.output/chrome-mv3`.
2. In Chrome open `chrome://extensions`, turn on Developer mode, press Load unpacked and pick `.output/chrome-mv3`.
3. On the Klipkord card press Details, then Extension options. The "Klipkord machine check" page opens.
   Press Run on each test in turn and follow the hint under its name. Stop ends a running test at once;
   Skip whisper-small keeps the tiny and base numbers if small is too slow. Run again (or Run failing tests again)
   repeats a test; the copied results keep every earlier run under `earlier`. Then press Copy results.

Paste the copied JSON into the project thread. It goes into the Log of `apps/klipkord/v1/HANDOFF.md` in the specs repo.

## v2

The "v2 checks" table at the bottom of the same page tests the four risky parts of v2. Rebuild and reload first.

1. Floating bubble: press Open bubble and allow the camera. A round camera window opens. Drag it, click into another
   app, open and close the Klipkord side panel, then record a window and an entire screen with v1 and watch for the
   bubble. Set each answer in the dropdowns. If Open bubble fails or the answers are no, try Open video fallback.
2. Word timings: pick a 60 s speech file (or leave it empty and talk for 60 s), press Run. Note the two
   realTimeFactor numbers next to v1's (tiny 0.29, base 0.49) and whether firstWords' times match the audio.
   The first run downloads whisper-tiny and whisper-base again if the cache was cleared.
3. Draw: press Draw on a test tab (a huggingface.co tab opens with a magenta stroke), come back, press Capture a tab
   and pick that tab. strokeInCapture should be true.
4. GIF: press Run. Note seconds and megabytes.

Press Copy v2 results and paste the JSON into the project thread; it goes into the Log of
`apps/klipkord/v2/HANDOFF.md`, with one line for each of the four answers in this file.
