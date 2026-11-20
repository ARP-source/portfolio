/**
 * The one channel between the DOM and the Field. Components emit; the Field only listens.
 * Nothing reaches into another module's internals.
 */
export type Formation = 'swarm' | 'trace' | 'raster' | 'hand' | 'drift' | 'recover' | 'thread';
export type Tier = 'high' | 'mid' | 'static';

export interface FieldEvents {
  'section:enter': { id: string; rect: DOMRectReadOnly };
  'section:leave': { id: string };
  'field:tier': { tier: Tier; particles: number; reason: string };
  'field:pause': { paused: boolean };
  // Phase 4 (demo) and Phase 5 (thread) events, declared now so the contract is fixed.
  /** The demo stage is wired up (on) or gone (off); the Field forms nothing there until on. */
  'emg:stage': { on: boolean };
  /** RMS envelope of the replayed recording, 0 (at rest) .. 1 (the loudest clip). */
  'emg:envelope': { rms: number };
  /** The classifier's label for the latest window ('rest' when nothing is held), and its posterior. */
  'emg:prediction': { gesture: 'rest' | 'close' | 'open' | 'pinch' | 'point'; p: number };
  /** Measured held-out accuracy now, and on day 1 (the clean baseline the loss is measured from). */
  'emg:drift': { accuracy: number; baseline: number };
  'emg:recalibrated': { accuracy: number; baseline: number };
}

type Handler<K extends keyof FieldEvents> = (detail: FieldEvents[K]) => void;

class Bus {
  #t = new EventTarget();
  #last = new Map<keyof FieldEvents, unknown>();
  emit<K extends keyof FieldEvents>(type: K, detail: FieldEvents[K]): void {
    this.#last.set(type, detail);
    this.#t.dispatchEvent(new CustomEvent(type, { detail }));
  }
  on<K extends keyof FieldEvents>(type: K, fn: Handler<K>): () => void {
    const h = (e: Event) => fn((e as CustomEvent<FieldEvents[K]>).detail);
    this.#t.addEventListener(type, h);
    return () => this.#t.removeEventListener(type, h);
  }
  /** Last value of an event, for listeners that attach late (the Field loads after paint). */
  last<K extends keyof FieldEvents>(type: K): FieldEvents[K] | undefined {
    return this.#last.get(type) as FieldEvents[K] | undefined;
  }
}

export const bus = new Bus();
