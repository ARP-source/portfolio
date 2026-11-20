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
  'emg:envelope': { rms: number };
  'emg:prediction': { gesture: string; p: number };
  'emg:drift': { accuracy: number };
  'emg:recalibrated': { accuracy: number };
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
