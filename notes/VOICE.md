# Spracheingabe

Im Reader: Mikrofontaste gedrückt halten, sprechen und loslassen. Die laufende Tour wird bereits vor der
Mikrofonfreigabe unterbrochen. Das Transkript steht anschließend editierbar im Fragefeld; erst **Ask** sendet die
Frage an den Antwortwriter. **Back to the tour** stellt die ursprüngliche Tour wieder her. Escape auf der
Mikrofontaste oder erneutes Drücken bricht die Aufnahme/Transkription ab. Bei verweigertem Mikrofon oder Abbruch
vor dem Transkript läuft eine zuvor spielende Tour weiter. Texteingabe bleibt verfügbar.

Die Aufnahme läuft bis zum Loslassen oder Abbrechen. Der Browser dekodiert sein Aufnahmeformat, mischt auf Mono und
erzeugt PCM16-WAV mit 16 kHz. Der Server prüft dieses Audioformat ohne eine feste Aufnahmezeit oder Audio-Größengrenze.
Mikrofonspuren, Timer und Requests werden bei Abbruch und Dokumentwechsel freigegeben. Mikrofone brauchen localhost
oder HTTPS; der Browser muss MediaRecorder und AudioContext unterstützen.

## API und Schlüssel

- Authentifiziert: `POST /api/documents/:id/transcribe`, Body `audio/wav`; Dokumentbesitz wird geprüft.
- Lokale Demo: `POST /api/demo/:paper/transcribe`, nur im bestehenden lokalen Entwicklungsmodus.
- Antwort: `{ "transcript": "…" }`. Keine Audioaufzeichnung wird in der Datenbank oder im Storage gespeichert.
- Library verwendet die eigene Meta-Verbindung aus Profile & Settings, mit dem vorhandenen konfigurierten
  Shared-Key-Fallback. Demos verwenden die lokale Serverkonfiguration. Ohne Schlüssel gibt es einen klaren Fehler.
- Upstream: `POST https://api.meta.ai/v1/asr/transcribe`, Multipart `request` (JSON-Datei mit
  `model: muse-voice-transcribe-1.0`, `audioEncoding: WAV`, `mode: PUSH_TO_TALK`) und `audio` (WAV-Datei).
  Die Implementierung folgt [Meta Speech to Text](https://dev.meta.ai/docs/speech-to-text) und der
  [Transcribe-Referenz](https://dev.meta.ai/docs/api-reference/voice/transcribe).
- Kein festes Transkriptions-Timeout; Abbruch und Verbindungsende beenden den Request. Ein laufender Sprachrequest pro Nutzer. Upstream-Fehlertexte werden nicht durchgereicht.

Die Transkription ist ein separater, potenziell kostenpflichtiger Provideraufruf. In diesem Air-Lauf wurde keiner
ausgeführt. Tests prüfen Multipart, Audioformat, Authentifizierung, lange Aufnahmen, lange Transkripte und Fehler mit Fake-Transporten. Der
Browser prüft eine echte MediaRecorder-Aufnahme mit synthetischem Mikrofon; seine Serverantwort wird simuliert.
Erkennungsqualität, echtes Mikrofon und Muse-Latenz sind damit nicht beurteilt.

## Sprache der Erklärung

Neue Touren verwenden die aus dem Dokumenttext erkannte dominante Sprache, bei unzureichendem Text die konfigurierte
Standardsprache. Das ist eine deterministische Heuristik, keine Sprachmodellklassifikation. Gemischte oder sehr
kurze Dokumente können auf den Fallback fallen. Bestehende gecachte Touren ändern sich nicht nachträglich.

Im Fragefeld wählt **Answer language** ausdrücklich eine andere Sprache, etwa Ukrainisch für einen deutschen
Musterbrief. **Document** ist der Standard. Der Writer erhält diese Sprache, Zitate bleiben im Original und die
Antworttour bekommt die passende Browserstimmen-Sprache. Der Haupttour wird nichts umgeschrieben. Die Verfügbarkeit
und Qualität einer Stimme hängen vom Browser ab; bei fehlender Sprachsynthese bleibt die zeitgesteuerte Wiedergabe.
Eine manuell gewählte Browserstimme bleibt eine ausdrückliche Nutzereinstellung.
