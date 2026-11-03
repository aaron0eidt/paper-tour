import type { SpeechAudio } from '../../../shared/speech';

/** A clip is decoded before handoff, while its predecessor is still speaking. */
export class PreparedAudio {
  readonly element: HTMLAudioElement;
  readonly ready: Promise<void>;
  playable = false;
  private readonly url: string;
  private disposed = false;
  private stopWaiting: () => void = () => {};

  constructor(readonly data: SpeechAudio) {
    const bytes = Uint8Array.from(atob(data.audioBase64), (char) => char.charCodeAt(0));
    this.url = URL.createObjectURL(new Blob([bytes], { type: data.mimeType }));
    this.element = new Audio(this.url);
    this.element.preload = 'auto';
    this.ready = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.element.removeEventListener('canplay', playable);
        this.element.removeEventListener('error', failed);
      };
      const playable = () => {
        this.playable = true;
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error('The generated audio could not be played. Retry or choose another provider.'));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Audio did not become playable. Retry the selected speech provider.'));
      }, 20_000);
      this.stopWaiting = () => {
        cleanup();
        reject(new Error('Speech preparation cancelled.'));
      };
      this.element.addEventListener('canplay', playable, { once: true });
      this.element.addEventListener('error', failed, { once: true });
      if (this.element.readyState >= 3) playable();
    });
    // Background preparation can fail before a foreground consumer awaits it.
    void this.ready.catch(() => {});
    this.element.load();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWaiting();
    this.element.onended = this.element.onerror = null;
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
    URL.revokeObjectURL(this.url);
  }
}
