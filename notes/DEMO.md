# Lokale Demo und Probe

Arbeitsname bleibt **Paper Tour**. Keine Marke wurde festgelegt oder veröffentlicht. Die bestehenden Kandidaten
**Nib**, **Penlight** und **Lupe** stehen in [NAMES.md](NAMES.md); Auswahl und Markenprüfung bleiben offen.
Hackathondauer, Jurykriterien, Pflichtmodelle, Team-/Videoformat und Zulässigkeit lokaler OCR bzw. fremder TTS müssen
vom Nutzer geklärt werden. Manim bleibt optional; die Funktionsplots benötigen es nicht.

## Kostenloser, vollständig lokaler Renderer-Test

```bash
ingest/.venv/bin/python scripts/create-demo-fixtures.py
npm run dev:demo
```

Öffnen: `http://localhost:5174/?paper=local-research&silent=1&rate=4`. Weitere Ordner:
`local-maths-de`, `local-lecture`, `local-lease-v1`, `local-lease-v2`, `local-terms`, `local-letter-de`.
Alle PDFs sind selbst erstellte CC0-Fixtures. Die gecachten Touren sind **offline verfasste Renderer-Testdaten**,
keine Modelloutputs und kein Beleg für die Qualität der automatischen Erklärung. Sie verändern keine bestehenden
Attention-Demos. Die Dateien bleiben gitignored und lassen sich ohne Netz reproduzieren.

Ohne API/Schlüssel funktionieren PDF, Tour, Pen, Board, Plot, Navigation und Suche. Live-Fragen und Transkription
funktionieren dadurch nicht automatisch. Die Browserprüfungen simulieren diese Antworten ausdrücklich. Ein echter
Providerlauf und eine uneditierte daraus erzeugte Qualitätsdemo erfordern eine separate Kostenfreigabe. Danach die
Ausgabe unverändert cachen und über mehrere Dokumenttypen beurteilen; nicht das Ergebnis für eine Demo schönschreiben.

## Probe für einen späteren 2–3-Minuten-Pitch

1. 0:00–0:25: Problem zeigen: Im Originaldokument die wichtige Stelle finden und verstehen. Auf die Quellenmarkierung
   zeigen; die PDF-Seite bleibt die Grundlage.
2. 0:25–1:05: Kurze Tour mit Pen und Board. Funktionsplot: sichere Formel, wachsender Parameter, bewegter Punkt.
   Einen Plot als Illustration erklären, nicht als gemessene Daten ausgeben.
3. 1:05–1:40: Frage unterbricht die Tour. Antwort zeigt eine Quelle und einen Plot. Pause und „Back to the tour“ zeigen.
4. 1:40–2:10: Deutsches Übungsblatt: Aufgabe/Teilaufgabe ansteuern, geprüfte gegenüber ungeprüften Rechenschritten erklären.
5. 2:10–2:40: Ein Teaser: wörtliche Änderung im synthetischen Mietvertrag oder deutscher Musterbrief in der gewählten
   Antwortsprache. Sagen, welche Teile live, gecacht oder simuliert sind.

Für eine reine Offlineprobe die Frage weglassen oder die ausdrücklich gekennzeichnete Testaufnahme verwenden.
Ein Schlüssel allein ist keine Freigabe, in diesem Agentenlauf kostenpflichtige Calls zu starten.

## Backup und lokale Air-Umgebung

Unter `.data/air-test/browser/backup-demo.webm` liegt nach der Air-Probe eine stumme Bildschirmaufnahme mit sichtbarer
Kennzeichnung „synthetic / fake answer“. Sie demonstriert die Bedienung, keine echte Spracherkennung oder Writerqualität.
Die Narration steht als Untertitel im Reader. Zusätzliche Prüfbilder und Testvideos liegen im selben gitignored Ordner.
Vor einer öffentlichen Demo neu mit freigegebenem Inhalt, echter Stimme und passendem Format aufnehmen.

Die Air-Integration verwendet das separate Supabase-Projekt `paper-tour-air-test`, API-Port 55321 und DB-Port 55322.
Die Konfiguration und ausschließlich lokalen Testkonten liegen geschützt unter `.data/air-test/backend/`; diese
Dateien enthalten lokale Testcredentials und dürfen nicht geteilt werden. Andere Checkouts wurden nicht geändert.
Normales Projektsetup bleibt im README. Für erneute Tests Vite und Worker nach Codeänderungen neu starten; der
Dateiwächter hat in der Air-Toolumgebung Änderungen nicht durchgängig erkannt.
