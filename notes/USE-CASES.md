# Use cases

Where Paper Tour is worth taking beyond research papers and exercise sheets, and in what order. The product is in
[PLAN.md](PLAN.md), the model harness in [HARNESS.md](HARNESS.md).

## Summary

A tour helps wherever a reader has to find, understand and act on specific parts of a document. We looked at about 35
candidates in education, work, everyday life, accessibility and specialist fields, merged them into 22 use cases and
scored each one. The three to build next are **course packs** (slides, scripts and past exams, linked to the exercise
sheets), **contracts and leases** with a "what changed" mode, and **life admin**: letters, bills and payslips from a
phone photo, explained in the reader's language. The pitch teasers are **a letter, in your language** and **examine
me**, where the tutor questions an author about their own thesis. Other tools summarise beside the document or turn it
into new media; a tour keeps the original page as the canvas and marks the exact clause, number or symbol it talks
about. The next three need tours across documents, photo ingestion, new board templates (timeline, waterfall, diff)
and safety and privacy rules per preset. After that, most of the list is presets of one engine. Code, spreadsheets and
live web apps need their own surface and are separate, later products.

## How we ranked

Each use case gets 1 to 3 points on five criteria. The total, out of 15, orders the P2 and P3 rows; ties go to the
one that is cheaper to build. The score is a guide, not the decision: the next three are also chosen for what
they add to the engine for the rest of the list.

| Criterion | 3 points | 1 point |
|---|---|---|
| Reach | Tens of millions meet it every year: students, tenants, employees | A small profession or hobby |
| Pay | Businesses or professionals pay for this help today | People expect it for free |
| Demo | Understood in ten seconds, and it uses the pointer, the pen and the board | Looks like the paper demo, or is hard to show |
| Fit | Today's PDF ingestion and board templates cover most of it | Needs a new input surface or player |
| Safety | Own, public or teaching documents | Regulated advice (legal, medical, financial) or sensitive personal data |

## Ranked use cases

**P1** is what we recommend next, in the order we would build it. **P2** follows once the engine has presets. **P3**
needs a new surface, a partner or a regulatory path. Scores read reach-pay-demo-fit-safety.

| Use case | Who | What the tour does | What is new | Risk | Priority |
|---|---|---|---|---|---|
| **Course packs:** slides, scripts, past exams | University students; lecturers who publish tours | From exercise 2b, jumps to slide 23 and boxes the condition the student forgot. "Explain slide 14 again" zooms into the diagram and builds its formula on the board. | Captionless images as targets; tours across documents; past exams matched to slides | Low; sharing needs the lecturer | **P1**, 13 (3-2-2-3-3) |
| **Contracts and leases**, with "what changed"; also terms of service, insurance | Tenants, employees, freelancers, policyholders | Plots the stepped rent in clause 4.2 as bars over three years, puts the notice period on a timeline, boxes the repairs clause. For a renewal: strikes the old wording, marks the new, shows the cost difference. | Clause IDs; defined terms linked to their uses; timeline and diff templates; version alignment | Legal advice framing; personal data | **P1**, 13 (3-2-3-3-2) |
| **Life admin:** letters, bills, payslips | Everyone; most of all newcomers, people with low literacy, older people | Answers in Ukrainian while circling the deadline on a photographed German tax letter and boxing the amount. On a utility bill, builds "your share = total × your m² ÷ all m²", recomputed by code. | Photo ingestion with OCR; table cells; waterfall template; derived numbers; bilingual tours; redaction | Privacy; tax and legal advice framing; misread numbers | **P1**, 12 (3-2-3-2-2) |
| **Examine me:** theses, drafts, talks | Students before a defence; researchers before submission | Highlights the claim in section 4.2, asks what supports it, listens to the answer, then points at Table 3 and says whether it does. | A mode on the paper engine: examiner questions, answer judging | Low; unpublished work goes to the model API | **Teaser**, 13 (2-2-3-3-3) |
| School texts and homework | Pupils; parents who help | Colours a poem's rhyme scheme and marks its metaphors, with ABAB built on the board. On a maths worksheet, shows the method the class uses so a parent can help. | "Explain like I am 12" style | Minors' data; school data agreements | P2, 12 (3-2-2-3-2) |
| Law study: statutes and cases | Law students | Numbers the elements of § 823 (1) BGB, then checks each against the case on the board, like a derivation. | § / Absatz / Satz IDs from the official XML; reasoning as derivation steps | Low; statutes are public | P2, 12 (2-2-2-3-3) |
| Policies, onboarding, compliance | HR and compliance teams; new staff | Tours the AI-use policy with two checkpoints (the EU AI Act has required AI literacy since February 2025), shows the rest "what changed in v3", records who finished. | Completion records; version diff | Low; documents stay internal | P2, 12 (2-3-1-3-3) |
| Manuals and datasheets | Device owners; engineers; support teams | "Where is the descaling valve?": circles part 7 on the exploded drawing and highlights step 4. On a datasheet: circles the pin and its table row. | Numbered callouts linked to the text; SAM outlines the part | Low | P2, 12 (2-2-3-2-3) |
| Language learning | Learners; international students | Reads a short Spanish text, points at each new word, builds the verb form on the board. | Word-level targets; grammar on the board | Low | P2, 12 (3-2-2-2-3) |
| Patient leaflets | Patients, carers, pharmacies | Highlights the adult dose, shows "common: up to 1 in 10 people" as an icon array, marks what to do after a missed dose. | Icon-array and number-line templates | Medical framing, kept to the approved text | P2, 11 (3-1-2-3-2) |
| Annual reports | Retail investors, journalists, finance students | Points at the five numbers that matter, animates revenue and margin over three years, boxes the main risk. | Chart parts through SAM; derived numbers | Investment advice framing | P2, 11 (2-2-2-3-2) |
| Textbook chapters | Pupils and students; publishers | A concept tour of one chapter with checkpoints, limited to what the exam needs. | Chapter selection; tours as overlays on the reader's own copy | Publisher rights | P2, 11 (3-2-2-2-2) |
| Forms, fill-along | Applicants for benefits, permits, visas | Field by field: what goes here, why, and where to find it on the reader's payslip. It never fills anything in. | Form fields as IDs; pointing across documents | Personal data | P2, 11 (3-2-2-2-2) |
| Patents | Engineers, patent attorneys | Maps each element of claim 1 to its reference numeral in the drawings. | Callout detection, shared with manuals | Low | P3, 11 (1-3-2-2-3) |
| Code and pull requests | Developers, reviewers | Walks a pull request in reading order and animates the request path before and after on the flow board. | Lines and symbols as IDs; a code viewer | Private code goes to the model API | P3, own product, 11 (2-3-3-1-2) |
| Spreadsheets and models | Analysts; whoever inherits a model | Builds the formula in C12 term by term and draws arrows from its inputs across the grid. | Cells as IDs; a grid viewer | Confidential data | P3, own product, 11 (2-3-3-1-2) |
| Web pages and product tours | Anyone online; software companies | Tours an article or help page in a browser extension; on a web app it is a generated product tour. | DOM elements as IDs; live pages | Pages change under the tour | P3, own product, 11 (3-3-2-1-2) |
| Medical education | Medical students | Circles the ST elevation on an ECG strip; labels an anatomy plate. | SAM on medical images; expert review | Image rights; must stay educational | P3, 11 (2-3-3-1-2) |
| Licence exams | Driving and boating learners | "Who goes first?": numbers the vehicles in order and names the rule. | Image-first targets with SAM | Rights to the official question sets | P3, 11 (3-2-3-1-2) |
| Lecture recordings | Students | "Explain minute 23 again": seeks the video, shows the slide, highlights what was said. | Timestamps as IDs; video sync | Recording rights | P3, 10 (3-2-2-1-2) |
| Medical letters and lab results | Patients | Puts each lab value on a number line against its reference range; ends with questions for the doctor. | Number-line template; clinician review | May be a medical device under the EU MDR; health data | P3, only with clinics as publishers, 9 (3-1-2-2-1) |
| Image-first: plans, maps, scores, art, rulebooks | Home buyers, musicians, museum visitors, hobbyists | Circles the building envelope on a zoning plan; marks the modulation in bar 17; walks a board game's first turn. | Legend symbols and regions as IDs; MusicXML | Image rights; planning advice | P3, 9 (2-1-3-1-2) |

**Parked:** party manifestos side by side (hard to stay neutral), red flags in scam letters (missing one gives false
reassurance), tender documents and grant calls (small reach; the contract preset covers most of it), board packs
(confidential and sold top-down).

## What exists, and how a tour differs

| Tool | What it does | How a tour differs |
|---|---|---|
| [NotebookLM](https://blog.google/technology/google-labs/notebooklm-video-overviews-studio-upgrades/) | Audio Overviews and, since July 2025, Video Overviews: narrated slides made from your sources | New media about the document. A tour stays on the page and marks what it talks about. |
| [Learn Your Way](https://learnyourway.withgoogle.com) (Google Labs) | Turns a textbook chapter into narrated slides, audio lessons, quizzes and mind maps; better recall than a PDF reader in Google's randomised study ([paper](https://arxiv.org/abs/2509.13348)) | Evidence that guided formats beat plain reading. It replaces the page; a tour keeps it. |
| [Acrobat AI Assistant](https://news.adobe.com/news/2025/08/acrobat-studio-delivers-new-ai-powered-home-for-productivity-creativity), [ChatPDF](https://www.chatpdf.com), [SciSpace](https://typeset.io/resources/introducing-copilot-ai-assistant-explains-research-papers/), [Explainpaper](https://www.explainpaper.com) | Chat about a PDF, or highlight a passage to have it explained. Acrobat's citations jump to the source, and it makes podcasts. | The reader drives and must know where to look. A tour leads, reads in order and draws on the page. |
| [Semantic Reader](https://openreader.semanticscholar.org/) (AI2: ScholarPhi, [Paper Plain](https://arxiv.org/abs/2203.00130)) | Definitions and plain-language guides in place; in user studies, readers answered faster or found papers easier | The closest research to explaining in place. No voice, pen or board. |
| [ChatGPT Study Mode](https://openai.com/index/chatgpt-study-mode/), [Gemini Guided Learning](https://techcrunch.com/2025/08/06/google-takes-on-chatgpts-study-mode-with-new-guided-learning-tool-in-gemini/), [Khanmigo](https://www.khanmigo.ai) | Socratic tutoring in a chat; Khanmigo costs learners $4 a month | The sheet is not the canvas. Our tutor marks the givens on the sheet itself. |
| [Docusign Iris](https://www.docusign.com/company/news-center/docusigns-new-ai-translates-legalese-and-does-your-contract-busywork), [ToS;DR](https://tosdr.org) | Since January 2026, an AI summary and key terms for signers; ToS;DR rates terms of service by hand | Confirms the contract case. A summary cannot show where a number comes from. |
| [Gemini Live](https://blog.google/products/gemini/gemini-live-updates-august-2025/) | Highlights objects in the camera view while it talks (August 2025) | Pointing while talking is becoming expected, but on a live camera, not on documents with stable IDs. |
| [CodeTour](https://github.com/microsoft/codetour), [CodeRabbit](https://docs.coderabbit.ai/pr-reviews/walkthroughs) | Code tours stored in the repository; pull request walkthroughs with sequence diagrams | Tours and diagrams already help with code. A tour adds voice, order and questions. |
| [WalkMe](https://news.sap.com/2024/06/sap-enters-agreement-to-acquire-walkme/) | Guided tours of software interfaces; SAP agreed to buy it for about $1.5 billion in 2024 | The same idea for documents: point at the element, explain it, move on. |

Each part exists somewhere. We found no tool that combines all four: the original page as the canvas, pointing at
exact elements, a pen and a board, and spoken questions whose answers point too.

## The next three

We do not simply take the top of the table. Examine me scores high, but it is a mode of the paper engine, so it becomes
a teaser. Life admin beats the other 12-point rows because it adds photo input and bilingual tours, which nine other
rows can use, from paper leases to leaflets, manuals and forms.

### 1. Course packs: slides, scripts and past exams

- **Why:** the students who use exercise sheets also have slides, a script and past exams, and the hard part is
  connecting them. Exported slides are PDFs with a text layer, so ingestion barely changes.
- **The moment:** stuck on exercise 2b, the student asks "why can I swap the sums here?". The tour opens slide 23,
  boxes the theorem's condition, returns to the sheet and circles where the task meets it.
- **Build:** captionless images as targets (already planned for tour@0.2); tours across several documents with
  document-prefixed IDs; a course card (topics, definitions, theorems, and where sheets and exams use them); an exam
  mode that orders topics by how often past exams ask about them.
- **Risks:** low. Private study is fine; a shared tour needs the lecturer, who is also the best channel for it.
- **Pay:** student subscriptions first (Khanmigo charges $4 a month), departments later.

### 2. Contracts and leases, with "what changed"

- **Why:** everyone signs, few read, and the facts that matter are spread across clauses and cross-references.
  Docusign's new signer summaries confirm the need, but a summary cannot show where a number comes from.
- **The moment:** "three things before you sign". The stepped rent in clause 4.2 becomes bars over three years, the
  notice period becomes a timeline, and the repairs clause is boxed. For a renewal, old and new sit side by side with
  struck and inserted text and the cost difference.
- **Build:** clause IDs from the numbering (§ 4, 4.2, (a)); defined terms linked to their uses with the planned
  `connect` action; a contract card (parties, term, money, deadlines, obligations, termination, unusual terms);
  timeline and diff templates; version alignment by sentence.
- **Framing:** explain what the text says and point at it. Never judge validity or recommend signing; end with
  questions to ask the other side or an adviser. The FTC's 2025 order against DoNotPay
  ([FTC](https://www.ftc.gov/news-events/news/press-releases/2025/02/ftc-finalizes-order-donotpay-prohibits-deceptive-ai-lawyer-claims-imposes-monetary-relief-requires))
  shows what happens to "robot lawyer" claims. In Germany the BGH allowed the Smartlaw contract generator because it
  does not act in a concrete individual case
  ([LTO](https://www.lto.de/recht/juristen/b/bgh-urteil-izr11320-vertragsgenerator-smartlaw-keine-unzulaessige-rechtsdienstleistung-rak-hamburg-rdg-legal-tech)).
  An assessment of the reader's own contract is the line not to cross, and a lawyer should check our wording before
  launch.
- **Pay:** consumers rarely pay per contract. Landlords, HR departments, e-signature and property platforms, and legal
  insurers could attach tours to their documents.

### 3. Life admin: letters, bills and payslips, from a photo, in your language

- **Why:** the largest unmet need. 6.2 million adults in Germany read and write at a low level
  ([LEO 2018](https://www.uni-hamburg.de/newsroom/presse/2019/pm26.html)), and many more read German as a second
  language. Help today comes from family, social workers and volunteers; at [Was hab' ich?](https://washabich.de)
  medical students translate findings by hand. Pointing matters most here: to act, the reader has to find the deadline
  and the reference number on the original.
- **The moment:** a photo of a letter, a question in Ukrainian, and an answer in Ukrainian that circles the deadline on
  the German page. On a utility bill, the board builds the reader's share from the building's total and the code
  recomputes it. On a payslip, a waterfall runs from gross to net.
- **Build:** photo ingestion (perspective fix, then OCR words with boxes into the same blocks and sentences; today
  ingestion only warns that OCR is not available); table cells; a letter card (sender, what they want, by when, how
  much, what happens if you do nothing, references); waterfall and timeline templates; derived numbers; bilingual
  tours; redaction of IBANs, tax IDs and names before any model call.
- **Risks:** privacy first: tax, social and health data, and Meta's API terms for them. Advice framing second: explain
  and recompute, but do not assess. Whether a utility charge is allowed is what legal service providers such as Mineko
  sell for €49–89 ([Finanztip](https://www.finanztip.de/presse/nebenkostenabrechnung-fehler-koennen-mieter-hunderte-euro-kosten/)),
  so that is a partner, not a feature. Third, misread numbers: show the crop, read every number twice, and never say a
  number that is not visible.
- **Pay:** individuals pay little; institutions do. Since January 2026 Berlin has given all its offices an AI tool that
  rewrites letters in plain language
  ([Berlin](https://www.berlin.de/rbmskzl/aktuelles/pressemitteilungen/2026/pressemitteilung.1636820.php)), legal
  insurers cover utility-bill checks, and senders could attach a tour to their standard letters. Distribution could
  run through WhatsApp: send a photo, get a link to the tour.

## Pitch teasers

The demo in PLAN.md ends with one teaser, a rental contract. We suggest two that show more range, about 15 seconds
each. Both questions are spoken, so both use Muse Voice Transcribe.

1. **"A letter, in your language."** A phone photo of a German letter that we write ourselves, so there are no rights
   or privacy issues. The user asks in Ukrainian. The answer, in Ukrainian, circles the deadline, boxes the amount and
   shows the next steps on a timeline, all on the German original.
   - **Why:** it moves the story from researchers to everyone, it shows why pointing beats a summary (you act on the
     original), and it previews the third build.
   - **Fallback:** the PDF of the same letter if OCR is not ready. Check that a Ukrainian browser voice exists on the
     demo machine.
2. **"Examine me."** The tutor opens a thesis chapter, highlights a claim and asks what supports it. The author
   answers aloud; the tutor points at the table that does, or does not.
   - **Why:** it turns the tutor around, needs no new ingestion, and speaks to every student and researcher in the
     room. It also suggests a paid mode: preparing for a defence or a review.
   - **Swap:** for a jury of non-academics, show "what changed in your lease" instead, with struck and inserted text
     and the cost difference as bars.

## Input kinds beyond PDFs

A tour never contains coordinates, so a new input needs only stable IDs and a way to turn them into geometry.

| Input | IDs | Ingestion work | Effort | Opens |
|---|---|---|---|---|
| Slides (PDF export, PPTX) | page, shape, image region, speaker note | Captionless image regions; shapes and notes from PPTX | Small | Course packs |
| Scans, phone photos, handwriting | page, block, line, word; grid region for handwriting | Perspective fix, OCR words with boxes (Tesseract through PyMuPDF), then today's sentence builder; handwriting read by vision on a set-of-marks grid | Medium | Letters, printed sheets, a student's written solution |
| PDF forms | field | Form widgets (name, type, rectangle) from PyMuPDF | Small | Fill-along |
| Tables in bills and reports | table, row, column, cell | PyMuPDF table detection; numbers parsed with units | Medium | Life admin, reports, datasheets |
| Drawings, maps, plans, dashboards | callout, legend entry, part, chart panel | OCR for numerals and legends; SAM or set-of-marks for parts and panels; chart values checked against a data export when there is one | Medium | Manuals, patents, zoning plans, dashboards |
| Statutes and e-books (XML, EPUB) | §, Absatz, Satz; chapter, paragraph | Read the structure directly | Small | Law study, textbooks |
| Web pages | DOM element | IDs injected into the main content; an extension | Medium, new surface | Articles, help pages, product tours |
| Video and recordings | transcript turn with time, slide frame | Timing from Muse Voice Transcribe; slide frames | Medium | Lecture recordings |
| Code and spreadsheets | line range, symbol, diff hunk; cell, range | A parser such as tree-sitter; formulas parsed into terms | Large, new surface | Code tours, model reviews |
| Sheet music | measure, staff, note | MusicXML directly; PDF scores need music recognition | Large | Music theory |

## Modes beyond the overview tour

Tutor checkpoints and the end-of-tour quiz are already planned. These modes build on them.

| Mode | What happens | Best for | Builds on |
|---|---|---|---|
| Examine me | The tutor asks about the reader's own document, listens, and points at what does or does not support the answer | Theses, drafts, talks, grant proposals | Ask, checkpoints, an answer judge |
| What changed | Old and new side by side, struck and inserted text, the difference in numbers on the board | Leases, terms, policies, laws, paper versions | Sentence alignment, a diff template |
| Compare two documents | One question answered in both, side by side | Two phone or energy offers, two insurance policies | Tours across documents |
| Fill-along | Field by field: what goes here, and where to find it on the reader's other documents | Forms and applications | Form fields, tours across documents |
| Bilingual | Narration in the learner's language; quotes stay in the original; a glossary on the board | Newcomers, international students, language learners | The tour language |
| Explain like I am 12 | Simpler words, more analogies, a slower pace; plain-language style for letters; an illustration from Muse Image for the analogy, never for data | School, low literacy | The existing `level` field (intro, grad, expert) |
| Audio-first | Every pen action is also said aloud, and figures are described in words | Blind and low-vision readers; listening on the move | Figure cards |
| Onboarding and compliance | A short tour with checkpoints and a record of who finished | Companies | Checkpoints, reporting |
| Publisher mode | The author or sender reviews, edits and shares the tour | Lecturers, landlords, clinics, authors | An editor, sharing, `doc_sha256` |

## What the engine needs to generalise

**One engine with presets.** A preset is data and prompts, not a fork of the code. It names the ingestion extras it
turns on (exercises, clauses, form fields, callouts, table cells), the card for stage A (paper, course, contract,
letter), its beat recipes, the actions and board templates it may use, its safety rules (claims it may make, phrases
it may not use, the closing card) and privacy rules, its language defaults and its evaluation fixtures.

**Engine changes for the next three,** roughly in order:

1. **Tours across documents.** IDs carry a document prefix (`slides:page14`, `lease-2026:c4.2`), and the player can
   switch documents or show two side by side. Course packs, what changed, compare and fill-along all need it.
2. **More element kinds:** clause, cell, field, callout and photo region. Tours stay free of coordinates; each surface
   turns IDs into geometry, as the PDF player does today.
3. **Photo ingestion** into the same blocks and sentences, so everything after ingestion stays the same.
4. **Board templates:** timeline, waterfall, diff, number line, icon array and table focus, next to today's formula,
   flow and bars. The model fills them; the code animates them.
5. **Derived numbers.** Every number on the board is printed in the document or computed by code from printed numbers,
   and the computation is shown. This extends today's rule that numbers must appear in the evidence.
6. **Safety per preset.** In high-stakes presets (contracts, letters, leaflets) the verifier also flags advice
   language ("you should", "this clause is invalid") and runs on Muse Wonder. A flagged step is rewritten once or
   dropped. These documents are short, so the extra cost is small.
7. **Privacy.** Redact identifiers before any model call and restore them in the player, keep no originals by
   default, and say what is sent to Meta, as the README already does for papers.
8. **Tour language separate from document language,** with quotes kept in the original.
9. **Publisher review.** A lecturer, landlord or clinic checks and edits a tour before it is shared. Tours are already
   bound to their document by `doc_sha256`, so we can share a tour and let each reader open their own copy, which also
   answers most rights questions.

**Separate products,** where the surface, the buyer and the compliance work differ. All of them can reuse the harness,
the action vocabulary and the board.

| Candidate | Why separate |
|---|---|
| Code tours | A code viewer, IDE and pull request integration, developer pricing |
| Web and product tours | An extension on live pages, sold to software companies as WalkMe is |
| Spreadsheets | A grid viewer and a formula engine |
| Clinical documents | A regulatory path under the EU MDR, clinical partners |
| Company training at scale | The tours are a preset, but selling them needs learning-platform export, single sign-on, audit records and long sales cycles |

## Open questions

- Who pays first: students, lecturers and universities, or senders who attach tours to their documents (landlords,
  insurers, public offices)?
- What do Meta's API terms say about personal documents: retention, training use, region? Life admin depends on the
  answer.
- A short legal check of the contract and letter wording under German law (legal services, tax advice) before any
  public launch.
- Does a local OCR library such as Tesseract count as a non-Meta service under the hackathon rules, or must photos go
  through Muse vision only?
- Are the browser voices for Ukrainian, Arabic and Turkish good enough on the demo machines?
- Should examine me and exam drills grade at all? If an institution uses the grades to evaluate learning, the EU AI
  Act treats the system as high risk. Feedback without grades is safer.
- How do we measure pointing accuracy on photos and forms? We need fixtures with hand-marked answers, as for papers.
- Do lecturers want to publish tours, and what editor would they need?
