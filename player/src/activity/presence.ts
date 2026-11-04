import { activeActivity, preferredActivity, type ActivityKind, type ActivityRun } from '../../../shared/agentActivity';
import { sentenceStart, SENTENCE_END } from '../narration/narrator';

export interface CompanionPlayback {
  playing: boolean;
  speaking: boolean;
  /** Only foreground synthesis blocks playback; silent lookahead is not a speaking status. */
  generating?: boolean;
  preparingText?: boolean;
  preparationError?: string;
  canPlay: boolean;
  words: readonly string[];
  word: number;
  page: number;
  title?: string;
  step?: { current: number; total: number };
}
export type CompanionMood = 'ready' | 'working' | 'speaking' | 'paused' | 'attention';

/** A previous reading job must never become the face of a guided tour (or vice versa). */
export function currentActivity(runs: ActivityRun[], mode: ActivityKind, foregroundReadingId?: string) {
  const answer = preferredActivity(runs.filter((run) => run.kind === 'answer' && activeActivity(run.status)));
  return (
    answer ??
    preferredActivity(
      runs.filter((run) => run.kind === mode),
      foregroundReadingId,
    )
  );
}

/** The same word callbacks that drive PDF marks drive the companion's sentence. No second speech clock. */
export function spokenSentence(
  playback: CompanionPlayback,
  retain = false,
): { words: readonly string[]; current: number } | undefined {
  if ((!retain && (!playback.speaking || playback.word < 0)) || !playback.words.length) return;
  const at = Math.max(0, Math.min(playback.word, playback.words.length - 1));
  const start = sentenceStart(playback.words, at);
  let end = at;
  while (end < playback.words.length - 1 && !SENTENCE_END.test(playback.words[end])) end++;
  return { words: playback.words.slice(start, end + 1), current: playback.speaking ? playback.word - start : -1 };
}

export function companionPresence(
  run: ActivityRun | undefined,
  mode: ActivityKind,
  playback: CompanionPlayback,
  foreground = false,
) {
  if (playback.preparingText)
    return { mood: 'working' as const, label: 'Preparing spoken text…', message: 'I’m preparing this passage. You can pause to interrupt.' };
  if (playback.preparationError && !playback.speaking)
    return { mood: 'attention' as const, label: 'Reading paused', message: `${playback.preparationError} Press play to retry or skip to the next passage.` };
  if (playback.playing && playback.generating)
    return { mood: 'working' as const, label: 'Generating speech…', message: 'I’m preparing the voice for this passage.' };
  if (playback.speaking) return { mood: 'speaking' as const, label: 'Speaking', message: '' };
  if (run && (activeActivity(run.status) || foreground)) {
    const operation = [...run.operations].reverse().find((op) => op.state === 'running');
    const messages = {
      source: 'I’m checking the surrounding passages.',
      model:
        mode === 'reading'
          ? 'I’m preparing the next passage in the paper’s own words.'
          : 'I’m putting the explanation and visuals together.',
      tool: 'I’m working on the explanation and its visual cues.',
      cache: 'I’m bringing back the prepared explanation.',
      validation: 'I’m checking that the explanation matches the paper.',
      preview: 'I’m getting the visual ready for you.',
    };
    return {
      mood: 'working' as const,
      label: run.status === 'pausing' ? 'Pausing' : 'Working',
      message: operation ? messages[operation.kind] : 'I’m preparing the next step for you.',
    };
  }
  if (run?.status === 'failed')
    return {
      mood: 'attention' as const,
      label: 'Needs attention',
      message: 'I couldn’t finish this step. You can check what happened below.',
    };
  if (run?.status === 'paused')
    return {
      mood: 'paused' as const,
      label: 'Preparation paused',
      message: 'I’ve paused preparation. Your saved work is ready when you are.',
    };
  if (playback.canPlay && !playback.playing && playback.word >= 0)
    return {
      mood: 'paused' as const,
      label: 'Paused',
      message: 'We can continue here, or take a closer look at this page.',
    };
  return {
    mood: 'ready' as const,
    label: 'Ready when you are',
    message:
      mode === 'reading'
        ? 'We can continue reading, or take a closer look at this page.'
        : mode === 'answer'
          ? 'We can look at this in more detail, or continue with the paper.'
          : 'Let’s explore this paper. You can pause and ask me about anything on the page.',
  };
}
