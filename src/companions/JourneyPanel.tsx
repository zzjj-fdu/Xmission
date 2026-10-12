import { useEffect, useRef, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { listTasks, onTasksChanged, type Task } from '../api/tasks'
import type { ThemeKey } from '../themes'
interface Chapter { id: string; theme: ThemeKey; taskId: string | null; node: number; paused: boolean; bag: string | null; route: string | null; discovery: string | null; gameBest: number | null }
interface Keepsake { id: string; theme: ThemeKey; name: string; story: string; collectedAt: string }
interface JourneyHome { chapter: Chapter | null; keepsakes: Keepsake[]; commissionReady: boolean }
const stages = ['整理行囊', '选择路线', '中途发现', '小小委托', '带回纪念物']
const discoveries: Record<ThemeKey, Record<string, string>> = {
  'pixel-jrpg': { 'hidden-star': '罗盘指向一处隐蔽的亮光，找到了一枚星点线索。', 'old-ticket': '记录本帮我们辨认出一张旧驿站票，目的地有了眉目。', 'river-stone': '顺着罗盘来到水边，找到一块被水磨亮的符石。', 'leaf-page': '我们收好一片叶子，留下了这一程的颜色。' },
  'parchment-journal': { 'hidden-star': '折页地图露出旧车站的标记，我们找到了一张盖过章的车票。', 'old-ticket': '手账中的票据拼出了新的地址，旅行页又多了一条线索。', 'river-stone': '地图带我们来到河岸，捡到一张蓝色的渡船票。', 'leaf-page': '一片漂亮的叶子压进手账，今天有了自己的颜色。' },
  'animal-crossing': { 'hidden-star': '探路地图带我们走到瀑布边，找到一块闪亮的海玻璃。', 'old-ticket': '采集手册记下了瀑布边的圆石，可以拿去做小挂饰。', 'river-stone': '沿着地图来到海滩，收好了一枚奶油色贝壳。', 'leaf-page': '我们在海滩找到了柔软的叶片，准备给伙伴做一件小物。' },
  'stardew-valley': { 'hidden-star': '田间指南帮我们选好一小块高地，果实作物结出了适合带去集市的收获。', 'old-ticket': '作物记录本留下了高地的种植线索，收成可以留作下一次的种子。', 'river-stone': '河岸的小菜地收获了新鲜叶菜，正好带去集市委托。', 'leaf-page': '我们记下河岸叶菜的生长过程，收好一份自己的小收获。' },
}
const copy: Record<ThemeKey, { title: string; bags: string[]; routes: string[]; place: string; item: string }> = {
  'pixel-jrpg': { title: '星图归途', bags: ['带上寻星罗盘', '带上冒险记录本'], routes: ['走山道，寻找星图', '沿河谷，拜访驿站'], place: '驿站', item: '归途星图章' },
  'parchment-journal': { title: '山谷旅行页', bags: ['带上折页地图', '带上票据手账'], routes: ['翻过山岭，寻找旧票据', '沿河散步，记录叶片'], place: '旅行记录页', item: '山谷旅行页' },
  'animal-crossing': { title: '河岸的小发现', bags: ['带上探路地图', '带上采集手册'], routes: ['去瀑布，找闪亮材料', '去海滩，拾手作叶片'], place: '手作小摊', item: '河岸手作挂饰' },
  'stardew-valley': { title: '河岸集市', bags: ['带上田间指南', '带上作物记录本'], routes: ['去高地，选择果实作物', '去河岸，选择叶菜作物'], place: '河岸集市', item: '集市收获篮' },
}
export function JourneyPanel({ theme, game }: { theme: ThemeKey; game: (onWin: (moves: number) => void) => ReactNode }) {
  const [home, setHome] = useState<JourneyHome | null>(null), [tasks, setTasks] = useState<Task[]>([]), [taskId, setTaskId] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), gate = useRef(false)
  const c = home?.chapter, style = copy[c?.theme ?? theme]
  const refresh = async () => { const data = await invoke<JourneyHome>('get_journey'); setHome(data); setTaskId(data.chapter?.taskId ?? ''); setTasks(await listTasks()) }
  useEffect(() => {
    let disposed = false
    const load = () => { void Promise.all([invoke<JourneyHome>('get_journey'), listTasks()]).then(([data, t]) => { if (!disposed) { setHome(data); setTaskId(data.chapter?.taskId ?? ''); setTasks(t) } }).catch(e => { if (!disposed) setError(String(e)) }) }
    load(); const subscriptions = [listen('journey-changed', load), onTasksChanged(load)]
    return () => { disposed = true; for (const sub of subscriptions) void sub.then(fn => fn()).catch(() => {}) }
  }, [])
  const action = async (action: string, extra: Record<string, unknown> = {}) => {
    if (gate.current) return
    gate.current = true; setBusy(true); setError('')
    try { await invoke('journey_action', { input: { requestId: crypto.randomUUID(), action, id: c?.id ?? null, expectedNode: c?.node ?? null, theme: c?.theme ?? theme, taskId: taskId || null, choice: null, moves: null, ...extra } }); await refresh() }
    catch (e) { setError(String(e)) } finally { gate.current = false; setBusy(false) }
  }
  const selectGoal = <label>关联一个真实目标<select value={taskId} onChange={e => setTaskId(e.target.value)} disabled={busy}><option value="">稍后选择</option>{tasks.filter(t => !['done', 'shelved'].includes(t.status)).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
  return <div className="xm-journey"><h3>{style.title}</h3><p className="xm-pet-menu-help">主动进入的五节点旅程。现实行动推进小委托，助理备资料不会推进或发奖。</p>
    {!c || c.node === 5 ? <>{c && <p>这章的纪念物已放进收藏。</p>}{selectGoal}<button className="xm-pet-menu-primary" disabled={busy || !home} onClick={() => void action('start', { id: null, expectedNode: null, theme })}>整理新一章的行囊</button></> : <>
      <ol className="xm-journey-map">{stages.map((label, index) => <li key={label} className={index < c.node ? 'is-done' : index === c.node ? 'is-current' : ''}><span>{index < c.node ? '✓' : index + 1}</span><small>{label}</small></li>)}</ol>
      <button disabled={busy} onClick={() => void action(c.paused ? 'resume' : 'pause')}>{c.paused ? '继续这段旅程' : '暂停，忙完再回来'}</button>
      {c.paused ? <p>行囊替你留着，休息不会失去已经发现的东西。</p> : <>
        {c.node === 0 && <><p>有限的行囊只能带一样主要道具。它会影响路上发现的线索。</p>{style.bags.map((label, i) => <button key={label} disabled={busy} onClick={() => void action('bag', { choice: i === 0 ? 'compass' : 'notebook' })}>{label}</button>)}</>}
        {c.node === 1 && <><p>地图分成两条路，你来决定今天往哪边走。</p>{style.routes.map((label, i) => <button key={label} disabled={busy} onClick={() => void action('route', { choice: i === 0 ? 'ridge' : 'river' })}>{label}</button>)}</>}
        {c.node >= 2 && <p className="xm-pet-dialogue">{discoveries[c.theme][c.discovery ?? 'leaf-page']}</p>}
        {c.node === 2 && <><p>配对路上的小发现，找齐三对就能去{style.place}。</p>{game(moves => void action('play', { moves }))}</>}
        {c.node === 3 && <><p>{style.place}有一个小委托：推进并完成你关联的真实目标，再回来交付。</p>{c.taskId ? <button disabled={busy} onClick={() => void invoke('open_preparation_task', { taskId: c.taskId }).catch(e => setError(String(e)))}>去原任务行动</button> : <p>请先选择一个目标。时间变了，可以在下面更换。</p>}<button className="xm-pet-menu-primary" disabled={busy || !home?.commissionReady} onClick={() => void action('commission')}>{home?.commissionReady ? '交付小委托' : '等实际行动完成'}</button><details><summary>再玩一轮配对</summary>{game(moves => void action('play', { moves }))}</details></>}
        {c.node === 4 && <><p>小委托完成了。这一程确定会带回「{style.item}」。</p><button className="xm-pet-menu-primary" disabled={busy} onClick={() => void action('claim')}>带回纪念物</button></>}
      </>}
      <details><summary>更换关联目标</summary>{selectGoal}<button disabled={busy} onClick={() => void action('link')}>关联这个目标</button><small>更换后从新目标的实际行动开始计算；不会复制任务，正文也不会写进故事。</small></details>
      {c.gameBest !== null && <small>这一程最好成绩：{c.gameBest} 步</small>}
    </>}
    {error && <p className="xm-pet-menu-error" role="alert">{error}</p>}
    {home?.keepsakes.length ? <details><summary>章节收藏 · {home.keepsakes.length}</summary>{home.keepsakes.map(k => <article className="xm-journey-keepsake" key={k.id}><strong>✦ {k.name}</strong><p>{k.story}</p><small>{new Date(k.collectedAt).toLocaleDateString('zh-CN')}</small></article>)}</details> : null}
  </div>
}
export function JourneyCollection() {
  const [items, setItems] = useState<Keepsake[]>([])
  useEffect(() => { let alive = true; void invoke<JourneyHome>('get_journey').then(h => { if (alive) setItems(h.keepsakes) }).catch(() => {}); return () => { alive = false } }, [])
  return items.length ? <section><h3>旅程章节纪念物</h3>{items.map(k => <article className="xm-journey-keepsake" key={k.id}><strong>✦ {k.name}</strong><p>{k.story}</p></article>)}</section> : null
}
