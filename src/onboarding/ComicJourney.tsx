import { useEffect, useRef, useState } from 'react';
import { journeyFrames, journeyMusic, normalizeJourneyFrame } from './journeyFrames';
import { createJourneyPlayer, type JourneyState } from './journeyPlayer';
import './comic-journey.css';

export function ComicJourney({ initialFrame = 0, motion, muted = false, saving, onFrame, onContinue }: {
  initialFrame?: number; motion: boolean; muted?: boolean; saving: boolean; onFrame: (frame: number) => void; onContinue: () => void;
}) {
  const first = useRef<HTMLImageElement>(null), second = useRef<HTMLImageElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const player = useRef<ReturnType<typeof createJourneyPlayer>>();
  const callbacks = useRef({ onFrame, onContinue }); callbacks.current = { onFrame, onContinue };
  const motionRef = useRef(motion); motionRef.current = motion;
  const [state, setState] = useState<JourneyState>(() => ({ frame: normalizeJourneyFrame(initialFrame), playing: motion, loading: false, error: '' }));
  useEffect(() => {
    if (!first.current || !second.current) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const current = createJourneyPlayer({
      layers: [first.current, second.current], initialFrame, motion: motionRef.current && !preference.matches, audio: audio.current ?? undefined,
      onState: setState, onFrame: frame => callbacks.current.onFrame(frame), onComplete: () => callbacks.current.onContinue(),
    });
    player.current = current;
    const visibility = () => { if (document.hidden) current.pause(); };
    const reduce = () => { current.setMotion(motionRef.current && !preference.matches); if (preference.matches) current.pause(); };
    document.addEventListener('visibilitychange', visibility); preference.addEventListener('change', reduce);
    return () => { current.dispose(); player.current = undefined; document.removeEventListener('visibilitychange', visibility); preference.removeEventListener('change', reduce); };
  }, []);
  useEffect(() => { player.current?.setMotion(motion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches); }, [motion]);
  useEffect(() => { if (saving) player.current?.pause(); }, [saving]);
  const atEnd = state.frame === journeyFrames.length - 1;
  return <section className="inn-journey" aria-label="狐狸带你环游世界">
    <div className="inn-journey-pictures"><img ref={first} alt="" /><img ref={second} alt="" aria-hidden="true" /></div>
    <audio ref={audio} src={journeyMusic} preload="auto" muted={muted} />
    <p className="inn-journey-caption" key={journeyFrames[state.frame].scene} aria-live="polite">{journeyFrames[state.frame].caption}</p>
    {(state.loading || state.error) && <div className="inn-journey-notice" role="status">{state.error || '图片正在展开…'}{state.error && <button onClick={() => player.current?.retry()}>重试</button>}</div>}
    {state.audioBlocked && <div className="inn-journey-notice" role="status">点“播放”继续旅行。</div>}
    <nav className="inn-journey-controls" aria-label="旅行控制">
      <button disabled={saving} onClick={() => state.playing ? player.current?.pause() : atEnd ? onContinue() : player.current?.play()}>{state.playing ? '暂停' : atEnd ? '继续' : '播放'}</button>
      <button disabled={saving} onClick={() => { player.current?.pause(); onContinue(); }}>跳过旅行</button>
    </nav>
  </section>;
}
