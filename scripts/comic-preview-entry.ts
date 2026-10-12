import { createJourneyPlayer, type JourneyState } from '../src/onboarding/journeyPlayer';
import { journeyFrames } from '../src/onboarding/journeyFrames';

// Relative paths make this standalone preview portable when unzipped and opened offline.
for (const frame of journeyFrames) frame.src = frame.src.replace('/onboarding/journey-comic/', './');
const picture = document.getElementById('picture') as HTMLImageElement;
const buffer = document.getElementById('picture-next') as HTMLImageElement;
const music = document.getElementById('music') as HTMLAudioElement;
const count = document.getElementById('count')!;
const caption = document.getElementById('caption')!;
const play = document.getElementById('play') as HTMLButtonElement;
const previous = document.getElementById('previous') as HTMLButtonElement;
const next = document.getElementById('next') as HTMLButtonElement;
const loading = document.getElementById('loading')!;
const dots = document.getElementById('dots')!;
const toggle = document.getElementById('music-toggle') as HTMLButtonElement;
let state: JourneyState = { frame: 0, playing: false, loading: false, error: '' }, ended = false;
const preference = matchMedia('(prefers-reduced-motion:reduce)');
function update(value: JourneyState) {
  state = value;
  count.textContent = `${value.frame + 1} / ${journeyFrames.length}`;
  caption.textContent = journeyFrames[value.frame].caption;
  play.textContent = value.playing ? '暂停' : ended ? '重看' : '播放';
  previous.disabled = value.frame === 0; next.disabled = value.frame === journeyFrames.length - 1;
  loading.classList.toggle('visible', value.loading || !!value.error || !!value.audioBlocked);
  loading.textContent = value.error || (value.audioBlocked ? '点击播放，开始旅行。' : '图片正在展开…');
  [...dots.children].forEach((dot, i) => dot.setAttribute('aria-current', String(i === Math.floor(value.frame / 3))));
}
const player = createJourneyPlayer({ layers: [picture, buffer], initialFrame: 0, motion: !preference.matches, audio: music,
  onState: update, onFrame: () => {}, onComplete: () => { ended = true; update(state); },
});
function seek(frame: number) { ended = false; player.seek(Math.max(0, Math.min(journeyFrames.length - 1, frame))); }
for (let i = 0; i < journeyFrames.length; i += 3) {
  const dot = document.createElement('button'); dot.setAttribute('aria-label', `场景 ${i / 3 + 1}：${journeyFrames[i].description}`);
  dot.onclick = () => seek(i); dots.append(dot);
}
play.onclick = () => { if (state.playing) player.pause(); else { if (ended) seek(0); player.play(); } };
previous.onclick = () => seek(state.frame - 1); next.onclick = () => seek(state.frame + 1);
toggle.onclick = () => { music.muted = !music.muted; toggle.textContent = music.muted ? '音乐关' : '音乐开'; toggle.setAttribute('aria-pressed', String(!music.muted)); };
document.addEventListener('keydown', event => {
  if (event.key === 'ArrowRight') { event.preventDefault(); seek(state.frame + 1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); seek(state.frame - 1); }
  if (event.code === 'Space' && event.target === document.body) { event.preventDefault(); play.click(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) player.pause(); });
preference.addEventListener('change', () => { player.setMotion(!preference.matches); if (preference.matches) player.pause(); });
window.addEventListener('pagehide', () => player.dispose());
