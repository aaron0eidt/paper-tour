# Ingestion notes for the 13 test documents

What `ingest/ingest.py` produced for each document in `eval/docs/` compared with what the PDF contains. Written for whoever fixes ingestion; no code was changed.
Block ids (`p1.b7`) and values are quoted from `demo/local-doc-<slug>/doc.json`. "Present" is what the `.tex` source prints.
Sections 0 to 3 describe the ingestion before the fixes; section 4 ("After the fixes", 2026-11-04) says what changed per document and what is still wrong, so block ids in sections 1 to 3 no longer match the current `doc.json`.

Reproduce one document: `bash eval/docs/build.sh technical-en`, then read `demo/local-doc-technical-en/doc.json` (`INGEST=0` skips ingestion).

## 0. State of the run

- Written on 2026-11-04 against `ingest/ingest.py` with mtime 00:24:33 (md5 `e1086ddd49a4f26d91ab403b101562f3`). The file was changed by someone else while I was working
  (mtimes 00:13:35 and 00:24:33; `git diff --stat` shows 344 changed lines in `ingest.py`, plus `verify_math.py` and two test files).
- What I saw: documents 1 to 6 were first ingested before 00:13:35, documents 7 to 13 after. At the end I ran `build.sh` for all 13 documents again and compared with the first runs
  (documents 1 to 10: pages, blocks, sentences, sections, figures, tables, equations and the block-type counts; documents 11 to 13: the same counts as printed by `ingest.py`): **identical for every document**,
  i.e. the edits did not change the output for these documents. The only differences between runs come from my own changes to a document, listed here because they change the result:
  1. Table captions added after the first run in four documents (`manual-espresso-en` 2 tables, `datasheet-sensor-en` 2, `technical-en` 2, `policy-en` 1): the captioned tables are then found and
     read row by row (see 2.1), the block count drops (e.g. `datasheet-sensor-en` 144 to 139 blocks and 69 to 49 sentences).
  2. `form-de`: with page 2 in 10 pt, a 3rd page was needed and page 1 got 5 sections; with 9 pt on page 2 (2 pages) the same page 1 gave 7 sections (two fake ones) and different block types (see the form section).
- Documents are 1 to 3 pages, 32 pages in total. 21 data tables (7 with a caption, 14 without; label/value grids such as the policy document control block, the patient block of the lab report and the info bar of the recipe are not counted), 12 drawings or plots (9 with a caption, 3 without), 2 displayed equations.

## 1. Summary

| Document | Pages | Sections found / present | Figures found / present | Tables found / present | Verdict |
|---|---|---|---|---|---|
| `manual-espresso-en` | 3 | 8 / 8 | 0 / 1 (no caption) | 2 / 4 | sections and steps fine; uncaptioned drawing and tables missed, callout numbers loose; one captioned table cut to its header row |
| `datasheet-sensor-en` | 3 | 6 / 8 (2 typed `authors`) | 3 / 3 | 2 / 4 | captioned figures and tables found; first figure bbox swallows the pin table; uncaptioned tables are column blobs |
| `annual-report-en` | 3 | 5 / 6 (first section lost as `authors`) | 1 / 1 | 0 / 3 | text and chart fine; 32 table cells typed `header_footer`, financial tables unusable |
| `article-en` | 2 | 0 / 0 | 1 / 1 | 0 / 0 | page 1 good; page 2 sidebar bullets interleaved with the text; page-2 running header read as text |
| `poem-de` | 1 | 1 box title / 0 (+3 false) | 0 / 0 | 0 / 0 | one sentence per stanza (good), but everything typed `authors`; task list turned into 3 fake sections |
| `story-en` | 2 | 0 / 0 | 0 / 0 | 0 / 0 | good paragraphs and sentences; 7 of 9 margin line numbers merged into sentences |
| `leaflet-de` | 3 | 6 / 6 | 0 / 0 | 0 / 2 | sections 1-6 and the table cells (row order) good; 14 sub-headings and both warning boxes are plain text; title lost as running header |
| `lab-report-en` | 2 | 2 / 2 | 0 / 0 | 0 / 1 | results table (the document) unusable: values, units, ranges and flags in separate column blobs |
| `policy-en` | 3 | 10 / 10 | 0 / 0 | 1 / 2 | best structure result (10 sections, 8 numbered rules); document control block scrambled, version history in column order |
| `form-de` | 2 | 12 / 12 (+2 false) | 0 / 0 (crest) | 0 / 1 | numbered bars and hints found; fields are bare labels, checkboxes vanish, two option labels become sections |
| `textbook-en` | 3 | 6 / 6 (level 3) | 1 / 2 | 0 / 0 | second figure dropped ("8.1"/"8.2" both give `fig8`), equations are plain text, boxes not marked |
| `technical-en` | 3 | 7 / 7 | 1 / 1 | 2 / 3 | sections, steps, diagram labels good; captioned tables found; code listings flattened |
| `recipe-de` | 2 | 1 / 2 | 1 / 1 | 0 / 1 | timeline figure found; two-column page read by y, ingredient groups cut into the steps |

Totals: figures found 8 of 12 (all captioned ones except the second textbook figure; none of the 3 uncaptioned); tables found 7 of 21 (all 7 captioned ones, none of the 14 uncaptioned);
displayed equations found 0 of 2.

## 2. Cross-cutting findings, most important first

### 2.1 A caption decides whether a table exists, and how its text is ordered
- With a caption ("Table 1. Absolute maximum ratings") the table is found (`kind: "table"`, bbox, crop image) and its text is typed `table_text`, one block per printed text line **in row order**:
  `p1.b52 "Shutdown pin voltage VSHDN −0.3 V to VS + 0.3 V"` (`datasheet-sensor-en`). Seen in 7 tables: `manual-espresso-en` Tables 1 and 2, `datasheet-sensor-en` Tables 1 and 2,
  `technical-en` Tables 1 and 2, `policy-en` Table 1.
- Without a caption nothing is found (14 tables). The cells are ordinary text blocks, sorted by column: `p2.b8 "Water hardness Range"`, `p2.b10 "Soft Medium Hard"` (`manual-espresso-en`),
  `p3.b7 other "1.0 1.1 2.0 2.1"` (`policy-en`), `p1.b16 "White blood cells (WBC) Red blood cells (RBC) Haemoglobin ..."` followed by values in separate blocks (`lab-report-en`).
  The two tables of `leaflet-de` are the exception: cells in row order, one block per cell.
- Captioned tables: a cell that wraps puts its second line in a block of its own (`p2.b8 "scan event of one parcel"` in `technical-en`, `p2.b9 "press releases"` in `policy-en`); empty cells are not marked
  (`datasheet-sensor-en` `p2.b8 "... ±0.5 ±2.0 °C"`); the table bbox of `manual-espresso-en` Table 2 is only the header row (`[80.5, 397.0, 514.5, 416.0]`, no rules or spacing under the header);
  `referenced_by` is empty when the text does not say "Table N".

### 2.2 Numeric table cells typed `header_footer` (`annual-report-en`)
32 cells of the three tables are classified `header_footer`: on page 1 the three column-header years and 15 values (`p1.b57 "2023"`, `p1.b60 "312"` ... `p1.b74 "415"`), on page 2 nine segment values (`p2.b63 "801"` ...), on page 3 the row numbers 1 to 5 (`p3.b3 "1"` ...). They are
and come after the table (or the footnote) in block order. Not dropped from `blocks`, but invisible to any logic that skips `header_footer`.

### 2.3 Side-by-side columns are ordered by y, not by column
- `recipe-de` page 1: ingredient groups (left) and steps (right) alternate: `p1.b15` (step 1), `p1.b16` (ingredients group 1), `p1.b17` (step 2), ...
- `article-en` page 2: the sidebar bullets (right column) are woven between the left-column paragraphs (`p2.b4`, `p2.b5`, `p2.b6` sidebar title, `p2.b7`, `p2.b8` main text, `p2.b9` ...) because the columns have different heights.
  On page 1, where both columns are full, the order is right.

### 2.4 Uncaptioned drawings are not figures
`manual-espresso-en` (parts drawing with 10 callouts), the `lab-report-en` logo and the `form-de` crest are not found. The drawing's text leaks into the flow as loose blocks: ten one-character `other`/`paragraph`
blocks `p1.b16 "3"`, `p1.b17 "4"`, `p1.b18 "1"` ... in random order (`manual-espresso-en`).

### 2.5 Blocks between the title and the first heading become `authors`
Subtitle, intro boxes, box titles and sometimes the first section heading are typed `authors`: `annual-report-en` `p1.b6 "Letter from the Chief Executive"` (the first section is lost),
`datasheet-sensor-en` "FEATURES" and "GENERAL DESCRIPTION", `leaflet-de` the opening box and the contents list (13 blocks), `poem-de` 13 of 27 blocks (the whole poem, "Arbeitsauftrag", "Zum Autor"),
`textbook-en` "Learning objectives" box, `recipe-de` "Zutaten"/"Zubereitung" and the info bar, `policy-en` the document control block.

### 2.6 Running header and title lines that repeat it
- Page-2 running header not recognised in all three 2-page documents with a header: `article-en` `p2.b1`, `story-en` `p2.b1`, `lab-report-en` `p2.b1` are `paragraph`; 3-page documents are fine.
- Title lines that repeat the running header text are dropped as `header_footer`: `leaflet-de` `p1.b4 "Beispielin 400 mg Filmtabletten"` (no `title` block at all, only `source.title`),
  `annual-report-en` `p1.b3 "Harrowgate Industrial Group plc"`, `article-en` masthead `p1.b3`.

### 2.7 Margin line numbers merged into sentences (`story-en`)
Seven of nine margin numbers are inserted into the prose: `p1.b10 "... and thus rid myself of the eye 10 forever."`, `"... cautiously 20 (for the hinges creaked)"`, `p2.b3 "... overcharged with awe. 40 I knew the sound well."`.

### 2.8 Figure number "8.1" is read as "8" (`textbook-en`)
`fig8` has `number: "8"`; Figure 8.2 (pgfplots) is not in `figures`, only its caption (`p2.b29`) and axis texts (`figure_text`); `fig8.referenced_by` lists mentions of both figures.
Datasheet, technical, annual-report, article and recipe figures with plain numbers (1, 2, 3) are fine; the recipe caption "Abbildung 1." is read correctly.

### 2.9 Form artefacts (`form-de`) and numbered lists
- Checkbox squares are vector drawings and disappear; the option labels are plain paragraphs. Labels that start with a digit ("1 Jahr", "2 Jahre") become headings and sections in one run (`sec-1-2`, `sec-2-2`).
- Numbered task lists are headings in `poem-de` (`sec-2`, `sec-3`, `sec-4`: "2. Analysiere das Reimschema ...", split in a heading block with the first line and a paragraph with the rest).
- Small grey field labels in sections 2 and 5 are typed `footnote` (`form-de` `p1.b27 "Hersteller und Typ"`, `p1.b46 "Ort, Datum *"`).

### 2.10 Code, equations, unnumbered sub-headings
- Code listings (`technical-en`) lose line breaks and indentation: `p2.b20 "curl -X GET \"https://...\" \\ -H \"Authorization: Bearer YOUR_ACCESS_TOKEN\" \\ -H ..."`; JSON is split by the braces (`p2.b22 other "{"`).
- Displayed mhchem equations are paragraphs (`textbook-en` `p1.b13 "6 CO2 + 6 H2O −−−→C6H12O6 + 6 O2"`, `p1.b12 "light"`, `p1.b14 other "(8.1)"`), `equations: []`; the `equation` type shows up where there is none (`recipe-de` `p1.b8 "220 ◦ C (Umluft 200 ◦ C)"`).
- Bold run-alone sub-headings without a number are paragraphs: 14 in `leaflet-de` (bold at body size 9.5 pt) and "Nährwerte pro Portion (ca.)" in `recipe-de` (12 pt sans bold), while the 12.6 pt "Revenue and margin development" in `annual-report-en` and larger headings are found.

### 2.11 Classification depends on document-wide statistics
`form-de` page 1 is the same PDF content in both runs, but the types of 11 blocks and the number of sections changed when page 2 was set in a smaller size (3 pages to 2 pages).

### 2.12 What worked
Numbered sections (`policy-en` 10 of 10, `technical-en` 7 of 7, `leaflet-de` 6 of 6, `manual-espresso-en` 8 of 8, `textbook-en` 8.2.1 to 8.2.6), numbered rules and steps as paragraphs with their numbers, figures with
captions (8 of 9), poem stanzas as single sentences with the right line rects (`poem-de`), `•` bullets, thin-space numbers, umlauts, fractions, hyphenation inside paragraphs, tables with captions (row order).

## 3. Per document

### 3.1 `manual-espresso-en` (manual, 3 pages)

Ingested: `3 pages, 98 blocks, 97 sentences, 8 sections, 0 figures, 2 tables, 0 panels, 0 equations`.
(First version of this document had no table captions: `99 blocks, 124 sentences, 0 tables`. Two tables, the troubleshooting and the specification table, were then given a caption "Table 1:" / "Table 2:" to test both cases; the other two tables stay uncaptioned on purpose.)

| Item | Present in the PDF | Found in doc.json |
|---|---|---|
| Sections | 6 numbered (1 Important safety information ... 6 Technical specifications) plus subsection 4.1 Procedure plus unnumbered "Disposal and warranty" | all 8 found with right numbers and levels: `sec-1` ... `sec-6`, `sec-4.1` (level 2), `sec-disposal-and-warranty` (level 1, no number, since it is a `\subsection*`, should be level 2) |
| Uncaptioned tikz parts drawing (10 callouts) | 1 figure, no caption | **0 figures**. The drawing's text labels leak into the reading flow as ten one-character blocks, e.g. `p1.b16 other "3"`, `p1.b17 other "4"`, `p1.b18 other "1"` (callouts in random order), plus `p1.b21 other "93 °C"` and `p1.b22 paragraph "MAX"`, `p1.b27 paragraph "MIN"` |
| Legend table (No. / Part, 10 rows, no caption) | 1 table | 0 tables; text came out as two cell-column blobs: `p1.b31 "1 Cup warming tray 2 Display (temperature, program) 3 Power button ..."` and `p1.b32 "6 Portafilter with handle 7 Steam wand ..."`, preceded by two header blocks `p1.b29 "No. Part"`, `p1.b30 "No. Part"` |
| WARNING / CAUTION boxes | 3 boxes (1 WARNING on p1, 1 CAUTION p2 after "Daily use", 1 WARNING + 1 CAUTION in section 4) | the box label and the box text are separate paragraph blocks: `p1.b8 "WARNING"` then `p1.b9 "To reduce the risk of fire..."`, same for `p2.b4 "CAUTION"`, `p2.b13`, `p2.b15`; no block type tells they are warnings |
| Numbered steps (section 3, "Step 1." to "Step 7.") | 4 + 7 steps | kept as one block each (`p2.b19 "Step 1. Switch the machine off. ..."` ... `p2.b25 "Step 7. ..."`); the page-1 list is split by the page break (`p1.b36 "3. Fill the portafilter..."`, `p2.b3 "4. Place a cup..."`) |
| Water hardness table (3 rows, no caption) | 1 table | 0 tables; cells scrambled by column: `p2.b8 "Water hardness Range"`, `p2.b10 "Soft Medium Hard"`, `p2.b11 "0 to 7 °dH 8 to 14 °dH above 14 °dH 6 weeks"`, `p2.b12 "6 months 3 months"` (the "6 weeks" value lands in the wrong column blob) |
| Troubleshooting table (8 rows x 3 columns, caption "Table 1: Troubleshooting guide") | 1 table | **found**: `tab1`, kind `table`, number "1", page 3, bbox `[59.0, 133.5, 536.5, 335.0]` (the whole table, the crop `figures/tab1.png` is right), caption block `p3.b5`. The cell text is no longer in column blobs: it is `table_text` with one block per printed text line in row order (`p3.b6 "Problem Possible cause Remedy"`, `p3.b7 "Machine does not switch on Plug not connected, no mains power Check the plug and the outlet. If the machine"`), but a cell that wraps to a second line puts that line in a block of its own (`p3.b8 "still does not start, contact customer service."`, `p3.b10 "head remains, descale the machine."`, `p3.b12 "less than 15 s"`, `p3.b14`, `p3.b16`, `p3.b19`, `p3.b21`); `referenced_by` is empty (the text says "check the table", not "Table 1") |
| Specification table (6 rows x 4 columns, caption "Table 2: Technical specifications of the Morvale ES-300") | 1 table | `tab2` found (page 3), but its bbox `[80.5, 397.0, 514.5, 416.0]` is only 19 pt high: **only the header row is in the table** (`p3.b24 table_text "Feature Value Feature Value"`, the crop `figures/tab2.png` shows just the header); the six body rows are `paragraph` column blobs after it (`p3.b25 "Rated voltage Rated power Pump pressure Water tank Cable length Protection class I"`, `p3.b26 "220 to 240 V, 50/60 Hz 1450 W 15 bar 1.2 L 1.0 m"`, `p3.b27`, `p3.b28`, `p3.b29`). Likely cause: this table has no rules or extra row spacing below the header, so row detection stops there |
| Header / footer | 2 + 2 per page | all classified `header_footer` (12 blocks), including "Page 1 of 3" |

Verdict: sections, headings and the numbered steps are good. **Captioned tables are found and their text comes in row order** (the troubleshooting table; the specification table only for its
header row), **uncaptioned tables are not found and come out as column blobs** (legend, water hardness). The uncaptioned parts drawing is not found at all (0 figures), its ten callout numbers
are loose blocks in random order.

### 3.2 `datasheet-sensor-en` (datasheet, 3 pages)

Ingested: `3 pages, 139 blocks, 49 sentences, 6 sections, 3 figures, 2 tables, 2 panels, 0 equations`.
(First version had no table captions: `144 blocks, 69 sentences, 0 tables`. Table 1 "Absolute maximum ratings" and Table 2 "Electrical characteristics" were then given captions placed above the tables, as in real datasheets; the pin function table and the ordering table stay uncaptioned.)

| Item | Present in the PDF | Found in doc.json |
|---|---|---|
| Sections | 6 unnumbered upper-case headings (PIN CONFIGURATION ... ORDERING INFORMATION) | all 6 found, level 1, no number (`sec-absolute-maximum-ratings`); the two headings of the first two-column block ("FEATURES", "GENERAL DESCRIPTION") are classified `authors` (`p1.b5 authors "FEATURES"`, `p1.b14 authors "GENERAL DESCRIPTION"`), not headings; the product line `p1.b4` is a `paragraph` |
| Figure 1, pinout (tikz, captioned) | 1 | `fig1`, caption "Figure 1. Pin configuration, SOT-23-5 (top view)", page 1, but bbox `[53.0, 297.0, 542.0, 422.89]` spans the full text width, i.e. the drawing **and** the pin function table next to it; panels `fig1.a [53, 297, 542, 419]` (whole) and `fig1.b [105, 320.5, 197.5, 421]` (the drawing only). The labels and the table cells (`p1.b18` ... `p1.b45`) are all typed `figure_text` |
| Figure 2, V(OUT) vs temperature curve (pgfplots, captioned) | 1 | `fig2`, page 2, caption found, bbox `[53, 390.9, 542, 565.5]` (full width, while the plot is centred at 72 % width); axis tick labels and the two annotations are 22 `figure_text` blocks (`p2.b25 "1,750"` ... `p2.b46 "Temperature (°C)"`, caption `p2.b47`) |
| Figure 3, application circuit (circuitikz, captioned) | 1 | `fig3`, page 3, caption found, bbox `[122, 140.5, 473, 227.5]`, labels as `figure_text` |
| Pin function table (5 rows, no caption) | 1 | no table object; absorbed into fig1 as described above |
| Absolute maximum ratings table (9 rows x 3 columns, caption "Table 1. Absolute maximum ratings") | 1 table | **found**: `tab1`, page 1, bbox `[144.0, 539.0, 451.0, 685.5]`, caption block `p1.b49`; the rows are `table_text` blocks in row order, one per row, with symbol and rating in the same block: `p1.b51 "Supply voltage (VS to GND) VS −0.3 V to 6.0 V"`, `p1.b52 "Shutdown pin voltage VSHDN −0.3 V to VS + 0.3 V"`, ... `p1.b59 "ESD, human body model 2000 V"`; symbols no longer become `equation` blocks; `referenced_by` is empty (the text never says "Table 1") |
| Electrical characteristics table (14 rows x 6 columns, caption "Table 2. Electrical characteristics") | 1 table | **found**: `tab2`, page 2, bbox `[53.0, 134.0, 542.0, 377.0]` (the crop `figures/tab2.png` shows the whole table), caption block `p2.b5`; 18 `table_text` blocks in row order: header `p2.b6 "Parameter Test conditions Min Typ Max Unit"`, group rows as blocks of their own (`p2.b7 "Accuracy"`, `p2.b14 "Output"`, `p2.b18 "Power supply"`), data rows one per block (`p2.b11 "Scale factor −40 °C to 125 °C 9.9 10.0 10.1 mV/°C"`, `p2.b8 "Temperature error TA = 25 °C, grade A ±0.5 ±2.0 °C"`). **Empty cells are not marked**: in `p2.b8` the two values `±0.5 ±2.0` can be read as typ and max only by knowing that Min is empty; in `p2.b19 "Supply voltage range VS 2.7 5.5 V"` min and max are indistinguishable from typ without the header. The Ω unit is plain text (`p2.b15 "... 20 35 Ω"`) |
| Ordering table (4 rows, no caption) | 1 | 0 tables; one blob per column (`p3.b22 "QT1190AKS-R7 QT1190AKS-RL QT1190BKS-R7 EVAL-QT1190"`, `p3.b23 "±2.0 °C max ±2.0 °C max ±1.0 °C max"` ...) |
| Features list, general description | bullet list + 2 paragraphs in two columns | bullets are separate `paragraph` blocks with the `•` character kept (`p1.b6 "• Linear scale factor of 10.0 mV/°C"` ...); reading order is correct (left column, then right column) |
| Equations (displayed) | none (only inline symbols) | `equations: []`; with the captioned tables the five earlier `equation`-typed blocks (symbol cells such as `VS`, `θJA`, `Ω`) are gone, they are part of the table rows |

Verdict: the three captioned figures are found with the right captions and numbers, but the first bbox swallows the neighbouring pin function table. **The two captioned tables are found and read row by row**,
which is what a datasheet needs (the parameter, its conditions and the values stay together), but the empty min/typ/max cells are not marked. The two uncaptioned tables (pin functions, ordering) are
missed, with cell text in column order (the pin table is inside the figure `fig1`).

### 3.3 `annual-report-en` (report, 3 pages)

Ingested: `3 pages, 186 blocks, 88 sentences, 5 sections, 1 figures, 0 tables, 0 panels, 0 equations`.

| Item | Present in the PDF | Found in doc.json |
|---|---|---|
| Cover band | white-on-green box: "Annual Report 2025" / "Harrowgate Industrial Group plc" / "Financial year ended ..." | title `p1.b4 "Annual Report 2025"` right; the company name in the band `p1.b3 header_footer "Harrowgate Industrial Group plc"` is dropped as a running header (same text as the page header); the subtitle line is typed `authors` (`p1.b5`) |
| First section heading "Letter from the Chief Executive" | heading | **not a heading**: `p1.b6 authors "Letter from the Chief Executive"`, `p1.b7 authors "Dear shareholders, customers and colleagues,"`; so the CEO letter has no section (sections start at "Key figures") |
| Other headings | Key figures, Revenue and margin development (`\subsection`), Segment performance, Principal risks, Outlook for 2026 | all found, all level 1 (the subsection is level 1 too), no numbers (none printed) |
| CEO letter text | 4 paragraphs and a signature | `p1.b8` ... `p1.b11` and `p1.b12 "Dr. Helena Marsh Chief Executive Officer, ..."`; fine |
| Key figures table (11 rows x 5 columns, no caption) | 1 table | 0 tables; the first value column (2023: 1,842) and rows are split in `other` blocks (`p1.b17 "1,842"`, `p1.b18 "1,967"`, `p1.b19 "2,134"`, `p1.b20 "+8.5 %"`), but **18 cells are typed `header_footer`** (the three column-header years and 15 values): `p1.b57 "2023"` ... `p1.b59 "2025"` (the column header years!) and `p1.b60 "312"`, `p1.b61 "341"`, `p1.b62 "389"` (EBITDA), ... `p1.b72 "498"`, `p1.b73 "462"`, `p1.b74 "415"` (net debt). They sit after the footnote in the block order, so the table text reads "EBITDA +14.1 %" with its three amounts missing |
| Dividend 2025 value with footnote mark `0.75^1` | "0.75" with a superscript 1 | merged to `p1.b40 other "0.751"`, which reads as 0.751; the footnote itself is found: `p1.b56 footnote "1 Proposed to the annual general meeting."` |
| Figure 1 revenue and margin chart (pgfplots, two axes, captioned) | 1 | `fig1`, page 2, bbox `[77.5, 94.0, 518.0, 274.0]`, caption "Figure 1. Revenue (bars) and EBIT margin (line), 2021 to 2025. Revenue grew by 7.5 % a year on average."; 29 `figure_text` blocks (tick labels with a space as thousands separator, e.g. `p2.b15 "2 134"`) |
| Segment table (6 rows x 6 columns, no caption) | 1 | 0 tables; 9 cells again typed `header_footer`: `p2.b63 "801"`, `p2.b64 "892"`, `p2.b65 "128"`, `p2.b66 "710"`, ... `p2.b71 "271"`; the cells `71` and `-22` merged to `p2.b50 "71 −22"` |
| Principal risks table (5 rows x 4 columns, no caption) | 1 | 0 tables; the row-number cells 1 to 5 became `header_footer` blocks at the top of page 3 (`p3.b3 "1"` ... `p3.b7 "5"`); the three text columns are intact and in row order (`p3.b14 "Supply chain and input costs"`, `p3.b15 "Dual sourcing..."`, `p3.b16 "Stable"`) |
| Outlook bullets | 4 bullets | 4 `paragraph` blocks with the `•` character kept (`p3.b31` ... `p3.b34`) |

Verdict: text, headings and the chart are found, but the first section is lost as `authors`, and in the three tables 32 numeric or index cells in total (18 + 9 + 5)
are typed `header_footer` and end up after the table (or the footnote) in reading order; for a financial report, whose value is in
its numbers, this is the most damaging result. A tour that states "revenue 2,134" is possible only from the CEO letter or the chart labels.

### 3.4 `article-en` (article, 2 pages, two columns)

Ingested: `2 pages, 60 blocks, 73 sentences, 0 sections, 1 figures, 0 tables, 0 panels, 0 equations`.

| Item | Present in the PDF | Found in doc.json |
|---|---|---|
| Masthead and running header | masthead "THE MARLOWE COURIER" + tagline; running header (page 1, page 2) | page 1: `p1.b1`-`p1.b4` all `header_footer`, including the masthead and the tagline (`p1.b3 "THE MARLOWE COURIER"`, `p1.b4 "Independent since 1894 · Weekend Feature"`); page 2: the running header is **not** recognised, it is `p2.b1 paragraph "THE MARLOWE COURIER"` and `p2.b2 paragraph "Weekend Feature · Saturday, 24 October 2026"` and so is part of the reading text |
| Headline | large bold headline | `title` "Two wheels, one city, a lot of arguments" (also `source.title`); right |
| Deck and byline | italic deck, byline "By Jonas Whitfield, Transport Correspondent" | plain `paragraph` blocks (`p1.b6`, `p1.b7`), no author detected (`authors` not used) |
| Run-in bold headings ("More riders, fewer serious injuries.", "The price of progress.", "A tale of two districts.", ...) | 5, inside paragraphs | no sections (`sections: []`), the heads are merged into the paragraph text (`p1.b31 "More riders, fewer serious injuries. The share of commuting trips ..."`); expected for run-in heads |
| Two-column reading order, page 1 | left column then right column | correct: left column blocks `p1.b8`-`p1.b34`, then right column from `p1.b35` ("that every lane kilometre is cheaper ..." is the continuation of the `p1.b34` paragraph across the column break, kept as a separate block) |
| Two-column reading order, page 2 | text of the left column, sidebar box in the right column | **scrambled**: the page's two columns end at different heights and blocks are ordered by y: `p2.b3` (left, y 53), `p2.b4 "• Launched: 2021"` (right, y 71), `p2.b5 "• Budget to 2028: ..."` (right, y 83), `p2.b6 "Marlowe Moves at a glance"` (right, y 54, the sidebar title, after two of its bullets), `p2.b7` (right), `p2.b8 "What comes next. ..."` (left, y 101), `p2.b9` ... `p2.b13` (right) |
| Paragraph continued across the page break | "How Marlowe compares" | split in two blocks, `p1.b43` ends mid-sentence ("... The leader, Kestrel, has 41") and `p2.b3 "kilometres per 100,000. Dr. Reyes warns ..."` |
| Pull quotes (2) | quote in a red-ruled box + attribution line | 2 blocks each: `p1.b32 "“My children ride to school alone now. ...”"` + `p1.b33 "Tomas Ellery, father of two, Eastfield"`; `p1.b37` + `p1.b38`; no marker that they are quotes boxes, the attribution is a separate paragraph |
| Figure 1 bar chart (pgfplots, captioned, in the left column) | 1 | `fig1`, page 1, bbox `[69.5, 369.0, 291.0, 499.5]`, caption found ("Figure 1. Protected bike lanes in Marlowe at the end of each year, ..."); 20 `figure_text` blocks (`p1.b10 "120"`, `p1.b11 "96"`, ... `p1.b29 "2025"`) in an order that is not left-to-right (values and axis ticks interleaved) |
| Sidebar box "Marlowe Moves at a glance" | box with a title bar and 8 bullets | bullets as 8 `paragraph` blocks with `•` (see reading order above); the title is a paragraph, not a heading |
| Equations / tables | none | none, correct |

Verdict: page 1 is read well (columns in order, chart and caption found). Page 2 loses the column order whenever the two columns have
different heights: the sidebar bullets are woven into the main text. The running header on page 2 is part of the text. A tour that points
at the sidebar would read its bullets in the wrong order or mixed with "What comes next".

### 3.5 `poem-de` (literature, 1 page, German)

Ingested: `1 pages, 27 blocks, 25 sentences, 4 sections, 0 figures, 0 tables, 0 panels, 0 equations`.

| Item | Present in the PDF | Found in doc.json |
|---|---|---|
| Title, subtitle, author | "Der Panther" / "Im Jardin des Plantes, Paris" / "Rainer Maria Rilke (1875-1926)" | `title` right (`p1.b4`, also `source.title`); subtitle and author line both typed `authors` (`p1.b5`, `p1.b6`) |
| Chapter label "TIERE IN DER LYRIK" | small caps line above the title | `p1.b3 header_footer`, dropped as running header |
| The poem (3 stanzas x 4 lines, line numbers 5 and 10 in the margin) | 12 lines | each **stanza is one block and one sentence** with 4 line rects: `p1.b7 authors "Sein Blick ist vom Vorübergehn der Stäbe so müd geworden, daß er nichts mehr hält. Ihm ist, als ob es tausend Stäbe gäbe und hinter tausend Stäben keine Welt."` (sentence `p1.s4`, 4 rects); stanza 2 `p1.b9`/`p1.s6`, stanza 3 `p1.b11`/`p1.s8`. Good for pointing at whole stanzas, but the **type is `authors`** (not paragraph), the line breaks are lost in the text (single line, spaces), and single lines (verses) cannot be targeted as sentences. The stanza 3 text keeps "auf –. Dann geht ein Bild hinein" inside one sentence |
| Line numbers in the margin (5, 10) | 2 | two separate blocks `p1.b8 authors "5"` and `p1.b10 authors "10"`, placed between stanza blocks in reading order |
| Source line "Aus: Rainer Maria Rilke, Neue Gedichte, 1907 ..." | 1 | `p1.b12 authors` |
| Margin box "Worterklärungen" | title + 5 glossary entries | `p1.b14 heading "Worterklärungen"` (the only box title recognised as a section: `sec-worterkl-rungen`, id with the umlaut dropped) and one `paragraph` block `p1.b15 "Jardin des Plantes (frz.): botanischer Garten mit Tierpark in Paris geschmeidig: biegsam und elegant in der Be..."` (entries merged into one block) |
| Margin box "Zum Autor" | title + biography | `p1.b16 authors "Zum Autor"`, `p1.b17 authors "Rainer Maria Rilke wurde 1875 in Prag geboren ..."` |
| Box "Arbeitsauftrag" (title + "Bearbeitungszeit: 25 Minuten" in the title bar) | 1 box, 4 numbered tasks | title `p1.b13 authors "Arbeitsauftrag"`, `p1.b18 authors "Bearbeitungszeit: 25 Minuten"`; the four tasks come out as `p1.b19 authors "1. Lies das Gedicht zweimal laut. ..."`, `p1.b20 heading "2. Analysiere das Reimschema und das Metrum des Gedichts. Bestimme auch die Kadenzen"` + `p1.b21 paragraph "(männlich oder weiblich) der Verse."`, `p1.b22 heading "3. Untersuche ..."` + `p1.b23`, `p1.b24 heading "4. Beschreibe ..."` + `p1.b25`; so tasks 2, 3 and 4 are made **sections** (`sec-2`, `sec-3`, `sec-4`, level 1, `number` "2", "3", "4", title = first text line) and each task is split into a heading block with the first line and a paragraph with the remainder; task 1 is not a section; `exercises` not present |
| Footer | "Text gemeinfrei ... Testzwecke." + page number 112 | page number `p1.b27 header_footer "112"`; the footer text is a `paragraph` (`p1.b26`) |
| Hyphenation | words broken at line ends ("Übertreibun-gen", "ge-nau") | joined correctly inside paragraphs (`p1.b17` reads "... lange und genau anzusehen"), but the task lines typed `heading` keep the line-end hyphen: `p1.b22 heading "... Metaphern und Übertreibun-"`, `p1.b23 "gen) und erkläre ihre Wirkung."` |

Verdict: the stanza segmentation is the best feature (one targetable sentence per stanza with 4 line rects); but almost everything is typed `authors`, the task list is
turned into three fake sections with line-split text, and the Worterklärungen entries are merged. A tour of this page can highlight stanzas but would treat
"Arbeitsauftrag" and the poem as author metadata.

### 3.6 `story-en` (literature, 2 pages)

Ingested: `2 pages, 32 blocks, 79 sentences, 0 sections, 0 figures, 0 tables, 0 panels, 0 equations`.

| Item | Present in the PDF | Found in doc.json |
|---|---|---|
| Title block | unit label, title, author, years | `title` "The Tell-Tale Heart" right (`p1.b4`, `source.title`); the unit label "UNIT 3 THE UNRELIABLE NARRATOR" is `header_footer` (`p1.b3`), author and years typed `authors` (`p1.b5 "Edgar Allan Poe"`, `p1.b6 "1809–1849 · first published in 1843"`); the author is not exposed as a name field |
| Box "Before you read" | title bar + 5 lines | both `authors`: `p1.b7 "Before you read"`, `p1.b8 "Edgar Allan Poe was an American writer ..."`; not a heading |
| Running text, 7 paragraphs of prose | 7 paragraphs, the last one ("Presently I heard a slight groan ...") breaks across the page | paragraphs correct (`p1.b9` ... `p1.b17`, `p2.b3`, `p2.b4`); the paragraph that breaks across the page is two blocks (`p1.b17 "Presently I heard ... a groan of pain or of"` and `p2.b3 "grief—oh, no!—it was ..."`) |
| Margin line numbers every 5 lines (5, 10, ..., 35 on p1; 40, 45 on p2) | 9 numbers | only two stay separate blocks, typed `other`: `p1.b11 "5"` and `p1.b15 "35"` (no sentence). The other seven are **merged into the prose in the middle of a sentence**, which changes the text: `p1.b10 "... and thus rid myself of the eye 10 forever."` (sentence `p1.s22`), `p1.b12 "... when I had made 15 an opening sufficient ..."`, `"... cautiously 20 (for the hinges creaked)"`, `"... indeed, to 25 suspect that every night ..."`, `p1.b13 "... for he 30 moved on the bed suddenly"`, `p2.b3 "... overcharged with awe. 40 I knew the sound well."`, `"... the wind in 45 the chimney ..."`. A tour that quotes these sentences or reads them aloud will say the line number |
| Sentence segmentation | 79 sentences incl. rhetorical short ones | fine (`p1.s14 "Object there was none."`, `p1.s15 "Passion there was none."`); the sentence containing the number is the only damaged one per case |
| Dialogue and dashes | em dashes, quotes | kept (`"“Who's there?”"` preserved with curly quotes) |
| Closing marker "[ The story continues ... ]" | 1 line | `p2.b5 paragraph "[ The story continues. The excerpt ends here.]"` |
| Glossary box | title + 6 terms in one running line | `p2.b6 paragraph "Glossary"`, `p2.b7 paragraph "hearken: to listen closely dissimulation: ..."` (terms in one block, no structure) |
| "Think about it" questions | box + 3 numbered questions | `p2.b8 paragraph "Think about it"`, `p2.b9` ... `p2.b11 paragraph "1. The narrator opens ..."` etc.; not sections, not exercises |
| Running header on page 2 | "AMERICAN GOTHIC · Short Fiction" / "Edgar Allan Poe" | page 1 `header_footer` (`p1.b1`, `p1.b2`); page 2 the same two lines are `paragraph` blocks (`p2.b1`, `p2.b2`) and so enter the reading text |

Verdict: good paragraph and sentence structure, but the margin line numbers corrupt seven sentences, and the page-2 running header is read as text. No sections or figures were
expected, and none were invented.

### 3.7 `leaflet-de` (medical, 3 pages, German)

Ingested: `3 pages, 108 blocks, 123 sentences, 6 sections, 0 figures, 0 tables, 0 panels, 0 equations`.

| Item | Present in the PDF | Found in doc.json |
|---|---|---|
| Document title block | "Gebrauchsinformation: Information für Anwender" / "Beispielin 400 mg Filmtabletten" / "Wirkstoff: Probanol" | **no `title` block**: both big lines are classified `header_footer` because they repeat the running header (`p1.b3 "Gebrauchsinformation: Information für Anwender"`, `p1.b4 "Beispielin 400 mg Filmtabletten"`); `source.title` is still "Beispielin 400 mg Filmtabletten"; the substance line is `p1.b5 authors "Wirkstoff: Probanol"` |
| Opening box ("Lesen Sie die gesamte ... " + 4 bullets) | 1 box | typed `authors` (`p1.b6` ... `p1.b10`), bullets kept with `•` |
| "Was in dieser Packungsbeilage steht" + numbered list 1-6 | heading + 6 items | all `authors` (`p1.b11` ... `p1.b17`); the list duplicates the six real section titles but is not mistaken for sections (the real headings are `p1.b18` ...) |
| The six numbered sections | 6 | all 6 found with right numbers, titles and pages (`sec-1` ... `sec-6`, level 1) |
| Sub-headings ("Beispielin darf nicht eingenommen werden,", "Warnhinweise und Vorsichtsmaßnahmen", "Schwangerschaft und Stillzeit", "Dauer der Anwendung", "Wenn Sie die Einnahme von Beispielin vergessen haben", "Meldung von Nebenwirkungen", ... 14 in all) | bold run-alone lines | not detected: each is a plain `paragraph` (`p1.b22`, `p1.b28`, `p2.b3`, `p2.b31`, `p2.b35`, `p3.b22` ...), so the missed-dose passage can only be found by its text, not as a subsection |
| Contraindication bullets, "Achtung" box, "Beenden Sie die Einnahme ..." box | 5 bullets + 2 boxes | bullets as `paragraph` with `•` (`p1.b23`-`p1.b27`); boxes as plain `paragraph` (`p1.b30 "Achtung: Nehmen Sie ..."`, `p3.b5 "Beenden Sie die Einnahme und suchen Sie sofort einen Arzt auf ..."`), so the warning boxes are not marked |
| Dosage table (3 rows x 5 columns, no caption) | 1 table | 0 tables; but the cells come out in **row order**, one block per cell: `p2.b15 "Kinder unter 12 Jahren"`, `p2.b16 "unter 40 kg"`, `p2.b17 "nicht empfohlen"`, `p2.b18 other "—"`, `p2.b19 other "—"`, `p2.b20 "Jugendliche von 12 bis 14 Jahren"`, `p2.b21 "40 bis 49 kg"`, `p2.b22 "½ Filmtablette (200 mg)"`, `p2.b23 "mindestens 8 Stunden"`, `p2.b24 "3 halbe Filmtabletten (600 mg)"`, ... `p2.b29 "3 Filmtabletten (1 200 mg)"`; the header cells are merged `p2.b12 "Körpergewicht Einzeldosis"`. Usable for a tour, but no table object and the columns are not named per cell |
| Side-effect frequency table (4 rows x 3 columns, no caption) | 1 table | 0 tables; row order again, cell by cell (`p3.b10 "Sehr häufig"`, `p3.b11 "kann mehr als 1 von 10 Behandelten betreffen"`, `p3.b12 "Magenbeschwerden wie Sodbrennen, ..."`, ... `p3.b21 "Magen-Darm-Geschwüre ..."`); numbers keep the thin space ("1 000", "1 200") |
| Fractions and special characters | ½, „BSP 400“, umlauts, ß | all kept (`p2.b22 "½ Filmtablette (200 mg)"`, `p3.b30 "... der Prägung „BSP 400“."`) |
| Footer | "TESTDOKUMENT: fiktives Arzneimittel ..." + "Seite N von 3" | `header_footer` on every page, correctly dropped (so the test marker is not read in the tour) |

Verdict: sections 1-6 and the table cells (row order) are good; no figures or tables are recognised, the title block is lost as running header, 14 sub-headings and
both warning boxes are plain paragraphs. For a medical leaflet this means the tour sees the text in the right order but cannot tell a warning from ordinary text.

### 3.8 `lab-report-en` (medical, 2 pages)

Ingested: `2 pages, 55 blocks, 52 sentences, 2 sections, 0 figures, 0 tables, 0 panels, 0 equations`.

| Item | Present in the PDF | Found in doc.json |
|---|---|---|
| Letterhead: drawn logo (no caption), lab name, address, "LABORATORY REPORT / Report no. / Status: final" | 1 logo, 3 text parts | title `p1.b3 "Meridian Clinical Laboratory"` (`source.title` the same); address `p1.b4 authors "Department of Haematology and Clinical Chemistry 12 Example Road, ..."`; `p1.b7 paragraph "LABORATORY REPORT"`, `p1.b8 authors "Report no. MCL-2026-118204 Status: final"`; the logo is not a figure (no caption) and nothing is extracted for it |
| Patient and sample block (labels in bold, 5 rows x 2 pairs) | 10 label/value pairs | labels and values separated into different blocks: `p1.b5 "Hale, Casey M. 14 Mar 1981 (45 years) Female P-000417 Ordering physician Dr. Anna Whitlock (fictional)"` (the right-hand labels are in `p1.b6 "Patient Date of birth Sex Patient ID"`, "Ordering physician" is merged into the value block), `p1.b9 "12 Oct 2026, 07:55 (fasting, 12 h) 12 Oct 2026, 09:02 12 Oct 2026, 15:20 Venous blood (EDTA and serum) Example..."`, `p1.b10 "Collected Received Reported Specimen Clinic"`; pairs only recoverable by order |
| Section headings | "Results", "Laboratory comments" | both found as `heading` (`sec-results`, `sec-laboratory-comments`), level 1, no numbers |
| Results table (22 rows x 5 columns, 3 panels, 9 flagged rows with bold value and flag, no caption) | 1 table | 0 tables; **the table is split by column and by font weight, and rows cannot be restored**: `p1.b16 "White blood cells (WBC) Red blood cells (RBC) Haemoglobin Haematocrit ..."` (all 8 test names of panel 1 in one block); the result values are spread over six blocks, normal values and bold flagged values separately (`p1.b17 "82.7"`, `p1.b18 "4.21"`, `p1.b19 "32.2 268"`, `p1.b20 "11.4"`, `p1.b21 "11.2 34.8"`, `p1.b22 "26.6"`) in an order that does not follow the rows; panel 2 values `p1.b25 "71 96 139 4.2 24 22 2.1"` (normal) and `p1.b26 "5.9"` (the flagged glucose); units `p1.b35 "×109/L ×1012/L g/dL % fL pg g/dL ×109/L"`; reference ranges `p1.b36 "4.0 – 10.0 3.80 – 5.20 12.0 – 15.5 ..."`; flags as the single blocks `p1.b37 "H"`, `p1.b38 "L L"`, `p1.b39 "L"`, `p1.b42 "H"`, `p1.b45 "H H"`, `p1.b46 "L H"`; the shading of the nine flagged rows is not recorded. A tour cannot tell whether "11.4" is H or L from text alone, and "5.9" is only linked to "Glucose, fasting" by counting |
| Panel header rows (shaded: "Complete blood count", "Clinical chemistry", "Lipids, iron stores and inflammation") | 3 | plain `paragraph` blocks (`p1.b15`, `p1.b23`, `p1.b27`) between the column blobs, not headings |
| Reference-range operators (`< 35`, `> 90`) and units with superscripts | present | kept (`p1.b41 "3.9 – 5.5 45 – 84 > 90 135 – 145 3.5 – 5.1 < 35 < 35 0.4 – 4.0"`); superscripts flattened (`×109/L`, `mL/min/1.73 m2`, same as the tex source `10^9`) |
| Laboratory comments box | 3 numbered comments + a note | one block `p2.b4 paragraph "1. Blood count. Haemoglobin, haematocrit and MCH are below ..."` (the three comments and the note merged); good enough for reading |
| Methods paragraph + authorised line | 2 | `p2.b5 paragraph "Methods: haematology by impedance and flow cytometry; ..."` (the authorised-by line is inside it) |
| Running header | "Meridian Clinical Laboratory · Report ..." / "Patient: Hale, Casey M. · ID ..." | page 1: `header_footer` (`p1.b1`, `p1.b2`); page 2: not recognised, `p2.b1`, `p2.b2` are `paragraph` (as in `article-en` and `story-en`, the 2-page documents). The footer test notice and "Page N of 2" are `header_footer` on both pages |

Verdict: headings and the comment box are fine; the results table, the heart of the document, is unusable for a tour that must state which value is high or low: values,
units, ranges and flags are in separate column blocks (and bold flagged values in blocks of their own), with no table object. This is the most severe table result
among the 13 documents.

### 3.9 `policy-en` (policy, 3 pages)

Ingested: `3 pages, 71 blocks, 72 sentences, 10 sections, 0 figures, 1 tables, 0 panels, 0 equations`.
(First version had no table captions: `83 blocks, 95 sentences, 0 tables`. The data classes table was then given the caption "Table 1: Data classes and permitted AI tools"; the document control block and the version history stay uncaptioned.)

| Item | Present in the PDF | Found in doc.json |
|---|---|---|
| Title and subtitle | "Use of AI Tools at Work" / "Group Policy POL-IT-014, Version 2.1" | title right (`p1.b3`, `source.title`); subtitle `p1.b4 authors` |
| Document control block (3 rows x 2 label/value pairs, no caption) | 1 table, 12 cells | typed `authors` and **scrambled**: `p1.b5 "Chief Information Security Officer Effective from 1 December 2026 All employees and contractors"` (values of the left pair, with the label "Effective from" in the middle), `p1.b6 "Policy owner"`, `p1.b7 "Applies to"`, `p1.b8 "Contact"`, `p1.b9 "Approved by Executive Board 1 December 2027 security@calder-finch.example"`, `p1.b10 "Next review"`; a tour cannot tell "Effective from" (1 December 2026) from "Next review" (1 December 2027) without the page image |
| Numbered sections 1-10 | 10 | **all 10 found**, with the right numbers, titles and levels (`sec-1` Purpose ... `sec-10` Version history) |
| Numbered rules 4.1 to 4.8 | 8 items with bold lead-in | 8 `paragraph` blocks, each starting with its number: `p1.b18 "4.1 Use approved tools. Use only AI tools ..."` ... `p1.b25 "4.8 Report incidents. ..."`; not sections, nested numbering is kept in the text only |
| Data classes table (4 rows x 5 columns, caption "Table 1: Data classes and permitted AI tools") | 1 table | **found**: `tab1`, page 2, bbox `[67.5, 132.5, 528.0, 285.5]`, caption block `p2.b5`; rows come as `table_text` blocks in row order, but one block per printed text line, so a row that wraps (all four do) is split: `p2.b6 "Class Description Examples Approved AI Public AI"` + `p2.b7 "tool tool"`, `p2.b8 "1 Public Meant for external release Published marketing material, job adverts, Yes Yes"` + `p2.b9 "press releases"`, `p2.b10 "2 Internal Not public; low harm if Meeting notes, internal slides, project plans Yes No"` + `p2.b11`, `p2.b12 "3 Confidential Harm to the Company or its Client deliverables, contracts, price lists, Yes, enterprise No"` + `p2.b13 "clients if disclosed financial results, source code tenant only"`, `p2.b14 "4 Restricted ... No No"` + `p2.b15` + `p2.b16`; the Yes/No cells sit at the end of the first line of each row, but the cell contents are interleaved across the wrapped lines ("Yes, enterprise" / "tenant only") |
| Bulleted responsibilities | 5 bullets | 5 `paragraph` blocks with `•` (`p2.b19` ... `p2.b23`); fine |
| Training, consequences, exceptions paragraphs | 3 | fine (`p2.b25`, `p2.b27`, `p2.b29`), the bold deadline "by 31 January 2027" is inside the paragraph |
| Version history table (4 rows x 4 columns, no caption) | 1 table | 0 tables; **column order**: `p3.b4 "Version Date"`, `p3.b5 "Author"`, `p3.b6 "Summary of changes"`, `p3.b7 other "1.0 1.1 2.0 2.1"`, `p3.b8 "1 March 2024"`, `p3.b9 "IT Security First issue; public AI tools not allowed for client work 15 September 2024 IT Security Approved AI ..."`, `p3.b10 "CISO CISO"`, `p3.b11 "Four data classes introduced; ... Training deadline of 31 January 2027, ..."`; version numbers, dates and changes cannot be paired |
| Header / footer | company, policy id, classification; footer and page number | all `header_footer` on all 3 pages, running header included (unlike the 2-page documents `article-en`, `story-en` and `lab-report-en`, where it is missed on page 2) |

Verdict: the best result for structure: all 10 numbered sections and the 8 numbered rules are intact. **The captioned data class table is found and read in row order** (wrapped lines split it), the two
uncaptioned tables are not: the version history is in column order and the document control block is scrambled.

### 3.10 `form-de` (form, 2 pages, German)

Ingested: `2 pages, 95 blocks, 106 sentences, 14 sections, 0 figures, 0 tables, 0 panels, 0 equations`.
An earlier run of the same page 1 in a 3-page version of the PDF (page 2 in normal size, a "Datenschutz" paragraph spilled to page 3) gave
`3 pages, 97 blocks, 103 sentences, 12 sections` (see "Differences between two runs" below).

| Item | Present in the PDF | Found in doc.json |
|---|---|---|
| Letterhead: drawn crest (no caption), office name and address, stamp box | crest + 2 text parts + empty box "Eingangsstempel / Aktenzeichen (vom Amt auszufüllen)" | all three text parts typed `header_footer` (`p1.b1 "Stadt Musterstadt"`, `p1.b2 "Bürgeramt · Abteilung Verkehr und Parken Beispielplatz 1, 12345 Musterstadt"`, `p1.b3 "Eingangsstempel / Aktenzeichen (vom Amt auszufüllen)"`); the crest is not extracted |
| Title and intro line | "Antrag auf Ausstellung eines Bewohnerparkausweises" + instruction | `title` right (`p1.b4`, `source.title`), the instruction `p1.b5 authors "Bitte in Druckbuchstaben ausfüllen und die Ausfüllhinweise auf Seite 2 beachten. Felder mit * sind Pflichtfelder."` |
| Numbered section bars 1 to 5 (white on red) | 5 | all 5 found as headings with number and title (`sec-1` "Antragstellerin / Antragsteller" ... `sec-5` "Erklärung und Unterschrift") |
| Field boxes with small labels (name, first name, DOB, phone, e-mail, street, PLZ, town, make and type, keeper, place and date, signature) | 12 empty boxes with a label in grey 6 pt | labels only, one `paragraph` per label (`p1.b7 "Name *"`, `p1.b8 "Vorname(n) *"`, `p1.b9`, ... `p1.b14 "Ort *"`); the two labels in section 2 and the two in section 5 are typed `footnote` (`p1.b27 "Hersteller und Typ"`, `p1.b28`, `p1.b46 "Ort, Datum *"`, `p1.b47`). There is no notion of an input field, so a tour sees a list of labels (with the `*` kept) |
| Plate boxes (3 + 2 + 4 small boxes) | 9 empty boxes | nothing extracted except the dash `p1.b17 other "–"` and the hint `p1.b18 "(z. B. MU-AB 1234)"` |
| Checkboxes (drawn squares) in sections 2, 3, 4 and the office box | 20 | **the squares are not text, so they disappear**; their option labels become independent paragraphs (`p1.b20 "Pkw"`, `p1.b21 "Kraftrad"`, `p1.b22 "Wohnmobil bis 3,5 t"`, `p1.b23 "Anhänger"`, `p1.b30 "Erstausstellung"`, `p1.b32 "Ersatz bei Verlust oder Diebstahl"`, ...); nothing says that they are tick options |
| Option text broken by a line wrap or by a box | "eine andere Person oder Firma (Vollmacht ...)" and "Vollmacht ... \| Anzeige bei Verlust" | order and merging wrong: `p1.b24 "Die Halterin / der Halter des Fahrzeugs ist Firma (Vollmacht und Halternachweis beifügen)"`, `p1.b25 "die Antragstellerin / der Antragsteller"`, `p1.b26 "eine andere Person oder"` (the sentence is cut around its own options); `p1.b41 "Vollmacht der Halterin / des Halters Verlust"` + `p1.b43 "Anzeige bei"` (the word "Verlust" jumps to the wrong option) |
| Option labels "1 Jahr", "2 Jahre" (validity, section 3) | 2 checkbox labels that start with a digit | in the 2-page run they are **two fake sections**: `sec-1-2 "Jahr"` (number "1") and `sec-2-2 "Jahre"` (number "2"), headings `p1.b35 "1 Jahr"`, `p1.b36 "2 Jahre"`, with ids that duplicate the real `sec-1`, `sec-2` plus a suffix; in the 3-page run of the same page they were plain paragraphs |
| "Vom Amt auszufüllen" box with 3 lines | 1 box, 8 labels | in the 2-page run all `paragraph` (`p1.b48` ... `p1.b56`); in the 3-page run they were `footnote` and `header_footer` (`p1.b54 header_footer "Ausweisnummer:"`, `p1.b55`, `p1.b56`) |
| Declaration text | 1 paragraph | fine (`p1.b45 "Ich versichere, dass meine Angaben vollständig und richtig sind. ..."`) |
| "Ausfüllhinweise" page | title, subtitle, 6 sub-headings, hints "Zu 1" to "Zu 5", numbered list of 5 documents, fee table, 3 bullets, contact, Datenschutz | headings all found (`sec-ausf-llhinweise`, `sec-zu-den-einzelnen-feldern`, `sec-diese-unterlagen-m-ssen-sie-beif-gen`, `sec-geb-hren`, `sec-fristen-und-bearbeitung`, `sec-abgabe-und-kontakt`, `sec-datenschutz`, all level 1, no numbers; ids with the umlaut replaced by a hyphen); hints: each label and text separate (`p2.b4 "Zu 1"`, `p2.b5 "Tragen Sie Ihren Namen so ein, ..."`, ... `p2.b12 "Zu 5"`, `p2.b13`); list items `p2.b15` ... `p2.b19` with their numbers; bullets `p2.b29` ... `p2.b31` with `•`; the bold "4 Wochen vor Ablauf", "10 Werktage", "14 Tagen" are inside the paragraphs |
| Fee table (4 rows x 3 columns, no caption) | 1 table | 0 tables; column order: `p2.b24 "Erstausstellung oder Verlängerung Erstausstellung oder Verlängerung Ersatz bei Verlust oder Diebstahl Änderung des Kennzeichens"`, `p2.b25 "1 Jahr 2 Jahre Restlaufzeit Restlaufzeit"`, `p2.b26 "15,00 Euro 30,00 Euro 10,00 Euro 10,00 Euro"`; the three header cells `p2.b21` ... `p2.b23` are separate; rows can only be recovered by counting |
| Footer | form id, state, page number | `header_footer` (`p1.b57`, `p1.b58 "Seite 1 von 2"`) |

Differences between two runs (same page 1, the other engineer was changing `ingest/ingest.py` meanwhile; its mtime is 00:13:35):
run A (3 pages: page 2 with 10 pt text, "Datenschutz" on page 3) vs run B (2 pages: page 2 with 9 pt text). Page 1 of the PDF is identical, but
run A gave 5 page-1 sections, `p1.b35 paragraph "1 Jahr"` and `p1.b48`-`p1.b53` typed `footnote`, `p1.b54`-`p1.b56` typed `header_footer`;
run B gave 7 page-1 sections (the two fake ones) and those blocks as `paragraph`. This suggests that the classification depends on document-wide font statistics (the body size changed because
page 2 got smaller), not only on the page itself.

Verdict: structure (numbered section bars and the Ausfüllhinweise headings) is found; the form-specific content is not: fields appear as bare labels, checkbox squares vanish and their
labels look like running text, two option labels become fake sections, the fee table is in column order. A tour can explain the hints on page 2 well, but page 1 needs the page image to be understood.

### 3.11 `textbook-en` (textbook, 3 pages)

Ingested: `3 pages, 68 blocks, 74 sentences, 6 sections, 1 figures, 0 tables, 0 panels, 0 equations`.

| Item | Present in the PDF | Found in doc.json |
|---|---|---|
| Chapter label and title | "CHAPTER 8 ENERGY AND METABOLISM" + section title "8.2 Photosynthesis: capturing light energy" | `title "8.2 Photosynthesis: capturing light energy"` (also `source.title`); the chapter label is `p1.b2 header_footer`; the section 8.2 itself is the title and not in `sections` |
| Subsections 8.2.1 to 8.2.6 | 6 numbered subsections | all 6 found with right numbers and titles, **level 3** (`sec-8.2.1` ... `sec-8.2.6`), because the level counts the dots |
| Learning objectives box (title + intro + 4 numbered objectives) | 1 box | all `authors`: `p1.b4 "Learning objectives"`, `p1.b5`, `p1.b6 "1. write the overall equation ..."` ... `p1.b9`; not a section and not marked as a box |
| Displayed equations 8.1 and 8.2 (mhchem, numbered) | 2 | `equations: []`; the equation text is flattened into plain paragraph blocks `p1.b13 paragraph "6 CO2 + 6 H2O −−−→C6H12O6 + 6 O2"` (subscripts lose their format, the arrow is three minus-like characters, the word "light" over the arrow is a separate block `p1.b12 "light"`), the equation number `p1.b14 other "(8.1)"`; second equation `p2.b4 "2 H2O −−−→O2 + 4 H+ + 4 e−"` and `p2.b5 other "(8.2)"`; inline `\ce{}` in running text is fine (`CO2`, `NADP+`) |
| Figure 8.1, chloroplast (tikz, captioned) | 1 | found as `fig8` (page 1, bbox `[94.0, 523.0, 515.5, 627.5]`, caption "Figure 8.1. Structure of a chloroplast ..."), but **number "8"** instead of "8.1" (the id `fig8` and `number: "8"` drop the part after the dot); labels as 6 `figure_text` blocks (`p1.b18 "Outer membrane"` ... `p1.b23 "Starch granule"`) in an order that mixes left and right labels |
| Figure 8.2, light-response curve (pgfplots, captioned) | 1 | **missing as a figure object**: `figures` has only one entry. The caption is found as `p2.b29 caption "Figure 8.2. Light-response curves ..."`, the axis labels and ticks are `figure_text` (`p2.b12 "Net CO2 uptake (𝜇mol m−2 s−1)"`, `p2.b17 "Sun plant"`, `p2.b20 "Shade plant"`, `p2.b28 "Light intensity (𝜇mol photons m−2 s−1)"`, ...), but nothing ties them to a figure. Most likely cause: "Figure 8.1" and "Figure 8.2" both give number "8" and id `fig8`, so the second one collides; consistent with `fig8.referenced_by = ["p1.s20", "p2.s20", "p2.s27", "p3.s8"]`, which lumps the mentions of both figures (the mentions in the text of 8.2.6 and in review question Q4 point to 8.2) |
| Key terms box | title + 8 terms | `p3.b2 paragraph "Key terms"`, `p3.b3 paragraph "photosynthesis process that converts ... chlorophyll green pigment ..."` (all 8 terms merged in one block, no separators) |
| Review questions Q1 to Q6 | subheading + 6 numbered | heading as plain `paragraph` (`p3.b4 "Review questions"`, a starred subsection is not recognised), each question its own `paragraph` (`p3.b5 "Q1 State the overall equation ..."` ... `p3.b10`) |
| Running header with page number | "8.2 Photosynthesis 2" | `header_footer` on all pages (page number included in the text, `p2.b1 "8.2 Photosynthesis 2"`) |
| Greek letters and superscripts in figure text | mu, m^-2 s^-1 | `𝜇` (U+1D707, the mathematical italic mu) and `−2` kept, e.g. `p2.b12 "Net CO2 uptake (𝜇mol m−2 s−1)"` |

Verdict: sections and the first figure are found, but the second figure is dropped (probable number collision "8.1"/"8.2" -> `fig8`), the equations are plain text without `equations` entries, and the learning objectives and key terms boxes are not marked.

### 3.12 `technical-en` (technical, 3 pages)

Ingested: `3 pages, 86 blocks, 59 sentences, 7 sections, 1 figures, 2 tables, 0 panels, 0 equations`.
(First version had no table captions: `103 blocks, 95 sentences, 0 tables`. "Table 1. Endpoints of the Parcel Tracking API v2" and "Table 2. Error codes" were then added above the tables; the rate-limit header table stays uncaptioned.)

| Item | Present in the PDF | Found in doc.json |
|---|---|---|
| Title and subtitle | "Parcel Tracking API v2" + "Reference for developers · Base URL ..." | title right (`p1.b3`, `source.title`); subtitle `p1.b4 authors` |
| Numbered sections 1-7 | 7 | all 7 found, right numbers, level 1 (`sec-1` Overview ... `sec-7` Rate limits) |
| Callout box "What is new in v2" | 1 box | plain `paragraph` `p1.b7 "What is new in v2. Page-based pagination with page and per_page, ..."` |
| Numbered steps (auth, 4 items) | 4 | 4 `paragraph` blocks, each with its number (`p1.b10 "1. Send a POST request to https://auth.lumenfreight.example/oauth/token ..."` ... `p1.b13`); inline code is joined into the text |
| Figure 1, sequence diagram (tikz, captioned) | 1 | `fig1`, page 1, bbox `[81.5, 502.5, 514.0, 722.5]`, caption found; 11 `figure_text` blocks: the four actor names (`p1.b16 "Client application"`, `p1.b17 "Carrier systems"`, `p1.b18 "Authorization server"`, `p1.b19 "Tracking API"`, order not left-to-right) and the six arrow labels as separate blocks in the right order 1 to 6 (`p1.b20 "1 POST /oauth/token"` ... `p1.b26 "6 200 OK, parcel status (JSON)"`) plus the note `p1.b23 "check token and scope"`; the arrows themselves and who sends to whom are not in the data. Referenced in text ("Figure 1 shows ...") |
| Endpoint table (6 rows x 4 columns, caption "Table 1. Endpoints of the Parcel Tracking API v2") | 1 table | **found**: `tab1`, page 2, bbox `[61.5, 133.5, 537.0, 280.5]`; rows are `table_text` blocks in row order: `p2.b6 "Method Path Description Scope"`, `p2.b7 "GET /parcels/{trackingId} Current status, estimated delivery date and last parcels:read"`, `p2.b9 "GET /parcels/{trackingId}/events All scan events, newest first; supports page and parcels:read"`, ... `p2.b16 "GET /health Service status; no authentication needed none"`; the second line of a wrapped description is a block of its own (`p2.b8 "scan event of one parcel"`, `p2.b10 "per_page (maximum 100)"`, `p2.b12 "postcode"`, `p2.b14 "changes"`), so the description text is cut in the middle of the row, with the scope value in between |
| Code listings: curl request (3 lines, `\` line continuation), JSON response (11 lines), error JSON (3 lines) | 3 listings in grey boxes | line breaks and indentation lost, listing text becomes a paragraph: `p2.b20 paragraph "curl -X GET \"https://api.lumenfreight.example/v2/parcels/LF123456789DE\" \\ -H \"Authorization: Bearer YOUR_ACCES..."` (backslashes kept); the JSON body is split by the braces: `p2.b22 other "{"`, `p2.b23 paragraph "\"trackingId\": \"LF123456789DE\", \"status\": \"IN_TRANSIT\", ..."`, `p2.b24 other "}"`; error JSON `p3.b5 paragraph "{ \"error\": { \"code\": \"PARCEL_NOT_FOUND\", ..."`; no code-block type |
| Error codes table (8 rows x 4 columns, caption "Table 2. Error codes") | 1 table | **found**: `tab2`, page 3, bbox `[61.5, 186.5, 533.5, 348.0]`, the crop shows the whole table; 12 `table_text` blocks: header `p3.b7 "Status Code Meaning What to do"`, one block per row (`p3.b8 "400 INVALID_REQUEST A parameter is missing or malformed Fix the request; do not retry unchanged"`, `p3.b9 "401 TOKEN_EXPIRED ..."` ... `p3.b18 "503 SERVICE_UNAVAILABLE The service is in maintenance Retry after Retry-After seconds"`), wrapped cells again as separate blocks (`p3.b12 "section 4"`, `p3.b14 "minutes to appear"`, `p3.b17 "persists"`) |
| Rate limit header table (4 rows x 2 columns, no caption) | 1 table | 0 tables; column order as plain paragraphs (`p3.b23 "X-RateLimit-Limit"`, `p3.b24`, `p3.b25`, `p3.b26 "Retry-After"`, then one block `p3.b27 "Number of requests allowed per minute (100) Requests left in the current window ..."`) |
| Running header/footer | 2 + 2 per page | all `header_footer` correctly, including "Page 1 of 3" |

Verdict: sections, the numbered auth steps and the sequence-diagram labels (in order) are good; **the two captioned tables are found and read by rows** (wrapped cells break out as extra blocks),
the uncaptioned header table is in column order, and the code listings are flattened (no line breaks, no code-block type). For API documentation the code blocks are the main weakness.

### 3.13 `recipe-de` (recipe card, kind "manual", 2 pages, German)

Ingested: `2 pages, 74 blocks, 61 sentences, 1 sections, 1 figures, 0 tables, 0 panels, 0 equations`.

| Item | Present in the PDF | Found in doc.json |
|---|---|---|
| Kicker "HAUPTGERICHT · EIN BLECH", title, intro line | 3 | kicker typed `header_footer` (`p1.b1`), title right (`p1.b2 "Hähnchen-Gemüse-Blech mit Zitronenreis"`, two lines joined), the intro sentence `p1.b3 authors` |
| Info bar (3 label/value pairs per row, 2 rows) | 6 pairs | typed `authors` and **scrambled**: `p1.b4 "4 Gesamtzeit: 50 Minuten"`, `p1.b5 "Portionen:"`, `p1.b6 "Backofen:"`, `p1.b7 "Aktive Zeit: 25 Minuten"`, `p1.b9 "Pro Portion:"`, `p1.b10 "Schwierigkeit: einfach ca. 620 kcal"`; the oven value `220 °C (Umluft 200 °C)` is typed `equation` (`p1.b8 equation "220 ◦ C (Umluft 200 ◦ C)"`, from the degree sign set by siunitx, and the ring is shown as `◦`) |
| Column headings "Zutaten" and "Zubereitung" | 2 headings, side by side | both `authors` (`p1.b11`, `p1.b12`), not headings; `sections` has only one entry, the page-2 "Ablaufplan" heading |
| **Two-column layout: ingredients (left) and steps (right)** | left: 3 groups; right: 8 steps | **reading order alternates between the columns by y position**: `p1.b14 "Für das Blech"` (L), `p1.b15 "1 Ofen vorheizen ..."` (R), `p1.b16 "600 g Hähnchenbrustfilet 400 g Süßkartoffeln 2 rote Paprika ..."` (L), `p1.b17 "2 Schneiden ..."` (R), `p1.b18 "3 Süßkartoffeln vorgaren ..."` (R), `p1.b19 "Für den Zitronenreis"` (L), `p1.b20 "250 g Basmatireis 500 ml Wasser ½ TL Salz 1 Bio-Zitrone (Schale und Saft)"` (L), `p1.b21 "4 Würzen ..."` (R), `p1.b22 "Für den Joghurt-Dip"` (L), `p1.b23` (L), `p1.b24` ... `p1.b27` steps 5-8 (R). So the ingredient groups are cut into the steps |
| Ingredient lists (tabular with right-aligned quantity column) | 3 lists, 10 + 4 + 5 lines | each group is one `paragraph` block with quantities and names in the printed line order (`p1.b16 "600 g Hähnchenbrustfilet 400 g Süßkartoffeln 2 rote Paprika (ca. 300 g) 1 Zucchini (ca. 250 g) 1 rote Zwiebel ..."`); no per-line items, so a tour can highlight a whole group but not one ingredient |
| Numbered steps 1-8 with bold lead-in and "(Minute a bis b)" | 8 | 8 `paragraph` blocks, each starting with its number (`p1.b15 "1 Ofen vorheizen (Minute 0). ..."`, no dot after the number, as printed); times and temperatures inside the text are intact (`220 ◦ C`, `12 min` with a thin space, `74 ◦ C`); the bold lead-ins are not separated |
| Figure 1 timeline (tikz, 5 rows of bars, dashed marker, captioned "Abbildung 1") | 1 | `fig1`, page 2, bbox `[60.0, 114.5, 544.0, 228.0]`, caption "Abbildung 1. Zeitplan für 50 Minuten. ..." found with the German label; 27 `figure_text` blocks (bar labels, row names, axis ticks `0` ... `50`, "Minuten", `p2.b3 "Blech wenden (Minute 32)"`) in an order that mixes bar labels, row names and ticks (`p2.b4 "Würzen"`, `p2.b5 "Schneiden und würzen"`, `p2.b6 "Schneiden"`, `p2.b7 "Vorheizen 220 ◦ C"`, ...); the bar lengths and positions (which bar overlaps which) are not in the data |
| Nutrition table (4 rows x 3 columns, no caption) + footnote | 1 | 0 tables; column order (`p2.b34 "Energie Eiweiß Kohlenhydrate Fett"`, `p2.b35 "620 kcal 44 g 78 g 14 g"`, `p2.b36 other "31 % 88 % 30 % 20 %"`), header cells `p2.b32 "Nährwert"`, `p2.b33 "Menge Anteil am Tagesbedarf*"`; the footnote `p2.b37 paragraph` is typed paragraph (no `footnote`) |
| Heading "Nährwerte pro Portion (ca.)" (`\subsection*`) and box title "Tipps" | 2 | plain `paragraph` blocks (`p2.b31`, `p2.b38`), not headings |
| Tipps (5 bullets) | 5 | 5 `paragraph` blocks with `•` (`p2.b39` ... `p2.b43`) |
| Footer | card number + "Seite 1 von 2" | `header_footer` |

Verdict: the timeline figure with its German caption is found and the steps are intact, but the two-column page is read by y position, which cuts the ingredient groups into the steps; the info bar and the nutrition table are scrambled.
For a recipe the order of ingredients and steps is the first thing a tour needs, and it is wrong here.

## 4. After the fixes (2026-11-04)

All numbers and quotes are from `demo/local-doc-<slug>/doc.json` after `bash eval/docs/build.sh` with the fixed `ingest/ingest.py` (the 13 documents compiled again and ingested, all 13 `doc.json` pass
`validate.py`). The fixes are covered by `ingest/test_documents.py` (41 tests on synthetic PDFs built in the tests). The first version of this section said that every guard was checked by switching it off; that was not true for
seven of them (the review in 4.6 found it): after the review each guard named in 4.1 and 4.6 was switched off, one at a time, in a copy of `ingest.py`; `test_documents.py`, `test_exercises.py` and `test_ingest_layout.py` were run on it, and a test fails for every one of them.

A document is a **paper** for these fixes when it has an abstract or a reference list (`looks_like_paper`, the evidence `mark_task_heads` already used); a **sheet** is a document with task headings. Everything
below applies to documents that are neither, and papers and sheets come out as before (4.5).

### 4.1 What changed in `ingest.py`

| Finding | Change |
|---|---|
| 2.5 front matter typed `authors` | Outside papers and sheets a block between the title and the first heading is `authors` only when every row reads as an author line (`looks_like_authors`): an e-mail address or ORCID, an institution ("University of", "Department of", ... in a short row that is no sentence), or a list of names (`is_person_name`: two to four capitalised words, no title word such as "Zum", "Im", "The", no digit; "Dr.", "Prof." and degrees such as "MD", "PhD" beside a name do not count, footnote numbers set apart by commas are dropped, names in capitals count in a row of six words or less). Under a row of names, an institution or an address, a short address row (up to 8 words, no colon, no sentence end, no date) is part of the block ("Berlin, Germany", "Example Street 5, 10115 Berlin"). A heading only with an address or an institution. A subtitle, a poem, a box of introductory text, a list of contents and a table of document data become headings or paragraphs with their sentences. Papers and sheets keep the old rule. |
| 2.1 / 2.4 tables and drawings without a caption | `find_loose_figures` (which only ran on sheets) now runs on every document that is no paper, except a slide deck (more than half of the pages landscape). Guards for these documents: the head of the first page (what starts beside or above the title: letterhead, logo, cover band; a photo or a drawing below the title is a figure) is no figure; a small image in the top fifth of a page is a logo; a drawing needs an image or a curve or slanted line that is no rounded corner of a box, or three filled bars or more with no text inside (`solid`: a bar chart, a timeline), so frames of code listings, form fields and checkboxes are none; a table needs two lines with cells side by side and text that fills 7 % of its box (`table_like`: the grid of empty form fields is none); the rows of a table are no body text for `sound` (a page with little else takes the first column of a table for its text column); shaded rows and cells inside a table are no drawing. Cells come as `table_text`, one block per printed row (`claim_region_text`), the callouts and labels of a drawing as `figure_text`. An uncaptioned table has no typed `grid` (as before; the first version of this fix gave it one, which read wrapped cells and header rows wrongly, see 4.6): its content is the `table_text` blocks. IDs and names as on sheets (`tab3`, "Table on page 2"). |
| captioned table cut after its header row (found while testing) | `rules_linked`: for rules up to 90 pt apart a text block that shares its line with another block (a cell) no longer breaks the table (`cells_ok`, as for rules further apart). The specification table of the manual keeps its six rows. |
| 2.2 numbers typed `header_footer` | A bare number (`"2023"`, `"312"`) is a running text only in the margin: the page-number footers make `"#"` a running text, and `classify_block` took every number on the page for one. Cells of a table region are never classified (they are `table_text`). |
| 2.7 margin line numbers | `mark_line_numbers`: small whole numbers (at most 0.85 body size) outside the text column, three or more, aligned on one edge and counting up by one step on every page (5, 10, 15 ... or 1, 2, 3 ...) are not joined to the text line beside them and are dropped from the rows. |
| 2.8 "8.1" read as "8" | `CAPTION_RE` and `FIG_REF_RE` read `\d+(\.\d+)*` (the first version read one dot only, so "Figure 4.2.1: ..." was no caption, see 4.6); "Figure 8.1 shows ..." at the start of a block is no caption any more. Number "8.1", ID `fig81` (the schema allows `^(fig|tab)[0-9A-Za-z]+$`, no dot), panels `fig81.a`; `fig8d1` when a Figure 81 exists too. `_expand_numbers` reads "8.1-8.3" and "4.2.1-4.2.3". |
| 2.6 running heads | Outside a paper a line matches the running head only in the margin (top or bottom tenth of the page), so a title or a heading that repeats it stays (the title of a paper never counts as running head outside the margin). `repeated_margin_texts` asks for 2 pages, not 3, when the document has two. A line above the title is a notice only in the margin (outside papers and sheets). |
| 2.3 columns of different heights | `xy_order` for portrait pages without a gutter, outside papers and sheets: a gutter between two groups of blocks that stand side by side (two or more on each side, sharing half of the shorter side's height, and a block of three printed lines or more on one side, so rows of "label ... value" are no columns) puts the whole left group before the right one; elsewhere top to bottom as before. Pages of a paper, of a sheet and landscape pages do not use it. |
| 2.9 forms | A numbered label with a single line of the same size close beside it on the same baseline ("1 Jahr", "2 Jahre" between checkboxes) is no heading (`shares_its_line`, outside papers and sheets; a narrow sidebar of other text next to a numbered heading is no neighbour). The rule that makes the small text under a short rule at the column edge a footnote (`footnote_rule_y`) ignores rules that touch a vertical rule: the top of a form field is no footnote separator. |

### 4.2 Before and after, per document

| Document | Blocks | Sentences | Sections | Figures | Tables | Result |
|---|---|---|---|---|---|---|
| `manual-espresso-en` | 98 to 100 | 97 to 81 | 8 to 8 | 0 to **1** | 2 to **4** | drawing, legend, water hardness table found; specification table complete |
| `datasheet-sensor-en` | 139 to 134 | 49 to 39 | 6 to **8** | 3 to 3 | 2 to **3** | FEATURES and GENERAL DESCRIPTION are headings; ordering table found |
| `annual-report-en` | 186 to 97 | 88 to 45 | 5 to **6** | 1 to 1 | 0 to **3** | CEO letter is a section; the three tables read row by row (every printed line is in a `table_text` block; a wrapped line is a block of its own), no grid |
| `article-en` | 60 to 60 | 73 to 71 | 0 to 0 | 1 to 1 | 0 to 0 | page 2 in column order, running head found |
| `poem-de` | 27 to 27 | 25 to 32 | 4 to 6 | 0 to 0 | 0 to 0 | no `authors` except the author line; poem, task box, notes are paragraphs and headings |
| `story-en` | 32 to 29 | 79 to 80 | 0 to 0 | 0 to 0 | 0 to 0 | line numbers out of the sentences, running head found |
| `leaflet-de` | 108 to 91 | 123 to 100 | 6 to 6 | 0 to 0 | 0 to **2** | title is a `title`, front matter is text, both tables found |
| `lab-report-en` | 55 to 47 | 52 to 33 | 2 to 2 | 0 to 0 | 0 to **1** | the results table is one table, one block per row; the department line with its address is `authors` |
| `policy-en` | 71 to 69 | 72 to 65 | 10 to 10 | 0 to 0 | 1 to **2** | version history found; document control no longer `authors` (still scrambled) |
| `form-de` | 95 to 94 | 106 to 103 | 14 to **12** | 0 to 0 | 0 to **1** | no fake sections, no footnotes; fee table found |
| `textbook-en` | 68 to 68 | 74 to 72 | 6 to 6 | 1 to **2** | 0 to 0 | `fig81` and `fig82` |
| `technical-en` | 86 to 84 | 59 to 52 | 7 to 7 | 1 to 1 | 2 to **3** | rate limit table found; code listings are no figures |
| `recipe-de` | 74 to 74 | 61 to 57 | 1 to **3** | 1 to 1 | 0 to **1** | Zutaten / Zubereitung headings, ingredients before steps, nutrition table found |

Totals: tables found 7 to **20** of 21 (the missing one is the pin function table of the datasheet, inside `fig1`), figures found 8 to **10** of 12 (the second figure of the textbook and the espresso drawing are new;
the lab-report logo and the form crest are not found on purpose: a logo in the head of the first page is no content), displayed equations 0 of 2 as before.

### 4.3 Per document: fixed, and what is still wrong

#### manual-espresso-en
- Fixed: the parts drawing is `fig1` (page 1, caption "Figure on page 1", bbox `[170, 427, 426, 586]`); its 13 labels are `figure_text` `p1.b16` ... `p1.b28` ("3", "4", "1", "9", "2", "93 °C", "MAX", "10", "5", "7", "MIN", "8", "6"), no loose
  one-character blocks are left in the text flow. The legend is `tab3` (page 1, bbox `[59, 598, 536, 682]`, no grid): `p1.b29 table_text "No. Part No. Part"`, `p1.b30 "1 Cup warming tray 6 Portafilter with handle"` ...
  `p1.b34 "5 Group head 10 Water level window (MIN and MAX marks)"`. The water hardness table is `tab4` (page 2): `p2.b9 "Soft 0 to 7 °dH 6 months"`, `p2.b10 "Medium 8 to 14 °dH 3 months"`, `p2.b11 "Hard above 14 °dH 6 weeks"` ("6 weeks" is
  in its row). Table 2 (`tab2`) is no longer cut after the header: bbox `[80, 397, 514, 493]`, `p3.b25 "Rated voltage 220 to 240 V, 50/60 Hz Brewing temperature 93 °C (adjustable 88 to 96 °C)"` ... `p3.b30 "Protection class I Noise level 56 dB(A)"`.
- Still wrong: the three ID numbers are not in reading order (`tab3` and `tab4` come before the printed `tab1` and `tab2`, because uncaptioned tables go on after the highest printed number); the wrapped cells of Table 1 are blocks of their
  own (`p3.b8 "still does not start, contact customer service."`, 2.1); the captioned troubleshooting table (`tab1`) has no `grid`, only the specification table (`tab2`) has one; the legend and the water hardness table are read as rows of `table_text` only; WARNING / CAUTION boxes are still a label block and a text block (`p1.b8 "WARNING"`, `p1.b9`); the step list is cut by the page break; `sec-disposal-and-warranty` is level 1.

#### datasheet-sensor-en
- Fixed: `p1.b5 heading "FEATURES"` and `p1.b14 heading "GENERAL DESCRIPTION"` (`sec-features`, `sec-general-description`: 8 sections, were 6); the product line `p1.b4` is a `paragraph`. The ordering table is `tab3` (page 3, bbox `[53, 297, 542, 371]`, no grid):
  `p3.b18 "QT1190AKS-R7 ±2.0 °C max SOT-23-5 T9A 7-inch reel, 3000 pieces"` ... `p3.b21 "EVAL-QT1190 Evaluation board with USB interface"`, one block per row.
- Still wrong: the pin function table is still inside `fig1` (bbox `[53, 297, 542, 423]`, its cells `figure_text`), there is no `tab` for it; empty min / typ / max cells are not marked; `fig1` and `fig2` are full width.

#### annual-report-en
- Fixed (2.2, 2.5, 2.6): `p1.b6 heading "Letter from the Chief Executive"` (`sec-letter-from-the-chief-executive`, 6 sections), `p1.b7 paragraph "Dear shareholders, customers and colleagues,"`, the cover lines `p1.b4 "Harrowgate Industrial Group plc"`
  and `p1.b5` are paragraphs (the first was dropped as running head). The three tables are `tab1` (page 1, `[68, 516, 528, 680]`), `tab2` (page 2) and `tab3` (page 3), none with a grid: `p1.b14 table_text "EUR million unless stated 2023 2024 2025 Change 2025"`,
  `p1.b15 "Revenue 1,842 1,967 2,134 +8.5 %"`, `p1.b16 "EBITDA 312 341 389 +14.1 %"` ... `p1.b25 "Employees at year end 7,420 7,610 7,880 +3.5 %"`; the 32 cells that were `header_footer` are in their rows, and the only `header_footer` blocks are the 12 margin lines (4 per page).
  The risks table is `tab3`: its row numbers 1 to 5 are in front of their rows.
- Also fixed: the cells that were merged in the segment table are in their rows: `p2.b39 "Service & Aftermarket 456 496 +8.8 % 71 14.3 %"`, `p2.b40 "Corporate and consolidation — — — −22 —"`.
- Still wrong: the footnote mark in `p1.b21 "Dividend per share (EUR) 0.60 0.65 0.751 +15.4 %"` still reads as 0.751; a cell that wraps is a block of its own in the risks table (`p3.b6 "1 Supply chain and input Dual sourcing ..."` + `p3.b7 "costs contracts."`); the subsection "Revenue and margin development" is level 1.

#### article-en
- Fixed: page 2 reads the left column, then the sidebar: `p2.b3`, `p2.b4 "What comes next. ..."`, then `p2.b5 "Marlowe Moves at a glance"` and its bullets `p2.b6 "• Launched: 2021"` ... `p2.b13`. The running head `p2.b1 "THE MARLOWE COURIER"`, `p2.b2` is
  `header_footer`.
- Still wrong: the masthead `p1.b3` and tagline `p1.b4` are still `header_footer` (they sit in the top tenth of the page and repeat the head); the sidebar title is a `paragraph`, not a heading; the pull quotes and the paragraph cut by the page break are as before; the figure labels of `fig1` are in no left-to-right order.

#### poem-de
- Fixed: only the author line is `authors` (`p1.b6 "Rainer Maria Rilke (1875–1926)"`). `p1.b5 "Im Jardin des Plantes, Paris"` is a paragraph, the three stanzas are paragraphs with sentences (`p1.b7`: `p1.s4 "Sein Blick ist vom Vorübergehn der Stäbe so müd geworden, daß er nichts mehr hält."`, `p1.s5`),
  the source line `p1.b12`, the notes `p1.b14 heading "Worterklärungen"`, `p1.b16 heading "Zum Autor"` with `p1.b17`, the task box `p1.b13 heading "Arbeitsauftrag"`, `p1.b18 "Bearbeitungszeit: 25 Minuten"` and the task `p1.b19 "1. Lies das Gedicht zweimal laut. ..."` are headings and paragraphs. The margin numbers 5 and 10 stay own `other` blocks without sentences.
- Still wrong (not in the list of fixes): the numbered tasks 2 to 4 are still headings and sections (`p1.b20 heading "2. Analysiere das Reimschema und das Metrum des Gedichts. Bestimme auch die Kadenzen"` + `p1.b21 "(männlich oder weiblich) der Verse."`, `sec-2`, `sec-3`, `sec-4`, 6 sections now with the three box titles);
  the document body size is 8 pt (glossary), so every 11 pt line looks like a heading; a stanza is now two sentences (each with its line rects) instead of one; the glossary entries are one block (`p1.b15`); a line-end hyphen stays in `p1.b22 "... Metaphern und Übertreibun-"`.

#### story-en
- Fixed: the nine margin numbers are no part of the text: `p1.s25 "Whenever it fell upon me, my blood ran cold; and so by degrees—very gradually—I made up my mind to take the life of the old man, and thus rid myself of the eye forever."`,
  `p2.s1 "grief—oh, no!—it was the low stifled sound that arises from the bottom of the soul when overcharged with awe."`; 29 blocks (was 32), no `other` block. `p2.b1`, `p2.b2` are `header_footer`. The author is the only `authors` block
  (`p1.b5 "Edgar Allan Poe"`); `p1.b6 "1809–1849 · first published in 1843"`, the "Before you read" box and its text are paragraphs.
- Still wrong: the paragraph that breaks across the page is two blocks; the glossary terms are one block (`p2.b8`); "Before you read", "Glossary" and "Think about it" are paragraphs, no headings (9 pt bold, body size); the closing marker is a paragraph.

#### leaflet-de
- Fixed (2.5, 2.6): `p1.b4 title "Beispielin 400 mg Filmtabletten"` (the line above it, `p1.b3 "Gebrauchsinformation: Information für Anwender"`, is still dropped as a notice in the top tenth of the page), no `authors`: `p1.b5 "Wirkstoff: Probanol"`,
  the opening box `p1.b6` ... `p1.b10`, the contents `p1.b11 "Was in dieser Packungsbeilage steht"` and `p1.b12` ... `p1.b17` are paragraphs with sentences. The dosage table is `tab1` (page 2, `[56, 324, 540, 428]`, 7 `table_text` blocks) and the frequency table `tab2` (page 3, `[56, 208, 540, 348]`, 10 `table_text` blocks); neither has a grid (a grid made of them read "Erwachsene und" with the maximum dose "3 Filmtabletten (1 200" and a row "Jugendliche ab 15 Jahren" with "mg)", and lost "Schwellung von Gesicht, Zunge oder Kehlkopf", see 4.6).
- Still wrong: the blocks of both tables are printed rows: a cell that wraps puts its second line in a block of its own (`p2.b14 "Jugendliche von 12 bis 14 40 bis 49 kg ½ Filmtablette (200 mg) mindestens 8 3 halbe Filmta..."` + `p2.b15 "Jahren Stunden (600 mg)"`), where
  they were one block per cell before (so the cells of a wrapped row are in two blocks and there is no grid to join them); the 14 bold sub-headings and the two warning boxes are paragraphs (2.10).

#### lab-report-en
- Fixed: the results table is `tab1` (page 1, `[52, 262, 543, 648]`, no grid, 22 rows): `p1.b13 table_text "Test Result Unit Reference range Flag"`, `p1.b14 "Complete blood count"`,
  `p1.b15 "White blood cells (WBC) 11.4 ×109/L 4.0 – 10.0 H"`, `p1.b17 "Haemoglobin 11.2 g/dL 12.0 – 15.5 L"`, `p1.b24 "Glucose, fasting 5.9 mmol/L 3.9 – 5.5 H"`, `p1.b38 "C-reactive protein (CRP) 6.8 mg/L < 5.0 H"`: value, unit, range and flag of a test are in one block,
  the three panel headers are rows of their own. `p2.b1`, `p2.b2` are `header_footer`. The department line with its address and telephone number, `p1.b4 "Department of Haematology and Clinical Chemistry 12 Example Road, Exampleville · Tel. 555-0142"`, is `authors` (an institution with its address, under the title); `p1.b8` and the label/value blocks are paragraphs.
- Still wrong: the patient and sample block is still in label blocks and value blocks (`p1.b5 "Hale, Casey M. 14 Mar 1981 (45 years) Female P-000417 Ordering physician Dr. Anna Whitlock (fictional)"`, `p1.b6 "Patient Date of birth Sex Patient ID"`); the logo is no figure (a logo beside the title is no content, on purpose);
  the shading of the nine flagged rows is not recorded; the unit `×109/L` is flattened.

#### policy-en
- Fixed: the version history is `tab2` (page 3, `[68, 92, 528, 181]`, no grid): `p3.b4 table_text "Version Date Author Summary of changes"`, `p3.b5 "1.0 1 March 2024 IT Security First issue; public AI tools not allowed for client work"` ... `p3.b8 "2.1 1 December 2026 CISO Training deadline of 31 January 2027, clarified Restricted data, 24-hour incident"`;
  the subtitle `p1.b4` and the document control blocks `p1.b5` ... `p1.b10` are paragraphs, no `authors` (the block with the address `security@calder-finch.example` has date and body text rows, so it is no author block).
- Still wrong: the document control block is still scrambled (`p1.b5 "Chief Information Security Officer Effective from 1 December 2026 All employees and contractors"`, labels `p1.b6 "Policy owner"` ... as separate blocks, uncaptioned label/value grids without rules are no table); the wrapped last cell
  of the version history is its own block (`p3.b9 "reporting"`); `tab1` (captioned) has no grid.

#### form-de
- Fixed (2.9): `p1.b35 "1 Jahr"` and `p1.b36 "2 Jahre"` are paragraphs, no more fake sections `sec-1-2`, `sec-2-2` (12 sections: `sec-1` ... `sec-5` and the 7 headings of the hints page); the small grey labels are paragraphs, no `footnote`
  (`p1.b27 "Hersteller und Typ"`, `p1.b28`, `p1.b46 "Ort, Datum *"`; the document has no `footnote` block); `p1.b5` (the instruction) is a paragraph, no `authors`; the empty field grid, the checkbox squares, the plate boxes and the signature frames are no table or figure.
  Page 1 is read row by row to its end: the signature line (`p1.b46 "Ort, Datum *"`, `p1.b47 "Unterschrift der Antragstellerin / des Antragstellers *"`) comes before the office box, whose rows are `p1.b49 "Antrag eingegangen am:"` ... `p1.b53 "Überweisung"` and then `p1.b54 "Ausweisnummer:"`, `p1.b55 "Gültig bis:"`, `p1.b56 "Bearbeitet von:"` (the first version of the column rule read the box column by column and put the signature after it, see 4.6).
  The fee table is `tab1` (page 2, `[168, 398, 426, 465]`, no grid): `p2.b22 "Erstausstellung oder Verlängerung 1 Jahr 15,00 Euro"`, `p2.b24 "Ersatz bei Verlust oder Diebstahl Restlaufzeit 10,00 Euro"`, one block per row.
- Still wrong (skipped): the checkbox squares are not text, so an option such as `p1.b20 "Pkw"` is a paragraph without its box; the option text broken by a wrap or a box (`p1.b41 "Vollmacht der Halterin / des Halters Verlust"`, `p1.b43 "Anzeige bei"`); the crest and the stamp box
  are not found; the classification still depends on the document-wide font statistics (2.11); the office name `p1.b1` is `header_footer`, the address and the stamp box text `p1.b2`, `p1.b3` are paragraphs now (they sit below the top tenth of the page, so they are no notice above the title).

#### textbook-en
- Fixed (2.5, 2.8): the learning objectives are paragraphs: `p1.b4 "Learning objectives"`, `p1.b5 "After studying this section, you should be able to:"`, `p1.b6 "1. write the overall equation of photosynthesis and name its inputs and outputs;"` ...
  The figures are `fig81` (Figure 8.1, page 1, number "8.1", `referenced_by ["p1.s20"]`) and `fig82` (Figure 8.2, page 2, `[98, 502, 511, 679]`, `referenced_by ["p2.s20", "p3.s8"]`), each mention goes to its own figure.
- Still wrong: the displayed mhchem equations are paragraphs (`p1.b13 "6 CO2 + 6 H2O −−−→C6H12O6 + 6 O2"`, `p1.b12 "light"`, `p1.b14 other "(8.1)"`) and `equations` is empty; "Learning objectives", "Key terms" and "Review questions" are paragraphs (bold 9.8 pt, below the heading size); the key terms are one block.

#### technical-en
- Fixed: the rate limit table is `tab3` (page 3, `[62, 430, 534, 507]`, no grid): `p3.b21 table_text "Header Meaning"`, `p3.b22 "X-RateLimit-Limit Number of requests allowed per minute (100)"` ... `p3.b25 "Retry-After Only on 429 and 503: seconds to wait before the next request"`. The three grey code
  listings are no figures (the tcolorbox draws one box piece per code line, boxes and straight lines only, which is no drawing); the subtitle `p1.b4` is a `paragraph`.
- Still wrong (skipped): the listings still have no line breaks (`p2.b20 paragraph "curl -X GET \"https://api.lumenfreight.example/v2/parcels/LF123456789DE\" \\ -H ..."`, `p2.b22 other "{"`); wrapped cells of `tab1` and `tab2` are blocks of their own; the actor names of `fig1` are not in left-to-right order.

#### recipe-de
- Fixed (2.3, 2.5): `p1.b11 heading "Zutaten"` and `p1.b19 heading "Zubereitung"`, the info bar and the intro are paragraphs (no `authors`). The page is read column by column: `p1.b11` ... `p1.b18` are the ingredients (`p1.b13 "Für das Blech"`, `p1.b14 "600 g Hähnchenbrustfilet 400 g Süßkartoffeln ..."`,
  `p1.b15 "Für den Zitronenreis"`, `p1.b16`, `p1.b17 "Für den Joghurt-Dip"`, `p1.b18`), then `p1.b19` ... `p1.b27` the steps 1 to 8. The nutrition table is `tab1` (page 2, `[190, 298, 405, 372]`, no grid): `p2.b33 "Energie 620 kcal 31 %"`, `p2.b34 "Eiweiß 44 g 88 %"`, `p2.b35 "Kohlenhydrate 78 g 30 %"`, `p2.b36 "Fett 14 g 20 %"`.
- Still wrong: the info bar is still scrambled (`p1.b4 "4 Gesamtzeit: 50 Minuten"`, `p1.b5 "Portionen:"`), and `p1.b8 equation "220 ◦ C (Umluft 200 ◦ C)"` is typed `equation`; each ingredient group is one block, so one ingredient cannot be pointed at; the bold heading "Nährwerte pro Portion (ca.)" is a paragraph; the timeline `fig1` labels are in no useful order.

### 4.4 Not done, and why
- **Code listings** (line breaks and indentation, `technical-en`), **displayed chemistry** (`textbook-en` equations 8.1 and 8.2 as `equations`), **form checkboxes** (`form-de`): each needs new machinery (a code block type with its layout, an
  equation reader for mhchem arrows over text, a checkbox object with its label), as said in the task.
- **Label/value grids without rules** (policy document control, lab-report patient block, recipe info bar, `form-de` fields): they have no rules and no header row, so nothing tells them from running text; they are paragraphs now instead of `authors`.
- **Pin function table inside `fig1`** (`datasheet-sensor-en`), **wrapped cells as blocks of their own** in captioned and uncaptioned tables, **numbered task lists as headings** (`poem-de`), **Bold run-in sub-headings at body size** (`leaflet-de`, `recipe-de`): not in the list of fixes.
- **The slide decks, lease, terms, letter and papers** keep their old figure and table detection: a deck (landscape pages) is skipped on purpose, papers have captions for all their figures and tables.
- **Sheets** keep the old front-matter rule (everything up to the first task is `authors`): their course lines are not author lines either, but this was not asked for and would change the sheet output.

### 4.5 Regression check
All 42 PDFs under `demo/` (the 13 test documents, the 11 `local-sheet-*` sheets and 18 more: papers, slides, lease, terms, letter, `mode-*`, `eval-*`) were ingested with the `ingest.py` as it was before the fixes (saved under `eval/docs/.build/before-src/`; this is the working tree of the
exercise-sheet round, not `HEAD`, which does not have that round) and with the fixed one, from the same PDF files, into `eval/docs/.build/before/` and `eval/docs/.build/after/`; `doc.json` (without the generator line) and the figure crops compared. The check was run again after the review fixes of 4.6 (into `eval/docs/.build/after2/`) with the same result: the folders listed here as identical or changed are the same.
- **Identical** (22 of the 29 folders that are no test documents): `_fixture`, `attention`, `attention-short`, `board-test`, `pen-test`, `eval-ants`, `eval-fish`, `eval-letter`, `eval-sheet-de`, `eval-sheet-en`, `mode-coach` and the 11 `local-sheet-*` folders.
  So research papers and sheets did not change at all. The 13 test documents all change (that is the point).
- **Changed, by intent**:
  - `eval-casimir` (a paper with neither an abstract nor a reference list, so no paper by the evidence used here): 7 stray digits of displayed equations (`"1"`, `"2"`, `"2"`, `"2"`, `"3"`, `"0"`, `"0"`, on pages 3, 5, 7 and 9) were `header_footer` and are `other` now (2.2), their block IDs and the ones behind them on those pages move; sections, figures, equations and sentences are the same.
  - `eval-slides` and `mode-deck` (the same deck): 53 bare numbers in the middle of slides (`header_footer` 119 to 66, `other` 8 to 61), as in `eval-casimir`; no figure is added (a deck is skipped).
  - `eval-lease`: 4 section titles that repeat the running head ("Section B: Main terms of the agreement", "Section C: Tenant’s obligations", "Section D: Landlord’s obligations", "Annex 4: Rent Review: ...") were dropped as `header_footer` and are headings now (95 to 99 sections, 2.6);
    the 4 bordered tables of Annex 4 (pages 61 and 62) are `tab1` to `tab4` with 16 `table_text` blocks instead of paragraphs and no grid. Their header cells wrap, so a cell is cut over two blocks: `p61.b6 "Year 1 (from 1 Year 2 (from 1 May Year 3 (from 1 May 2022)"`, `p61.b7 "May 2020) 2021)"`, `p61.b8 "£300 per week £300 x 1.014 = £304.20 x 1.014% ="`, `p61.b9 "£304.20 per week £308.46 per week"`. (The first version of this note quoted "Year 1 (from 1 May 2020) £300 per week" as one line; that was the old paragraph, not `doc.json`.)
    On page 57 the signature lines are in row order as before: `p57.b14 "Date:"`, `p57.b15 "(insert date)"`, `p57.b16 "Yours sincerely"` (the first version of the column rule read "Date:", "Yours sincerely", "(insert date)").
  - `eval-terms`: the three pages of the phone number table (pages 21 to 23, "Austria 0800 001180" ...) are `tab1` to `tab3`, 48 `table_text` blocks (one per row; the cells were 47 `other` and about 45 `paragraph` blocks), the 4 lines above the title on page 1 (`p1.b1 "GOOGLE TERMS OF SERVICE"`, `p1.b2 "Effective July 30, 2026"`, `p1.b3 "Archived versions"`, `p1.b4 "What’s covered in these terms"`, at y 95 to 248, below the top tenth of the page) were `header_footer` as notices above the title and are `paragraph` now. They do not repeat a running head (the document has none: `repeated_margin_texts` finds nothing); they change because a line above the title is a notice only in the margin outside papers and sheets (the first version of this note named a running head as the reason, which was wrong).
  - `mode-distribution`, `mode-timeline`: the subtitle ("A short technical note, written for testing") is a `paragraph`, not `authors` (2.5).
  - `eval-letter` is identical (its letterhead logo on page 3 is no figure).
- No paper changed for the other fixes; the title rule (a title that repeats the running head stays the title) and the two-page head rule would change a paper only where such a title or a 2-page paper exists, none is among the 42 PDFs.

### 4.6 Review fixes (2026-11-04, same day)

A review of the first version of 4.1 to 4.5 found eight problems. Each is fixed in `ingest/ingest.py` and has a test in `ingest/test_documents.py`; the documents were built again (`bash eval/docs/build.sh`, all 13 `doc.json` pass `validate.py`).

| Finding | Fix | Test |
|---|---|---|
| The column rule (2.3) scrambled forms and letters: single lines of "label ... value" side by side count as two columns. `form-de` page 1 read the signature line after the office box and the office box column by column; `eval-lease` page 57 read "Date:", "Yours sincerely", "(insert date)". | `column_cut` needs a block of three printed lines or more on one side of the gutter. Both pages are back in row order (`p57.b14 "Date:"`, `p57.b15 "(insert date)"`, `p57.b16 "Yours sincerely"`; `form-de` `p1.b47 "Unterschrift ..."` before `p1.b48 "Vom Amt auszufüllen"`); the recipe and the article keep their column order. | `ColumnTests.test_rows_of_label_and_value_stay_in_row_order`, `test_a_column_of_three_lines_beside_single_lines_is_still_a_column` |
| Numbers of three levels ("Figure 4.2.1: ...", "Fig. 3.2.1. Results", "Table 4.2.2: ...") were no caption: the figure and table were lost in a paper and loose in a manual. | `CAPTION_RE` and `FIG_REF_RE` read `\d+(\.\d+)*`; `_expand_numbers` reads "4.2.1-4.2.3". IDs `fig421`, `tab422`. | `FigureNumberTests.test_numbers_of_three_levels_are_captions_too` (a plain page and a page with an abstract) |
| Typed grids for uncaptioned tables were wrong in many cases, mostly with confidence "high": a wrapped cell became a row (`leaflet-de`: "Erwachsene und" with "3 Filmtabletten (1 200", and a row "Jugendliche ab 15 Jahren" with "mg)"), lines were lost (`annual-report-en` `tab3`: "exceeds 7 %.", "employees.", "liability)"; `policy-en` "reporting"), the first data row became the header (`eval-terms`: label_header "Guadeloupe"; `eval-lease`: label_header "Year 1 (from 1", row "May 2020)"). `server/src/harness/tables.ts` hands a grid to the model as the content of the table. | The old rule is back: no `grid` for a table without a caption block (18 uncaptioned tables in 11 folders: nine of the test documents, `eval-lease` and `eval-terms`). Their rows stay `table_text` blocks, which hold every printed line. | `LooseFigureTests.test_an_uncaptioned_table_is_read_row_by_row` (no `grid`) |
| Author blocks outside papers broke on real ones: an address row under the institution ("Berlin, Germany", "Example Street 5, 10115 Berlin"), footnote numbers ("Jane Doe1,2, John Roe2 and Ann Lee1"), degrees ("Jane Doe, MD, and John Roe, PhD"), names in capitals ("JANE DOE AND JOHN ROE"). | `looks_like_authors`: a short address row (up to 8 words, no colon, no sentence end, no date) is accepted under a row of names, an institution, an e-mail address or an address; split parts without a letter are dropped; "Dr.", "Prof." and degrees do not count as name words and a part that is only a degree is accepted; "and"/"und" split in any case; capitals count as a name in a row of six words or less (a block typed heading is still no author block). Effect on the documents: `lab-report-en` `p1.b4` ("Department of Haematology and Clinical Chemistry 12 Example Road, Exampleville · Tel. 555-0142") is `authors` now (34 to 33 sentences); no other document changes. | `FrontMatterTests.test_addresses_degrees_footnote_numbers_and_capitals_are_authors`, `test_a_row_after_the_names_must_still_look_like_an_address`, `test_a_heading_in_capitals_is_no_author_line`, `test_what_is_a_person_name` |
| An uncaptioned bar chart or timeline was no figure (filled rectangles and axis lines have no image and no curve), its tick labels stayed `other` blocks in the text flow. | `solid` also counts three shapes or more with a side of half a body size or more that hold no text row. | `LooseFigureTests.test_a_bar_chart_without_a_caption_is_a_figure_with_its_labels` (labels are `figure_text`), `test_two_filled_boxes_are_no_bar_chart` |
| Numbered headings were demoted to labels on a page without a gutter that has a narrow sidebar (`1 Preparation`, `2 Baking`, `3 Serving` beside an ingredient column: no sections). | `shares_its_line` counts only single-line neighbours of the same size (0.5 pt) on the same baseline (0.3 of the size). "1 Jahr" and "2 Jahre" are still labels. | `FormTests.test_numbered_headings_beside_a_narrow_sidebar_stay_headings` |
| Any picture or drawing between the title and the first body text of page 1 was rejected as part of the head (a recipe photo, a parts drawing under a manual's title). | On page 1 only a candidate that starts above the bottom of the title is part of the head (a document without a title keeps the old rule). The lab-report logo and the form crest, which sit beside the title, are still skipped. | `LooseFigureTests.test_a_photo_or_a_drawing_right_under_the_title_is_a_figure_and_a_logo_beside_it_is_not` |
| Claims of this document: every guard was checked by switching it off (false for seven), the 4 `eval-terms` lines "repeated the running head" (the document has none), the lease tables quoted as one line. | Corrected in 4.1, 4.3 and 4.5. Tests added for the guards that no test caught (below). | see below |

Guards that no test caught, and the test that fails when each is switched off now:

| Guard | Test |
|---|---|
| `key == "#"` in `classify_block` (the only part of the 2.2 fix that touches papers: a bare number in the middle of a paper page is no page number) | `RunningHeadTests.test_a_number_in_the_middle_of_a_paper_page_is_no_page_number_either` |
| the margin condition for notices above the title | `RunningHeadTests.test_a_line_above_the_title_is_a_notice_only_in_the_margin_or_in_a_paper` |
| `if b.type == "heading": return False` in `looks_like_authors` | `FrontMatterTests.test_a_heading_in_capitals_is_no_author_line` (needed now that capitals can be names) |
| the `fig8d1` branch (Figure 81 next to Figure 8.1) | `FigureNumberTests.test_figure_81_next_to_figure_8_1_gets_a_valid_id_of_its_own` |
| the capitals rule and `NOT_NAME_WORDS` in `is_person_name` | `FrontMatterTests.test_what_is_a_person_name` |
| the colon rule in `is_person_name` | none needed: it never fired. A word with a colon ("Wirkstoff:") already fails `NAME_WORD_RE`, so the rule was removed; `test_what_is_a_person_name` checks that "Wirkstoff: Probanol" is no name (it fails when the name-word pattern is switched off) |
| the shaded-cell exclusion in `find_loose_figures` | `LooseFigureTests.test_shaded_cells_of_a_table_are_no_drawing` (matters since empty shaded cells can be three bars) |

Regression check after the review fixes: the same 42 PDFs were ingested again into `eval/docs/.build/after2/`. Against `before/`: the same 22 folders are identical (all research papers, `attention`, the sheets) and the same 7 folders change as in 4.5. Against the first version of the fixes (`after/`): `eval-lease` page 57 and `form-de` page 1 (order, finding 1), the `grid` of the 18 uncaptioned tables (finding 3: `eval-lease` `tab1`, `tab3`; `eval-terms` `tab1` to `tab3`; `annual-report-en` `tab1` to `tab3`; `datasheet-sensor-en` `tab3`; `form-de` `tab1`; `lab-report-en` `tab1`; `leaflet-de` `tab1`, `tab2`; `manual-espresso-en` `tab3`, `tab4`; `policy-en` `tab2`; `recipe-de` `tab1`; `technical-en` `tab3`) and `lab-report-en` `p1.b4` (finding 4). Nothing else differs, also not in the figure crops.
