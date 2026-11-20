import type { Tier } from './bus';
import type { Rect } from './thread-line';

/**
 * What the field remembers while the visitor moves between pages (sessionStorage, this tab only):
 * the tier the fps probe settled on, so later pages start there without probing again; the line
 * of the project card that was just opened, so its dots can stream on into the project's page;
 * and which ordering of the project list the visitor came from, for the way back.
 */
export interface Session {
  tier?: Tier;
  reason?: string;
  thread?: { slug: string; rect: Rect; ys: number[]; at: number } | undefined;
  list?: string;
}

const KEY = 'signal:field';

export function readSession(): Session {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Session;
  } catch {
    return {};
  }
}

export function writeSession(patch: Partial<Session>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...readSession(), ...patch }));
  } catch {
    // Storage off (private mode, quota): every page simply starts fresh.
  }
}
