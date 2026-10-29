import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, MotionConfig } from 'motion/react';
import katex from 'katex';
import { SceneBoard } from '../components/SceneBoard';
import { MafsRenderer } from './MafsRenderer';
import {
  functionState,
  lessons,
  matrixAt,
  multiply,
  nativeScene,
  type GraphGeometry,
  type Lesson,
  type Point,
} from './model';
import 'katex/dist/katex.min.css';
import '../board.css';
import './style.css';
function MathText({ latex }: { latex: string }) {
  return (
    <span dangerouslySetInnerHTML={{ __html: katex.renderToString(latex, { throwOnError: false, trust: false }) }} />
  );
}
function App() {
  const [index, setIndex] = useState(0),
    [progress, setProgress] = useState(0),
    [playing, setPlaying] = useState(false),
    [backward, setBackward] = useState(false),
    [input, setInput] = useState<Point>([1, 1]),
    [graph, setGraph] = useState<GraphGeometry>(),
    [layoutError, setLayoutError] = useState('');
  const lesson = useMemo<Lesson>(
    () => (lessons[index].kind === 'linear-map' ? ({ ...lessons[index], input } as Lesson) : lessons[index]),
    [index, input],
  );
  useEffect(() => {
    let active = true;
    if (lesson.kind === 'graph' && !graph) {
      import('./layout')
        .then(({ layoutGraph }) => layoutGraph(lesson))
        .then((value) => {
          if (active) setGraph(value);
        })
        .catch(() => {
          if (active) setLayoutError('Das Layout konnte nicht berechnet werden.');
        });
    }
    return () => {
      active = false;
    };
  }, [lesson, graph]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0,
      last: number | undefined;
    const tick = (now: number) => {
      if (last !== undefined) setProgress((p) => Math.min(1, p + Math.min(now - last!, 100) / 12000));
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => {
    if (progress >= 1) setPlaying(false);
  }, [progress]);
  const scene = useMemo(() => nativeScene(lesson, progress, graph, backward), [lesson, progress, graph, backward]);
  const state = lesson.kind === 'function' ? functionState(lesson, progress) : undefined;
  const matrix = lesson.kind === 'linear-map' ? matrixAt(lesson.matrix, progress) : undefined;
  const result = matrix ? multiply(matrix, input) : undefined;
  const phase = Math.min(2, Math.floor(progress * 3));
  const captions =
    lesson.kind === 'function'
      ? [
          'Eine feste Eingabe kann je nach Skalierung eine andere Antwort erzeugen. Die gestrichelte Kurve zeigt den Ausgangszustand.',
          'Mit wachsender Skalierung wird die Übergangszone breiter. Verfolge die markierte Eingabe x = 1.',
          'Die Kurve reagiert nahe der Mitte weniger stark auf Eingabeänderungen. Werte und Form bleiben an denselben Achsen ablesbar.',
        ]
      : lesson.kind === 'linear-map'
        ? [
            'Der gelbe Vektor ist die Eingabe. Blau und Grün zeigen die Bilder der beiden Basisvektoren.',
            'Die Matrix verändert Basis und Gitter gemeinsam. Der rosa Ergebnisvektor entsteht aus derselben Linearkombination.',
            'Ziehe den gelben Punkt: Beide Ansichten rechnen A v neu aus. Die Transformation bleibt dieselbe.',
          ]
        : backward
          ? [
              'Wir beginnen beim Fehler und folgen den Abhängigkeiten rückwärts. Dies zeigt Wege, noch keine ausgerechneten Gradienten.',
              'Ein Beitrag kann über mehrere Verbindungen zurücklaufen. Verzweigungen bleiben als einzelne Kanten erhalten.',
              'Eine Netzwerkschicht ist kein einzelner Knoten: Jede Variable und jede Verbindung bleibt sichtbar.',
            ]
          : [
              'Die beiden Eingaben laufen über getrennte Verbindungen zu den ersten verborgenen Variablen.',
              'Die nächsten Variablen hängen jeweils von beiden vorherigen Aktivierungen ab.',
              'Vorhersage und Ziel treffen erst am Fehler zusammen. Das Layout erhält die wirkliche Topologie.',
            ];
  return (
    <MotionConfig reducedMotion="user">
      <div className="lab-shell">
        <header className="lab-header">
          <a href="/">‹ Paper Tour</a>
          <span>Separater Versuchsaufbau · kein Umbau des Readers</span>
          <a href="https://mafs.dev/" target="_blank" rel="noreferrer">
            Mafs-Dokumentation ↗
          </a>
        </header>
        <div className="lab-intro">
          <h1>Mathematik, die sich bewegt.</h1>
          <p>Gleiche Werte. Gleiche Zeitsteuerung. Zwei Wege, einen Zusammenhang sichtbar zu machen.</p>
        </div>
        <nav className="lab-tabs" aria-label="Mathematisches Beispiel">
          {['Funktionen', 'Lineare Algebra', 'Rechengraph'].map((title, i) => (
            <button
              key={title}
              aria-pressed={index === i}
              onClick={() => {
                setIndex(i);
                setProgress(0);
                setPlaying(false);
              }}
            >
              {title}
            </button>
          ))}
        </nav>
        <div className="lesson-heading">
          <h2>{lesson.title}</h2>
          <span>Illustration · keine Messdaten</span>
        </div>
        <main className="lab-comparison">
          <section className="lab-canvas" aria-label="Bestehender Renderer">
            <div className="canvas-title">
              <h3>Bestehender Renderer</h3>
              <span>Produktionskomponente · unverändert</span>
            </div>
            <div className="native-scene-wrap">
              {scene.objects.length ? (
                <SceneBoard item={scene} focus={null} playback={{ playing: false, progress: 1 }} />
              ) : (
                <p>{layoutError || 'Layout wird berechnet…'}</p>
              )}
            </div>
            <p className="canvas-note">
              {lesson.kind === 'linear-map'
                ? 'Vorhandene Vektoren und Achsen. Ein transformiertes Koordinatengitter fehlt im aktuellen Vertrag.'
                : lesson.kind === 'graph'
                  ? 'Direkte Renderer-Vorschau: Die vorhandene Szenenprüfung beanstandet Überlappungen an Pfeil-Enden.'
                  : 'Bestehende SVG-Szenen, mit denselben Quelldaten wie rechts.'}
            </p>
          </section>
          <section className="lab-canvas candidate" aria-label="Mafs Kandidat">
            <div className="canvas-title">
              <h3>Mafs · Kandidat</h3>
              <span>{lesson.kind === 'graph' ? 'Topologie + ELK-Layout' : 'Mathematische Koordinaten + React'}</span>
            </div>
            <MafsRenderer lesson={lesson} progress={progress} graph={graph} backward={backward} onInput={setInput} />
            <p className="canvas-note">
              {lesson.kind === 'linear-map'
                ? 'Zusätzlich: mittransformiertes Gitter und verschiebbare Eingabe.'
                : 'Die Szene wird live aufgebaut; es wird kein Video gerendert.'}
            </p>
          </section>
        </main>
        <section className="lab-transport" aria-label="Gemeinsame Wiedergabe">
          <button
            className="play-control"
            onClick={() => {
              if (progress === 1) setProgress(0);
              setPlaying((p) => !p);
            }}
          >
            {playing ? 'Pause' : 'Abspielen'}
          </button>
          <button
            onClick={() => {
              setPlaying(false);
              setProgress(0);
            }}
          >
            Zurücksetzen
          </button>
          <label className="timeline-label">
            Zeitposition
            <input
              aria-label="Zeitposition"
              type="range"
              min="0"
              max="1"
              step="0.001"
              value={progress}
              onChange={(e) => {
                setPlaying(false);
                setProgress(Number(e.target.value));
              }}
            />
          </label>
          <output>{Math.round(progress * 100)} %</output>
          {lesson.kind === 'graph' && (
            <button
              aria-pressed={backward}
              onClick={() => {
                setBackward((b) => !b);
                setProgress(0);
              }}
            >
              {backward ? 'Rückwärts' : 'Vorwärts'}
            </button>
          )}
        </section>
        <section className="lab-explanation" aria-label="Erklärung">
          <div className="math-line">
            {state && (
              <MathText
                latex={`f(x)=\\sigma(x/a),\\quad a=${state.a.toFixed(2)},\\quad f(1)=${state.fn(1).toFixed(3)}`}
              />
            )}{' '}
            {matrix && result && (
              <MathText
                latex={`\\begin{bmatrix}${matrix[0][0].toFixed(2)}&${matrix[0][1].toFixed(2)}\\\\${matrix[1][0].toFixed(2)}&${matrix[1][1].toFixed(2)}\\end{bmatrix}\\begin{bmatrix}${input[0].toFixed(2)}\\\\${input[1].toFixed(2)}\\end{bmatrix}=\\begin{bmatrix}${result[0].toFixed(2)}\\\\${result[1].toFixed(2)}\\end{bmatrix}`}
              />
            )}{' '}
            {lesson.kind === 'graph' && (
              <MathText
                latex={
                  backward
                    ? 'E\\longrightarrow y\\longrightarrow a_i\\longrightarrow x_j'
                    : '(x_1,x_2)\\longrightarrow(a_3,a_4)\\longrightarrow(a_5,a_6)\\longrightarrow y\\longrightarrow E'
                }
              />
            )}
          </div>
          <motion.p
            key={`${index}-${phase}-${backward}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {captions[phase]}
          </motion.p>
          <div className="phase-controls">
            {['Ausgangslage', 'Veränderung', 'Zusammenhang'].map((label, i) => (
              <button
                key={label}
                aria-pressed={phase === i}
                onClick={() => {
                  setPlaying(false);
                  setProgress(i / 2);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
        <details className="lab-contract">
          <summary>Was dieser Versuch prüft</summary>
          <p>
            Live-Plot, lineare Transformation und neun individuelle Graphknoten; gemeinsame Pause und exaktes Suchen.
            Die Szenen stammen aus austauschbaren Beispieldaten. Der Produktions-Agent nutzt weiterhin seine bisherigen
            Tools. Der nächste Integrationsschritt wäre ein gemeinsamer Szenenvertrag für Touren und Rückfragen.
          </p>
        </details>
      </div>
    </MotionConfig>
  );
}
const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
