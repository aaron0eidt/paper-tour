# Plan

**Pitch:** NotebookLM made papers something you can listen to. Paper Tour makes them something you can watch. A voice
walks you through a paper while the PDF moves along with it: it scrolls, highlights the sentence being discussed, zooms
into a figure and boxes the part that matters. You can interrupt, ask about what's on screen, and it answers by pointing
too.

## The 90-second demo

Everything is built around this sequence.

1. Drop in a paper. About 45 seconds later the tour is ready, with chapters and a chosen length (3, 7 or 15 minutes).
2. Press play. "The key idea is this one sentence" lights the sentence up; "now look at Figure 2" zooms in, boxes panel
   (b), and a note says "the y-axis is log scale".
3. Interrupt by voice: "Wait, why does the loss spike there?" It stops, answers with the paper as context, highlights
   the paragraph that explains it, and asks whether to carry on.
4. Draw a box over any part of a figure and ask "what is this?" The crop goes to the vision model.

Step 2 is the moment judges remember; step 4 is the follow-up surprise.

## Design rule: the model picks IDs, never pixels

Models are bad at bounding boxes. Ingestion gives every sentence, block, figure, panel and equation an ID with exact
coordinates (`doc.json`); tours and answers refer only to IDs, and the player looks the coordinates up. To point inside
a figure, draw a labeled grid or the detected panels onto the crop and let the model pick a label (set-of-marks); the
result is stored as a `region` normalized to the target's bbox. Stretch: SAM 3, which segments from text prompts like
"the red curve".

## Architecture

```
PDF ─▶ ingest (PyMuPDF) ─▶ doc.json: IDs + bboxes + figure crops
                                │
                                ▼
                   tour writer (LLM + vision) ─▶ tour.json ─▶ TTS per step
                                                     │
         player: pdf.js + SVG overlay + camera ◀─────┘
                 ▲ ▼
         voice agent: STT → LLM with the paper + current step → TTS, can emit the same actions
```

## Stack

Built: ingestion (PyMuPDF), the player (Vite, React, pdf.js), the library app (Node API and worker, Supabase storage)
and tour generation with Meta's Muse model. Narration still uses browser voices. The rest depends on what the hackathon
provides and requires.

| Layer | Candidates |
|---|---|
| LLM + vision | Muse is built in and selectable under Profile & Settings; Llama 4 Maverick (Llama API, Groq or Together) as an alternative |
| TTS | Cartesia or ElevenLabs (word timestamps, several voices for podcast mode); Kokoro as an open fallback |
| STT | Whisper large-v3-turbo on Groq, or Deepgram |
| Voice loop | Pipecat or LiveKit Agents (voice activity detection and barge-in built in) |
| Harder layouts | Docling, if PyMuPDF heuristics fail on uploaded papers |

Figure explanations get much better when the model sees the high-res crop, the caption, and the sentences that cite the
figure (`referenced_by` in `doc.json`).

Full duplex isn't needed: barge-in (stop narration when the user speaks, answer, resume) gives most of the feel. Build
push-to-talk first.

## Scope

**MVP, must work in the demo:**
- Upload a paper, or pick one of three pre-cached ones. *(Uploads done in the library app; one demo paper so far.)*
- The generated tour: narration, auto-scroll, sentence highlights, figure zooms with boxes and notes, chapter timeline.
  *(Done: Muse tours.)*
- Interrupting with a question, then resuming.
- Draw a box and ask.

**Stretch, in priority order:**
1. Two-voice podcast mode (host plus expert; the tour format already has speakers).
2. Depth slider: intro, grad, expert.
3. Barge-in instead of push-to-talk.
4. SAM 3 regions inside figures.
5. Cross-language tours.
6. A short quiz at the end.
7. Export the tour as a video.

## Timeline for about 30 build hours

Scale to the real length.

| Hours | Work |
|---|---|
| 0–2 | Repo, schemas, three demo papers *(done)* |
| 2–10 | Ingestion on the demo papers; player running a hand-written tour *(done)* |
| 10–18 | LLM tour writer *(done, Muse)*; TTS with word timestamps; sync at step level |
| 18–26 | Voice Q&A with the current step as context; draw a box and ask |
| 26–32 | Podcast mode, camera polish, a real live upload |
| Last 4–6 | Feature freeze, cache demo tours, record a backup video, rehearse |

**Team split:** (A) ingestion and the doc model; (B) player and overlays; (C) LLM prompts and the voice pipeline;
(D) demo papers, design, pitch, testing.

## Risks

| Risk | Mitigation |
|---|---|
| Messy layouts (two columns, math) | Tune ingestion on the demo papers and pre-compute them; see the review findings |
| Wrong coordinates from the model | IDs only, plus set-of-marks |
| Slow answers | Stream LLM output into TTS sentence by sentence; whole paper in context; a short filler line |
| Audio and visuals drift apart | Sync at step boundaries; word-level sync only when the TTS gives timestamps |
| Wi-Fi or an API fails live | Cached tours and a recorded backup video |

## Open questions

The hackathon's length, team size, required or provided Meta models and credits, and judging criteria. Settle these
before choosing the LLM and TTS stack.
