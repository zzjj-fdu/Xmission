import {useEffect,useRef,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import {emit,listen} from '@tauri-apps/api/event'
import {useFox} from './useFox'
import {FoxAccessory} from './FoxSprite'
import {CompanionSprite} from './CompanionSprite'
import {PetJournalPanel} from './PetJournalPanel'
import {PetJourneyNotes} from './PetJourneyNotes'
import {PetLifeScene} from './PetLifeScene'
import {PetGlyph} from './PetGlyph'
import {CompanionPreferences} from './CompanionPreferences'
import {FOX_ROUTES} from './assets'
import {startCompanionTrip,claimCompanionTrip} from '../api/companion'
import {COMPANION_NAMES,type PetCare,type PetSouvenir} from './types'
import type {ThemeKey} from '../themes'
import './pet-menu.css'
type Tab='home'|'travel'|'collection'|'game'|'dress'|'settings'|'letter'|'memories'
const names:Record<Tab,string>={home:'伙伴',travel:'出去逛逛',collection:'旅行背包',game:'翻牌找朋友',dress:'衣装',settings:'陪伴设置',letter:'旅途来信',memories:'共同经历'}
const skins:Record<ThemeKey,string>={'pixel-jrpg':'星光冒险家','parchment-journal':'手账旅行家','animal-crossing':'小岛朋友','stardew-valley':'农场采集员'}
export function PetMenu({onClose}:{onClose:()=>void}){
 const pet=useFox(),theme=pet.theme,home=pet.home
 const[tab,setTab]=useState<Tab>('home'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[bubble,setBubble]=useState('')
 const[route,setRoute]=useState('nearby'),[duration,setDuration]=useState(30),[letter,setLetter]=useState<PetSouvenir|null>(null)
 const[older,setOlder]=useState<PetSouvenir[]>([]),pending=useRef<string|null>(null),gate=useRef(false)
 useEffect(()=>{
   let disposed=false,stop:(()=>void)|undefined
   const select=(value:string)=>{if(value==='talk'){onClose();void invoke('open_companion_input').catch(()=>{});return}if(Object.prototype.hasOwnProperty.call(names,value)&&value!=='letter')setTab(value as Tab)}
   void invoke<string>('get_companion_panel_tab').then(select).catch(()=>{})
   void listen<{tab:string}>('companion-panel',({payload})=>select(payload.tab)).then(fn=>{if(disposed)fn();else stop=fn}).catch(()=>{})
   return()=>{disposed=true;stop?.()}
 },[])
 useEffect(()=>setOlder([]),[home?.collection[0]?.id])
 useEffect(()=>{setOlder([]);setLetter(null);setBubble('');pending.current=null;setTab('home')},[pet.preferences.character])
 const run=async(job:()=>Promise<void>)=>{if(gate.current)return;gate.current=true;setBusy(true);setError('');try{await job()}catch(e){setError(String(e))}finally{gate.current=false;setBusy(false)}}
 const care=(action:string,moves?:number)=>run(async()=>{
   await invoke<PetCare>('interact_companion',{requestId:crypto.randomUUID(),action,moves:moves??null})
   setBubble(action==='snack'?'小点心收到了，谢谢你！':action==='brush'?'尾巴又蓬松起来啦。':action==='game'?'找齐了，一起记住这些小惊喜！':'我在这里呀。')
   await pet.refresh()
 })
 const travel=()=>run(async()=>{pending.current??=crypto.randomUUID();await startCompanionTrip(pending.current,theme,route,duration,pet.weather,pet.phase);pending.current=null;await pet.refresh()})
 const claim=()=>run(async()=>{if(!home?.trip)return;const item=await claimCompanionTrip(home.trip.id);setLetter(item);setTab('letter');await pet.refresh()})
 const trip=home?.trip,away=trip?.state==='away'
 return <section className={'xm-pet-menu theme-'+theme} aria-label={pet.preferences.name+'菜单'}>
 <header className="xm-pet-menu-head">
  {tab!=='home'&&<button className="xm-pet-menu-back" aria-label="返回伙伴首页" onClick={()=>{setTab('home');setError('')}}><PetGlyph name="back" size={20}/></button>}
  <div className="xm-pet-menu-heading"><small>{tab==='home'?COMPANION_NAMES[pet.preferences.character]+' · 桌面伙伴':pet.preferences.name+'的随身手册'}</small><strong>{tab==='home'?pet.preferences.name:names[tab]}</strong></div>
  <button className="xm-pet-menu-settings" aria-label="陪伴设置" title="陪伴设置" onClick={()=>setTab('settings')}><PetGlyph name="settings" size={19}/></button>
  <button className="xm-pet-menu-close" aria-label="收起伙伴菜单" onClick={onClose}><PetGlyph name="close" size={19}/></button>
 </header>
 <div className={'xm-pet-menu-scroll page-'+tab}>
 {error&&<p role="alert" className="xm-pet-menu-error">{error}</p>}
 {pet.error&&!home&&<p role="alert">{pet.error}<button onClick={()=>void pet.refresh()}>重试</button></p>}
 {tab==='home'&&<>
   <PetLifeScene pet={pet} dialogue={bubble||undefined} onMemory={()=>setTab('memories')} onKeepsake={()=>{if(home?.keepsake){setLetter(home.keepsake);setTab('letter')}}}/>
   {trip?.state==='returned'&&<button className="xm-pet-menu-primary xm-pet-return-home" disabled={busy} onClick={()=>void claim()}><PetGlyph name="bag" size={18}/>看看带回来的小惊喜<span>›</span></button>}
   <nav className="xm-pet-home-primary" aria-label="伙伴主要活动">
    <button onClick={()=>{onClose();void invoke('show_companion_bubble',{kind:'conversation'}).catch(()=>{})}}><PetGlyph name="talk"/><strong>递句话</strong><small>就在伙伴旁边</small></button>
    <button onClick={()=>setTab('travel')}><PetGlyph name="travel"/><strong>出去逛逛</strong><small>{away?'翻看行囊':'去看看远方'}</small></button>
    <button onClick={()=>setTab('collection')}><PetGlyph name="bag"/><strong>旅行背包</strong><small>{home?.collectionTotal?home.collectionTotal+'份纪念':'收藏小惊喜'}</small></button>
   </nav>
   <div className="xm-pet-care-caption"><span>陪它一会儿</span><small>摸头与梳毛在桌面用鼠标轻扫</small></div>
   <div className="xm-pet-quick">
    <button disabled={busy||away||!pet.preferences.enabled} onClick={()=>void care('snack')}><PetGlyph name="snack" size={21}/><span>给点心</span></button>
    <button disabled={busy||away||!pet.preferences.enabled||!!home?.focus} onClick={()=>{onClose();void invoke('show_companion_bubble',{kind:'paper'}).catch(()=>{})}}><PetGlyph name="game" size={21}/><span>丢小玩具</span></button>
   </div>
   {home?.growth&&<p className="xm-pet-growth"><strong>{home.growth.stage}</strong><small>{home.growth.next}</small></p>}
   <nav className="xm-pet-home-secondary" aria-label="伙伴的小天地">
    <button onClick={()=>setTab('game')}><PetGlyph name="game" size={17}/>小游戏</button>
    <button onClick={()=>setTab('dress')}><PetGlyph name="dress" size={17}/>衣装</button>
    <button onClick={()=>setTab('memories')}><PetGlyph name="memory" size={17}/>共同经历</button>
   </nav>
   {home?.today.length? <details className="xm-pet-today"><summary>今天的小纸条 · {home.today.length} 项</summary><ul>{home.today.slice(0,6).map(i=><li key={i.key}><strong>{i.title}</strong><small>{i.detail}</small></li>)}</ul></details>:null}
 </>}
 {tab==='memories'&&home&&<PetJournalPanel journal={home.journal} affection={home.care.affection} onChange={pet.refresh}/>}
 {tab==='travel'&&<>{trip?<div className="xm-pet-trip-mini"><CompanionSprite theme={trip.theme} action={trip.state==='returned'?'return':'depart'} size={118} animated={pet.animated}/><h3>{trip.state==='returned'?'带着小惊喜回来了':'正在替你看看远方'}</h3><PetJourneyNotes trip={trip} now={pet.clock}/><p>{trip.state==='returned'?trip.itemName:'约剩 '+Math.max(0,Math.ceil((trip.returnsAt-pet.clock)/60000))+' 分钟'}</p>{(trip.state==='returned'||trip.returnsAt<=pet.clock)&&<button disabled={busy} onClick={()=>void claim()}>收好纪念物</button>}</div>:<><p className="xm-pet-dialogue">准备一个小行囊，替你看看远方。</p><label>去哪里<select value={route} onChange={e=>{setRoute(e.target.value);pending.current=null}}>{Object.entries(FOX_ROUTES[theme]).map(([key,r])=><option key={key} value={key}>{r.name}</option>)}</select></label><p className="xm-pet-menu-help">{FOX_ROUTES[theme][route].copy}</p><label>旅行多久<select value={duration} onChange={e=>{setDuration(Number(e.target.value));pending.current=null}}><option value={30}>半小时散步</option><option value={120}>两小时探索</option><option value={480}>半日远行</option></select></label><button className="xm-pet-menu-primary" disabled={busy||!home||!pet.preferences.enabled} onClick={()=>void travel()}>整理行囊，出发</button></>}<small className="xm-pet-menu-help">关闭应用后按时间继续旅行，重新打开后结算；旅途收藏保存在本机。</small></>}
 {tab==='collection'&&<><p className="xm-pet-menu-help">{home?.collectionTotal??0} 次旅途的纪念</p><div className="xm-pet-bag-grid">{[...(home?.collection??[]),...older].map(i=><button key={i.id} onClick={()=>{setLetter(i);setTab('letter')}}><FoxAccessory theme={i.theme} size={68}/><strong>{i.itemName}</strong><small>{new Date(i.collectedAt).toLocaleDateString('zh-CN')}</small></button>)}</div>{!home?.collection.length&&<p className="xm-pet-dialogue">背包里还有位置，等下一次小旅行。</p>}{(home?.collectionTotal??0)>(home?.collection.length??0)+older.length&&<button disabled={busy} onClick={()=>void run(async()=>{const items=await invoke<PetSouvenir[]>('list_companion_collection',{offset:(home?.collection.length??0)+older.length});setOlder(s=>[...s,...items])})}>翻看更早的纪念物</button>}</>}
 {tab==='letter'&&letter&&<article className="xm-pet-small-letter"><FoxAccessory theme={letter.theme} size={86}/><h3>{letter.itemName}</h3><p>{letter.story}</p>{home?.journal.unlocks.some(u=>u.id==='stamp'&&u.unlocked)&&letter.id.charCodeAt(0)%2===0&&<span className="xm-pet-letter-postmark" aria-label="一起完成写作目标的纪念邮戳">✦ 共同的纪念邮戳</span>}<small>{pet.preferences.name} · {new Date(letter.collectedAt).toLocaleDateString('zh-CN')}</small><button className="xm-pet-menu-primary" disabled={busy} onClick={()=>void run(async()=>{await invoke('set_companion_keepsake',{id:home?.keepsake?.id===letter.id?null:letter.id});await pet.refresh()})}>{home?.keepsake?.id===letter.id?'从垫子旁收回背包':'摆在伙伴的垫子旁'}</button><button disabled={busy} onClick={()=>void run(async()=>{const next=await invoke<PetSouvenir>('polish_companion_letter',{id:letter.id});setLetter(next);await pet.refresh()})}>用 AI 润色这封来信</button><small className="xm-pet-menu-help">只发送这封虚构旅行来信；奖励与纪念物保持本地结果。服务失败会保留原文。</small></article>}
 {tab==='game'&&<MemoryGame key={theme} theme={theme} reduced={!pet.animated} disabled={busy||!!home?.focus||away||!pet.preferences.enabled} best={home?.care.bestMoves??null} onWin={moves=>void care('game',moves)}/>}
 {tab==='dress'&&<>{pet.preferences.character==='red-panda'&&<label>小熊猫衣装<select value={pet.preferences.outfit==='scarf'?'none':pet.preferences.outfit} disabled={busy} onChange={e=>void run(()=>pet.save({outfit:e.target.value as import('./types').CompanionOutfit}))}><option value="theme">主题衣装</option><option value="none">轻装</option></select></label>}<p className="xm-pet-dialogue">带上小行囊，换一种出门的心情。</p><button className="xm-pet-menu-primary" disabled={busy} onClick={()=>void run(()=>pet.save({appearance:'follow'}))}>跟随应用主题{pet.preferences.appearance==='follow'?' · 已选':''}</button><div className="xm-pet-outfits">{Object.entries(skins).map(([key,name])=><button key={key} disabled={busy} aria-pressed={pet.preferences.appearance===key} onClick={()=>void run(()=>pet.save({appearance:key as ThemeKey}))}><CompanionSprite theme={key as ThemeKey} action="idle" size={104} animated={false}/><span>{name}</span></button>)}</div></>}
 {tab==='settings'&&<CompanionPreferences compact/>}
 </div></section>
}
const GAME_STYLE:Record<ThemeKey,{title:string;labels:string[];hint:string}>={
 'pixel-jrpg':{title:'配对星图片',labels:['旅团星图','月湾星图','晨光星图'],hint:'看看星点的位置，找到两张相同的星图。'},
 'parchment-journal':{title:'配对手账邮票',labels:['新叶邮票','秋叶邮票','花瓣邮票'],hint:'一起记住邮票的颜色与叶脉。'},
 'animal-crossing':{title:'海滩小收藏',labels:['桃色贝壳','海玻璃','小岛叶片'],hint:'把海边找到的小东西两两收好。'},
 'stardew-valley':{title:'种子与作物卡',labels:['胡萝卜','小萝卜','种子袋'],hint:'记住作物卡，一起找齐三对。'},
}
function CardSymbol({theme,value}:{theme:ThemeKey;value:number}){
 if(theme==='pixel-jrpg')return <svg viewBox="0 0 64 64" aria-hidden="true"><path d={['M12 42L27 14L48 29L36 50Z','M12 18L40 12L52 40L25 50Z','M12 32L30 12L50 24L44 51Z'][value]} fill="none" stroke="#ddbd74" strokeWidth="2"/>{[[12,42],[27,14],[48,29],[36,50]].map(([x,y],i)=><circle key={i} cx={(x+value*7)%48+8} cy={y} r="3" fill="#fff0b3"/>)}</svg>
 if(theme==='parchment-journal')return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M15 49Q12 15 48 13Q53 47 15 49Z" fill={['#829d64','#b77b4d','#aa7489'][value]} stroke="#67533c"/><path d="M13 53L45 20M25 40L22 26M34 32L42 35" fill="none" stroke="#f0dfb8" strokeWidth="2"/></svg>
 if(theme==='animal-crossing')return <svg viewBox="0 0 64 64" aria-hidden="true">{value===0?<><path d="M32 52Q5 40 12 19Q22 6 32 20Q42 6 52 19Q59 40 32 52" fill="#f4ab94" stroke="#c6776e"/><path d="M32 47V20M32 47L17 22M32 47L47 22" stroke="#fff1d0" strokeWidth="2"/></>:value===1?<path d="M15 15L43 10L55 34L36 53L12 39Z" fill="#9edaca" stroke="#539886" strokeWidth="2"/>:<path d="M14 50Q8 10 51 13Q53 48 14 50M14 50L44 20" fill="#84b765" stroke="#578b41" strokeWidth="2"/>}</svg>
 return <svg viewBox="0 0 64 64" aria-hidden="true">{value===0?<><path d="M33 23L44 28L24 55Z" fill="#e49539" stroke="#86551e" strokeWidth="2"/><path d="M35 26L28 10L38 18L47 9L44 28" fill="#75a74c" stroke="#456d2c"/></>:value===1?<><path d="M16 30Q30 18 46 30Q48 49 31 52Q17 50 16 30" fill="#f2dfb3" stroke="#aa8b64"/><path d="M30 28L21 11L33 18L42 10L36 29" fill="#86aa55"/></>:<><path d="M20 16H46L50 50H16Z" fill="#e7c98c" stroke="#765738" strokeWidth="2"/><path d="M33 42V26M33 33Q16 19 24 19Q38 20 33 33Q37 15 47 21Q46 33 33 33" fill="#89a952" stroke="#5a7332"/></>}</svg>
}
function shuffled(){const a=[0,0,1,1,2,2];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function MemoryGame({theme,reduced,disabled,best,onWin}:{theme:ThemeKey;reduced:boolean;disabled:boolean;best:number|null;onWin:(n:number)=>void}){
 const[deck,setDeck]=useState(shuffled),[open,setOpen]=useState<number[]>([]),[matched,setMatched]=useState<number[]>([]),[moves,setMoves]=useState(0),[locked,setLocked]=useState(false),[pose,setPose]=useState<'game-turn'|'game-wait'|'game-match'|'game-miss'>('game-wait'),[line,setLine]=useState('我也会记住这一张。'),timer=useRef<number|undefined>(undefined),gate=useRef(false)
 const style=GAME_STYLE[theme]
 useEffect(()=>()=>{clearTimeout(timer.current);gate.current=false},[])
 const signal=(action:typeof pose)=>{setPose(action);void emit('companion-gesture',{action}).catch(()=>{})}
 const pick=(index:number)=>{
  if(disabled||gate.current||locked||open.includes(index)||matched.includes(index))return
  const next=[...open,index];setOpen(next);signal('game-turn')
  if(next.length===1){setLine('记住这一张，再找它的小伙伴。');return}
  gate.current=true;setLocked(true);const count=moves+1;setMoves(count)
  const same=deck[next[0]]===deck[next[1]];signal(same?'game-match':'game-miss');setLine(same?'找到了，它们是一对！':'差一点，再慢慢看看。')
  timer.current=window.setTimeout(()=>{
   if(same){const all=[...matched,...next];setMatched(all);if(all.length===6)onWin(count)}
   setOpen([]);gate.current=false;setLocked(false)
   if(!same){setPose('game-wait')}
  },same?650:1100)
 }
 return <div className={'xm-pet-memory theme-'+theme+(reduced?' is-reduced':'')}>
  <div className="xm-pet-game-companion"><CompanionSprite theme={theme} action={pose} size={84} animated={!reduced}/><div><strong>{style.title}</strong><p aria-live="polite">{disabled?'先安静陪你，忙完再来玩。':line}</p></div></div>
  <p className="xm-pet-menu-help">{style.hint}</p><div className="xm-pet-memory-board">{deck.map((value,i)=><button key={i} className={matched.includes(i)?'is-matched':open.includes(i)?'is-open':''} disabled={disabled||locked||matched.includes(i)} aria-label={'第'+(i+1)+'张卡'+(matched.includes(i)?'，已配对':open.includes(i)?'，'+style.labels[value]:'')} onClick={()=>pick(i)}>{open.includes(i)||matched.includes(i)?<><CardSymbol theme={theme} value={value}/><small>{style.labels[value]}</small></>:<span className="xm-pet-card-back" aria-hidden="true">{theme==='pixel-jrpg'?'✦':theme==='parchment-journal'?'✉':theme==='animal-crossing'?'❋':'✿'}</span>}</button>)}</div>
  <p className="xm-pet-menu-help">{matched.length===6?'都找齐了！':'已找到 '+matched.length/2+' 对'} · {moves} 步{best!==null?' · 最好 '+best+' 步':''}</p>
  <button disabled={locked||disabled} onClick={()=>{clearTimeout(timer.current);gate.current=false;setDeck(shuffled());setOpen([]);setMatched([]);setMoves(0);setPose('game-wait');setLine('新的一轮，一起慢慢找。')}}>重新洗牌</button>
  <small className="xm-pet-menu-help">找齐后记录成绩。每天首次小游戏增加熟悉度，不消耗金币。</small>
 </div>
}
