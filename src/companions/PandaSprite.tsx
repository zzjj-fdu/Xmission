import{memo,useEffect,useRef,useState}from'react'
import type{ThemeKey}from'../themes'
import type{FoxAction,FoxDirection}from'./types'
import{petViewport}from'./petGeometry'
import{loadPandaAtlas,pandaRenderer,PandaDrawing}from'./rig/renderer'
import'./companion.css'
interface Props{attachment?:string;cutout?:[number,number,number,number]|null;attachmentPhase?:'enter'|'hold'|'leave';startAtMs?:number;durationMs?:number;offsetMs?:number;reserve?:boolean;onPaint?:(canvas:HTMLCanvasElement)=>void;theme:ThemeKey;action?:FoxAction;direction?:FoxDirection;size?:number;animated?:boolean;className?:string;title?:string;outfit?:'theme'|'scarf'|'none';playbackRate?:number;scarfMotion?:boolean;scarfOnly?:boolean}
export const PandaSprite=memo(function PandaSprite({theme,action='idle',direction='right',size=96,animated=true,reserve=false,onPaint,className='',title,outfit='theme',attachment,cutout,attachmentPhase='hold',startAtMs,durationMs,offsetMs=0,playbackRate=1,scarfMotion=true,scarfOnly=false}:Props){
 const canvas=useRef<HTMLCanvasElement>(null),painted=useRef(onPaint),[error,setError]=useState('');painted.current=onPaint
 const playback=useRef({action,direction,attachment,cutout,attachmentPhase,startAtMs,durationMs,offsetMs,playbackRate,scarfMotion,scarfOnly});playback.current={action,direction,attachment,cutout,attachmentPhase,startAtMs,durationMs,offsetMs,playbackRate,scarfMotion,scarfOnly}
 const repaint=useRef<(()=>void)|undefined>()
 const viewport=reserve?petViewport(size):size
 useEffect(()=>{
  let disposed=false,frame=0,drawing:PandaDrawing|undefined,visibility:(()=>void)|undefined,started=performance.now(),clipKey=''
  setError('')
  void Promise.all([loadPandaAtlas(theme,outfit),pandaRenderer()]).then(([atlas,renderer])=>{
   if(disposed||!canvas.current)return
   drawing=new PandaDrawing(atlas);const target=canvas.current,ctx=target.getContext('2d')!,dpr=Math.min(2,window.devicePixelRatio||1)
   target.width=target.height=Math.ceil(viewport*dpr);let last=-Infinity
   const tick=(now:number)=>{
    if(disposed||!drawing)return
    const{action,direction,attachment,cutout,attachmentPhase,startAtMs,durationMs,offsetMs,playbackRate,scarfMotion,scarfOnly}=playback.current
    const key=action+':'+(startAtMs??'');if(key!==clipKey){clipKey=key;started=now;last=-Infinity}
    // Locomotion has 75 ms authored frames, so 12 fps would skip run phases.
    const locomotion=action==='walk'||action.startsWith('run'),interval=locomotion?1000/30:atlas.pixel?1000/12:['sleep','focus','idle'].includes(action)?1000/18:1000/30
    try{if(now-last>=interval){last=now
     const elapsed=animated?(startAtMs?Math.max(0,Date.now()-startAtMs):now-started)*playbackRate+offsetMs:offsetMs
     const icon=cutout?.map(n=>n/size*100)as[number,number,number,number]|undefined
     drawing.draw({action,direction,timeMs:elapsed,attachment,cutout:icon,attachmentPhase,durationMs,outfit,pixel:atlas.pixel,scarfMotion,scarfOnly},size/100*dpr,animated)
     renderer.render({container:drawing.stage,clear:true})
     ctx.clearRect(0,0,target.width,target.height)
     if(reserve)ctx.drawImage(renderer.canvas,0,0,target.width,target.height,0,0,target.width,target.height)
     else{const sourceSide=size*1.5*dpr;ctx.drawImage(renderer.canvas,0,0,sourceSide,sourceSide,0,0,target.width,target.height)}
     painted.current?.(target)
    }}catch(e){cancelAnimationFrame(frame);setError(String(e instanceof Error?e.message:e));return}
    if(animated&&!document.hidden)frame=requestAnimationFrame(tick)
   }
   repaint.current=()=>{cancelAnimationFrame(frame);last=-Infinity;tick(performance.now())}
   visibility=()=>{cancelAnimationFrame(frame);if(!document.hidden)repaint.current?.()}
   document.addEventListener('visibilitychange',visibility);tick(performance.now())
  }).catch(e=>{if(!disposed)setError(String(e instanceof Error?e.message:e))})
  return()=>{disposed=true;repaint.current=undefined;cancelAnimationFrame(frame);if(visibility)document.removeEventListener('visibilitychange',visibility);drawing?.destroy()}
 },[theme,size,viewport,reserve,animated,outfit])
 useEffect(()=>{repaint.current?.()},[action,direction,attachment,attachmentPhase,cutout?.join(','),startAtMs,durationMs,offsetMs,playbackRate,scarfMotion,scarfOnly])
 const pixel=theme==='pixel-jrpg'||theme==='stardew-valley'
 return <span className={'xm-fox-player xm-panda-player '+className+(pixel?' is-pixel':'')} style={{width:viewport,height:viewport}} role={title?'img':undefined} aria-label={title} aria-hidden={!title}>
  <canvas ref={canvas} style={{width:viewport,height:viewport}}/>{error&&<span className="xm-fox-unavailable" role="alert">{error}</span>}
 </span>
})
export async function preloadPanda(theme:ThemeKey,outfit:'theme'|'scarf'|'none'='theme'){await Promise.all([loadPandaAtlas(theme,outfit),pandaRenderer()])}

