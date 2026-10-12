import {useEffect,useRef,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import {emit,listen} from '@tauri-apps/api/event'
import type {useFox} from './useFox'
import {useCompanionStore} from '../store/companion'
import {FoxAccessory} from './FoxSprite'
import {CompanionSprite,preloadCompanionAction} from './CompanionSprite'
import {PetBall,PetMorphCanvas} from './PetBall'
import {petViewport,PET_BALL_SIZE,PET_VIEWPORT_RATIO} from './petGeometry'
import type {PetMorph} from './usePetMorph'
import {petMorphMotion} from './petMorphMotion'
import {bodyPart,startTouch,moveTouch,type TouchPath} from './gesture'
import {directCare,careReady,careMayInterrupt} from './touchPolicy'
import {usePetLife} from './usePetLife'
import {PetEnvironment} from './PetEnvironment'
import {postPetHitMask} from './petHitMask'
import type {FoxDirection,PetDockState} from './types'
type Pet=ReturnType<typeof useFox>
type Care='stroke'|'brush'
interface Props{pet:Pet;direction:FoxDirection;glance:(d:FoxDirection)=>void;onMenu:()=>void;native?:boolean;size?:number;className?:string;dock?:PetDockState;morph?:PetMorph|null}
export function PetSurface({pet,direction,onMenu,native=true,size=pet.preferences.size,className='xm-pet-body',dock={side:null,hidden:false,transitioning:false,folded:false},morph}:Props){
 const transforming=morph?.stage==='start',mode=morph?.stage==='finish'?morph.to:pet.preferences.displayMode,mini=mode==='mini'
 const viewport=transforming?petViewport(size):mini?PET_BALL_SIZE:petViewport(size)
 const [morphPose,setMorphPose]=useState(()=>morph?petMorphMotion(morph,Date.now()):null)
 useEffect(()=>{
  if(!transforming||!morph){setMorphPose(null);return}
  let frame=0,previous=''
  const tick=()=>{const pose=petMorphMotion(morph,Date.now()),key=pose.action+':'+pose.startedAt;if(key!==previous){previous=key;setMorphPose(pose)}if(!pose.finished)frame=requestAnimationFrame(tick)}
  tick();return()=>cancelAnimationFrame(frame)
 },[transforming,morph])
 usePetLife(pet,!!dock.side||!!transforming||pet.perched||pet.exploring,native)
 useEffect(()=>{if(native)void invoke('companion_activity',{active:!!pet.gesture&&!dock.folded}).catch(()=>{});return()=>{if(native)void invoke('companion_activity',{active:false}).catch(()=>{})}},[native,pet.gesture,dock.folded])
 const bodyCanvas=useRef<HTMLCanvasElement|null>(null)
 const sourceId=useRef(0);if(transforming&&sourceId.current!==morph.id){sourceId.current=morph.id;bodyCanvas.current=null}
 const readyId=useRef(0)
 const painted=(canvas:HTMLCanvasElement)=>{bodyCanvas.current=canvas;if(native){if(transforming){
  if(readyId.current!==morph.id){readyId.current=morph.id;void Promise.all(['lift','lifted','land'].map(action=>preloadCompanionAction(pet.theme,action as import('./types').FoxAction))).then(()=>{if(mounted.current&&sourceId.current===morph.id)return invoke('companion_morph_ready',{id:morph.id})}).catch(()=>{readyId.current=0})}
 }else void postPetHitMask(canvas).catch(()=>{})}}
 const paintedEffect=(canvas:HTMLCanvasElement)=>{if(native)void postPetHitMask(canvas).catch(()=>{})}
 const paintedAccessory=()=>{if(bodyCanvas.current)painted(bodyCanvas.current)}
 const menuTimer=useRef<number|undefined>(undefined)
 const pressed=useRef(false),path=useRef<TouchPath|null>(null),part=useRef('body'),nativeDrag=useRef(false),tapTimer=useRef<number|undefined>(undefined),lastTap=useRef(0),mounted=useRef(true),doubleMs=useRef(480)
 const hover=useRef<{kind:Care;started:number;path:TouchPath}|null>(null),hoverDone=useRef(false),hoverTimers=useRef<number[]>([]),lastCare=useRef(0),lastReward=useRef(0),careBusy=useRef(false)
 const[touch,setTouch]=useState<Care|'drag'|null>(null),[error,setError]=useState('')
 const store=useCompanionStore,latest=useRef(pet);latest.current=pet
 const tucked=!transforming&&!!dock.side&&(dock.hidden||dock.transitioning)
 useEffect(()=>{
  if(!native||!dock.side)return
  let frame=0,last=0;const until=performance.now()+340
  const sync=(now:number)=>{if(now-last>=30&&bodyCanvas.current){last=now;void postPetHitMask(bodyCanvas.current).catch(()=>{})}if(now<until)frame=requestAnimationFrame(sync)}
  frame=requestAnimationFrame(sync)
  return()=>cancelAnimationFrame(frame)
 },[native,dock.side,dock.folded])
 const edgeAction=dock.side?(dock.transitioning?(dock.folded?'dock-':'undock-')+dock.side:'edge-'+dock.side) as import('./types').FoxAction:'idle'
 const attached=pet.perched?pet.attachment:null
 const shownAttachment=!transforming&&!tucked&&!pet.dragging?attached??undefined:undefined
 const facing=tucked?(dock.side==='left'?'right':'left'):attached==='right'||attached==='icon'?'left':attached==='top'?'front':attached?'right':direction
 const bodyFacing=attached==='top'?'front':pet.action==='idle'?facing:facing==='left'?'left':'right'
 const hitPart=(x:number,y:number)=>{const px=(x-.5)*PET_VIEWPORT_RATIO+.5,py=(y-1)*PET_VIEWPORT_RATIO+1;return pet.action==='sleep'&&py>.5&&(bodyFacing==='left'?px<.5:px>.5)?'head':bodyPart(px,py,bodyFacing)}
 const say=(kind:string)=>void invoke('show_companion_bubble',{kind}).catch(()=>{})
 const markHover=(active:boolean)=>{if(store.getState().hovering===active)return;store.setState({hovering:active});if(native)void invoke('companion_hovering',{active}).catch(()=>{})}
 const cancelHover=()=>{
  hoverTimers.current.forEach(clearTimeout);hoverTimers.current=[];hover.current=null;markHover(false)
  if(mounted.current&&!pressed.current)setTouch(null)
 }
 const clearTool=()=>{store.setState({tool:null});if(native)void emit('companion-tool',{tool:null}).catch(()=>{})}
 const finishCare=async(kind:Care)=>{
  const current=latest.current
  if(careBusy.current||!current.preferences.enabled||current.home?.trip?.state==='away'||pressed.current)return
  careBusy.current=true;lastCare.current=Date.now();hoverDone.current=true;cancelHover()
  clearTimeout(tapTimer.current);lastTap.current=0
  if(kind==='brush')clearTool()
  try{if(!current.home?.care?.caredToday.includes(kind)&&Date.now()-lastReward.current>=12000){lastReward.current=Date.now();await invoke('interact_companion',{requestId:crypto.randomUUID(),action:kind,moves:null,animate:false});await latest.current.refresh()}}catch(e){if(mounted.current)setError(String(e))}finally{careBusy.current=false}
 }
 const hoverAt=(e:React.PointerEvent<HTMLButtonElement>)=>{
  if(transforming||tucked||pet.exploring||!['normal','edge'].includes(mode)||pressed.current||e.buttons||hoverDone.current||careBusy.current||!pet.preferences.enabled||pet.travelBag||pet.home?.trip?.state==='away'||!careMayInterrupt(pet.gesture))return
  const box=e.currentTarget.getBoundingClientRect(),x=(e.clientX-box.left)/box.width,y=(e.clientY-box.top)/box.height
  const canvas=e.currentTarget.querySelector('canvas'),pixel=canvas?.getContext('2d')
  let onFur=false
  try{if(canvas&&pixel)onFur=pixel.getImageData(Math.min(canvas.width-1,Math.max(0,Math.floor(x*canvas.width))),Math.min(canvas.height-1,Math.max(0,Math.floor(y*canvas.height))),1,1).data[3]>32}catch{}
  const hit=hitPart(x,y)
  const kind=directCare(hit,onFur,pressed.current)
  if(!kind){cancelHover();return}
  if(Date.now()-lastCare.current<1800)return
  if(hover.current&&hover.current.kind!==kind)cancelHover()
  if(!hover.current){
   hover.current={kind,started:Date.now(),path:startTouch(e.screenX,e.screenY)};markHover(true)
   if(kind==='stroke')hoverTimers.current.push(window.setTimeout(()=>{if(!mounted.current||pressed.current||hover.current?.kind!==kind||!careMayInterrupt(latest.current.gesture))return;setTouch(kind);latest.current.act('pet');void finishCare(kind)},700))
  }else{
   const h=hover.current;moveTouch(h.path,e.screenX,e.screenY,size,'brush')
   if(careReady(h.kind,Date.now()-h.started,h.path.path,size)){setTouch(h.kind);latest.current.act(h.kind==='brush'?'groom':'pet');void finishCare(h.kind)}
  }
 }
 const setDrag=()=>{setTouch('drag');store.setState({dragging:true});store.getState().act('lifted')}
 const contact=useRef(setDrag);contact.current=setDrag
 useEffect(()=>{
  mounted.current=true;let disposed=false,stop:(()=>void)|undefined
  if(native){void invoke<number>('companion_double_click_ms').then(n=>{if(n>=100&&n<=1500)doubleMs.current=n}).catch(()=>{})
   void listen<{kind:string}>('companion-contact',({payload})=>{if(pressed.current&&payload.kind==='drag')contact.current()}).then(fn=>{if(disposed)fn();else stop=fn}).catch(()=>{})}
  return()=>{mounted.current=false;disposed=true;stop?.();hoverTimers.current.forEach(clearTimeout);clearTimeout(tapTimer.current);clearTimeout(menuTimer.current);store.setState({dragging:false,hovering:false});if(native)void invoke('companion_hovering',{active:false}).catch(()=>{})}
 },[native])
 const FOX_OPEN_MENU_DELAY=1800
 const tap=()=>{
  if(transforming)return
  if(!mini&&latest.current.preferences.taskClick==='single'){lastTap.current=0;if(native)void invoke('open_companion_tasks').catch(()=>{});else onMenu();return}
  const now=performance.now();clearTimeout(tapTimer.current)
  if(lastTap.current>0&&now-lastTap.current<doubleMs.current){lastTap.current=0;clearTool();if(mini){if(native)void invoke('set_companion_mode',{mode:'normal'}).catch(e=>setError(String(e)));else onMenu()}else{latest.current.act('respond',1800);if(native)void invoke('open_companion_tasks').catch(()=>{});else onMenu()}return}
  lastTap.current=now;const hit=part.current
  tapTimer.current=window.setTimeout(()=>{lastTap.current=0;if(!mounted.current)return
   if(latest.current.preferences.taskClick==='single'||mini){if(native)void invoke('open_companion_tasks').catch(()=>{});else onMenu();return}
   if(hit==='dock')return
   if(latest.current.travelBag||size<=64||hit==='bag'){if(!latest.current.animated){onMenu();return}latest.current.act('bag-open');menuTimer.current=window.setTimeout(()=>{if(mounted.current)onMenu()},FOX_OPEN_MENU_DELAY);return}
   if(hit==='tail'){latest.current.act('tail');return}
   latest.current.act('respond',1400);say('touch-help')
  },doubleMs.current)
 }
 const done=(moved:boolean)=>{
  pressed.current=false;nativeDrag.current=false;path.current=null;store.setState({dragging:false})
  if(mounted.current)setTouch(null)
  if(moved){clearTimeout(tapTimer.current);lastTap.current=0;if(!mini)latest.current.act('land')}
  else tap()
 }
 const down=(e:React.PointerEvent<HTMLButtonElement>)=>{
  if(transforming||e.button!==0||pressed.current||!pet.preferences.enabled)return
  clearTimeout(menuTimer.current);cancelHover();hoverDone.current=false
  const box=e.currentTarget.getBoundingClientRect()
  part.current=tucked?'dock':pet.travelBag?'bag':hitPart((e.clientX-box.left)/box.width,(e.clientY-box.top)/box.height)
  pressed.current=true;path.current=startTouch(e.screenX,e.screenY);setError('');e.preventDefault()
  if(native)void invoke('dismiss_companion_notice').catch(()=>{})
  if(native&&navigator.userAgent.includes('Windows')){
   void invoke<{moved:boolean}>('drag_companion',{mode:'body'}).then(r=>{if(mounted.current)done(r.moved)}).catch(e=>{pressed.current=false;store.setState({dragging:false});if(mounted.current){setTouch(null);setError(String(e))}})
  }else e.currentTarget.setPointerCapture(e.pointerId)
 }
 const move=(e:React.PointerEvent<HTMLButtonElement>)=>{
  if(!pressed.current){hoverAt(e);return}
  if(!path.current||native&&navigator.userAgent.includes('Windows'))return
  const next=moveTouch(path.current,e.screenX,e.screenY,size,'body')
  if(next.drag&&!nativeDrag.current){clearTimeout(tapTimer.current);nativeDrag.current=true;setDrag()
   if(native)void invoke('drag_companion').then(()=>done(true)).catch(()=>done(true))
  }
 }
 const up=(e:React.PointerEvent<HTMLButtonElement>)=>{
  if(native&&navigator.userAgent.includes('Windows')||!path.current)return
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)
  if(nativeDrag.current&&native)return
  done(path.current.drag)
 }
 const cancel=()=>{cancelHover();if(native&&navigator.userAgent.includes('Windows'))return;pressed.current=false;path.current=null;setTouch(null);store.setState({dragging:false})}
 return <button className={className+(pet.tool?' tool-'+pet.tool:'')+(touch?' is-'+touch:'')+(!pet.preferences.enabled&&!transforming?' is-away':'')} style={!native?{width:viewport,height:viewport}:undefined} aria-label={mini?'悬浮球，单击查看任务，双击变回伙伴':(pet.travelBag?'旅行行囊':pet.preferences.name)+'，悬停摸头，背包打开菜单，拖动移动，右键菜单'} title={error||undefined}
 onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
 onPointerEnter={e=>{hoverDone.current=false;hoverAt(e)}}
 onPointerLeave={()=>{hoverDone.current=false;cancelHover()}}
 onKeyDown={e=>{if(e.key==='Escape'){cancelHover();clearTool()}}}
 onClick={e=>{if(e.detail===0&&!transforming){if(mini&&native)void invoke('open_companion_tasks').catch(()=>{});else onMenu()}}}
 onContextMenu={e=>{e.preventDefault();if(transforming)return;cancelHover();clearTimeout(tapTimer.current);lastTap.current=0;clearTool();if(native)void invoke('show_companion_menu').catch(e=>setError(String(e)));else onMenu()}}>
 <span data-pet-source-hidden={transforming?'true':undefined} style={transforming?{visibility:'hidden'}:undefined} className={'xm-pet-artwork'+(!transforming&&native&&dock.side?' at-'+dock.side:'')+(!transforming&&dock.folded?' is-folded':'')+(pet.preferences.reducedMotion?' is-reduced':'')}>
 {mini&&!transforming?<PetBall theme={pet.theme} onPaint={painted}/>:pet.travelBag&&!transforming?<FoxAccessory theme={pet.home!.trip!.theme} kind="bag" size={size} onPaint={painted}/>:<CompanionSprite attachment={shownAttachment} cutout={shownAttachment?pet.attachmentCutout:null} attachmentPhase={pet.attachmentMotion?.phase} reserve theme={pet.theme} action={transforming?morphPose?.action??'lifted':tucked?edgeAction:pet.action} direction={facing} size={size} animated={transforming?morph.durationMs>200:pet.animated} startAtMs={transforming?morphPose?.startedAt:shownAttachment?pet.attachmentMotion?.startedAt:undefined} durationMs={transforming?morphPose?.durationMs:shownAttachment?pet.attachmentMotion?.durationMs:tucked?(dock.transitioning?280:undefined):pet.gesture===pet.action?pet.gestureUntil-pet.gestureStarted:undefined} offsetMs={!transforming&&!tucked&&(pet.action==='focus'||pet.action==='sleep')?pet.activityElapsed[pet.action]:0} onPaint={painted}/>}
 {!transforming&&!tucked&&!mini&&!pet.travelBag&&<PetEnvironment pet={pet} direction={facing} onPaint={paintedAccessory}/> }
 </span>
 {transforming&&<PetMorphCanvas morph={morph} theme={pet.theme} source={bodyCanvas} onPaint={paintedEffect}/>}
 {!transforming&&!tucked&&!mini&&pet.tool&&<span className="xm-pet-tool-hint">{pet.tool==='brush'?'悬停梳毛':'悬停摸头'}</span>}
 </button>
}
