import { journeyFrames, journeyDuration, journeyFrameAt, normalizeJourneyFrame } from './journeyFrames';

export interface JourneyState { frame: number; playing: boolean; loading: boolean; error: string; audioBlocked?: boolean; }
interface Options {
  layers: [HTMLImageElement, HTMLImageElement];
  initialFrame: number;
  motion: boolean;
  audio?: HTMLAudioElement;
  onState: (state: JourneyState) => void;
  onFrame: (frame: number) => void;
  onComplete: () => void;
}

/** Decoded-image handoff: an old picture stays opaque underneath its successor. */
export function createJourneyPlayer(options: Options) {
  const cache = new Map<number, Promise<HTMLImageElement>>();
  const decoded = new Set<number>();
  let state: JourneyState = { frame: normalizeJourneyFrame(options.initialFrame), playing: options.motion, loading: false, error: '' };
  let alive = true, pending = false, active = 0, shown = false, request = 0, completed = false, motion = options.motion;
  let requestedFrame = state.frame;
  let audioRequest = 0;
  let timer: number | undefined, loadingTimer: number | undefined, transition: Animation | undefined;
  const emit = () => { if (alive) options.onState({ ...state }); };
  const clearTimer = () => window.clearTimeout(timer);
  function load(frame: number) {
    if (!cache.has(frame)) {
      const image = new Image();
      const promise = new Promise<HTMLImageElement>((resolve, reject) => {
        image.onload = async () => {
          try { await image.decode?.(); decoded.add(frame); resolve(image); }
          catch (error) { cache.delete(frame); reject(error); }
        };
        image.onerror = error => { cache.delete(frame); reject(error); };
      });
      cache.set(frame, promise); image.src = journeyFrames[frame].src;
    }
    return cache.get(frame)!;
  }
  function preload(frame: number) {
    for (let ahead = frame + 1; ahead <= Math.min(frame + 3, journeyFrames.length - 1); ahead++) void load(ahead).catch(() => {});
    for (const saved of cache.keys()) if (saved < frame - 1 || saved > frame + 3) { cache.delete(saved); decoded.delete(saved); }
  }
  function reveal(image: HTMLImageElement, frame: number) {
    transition?.cancel(); transition = undefined;
    const outgoing = options.layers[active]; outgoing.style.opacity = '1'; outgoing.style.zIndex = '0';
    const slot = shown ? 1 - active : active, incoming = options.layers[slot];
    incoming.src = image.src; incoming.alt = journeyFrames[frame].description;
    incoming.style.opacity = '1'; incoming.style.zIndex = '1'; incoming.setAttribute('aria-hidden', 'false');
    if (incoming !== outgoing) outgoing.setAttribute('aria-hidden', 'true');
    const sameScene = journeyFrames[state.frame].scene === journeyFrames[frame].scene;
    const duration = shown && motion ? (sameScene ? 100 : 420) : 0;
    active = slot; shown = true;
    if (duration && typeof incoming.animate === 'function') {
      const animation = incoming.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration, easing: sameScene ? 'linear' : 'cubic-bezier(.4,0,.2,1)', fill: 'forwards',
      });
      transition = animation;
      void animation.finished.then(() => {
        if (transition !== animation) return;
        outgoing.style.opacity = '0'; animation.cancel(); transition = undefined;
      }).catch(() => {});
    } else if (incoming !== outgoing) outgoing.style.opacity = '0';
  }
  function schedule() {
    clearTimer();
    if (!alive || pending || !shown || !state.playing || completed) return;
    const end = journeyFrames[state.frame].start + journeyFrames[state.frame].duration;
    const delay = options.audio ? Math.max(10, end - options.audio.currentTime * 1000) : journeyFrames[state.frame].duration;
    timer = window.setTimeout(() => {
      if (options.audio) {
        const time = options.audio.currentTime * 1000;
        if (options.audio.ended || time >= journeyDuration - 1) { finish(); return; }
        const target = journeyFrameAt(time);
        if (target !== state.frame) void show(target); else schedule();
      } else if (state.frame < journeyFrames.length - 1) void show(state.frame + 1);
      else finish();
    }, delay);
  }
  function finish() { if (!alive || completed) return; completed = true; state.playing = false; options.audio?.pause(); emit(); options.onComplete(); }
  function startSound() {
    if (!options.audio) { schedule(); return; }
    if (!options.audio.paused) { schedule(); return; }
    const ticket = ++audioRequest;
    try {
      void options.audio.play().then(() => { if (alive && state.playing && ticket === audioRequest) schedule(); }).catch(() => {
        if (!alive || ticket !== audioRequest) return; state.playing = false; state.audioBlocked = true; clearTimer(); emit();
      });
    } catch { state.playing = false; state.audioBlocked = true; emit(); }
  }
  async function show(frame: number) {
    clearTimer(); window.clearTimeout(loadingTimer);
    const current = ++request; requestedFrame = frame; pending = true; state.loading = false; state.error = ''; emit();
    if (!decoded.has(frame)) options.audio?.pause();
    loadingTimer = window.setTimeout(() => { if (alive && current === request) { state.loading = true; emit(); } }, 180);
    try {
      const image = await load(frame);
      if (!alive || current !== request) return;
      window.clearTimeout(loadingTimer);
      if (!shown && options.audio) options.audio.currentTime = journeyFrames[frame].start / 1000;
      reveal(image, frame);
      state.frame = frame; state.loading = false; pending = false; emit();
      options.onFrame(frame); preload(frame); if (state.playing) startSound();
    } catch {
      if (!alive || current !== request) return;
      window.clearTimeout(loadingTimer); pending = false;
      state.playing = false; options.audio?.pause(); state.loading = false; state.error = '图片暂时没有展开。'; emit();
    }
  }
  function pause() { clearTimer(); audioRequest++; state.playing = false; options.audio?.pause(); emit(); }
  function play() {
    if (!alive || completed) return;
    state.playing = true; state.audioBlocked = false; emit();
    if (state.error) void show(requestedFrame); else if (shown && !pending) startSound();
  }
  function dispose() {
    alive = false; request++; audioRequest++; clearTimer(); window.clearTimeout(loadingTimer); transition?.cancel(); options.audio?.pause(); cache.clear(); decoded.clear();
  }
  void show(state.frame);
  return {
    pause, play, dispose,
    retry: () => { if (alive) void show(requestedFrame); },
    seek: (frame: number) => { if (!alive) return; pause(); completed = false; const target = normalizeJourneyFrame(frame); if (options.audio) options.audio.currentTime = journeyFrames[target].start / 1000; void show(target); },
    setMotion: (value: boolean) => {
      motion = value;
      if (!motion && shown) { transition?.cancel(); transition = undefined; options.layers[active].style.opacity = '1'; options.layers[1 - active].style.opacity = '0'; }
    },
  };
}
