import { useState } from 'react';
import { chapters } from './world';
export function WorldMap({ onContinue }: { onContinue: () => void }) {
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState(1);
  const chapter = chapters[selected];
  return <div className="inn-atlas-layout">
    <div className="inn-atlas-scroll" tabIndex={0} aria-label="航图，可滚动探索，使用章节标记阅读来信">
      <div className="inn-atlas-surface" style={{ width: `${zoom * 100}%` }}>
        <img src="/onboarding/atlas.png" alt="由纸、木头与毛毡构成的航图，十余片陆地散布在海上，航线跨越诸大陆" />
        {chapters.map((c, i) => <button key={c.id} className={`inn-map-pin ${i === selected ? 'is-selected' : ''}`} style={{ left: `${c.x}%`, top: `${c.y}%` }} aria-pressed={selected === i} onClick={() => setSelected(i)}><span className="inn-pin-dot" /><span>{c.land}</span></button>)}
      </div>
      <div className="inn-map-tools"><button onClick={() => setZoom(v => Math.max(1, v - .25))} disabled={zoom <= 1} aria-label="缩小地图">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(v => Math.min(2, v + .25))} disabled={zoom >= 2} aria-label="放大地图">＋</button></div>
    </div>
    <article className="inn-letter-card" key={chapter.id}>
      <small>{chapter.chapter} · {chapter.land}</small><h2>{chapter.title}</h2><p>{chapter.text}</p><blockquote>{chapter.note}</blockquote>
      <div className="inn-chapter-tabs" aria-label="目前展开的四封来信">{chapters.map((c, i) => <button key={c.id} onClick={() => setSelected(i)} aria-pressed={i === selected}>{i + 1}</button>)}</div>
      <p className="inn-note">账簿目前只整理到这四封。航图上的其他地方，还没有寄来消息。</p>
      <button className="inn-primary" onClick={onContinue}>合上航图</button>
    </article>
  </div>;
}
