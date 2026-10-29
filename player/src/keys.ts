// The reader's keyboard: which key does what, and when a key belongs to the focused element instead.

export type KeyCommand =
  | 'toggle'
  | 'next'
  | 'prev'
  | 'nextSentence'
  | 'prevSentence'
  | 'nextChapter'
  | 'prevChapter'
  | 'first'
  | 'last'
  | 'replay'
  | 'mute'
  | 'ids'
  | 'help';

/** What a key press means for the tour; null when it means nothing here. */
export function keyCommand(key: string, shift = false): KeyCommand | null {
  switch (key) {
    case ' ':
    case 'k':
    case 'K':
      return 'toggle';
    case 'ArrowRight':
      return shift ? 'nextSentence' : 'next';
    case 'ArrowLeft':
      return shift ? 'prevSentence' : 'prev';
    case 'PageDown':
      return 'next';
    case 'PageUp':
      return 'prev';
    case ']':
      return 'nextChapter';
    case '[':
      return 'prevChapter';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'r':
    case 'R':
      return 'replay';
    case 'm':
    case 'M':
      return 'mute';
    case 'd':
    case 'D':
      return 'ids';
    case '?':
      return 'help';
    default:
      return null;
  }
}

/** The part of a DOM element the check needs, so it can be tested without a DOM. */
export interface KeyTarget {
  isContentEditable?: boolean;
  closest?(selector: string): unknown;
}

/**
 * Whether the focused element keeps this key for itself: typing in a field or a menu uses the
 * arrows and letters; a button, link or summary only uses Space and Enter. Any other key (the arrows
 * after a click on Play, say) still steers the tour.
 */
export function keyBelongsTo(target: KeyTarget | null, key: string): boolean {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.isContentEditable || target.closest('input, textarea, select, [role="listbox"], [role="textbox"], dialog')) return true;
  return !!target.closest('button, a, summary') && (key === ' ' || key === 'Enter');
}

/** The keys the reader answers to, for the help list. */
export const KEY_HELP: { keys: string[]; does: string }[] = [
  { keys: ['Space', 'K'], does: 'Play or pause' },
  { keys: ['←', '→'], does: 'Previous or next step' },
  { keys: ['Shift ←', 'Shift →'], does: 'Previous or next sentence' },
  { keys: ['[', ']'], does: 'Previous or next chapter' },
  { keys: ['Home', 'End'], does: 'First or last step' },
  { keys: ['R'], does: 'Replay this sentence' },
  { keys: ['M'], does: 'Mute or unmute' },
  { keys: ['H'], does: 'A hint, when you are asked to try' },
  { keys: ['/'], does: 'Ask a question' },
  { keys: ['D'], does: 'Show element IDs' },
  { keys: ['?'], does: 'This list' },
];
