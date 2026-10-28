# Weitere Dokument-Workflows, lokal

Diese Werkzeuge ergänzen den bestehenden PDF-Reader ohne Provideraufrufe. Sie bereiten echte, hochladbare PDFs vor.
Nur eigene, synthetische oder rechtmäßig nutzbare Quellen verwenden. Ausgabeverzeichnisse müssen neu sein;
Originaldateien werden nicht verändert. Arbeitsdateien unter `.data/` halten.

## Kurspaket: Folien, Skript und Prüfungsblatt

```bash
ingest/.venv/bin/python ingest/workflows.py pack .data/course \
  slides.pdf script.pdf exam.pdf
```

`paper.pdf` enthält die ursprünglichen Seiten in Eingabereihenfolge und PDF-Lesezeichen je Quelle. `sources.json`
bindet Dateiname und SHA-256 an die Seitenbereiche. Das PDF über die Library hochladen; im Reader funktionieren
Seitennavigation, Suche und Fragen über das gesamte Paket. Damit kann eine Antwort auf eine Übungsfrage auf eine
Folie im selben Paket zeigen. Die Aufgabe `ex1.a` ist ebenfalls ein gültiges Reader-Ziel, auch über mehrere Seiten.
Für lokale Ingestion ohne Library:

```bash
ingest/.venv/bin/python ingest/process.py .data/course/paper.pdf --out .data/course
```

Grenzen: ein zusammengeführtes PDF mit eindeutigen neuen IDs; keine automatische Zuordnung von Prüfungsaufgaben zu
Theoremen und kein Wechsel zwischen getrennten Library-Dokumenten. Die Quellenzuordnung bleibt lokal im Manifest.
Maximal 12 Quellen, zusammen 100 Seiten; verschlüsselte PDFs werden abgewiesen.

## Mietvertrag oder Bedingungen: „Was hat sich geändert?“

```bash
ingest/.venv/bin/python ingest/workflows.py compare .data/lease-change old.pdf new.pdf
```

`changes.html` zeigt wörtlich gestrichene und eingefügte Textblöcke nebeneinander, mit Quellseite und Reader-Seitenziel.
`changes.json` enthält dieselben Änderungen und die beiden Quell-Hashes. `paper.pdf` enthält beide unveränderten
Originale (alt, danach neu) und lässt sich im Reader öffnen/hochladen. Die Seitenziele führen zur überprüfbaren
Quelle. Unveränderte Passagen werden im Bericht ausgelassen. Eingebettetes HTML aus Dokumenttext wird escaped;
der Bericht lädt keine Skripte oder externen Ressourcen.

Das ist ein Textvergleich, keine Vertragsbewertung und keine Empfehlung zu unterschreiben. Layout-, Bild- und
OCR-Änderungen können fehlen; beide Originale prüfen. Es werden keine Beträge aus unsicheren Texten als verbindliche
Kostendifferenz berechnet. Klauselregister, automatische Begriffsverknüpfungen und ein synchroner Zweifenster-Reader
aus USE-CASES bleiben eigenständige spätere Produktarbeit.

## Musterbrief vom Foto, in der Lesersprache

```bash
ingest/.venv/bin/python ingest/workflows.py photo .data/letter phone.jpg \
  --language deu --tessdata .data/tessdata
```

PyMuPDFs lokale OCR benötigt Tesseract-Sprachdaten, etwa `deu.traineddata` aus dem offiziellen
[tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast)-Paket (Apache-2.0). In `.data/tessdata` ablegen;
es wird kein Foto an einen OCR-Dienst gesendet. Mehrsprachig etwa `--language deu+eng`; `--rotate 90` dreht vor der OCR.
Unterstützt werden lokal dekodierbare Bilder, maximal 20 Megapixel und 50 MiB. Das erzeugte `paper.pdf` bewahrt das
Foto und ergänzt eine durchsuchbare Textebene. Anschließend über die Library hochladen und im Fragefeld die gewünschte
Antwortsprache wählen. Die Ingestion selbst hat weiterhin keinen automatischen OCR-Fallback für beliebige Uploads.

Für die Air-Prüfung wurde die erste Seite des selbst geschriebenen Musterbriefs gerastert, deutsch OCR-erkannt,
über die Browseroberfläche hochgeladen und im Reader geöffnet. Fristtext wurde in der echten Worker-Ausgabe gefunden.
Das prüft den Weg, nicht die Qualität schiefer, unscharfer Handyfotos. Perspektivkorrektur ist nicht implementiert.
Jeden Betrag, jede Frist und jedes Aktenzeichen am Bild prüfen.

Persönliche Briefe vor einem Modellaufruf lokal anonymisieren. Diese Werkzeuge implementieren keine zuverlässige
automatische Schwärzung. Es werden hier ausschließlich synthetische Inhalte verwendet. Sensible echte Daten gehören
erst nach Klärung von Providerbedingungen, Einwilligung und Hackathonregeln in einen solchen Ablauf.

## Weitere vorhandene Abläufe

Übungsblätter verwenden bereits den Aufgabenwriter und numerisch geprüfte Ableitungszeilen; ungeprüfte Zeilen bleiben
markiert. Folien, Verträge, Briefe und sonstige Dokumente haben passende vorhandene Arcs. Formulare können als PDF
gelesen werden; es erfolgt kein Ausfüllen oder Absenden. „Examine me“, Benotung, Tabellenzellen, neue Timeline-/Diff-
Boards und Publisher-Freigaben sind weitere Produktmodi aus USE-CASES, keine Voraussetzung dieser lokalen Workflows.
