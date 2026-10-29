# Live demo runbook (written 2026-10-29)

The plan for the Nov 9 live final, and for any other live demo. The rule behind it: **the demo must not be able to
fail.** Everything that matters is prepared, and every live part has a fallback that takes under ten seconds. Quality
targets and the rubric are in [HACKATHON-PLAN.md](HACKATHON-PLAN.md); how the app runs is in [HANDOFF.md](HANDOFF.md).
The slot length is not known yet, so the order below has a 5-minute version and a 3-minute cut.

## The documents, and why these four

All four are played from `demo/<folder>/` with `http://localhost:5174/?paper=<folder>`. Their tours come from the
pipeline (standard preset), as an upload would get them.

| Folder | What | Why it is in the demo | Play only |
|---|---|---|---|
| `attention-short` | *Attention Is All You Need* | Everyone knows it, so judges can judge the explanation. Six board kinds in 11 steps: heatmap, plot, scatter, shapes, bars, formula | steps 1 to 3, then step 5 (the shapes board), then the end card |
| `eval-fish` | A fresh robot-fish paper, with photographs | Proves it works on a paper nobody prepared a template for. Its Figure 3 has a clean photo of the fish for the SAM snap | step 1, then the page with Figure 3 |
| `eval-sheet-de` | A German linear-algebra sheet | Coach mode: the tour stops and lets you try first, then solves line by line on the board, each line checked in code, narrated in German | steps 1 to 4: overview, task, try-first, first solution step |
| `eval-slides` | Lecture slides on KNN and regression | A different mode: slide by slide in a filmstrip, with a worked example on the board. Only a teaser | step 2 (the worked example) |

Playing a tour in full takes 3.5 to 6 minutes, so a live demo never does. Each tour step takes 15 to 30 seconds. One
blemish to keep in mind: the German sheet's chapter titles carry a stray diaeresis from the PDF text ("L¨ose"), so do
not open its chapter list on screen.

## What is live and what is not

| Part | State | Needs |
|---|---|---|
| PDFs, `doc.json`, tours, boards, pen marks, the camera | Local files, play with no key and no network | the web app on 5174 |
| Narration | The browser's speech synthesis. Chrome prefers Google voices, which **need the network** | a voice, or Mute for timed captions |
| The three suggested questions of each tour | **Saved** in `demo/<folder>/answers.json` by `demo:prepare`, played with no model call by `demo:offline` | the saved file |
| Any other question, "Not clear?" | Live Muse Spark, 7 to 40 seconds (3 measured: 7, 11 and 41 s) | network and key |
| Region snap | Live SAM 3.1, about 2.5 s. When it fails the learner's rectangle stays | network and key |
| Voice question | Live Muse Voice Transcribe, 2 to 3 s | network, key, microphone |
| A new upload | Live: the pipeline takes 1 to 2 minutes (the first steps can play before it ends) | network, key, Supabase, worker |

Say which is which. A saved answer is the real model output from earlier; it is not faked, and it is not live.

## The order (5 minutes, with the 3-minute cut marked)

1. **0:00, the hook** (`attention-short`, loaded and not playing, no chat box in view). Say: "This is not a chat with a
   PDF. It reads the real page with you." Click **Start tour** (or Play). Steps 1 to 3 play: the sentence lights as the
   voice reaches it, a heatmap and a plot build on the board, then the pen outlines the exact part of a figure. Say:
   "The model chooses IDs. Code draws, and checks every number against the document."
2. **1:10, the shapes board.** While step 4 starts, press `→` to land on step 5. Say: "Matrix shapes: the code refuses a
   board whose inner dimensions do not match."
3. **1:35, a question that costs nothing.** Press `End`, then Space (the tour plays its last step and ends). While it
   plays, the reader fetches the three suggested questions. On the end card, under "Keep exploring", a green dot marks
   each one that is ready (a second or two in way 2 below; in way 1 it can take a minute). Click the second one. The
   answer plays at once as a short tour that points and draws, with **Pause answer** and **Back to the tour**. Say:
   "Answers are tours too, not paragraphs."
4. **2:15, a fresh paper and SAM** (`?paper=eval-fish`). Click **Start tour** (or Play), let step 1 play, then pause
   with Space. Go to page 2 (the page box in the toolbar): Figure 3, bottom right, is the white photo of the robot.
   Click **Select a region** (the button beside the question field) and drag loosely around the photo, not exactly. Its
   outline snaps in about 2.5 s. Say: "SAM 3.1 turned my loose drag into the object." Hold the microphone button and ask
   "What is this part for?". Release, check the text, press Ask. A live answer takes 10 to 40 seconds: fill it with what
   the models are doing ("Spark reads the crop and the page"), or give up at 25 s and use the fallback below.
5. **3:30, a German sheet explained for a learner** (`?paper=eval-sheet-de`). Click **Start tour** (or Play). After the
   task, the tour stops: "Versuche zuerst...". Press `H` for a hint, then **Show solution**: the line-by-line solution
   builds on the board. Say: "The tour is in the sheet's language, and every line of the solution is checked numerically
   in code." For an English answer, open the answer-language picker beside the question field.
6. **4:30, slides, a teaser** (`?paper=eval-slides`). Step 2 only. Say: "Slides play slide by slide."
7. **4:45, under the hood, 15 seconds.** Say the numbers from `node scripts/scorecard.mjs` (ten documents, all 378 IDs
   the tours point at exist, the checks sent back 15 drafts, no tour failed). Close with one sentence: a tutor that
   reads the real page with you, and not a chat.

The 3-minute cut: part 1 up to step 2, then 3, 4 and 5 (stop at the solution). Drop 2, 6 and the numbers in 7.

Pick the region before the day: **the white photo of the robot in Figure 3 (page 2) snaps** (confidence 0.81, 2.6 s in a
test through the demo route). A drag over the translucent CAD drawing in the same figure, or over a whole pool photo in
Figure 7, does not: SAM answers "invalid_response" and the reader quietly keeps the rectangle. If the snap fails on the
day, go on and ask anyway.

## Three ways to run it

**1. Live, everything on** (the default): `npm run dev`. Saved answers are not used, but they exist.

**2. Answers first, the recommended way for the final.** The saved questions never wait for a model and never fail; any
other question is still live. Three terminals (and a fourth with the worker if you will upload):

```bash
PORT=3002 npm --prefix server run start                  # the live API, on another port
npm run demo:offline -- --forward http://127.0.0.1:3002  # answers from file first, the rest to the live API
npm run dev:demo                                         # the reader, which proxies /api to 3001
```

**3. No network at all.** Needs no Supabase, no API and no key:

```bash
npm run dev:demo
npm run demo:offline
```

Then only the saved questions work. A question that is not saved gets "Offline: only the prepared questions can be
answered", a region keeps your rectangle, voice says it is off, and "Not clear?" fails. The tours, boards, pen marks and
the page all work. Chrome's Google voices do not: choose a local one under **Audio settings, Narration voice** (on this
Mac: 45 English and 9 German local voices), or press Mute for timed captions.

## If something fails

These fallbacks assume way 2 or 3. In way 1 a suggested question is fast only while the API still holds its answer in
its 30-minute store.

| What you see | Do this |
|---|---|
| An answer is slow (after 25 s) | Keep talking. Press Esc to stop it and click a suggested question: in way 2 or 3 it is saved, so it plays at once |
| A red message under the ask bar | Click a suggested question. Switch to way 2 or 3 at the next break |
| The venue network dies | In way 2 there is nothing to switch: saved questions keep playing and the rest say the live API did not answer. In way 1: `Ctrl-C` the API, run `npm run demo:offline`, reload the page (about ten seconds) |
| Silence | Press Mute and run the tour with captions (or add `&silent=1` to the URL), or pick another voice under Audio settings |
| The voice question fails | Type it: press `/` and type. Say voice is optional |
| No outline after the drag | Carry on, ask anyway. Next time drag over the robot photo only |
| A page will not load | Reload the URL. The four URLs are in the bookmarks bar |
| The whole machine is lost | The backup video (see below), on a second device |

## Before the demo

The PDFs, `doc.json`, tours and `answers.json` under `demo/` are not committed (the PDFs are not ours to host). Do all
of this on the machine that will run the demo, or copy `demo/` there and run `npm run preflight` on it.

Do the numbered steps once, after the code freeze (Nov 2, noon). Prepared answers should come from the final pipeline,
so run `demo:prepare --force` again after any change to how answers are written.

1. `npm run supabase:start` (with Colima: `mkdir -p .data/tmp && TMPDIR=$PWD/.data/tmp npm run supabase:start`), then
   `npm run dev`.
2. `npm run demo:prepare` (about 2 minutes for twelve answers, 5 to 40 seconds each; a few tenths of a dollar at most).
   It checks the four folders, runs `ingest/validate.py` on every tour, asks each suggested question and saves the
   answers. It exits non-zero if any question has no usable answer.
3. `npm run preflight`, until it says READY with no warning. If you will run way 2, also run `npm run preflight -- --api
   http://127.0.0.1:3002` to check the live API behind it. If you will run way 3, run `npm run preflight -- --offline`
   with `demo:offline` up.
4. Record the backup video: the whole order above, with voice, on the demo machine. Keep it on a second device.

An hour before, and again ten minutes before:

- [ ] `npm run preflight` says READY. It checks the key (never printing it), the API, the web app, the demo route, Muse
      Spark, SAM 3.1, Muse Voice Transcribe, every demo folder (PDF, `doc.json`, `tour.json`, validation, served by the
      web app, saved answers) and the speech note. It takes about 3 seconds and costs under one cent.
- [ ] Listen to the speech: open `?paper=attention-short`, click Start tour, then `?paper=eval-sheet-de`. English and
      German voices both work. Check the output device.
- [ ] Chrome has microphone permission for `localhost:5174`, and the right input device.
- [ ] Rehearse the region snap and a spoken question once on `?paper=eval-fish`.
- [ ] The four URLs are open in one window, in the order of the demo, browser zoom 100%, notifications off, the machine
      on power and awake (`caffeinate -dimsu`), a phone hotspot ready as a second network.
- [ ] A judge may upload their own PDF: start with `TOUR_PRESET=quick npm run dev` for about 6 steps, and let the first
      step play while the rest is written. If it fails, go back to the prepared folders.

## Commands

| Command | What it does |
|---|---|
| `npm run preflight -- [folders] [--offline] [--skip-models] [--strict] [--json] [--api URL] [--web URL]` | The check above. One PASS, WARN, FAIL, SKIP or NOTE line per item; exits 1 when a must-have fails. `--strict` also fails on warnings. `--offline` needs no key and calls no model, and requires every saved answer |
| `npm run demo:prepare -- [folders] [--regenerate] [--preset quick\|standard\|deep] [--language de-DE] [--no-ask] [--force] [--api URL]` | Checks and validates the folders, asks the suggested questions through the running API and saves `demo/<folder>/answers.json`. `--regenerate` writes a new tour first (1 to 2 minutes and $0.3 to $0.8 a folder; the old tour is kept in `.data/demo-prepare/<folder>/previous/`, and the new one is used only if it validates) |
| `npm run demo:offline -- [--port 3001] [--forward URL]` | The API stand-in that answers from `answers.json`. It takes the API's port, so stop the API first |
| `npm run dev`, `npm run dev:demo` | The whole app, or the reader alone |
| `node scripts/scorecard.mjs demo/<folder>...` | The numbers for the "under the hood" line |

Both scripts default to the four folders above. Neither prints the key. `npm test` runs their tests, which use fake
servers and make no model call.
