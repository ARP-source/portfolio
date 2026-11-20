/**
 * The guided demo (Demo.astro). Replays the participant's recorded EMG while the visitor holds,
 * classifies each window with the in-browser LDA, and tells the Field what to show over the bus.
 * Every number it prints is computed here, from the exported recordings.
 */
import { bus, type FieldEvents } from '../scripts/bus';
import { loadEmg, stack, type Clip } from './emg';
import { accuracy, addWindows, fit, posterior, type LdaModel, type LdaStats } from './lda';
import { mountMap } from './turntable';

const POSE = ['close', 'open', 'pinch', 'point'] as const;
const NAME = ['hand close', 'hand open', 'pinch', 'point'];
const WIN_S = 0.2;
const STEP_S = 0.05;
/** A shorter hold does not count as a recalibration round. */
const ROUND_S = 1;
const PLAY_S = 3;
const ROUNDS = 3;

export async function mountDemo(root: HTMLElement): Promise<void> {
  const emg = await loadEmg(root.dataset.src);
  // The visitor moved to another page while the recordings loaded.
  if (!root.isConnected) return;
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const scope = $('.scope');
  const steps = [...root.querySelectorAll<HTMLLIElement>('.steps > li')];
  const holdBtn = $<HTMLButtonElement>('[data-hold]');
  const recalBtn = $<HTMLButtonElement>('[data-recal]');
  const recalAdd = $<HTMLButtonElement>('[data-recal-add]');
  const skipBtn = $<HTMLButtonElement>('[data-skip]');
  const resetBtn = $<HTMLButtonElement>('[data-reset]');
  const pred = $<HTMLOutputElement>('[data-pred]');
  const status = $('[data-status]');
  const tracePath = $<SVGPathElement>('[data-trace]');
  const traceAll = $<SVGPathElement>('[data-trace-all]');
  const reveal = $<SVGRectElement>('[data-reveal]');
  const cursor = $<SVGLineElement>('[data-cursor]');
  const W = 960, H = 160;
  const scale = Number(root.dataset.scale) || 1;

  const tested = (day: number) => stack(emg.clips.filter((c) => c.day === day && c.role !== 'recal'));
  const t1 = tested(1), t29 = tested(29);
  const base = fit(emg.stats);
  const A1 = accuracy(base, t1.rows, t1.labels);
  const A29 = accuracy(base, t29.rows, t29.labels);
  /** RMS over the last 200 ms (the classifier's window) from the 10 ms envelope samples. */
  const rmsAt = (c: Clip, t: number) => {
    const e = c.envelope!, hz = c.envelopeHz!;
    const end = Math.min(e.length, Math.floor(t * hz) + 1), n = Math.round(WIN_S * hz);
    let sq = 0, k = 0;
    for (let i = Math.max(0, end - n); i < end; i++, k++) sq += e[i]! * e[i]!;
    return k ? Math.sqrt(sq / k) : 0;
  };
  // Envelope scale: the loudest 200 ms of any clip the demo plays is full recruitment.
  const envMax = Math.max(...emg.clips.flatMap((c) => (c.envelope ? Array.from(c.envelope, (_, i) => rmsAt(c, i / c.envelopeHz!)) : [])));

  const st = { gesture: 0, day: 1 as 1 | 29, rounds: 0, stats: emg.stats, model: base as LdaModel, recal: [] as number[], held: false };
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  // ------------------------------------------------------------------ the trace

  const clip = (): Clip => emg.clips.find((c) => c.day === st.day && c.gesture === st.gesture && c.role === 'play+test')!;
  const path = (tr: ArrayLike<number>) =>
    Array.from(tr, (v, i) => `${i ? 'L' : 'M'}${((i / (tr.length - 1)) * W).toFixed(1)} ${(H / 2 - (v / scale) * H * 0.46).toFixed(1)}`).join('');
  // ------------------------------------------------------------------ the map

  const map = mountMap(root, emg.meta.model.map, emg.stats);
  const drawClouds = (stats: LdaStats) => map.setClouds(stats);

  let pos = 0; // seconds into the clip
  const showClip = () => {
    const c = clip();
    map.clearDots();
    map.mine(st.gesture);
    const d = path(c.trace!);
    tracePath.setAttribute('d', d);
    traceAll.setAttribute('d', d);
    pos = 0;
    drawAt(0);
    $('[data-pair]').textContent = c.pair!;
    $('[data-gesture-label]').textContent = NAME[st.gesture]!;
    $('[data-day-label]').textContent = `Day ${st.day}`;
    scope.dataset.day = String(st.day);
  };
  const drawAt = (t: number) => {
    const x = (t / duration(clip())) * W;
    reveal.setAttribute('width', String(x));
    cursor.setAttribute('x1', String(x));
    cursor.setAttribute('x2', String(x));
  };
  const duration = (c: Clip) => c.envelope!.length / c.envelopeHz!;

  // ------------------------------------------------------------------ playing

  let raf = 0, last = 0, win = -1, heldFor = 0, until = 0;
  let mode: 'play' | 'recal' = 'play';
  let votes = [0, 0, 0, 0], conf = [0, 0, 0, 0];
  let activeBtn: HTMLButtonElement | null = null;

  const emit = <K extends keyof FieldEvents>(k: K, d: FieldEvents[K]) => bus.emit(k, d);

  const start = (m: 'play' | 'recal', btn: HTMLButtonElement | null, seconds = 0) => {
    if (raf) return;
    mode = m;
    activeBtn = btn;
    btn?.setAttribute('aria-pressed', 'true');
    root.dataset.playing = '';
    votes = [0, 0, 0, 0];
    conf = [0, 0, 0, 0];
    win = -1;
    heldFor = 0;
    until = seconds;
    map.ageDots();
    map.holding(true);
    if (pos >= duration(clip()) - STEP_S) pos = 0;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const tick = (now: number) => {
    // rAF timestamps are frame starts and can precede the performance.now() taken in start().
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    heldFor += dt;
    const c = clip();
    const dur = duration(c);
    pos += dt;
    if (pos >= dur) {
      pos -= dur;
      win = -1;
    }
    drawAt(pos);
    emit('emg:envelope', { rms: rmsAt(c, pos) / envMax });
    // The window that has just finished: the classifier can only label a window once it is complete.
    const i = Math.min(c.rows.length - 1, Math.max(0, Math.floor((pos - WIN_S) / STEP_S)));
    if (pos >= WIN_S && i !== win) {
      win = i;
      const p = posterior(st.model, c.rows[i]!);
      const k = p.indexOf(Math.max(...p));
      votes[k]!++;
      conf[k]! += p[k]!;
      emit('emg:prediction', { gesture: POSE[k]!, p: p[k]! });
      map.addDot(c.rows[i]!, k === st.gesture);
      map.pick(k);
      pred.textContent = `${NAME[k]}, ${Math.round(p[k]! * 100)}%${k === st.gesture ? '' : ' (misread)'}`;
      pred.toggleAttribute('data-wrong', k !== st.gesture);
    }
    if (activeBtn) activeBtn.style.setProperty('--held', String(Math.min(1, heldFor / (mode === 'recal' ? ROUND_S : PLAY_S))));
    if (until && heldFor >= until) return stop();
    raf = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
    delete root.dataset.playing;
    activeBtn?.setAttribute('aria-pressed', 'false');
    activeBtn?.style.removeProperty('--held');
    activeBtn = null;
    emit('emg:envelope', { rms: 0 });
    emit('emg:prediction', { gesture: 'rest', p: 1 });
    map.pick(-1);
    map.holding(false);
    const n = votes.reduce((a, b) => a + b, 0);
    if (!n) return;
    const k = votes.indexOf(Math.max(...votes));
    const sure = Math.round((conf[k]! / votes[k]!) * 100);
    const wrongShare = 1 - votes[st.gesture]! / n;
    let msg = `Classified: ${NAME[k]}, ${sure}% confident.`;
    if (k !== st.gesture) msg += ` You held ${NAME[st.gesture]}.`;
    else if (wrongShare > 0.05) msg += ` ${Math.round(wrongShare * 100)}% of windows were misread.`;
    if (mode === 'recal' && heldFor >= ROUND_S) msg = addRound();
    else if (mode === 'recal') msg += ` Hold for at least ${ROUND_S} s to record a round.`;
    say(msg);
    if (st.day === 1) setStep(3);
    else if (!st.rounds) setStep(4);
  };

  // ------------------------------------------------------------------ the sequence

  const say = (msg: string) => {
    // Same text twice in a row is not re-announced by every screen reader; clear first.
    status.textContent = '';
    requestAnimationFrame(() => (status.textContent = msg));
  };
  const setStep = (n: number) => steps.forEach((li, i) => (i + 1 === n ? li.setAttribute('aria-current', 'step') : li.removeAttribute('aria-current')));

  const skip = () => {
    stop();
    st.day = 29;
    root.dataset.skipped = '';
    skipBtn.hidden = true;
    resetBtn.hidden = false;
    $('[data-after-skip]').hidden = false;
    recalBtn.disabled = recalAdd.disabled = false;
    showClip();
    emit('emg:drift', { accuracy: A29, baseline: A1 });
    say(`Drift detected. The day-1 model gets ${pct(A29)} of held-out day-29 windows right, down from ${pct(A1)} on day 1.`);
    setStep(2);
  };

  const addRound = (): string => {
    if (st.rounds >= ROUNDS) return 'Already recalibrated with all three rounds.';
    st.rounds++;
    const r = stack(emg.clips.filter((c) => c.day === 29 && c.role === 'recal' && c.trial === st.rounds));
    st.stats = addWindows(st.stats, r.rows, r.labels);
    st.model = fit(st.stats);
    drawClouds(st.stats);
    const a = accuracy(st.model, t29.rows, t29.labels);
    st.recal.push(a);
    root.dataset.recalibrating = '';
    scope.dataset.recalibrated = '';
    $('[data-recal-values]').textContent = st.recal.map(pct).join(' · ');
    $('[data-rounds]').textContent = `${st.rounds} of ${ROUNDS}`;
    emit('emg:recalibrated', { accuracy: a, baseline: A1 });
    if (st.rounds < ROUNDS) return `Round ${st.rounds} of ${ROUNDS} added: ${pct(a)} of held-out day-29 windows right.`;
    recalBtn.disabled = recalAdd.disabled = true;
    $('[data-done]').hidden = false;
    setStep(0);
    return `Recalibrated: ${pct(a)} on day 29, from ${pct(A29)} before, with three repetitions of each gesture.`;
  };

  const reset = () => {
    stop();
    Object.assign(st, { day: 1, rounds: 0, stats: emg.stats, model: base, recal: [] });
    drawClouds(emg.stats);
    delete root.dataset.skipped;
    delete root.dataset.recalibrating;
    delete scope.dataset.recalibrated;
    skipBtn.hidden = false;
    resetBtn.hidden = true;
    $('[data-after-skip]').hidden = true;
    $('[data-done]').hidden = true;
    recalBtn.disabled = recalAdd.disabled = true;
    $('[data-recal-values]').textContent = '–';
    $('[data-rounds]').textContent = `0 of ${ROUNDS}`;
    pred.textContent = 'nothing yet';
    pred.removeAttribute('data-wrong');
    showClip();
    emit('emg:drift', { accuracy: A1, baseline: A1 });
    say('Back to day 1, with the original day-1 model.');
    setStep(2);
    skipBtn.focus();
  };

  // ------------------------------------------------------------------ controls

  /** Press and hold with a pointer, or Space/Enter while the button has focus. */
  const holdable = (btn: HTMLButtonElement, m: 'play' | 'recal') => {
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || btn.disabled) return;
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic or already-released pointer: the pointerup listener still ends the hold */
      }
      start(m, btn);
    });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) btn.addEventListener(t, () => activeBtn === btn && stop());
    btn.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      if (!e.repeat) start(m, btn);
    });
    btn.addEventListener('keyup', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      if (activeBtn === btn) stop();
    });
    btn.addEventListener('blur', () => activeBtn === btn && stop());
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  holdable(holdBtn, 'play');
  holdable(recalBtn, 'recal');
  $<HTMLButtonElement>('[data-play]').addEventListener('click', () => start('play', null, PLAY_S));
  recalAdd.addEventListener('click', () => start('recal', null, PLAY_S));
  skipBtn.addEventListener('click', skip);
  resetBtn.addEventListener('click', reset);
  root.querySelectorAll<HTMLInputElement>('input[name="demo-gesture"]').forEach((r) =>
    r.addEventListener('change', () => {
      stop();
      st.gesture = Number(r.value);
      showClip();
      pred.textContent = 'nothing yet';
      pred.removeAttribute('data-wrong');
    }),
  );

  // Pause cleanly if the visitor scrolls away or switches tabs mid-hold.
  document.addEventListener('visibilitychange', () => document.hidden && stop());

  showClip();
  root.querySelectorAll<HTMLElement>('[data-js]').forEach((el) => (el.hidden = false));
  $('[data-recal-values]').textContent = '–';
  document.documentElement.dataset.demo = 'ready';
  setStep(2);
  emit('emg:stage', { on: true });
}
