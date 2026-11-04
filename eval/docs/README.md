# Evaluation documents (beyond papers, exercise sheets and slides)

Thirteen test documents (LaTeX) for Paper Tour: manuals, datasheets, reports, articles, literature, medical texts, policies, forms, textbooks, technical documentation and a recipe.
Each one is written to look like the real thing (layout, numbered sections, tables, figures with or without captions) so that ingestion and the tour are tested realistically.
All content is our own, except two public-domain texts: Rilke, "Der Panther" (1902, the author died in 1926) and Poe, "The Tell-Tale Heart" (1843). Companies, people, products and the medicine are fictional.

| Document | Kind | Lang | Pages | Features |
|---|---|---|---|---|
| `manual-espresso-en` | manual | en | 3 | Fictional espresso machine; tikz parts drawing with 10 numbered callouts and no caption, legend table, WARNING/CAUTION boxes, 7-step descaling procedure, water hardness table, captioned troubleshooting and specification tables |
| `datasheet-sensor-en` | datasheet | en | 3 | Fictional temperature sensor IC; tikz SOT-23-5 pinout, pin table, captioned absolute maximum ratings and electrical characteristics (min/typ/max), pgfplots V(out) vs temperature curve, circuitikz application circuit, ordering table |
| `annual-report-en` | report | en | 3 | Annual report excerpt; CEO letter, key figures table (3 years), pgfplots revenue bars with EBIT margin line on a second axis, segment table, risks table, outlook; tables without captions |
| `article-en` | article | en | 2 | Two-column newspaper feature on a bike-lane programme; masthead, pull quotes, pgfplots bar chart inside a column, quotes from supporters and critics, sidebar box |
| `poem-de` | literature | de | 1 | Rilke, "Der Panther" (public domain) as a school-reader page; line numbers 5 and 10, Worterklärungen and Zum Autor boxes, Arbeitsauftrag box (rhyme scheme, metre, imagery) |
| `story-en` | literature | en | 2 | Poe, "The Tell-Tale Heart" (public domain), first part only; anthology page with margin line numbers every 5 lines, introduction, glossary, questions |
| `leaflet-de` | medical | de | 3 | Fictional patient information leaflet (Gebrauchsinformation) "Beispielin 400 mg Filmtabletten", sections 1-6, dosage table by age and weight, side effects by frequency, warnings, missed dose; test marker in the footer |
| `lab-report-en` | medical | en | 2 | Fictional blood test report; letterhead with drawn logo, patient and sample block, results table (value, unit, reference range, H/L flag, three panels), laboratory comments |
| `policy-en` | policy | en | 3 | Company policy "Use of AI Tools at Work"; document control block, numbered sections 1-10 and rules 4.1-4.8, captioned data classes table, training deadline, consequences, version history table |
| `form-de` | form | de | 2 | Fictional Antrag (Bewohnerparkausweis, Bürgeramt Musterstadt); field boxes, checkboxes, numbered section bars, signature and office box; page 2 Ausfüllhinweise, document list, fee table, deadlines |
| `textbook-en` | textbook | en | 3 | Photosynthesis section 8.2; learning objectives box, subsections 8.2.1-8.2.6, captioned tikz chloroplast diagram, mhchem equations 8.1 and 8.2, pgfplots light-response curve, key terms box, review questions |
| `technical-en` | technical | en | 3 | Fictional "Parcel Tracking API v2" documentation; OAuth steps, captioned tikz sequence diagram, captioned endpoint and error tables, listings code blocks, rate limits table |
| `recipe-de` | manual | de | 2 | Recipe card (Rezept) for 4 portions; ingredients in three groups beside 8 timed steps (two columns), tikz timeline of parallel tasks with caption, nutrition table, tips. The kind list has no recipe, so the key uses `manual` |

Totals: 32 pages, 21 data tables (7 with a caption, 14 without), 12 drawings or plots (9 with a caption, 3 without), 2 displayed equations. Captions are mixed on purpose, because ingestion treats captioned and
uncaptioned tables and figures very differently (see `INGEST-NOTES.md`).

## Build

```
bash eval/docs/build.sh                                   # all documents, one after the other
bash eval/docs/build.sh leaflet-de technical-en           # only these slugs
INGEST=0 bash eval/docs/build.sh poem-de                  # compile only
```

For each `<slug>.tex` the script runs `pdflatex` twice under `nice -n 15` in `eval/docs/.build/<slug>/` (ignored by `eval/docs/.gitignore`), copies the PDF to
`demo/local-doc-<slug>/paper.pdf` and runs `ingest/.venv/bin/python ingest/ingest.py demo/local-doc-<slug>/paper.pdf --out demo/local-doc-<slug>` (`demo/local-*/` is gitignored).
Needs TeX Live 2025 with tikz, pgfplots, circuitikz, mhchem, siunitx, multicol, tcolorbox, listings. The script is not marked executable; call it with `bash`.

## Keys

`<slug>.expect.json` is the key for judging a tour of that document:

```
{"slug", "kind" (manual, datasheet, report, article, literature, medical, policy, form, textbook, technical), "language" (en|de),
 "must_cover": [4-8 points a good tour must make],
 "numbers": [numbers a good tour should state exactly], "units": [parallel list, one entry per number],
 "figures": [what each figure, table or box shows and what a tour should point at],
 "pitfalls": [what a tour must not do: give medical advice, invent numbers, recommend signing, ...]}
```

## Ingestion

`INGEST-NOTES.md` compares, for every document, what `ingest/ingest.py` found (sections, figures, tables, equations, block types) with what is in the PDF, quoting `doc.json`, and lists the cross-cutting problems.
