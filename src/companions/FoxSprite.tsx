import { memo,useEffect,useMemo,useRef,useState } from 'react'
import type { ThemeKey } from '../themes'
import type { FoxAction,FoxDirection,FoxEmotion } from './types'
import { FOX_ASSETS, FOX_ASSET_REVISION, foxAtlas } from './assets'
import { FOX_ACTIONS } from './behavior'
import {petViewport,posePlacement,clearIconPicture,type PoseGeometry} from './petGeometry'
import {perchKind,perchPlacement} from './perchGeometry'
import './companion.css'

interface Frame extends PoseGeometry {source:string;mask:number[][];foregroundMask?:number[][];durationMs?:number;flipX?:boolean}
interface Atlas {perches:Record<string,Record<'enter'|'hold'|'leave',Frame[]>>;actions:Record<FoxAction,Frame[]>;left:Frame[];leftIdle?:Frame[];frontIdle?:Frame[];front:Frame[];back:Frame[];expressions:Record<FoxEmotion,Frame[]>;accessories:Record<string,Frame[]>}
const atlasCache=new Map<string,Promise<Atlas>>(),images=new Map<string,Promise<HTMLImageElement>>()
const frames=new WeakMap<Frame,Promise<HTMLCanvasElement>>()
const foregrounds=new WeakMap<Frame,Promise<HTMLCanvasElement>>()
const root=import.meta.env.BASE_URL+'pets/fox/'
function loadAtlas(theme:ThemeKey){
 const key=FOX_ASSETS[theme]
 let job=atlasCache.get(key)
 if(!job){job=fetch(foxAtlas(theme),{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('伙伴素材加载失败');return r.json() as Promise<Atlas>}).catch(e=>{atlasCache.delete(key);throw e});atlasCache.set(key,job)}
 return job
}
function loadImage(source:string){
 let job=images.get(source)
 if(!job){job=new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>{images.delete(source);reject(new Error('伙伴图片加载失败'))};img.src=root+source+'?v='+FOX_ASSET_REVISION});images.set(source,job)}
 return job
}
function drawable(frame:Frame){
 let job=frames.get(frame)
 if(!job){job=loadImage(frame.source).then(img=>{
   const [x,y,w,h]=frame.rect,canvas=document.createElement('canvas'),mask=document.createElement('canvas')
   canvas.width=mask.width=w;canvas.height=mask.height=h
   const ctx=canvas.getContext('2d')!,mc=mask.getContext('2d')!
   ctx.drawImage(img,x,y,w,h,0,0,w,h);mc.fillStyle='#fff'
   for(const [row,...runs] of frame.mask)for(let i=0;i<runs.length;i+=2)mc.fillRect(runs[i],row,runs[i+1],1)
   ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0);ctx.globalCompositeOperation='source-over'
   return canvas
 }).catch(e=>{frames.delete(frame);throw e});frames.set(frame,job)}
 return job
}
const loopActions=new Set<FoxAction>(['idle','walk','run','focus','sleep','lifted','edge-left','edge-right','game-wait','window-hang'])
function foreground(frame:Frame){
 if(!frame.foregroundMask)return Promise.resolve(null)
 let job=foregrounds.get(frame)
 if(!job){job=drawable(frame).then(source=>{
  const layer=document.createElement('canvas'),mask=document.createElement('canvas');layer.width=mask.width=source.width;layer.height=mask.height=source.height
  const ctx=layer.getContext('2d')!,mc=mask.getContext('2d')!;ctx.drawImage(source,0,0);mc.fillStyle='#fff'
  for(const[row,...runs]of frame.foregroundMask!)for(let i=0;i<runs.length;i+=2)mc.fillRect(runs[i],row,runs[i+1],1)
  ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0);ctx.globalCompositeOperation='source-over';return layer
 }).catch(e=>{foregrounds.delete(frame);throw e});foregrounds.set(frame,job)}
 return job
}
interface PlayerProps {attachment?:string;cutout?:[number,number,number,number]|null;startAtMs?:number;durationMs?:number;offsetMs?:number;flip?:boolean;reserve?:boolean;onPaint?:(canvas:HTMLCanvasElement)=>void;theme:ThemeKey;select:(atlas:Atlas)=>Frame[];size:number;animated:boolean;frameMs:number;loop:boolean;title?:string;className?:string}
function Player({attachment,cutout,startAtMs,durationMs,offsetMs=0,flip=false,reserve=false,onPaint,theme,select,size,animated,frameMs,loop,title,className=''}:PlayerProps){
 const painted=useRef(onPaint);painted.current=onPaint
 const canvas=useRef<HTMLCanvasElement>(null),[failed,setFailed]=useState(false)
 const pixel=theme==='pixel-jrpg'||theme==='stardew-valley'
 const viewport=reserve?petViewport(size):size
 useEffect(()=>{
   let disposed=false,timer:number|undefined,sequence:Frame[]=[],index=0,active=false,started=performance.now()-offsetMs
   const paint=async()=>{
     if(disposed||!sequence.length||active)return
     active=true
     const elapsed=Math.max(0,startAtMs===undefined?performance.now()-started:Date.now()-startAtMs)
     const raw=sequence.map(f=>f.durationMs??frameMs),sum=raw.reduce((a,b)=>a+b,0),rate=!loop&&durationMs?Math.min(1,durationMs/sum):1
     const durations=raw.map(ms=>ms*rate),total=durations.reduce((a,b)=>a+b,0)
     const position=loop?elapsed%total:Math.min(elapsed,total-1)
     let boundary=0
     if(animated){for(index=0;index<sequence.length-1;index++){boundary+=durations[index];if(position<boundary)break}}
     if(!animated){index=loop?0:sequence.length-1;boundary=total}
     else if(index===sequence.length-1)boundary=total
     const frame=sequence[index]
     try{
       const[source,paws]=await Promise.all([drawable(frame),attachment?.startsWith('icon')&&cutout&&!frame.objectBox?foreground(frame):Promise.resolve(null)]);if(disposed)return
       const target=canvas.current;if(!target)return
       const dpr=Math.min(2,window.devicePixelRatio||1);target.width=Math.ceil(viewport*dpr);target.height=Math.ceil(viewport*dpr)
       const ctx=target.getContext('2d')!;ctx.scale(dpr,dpr);ctx.imageSmoothingEnabled=!pixel;ctx.imageSmoothingQuality='high'
       const scale=size/frame.basis,w0=source.width*scale,h0=source.height*scale
       let {x,y,w,h}=reserve?posePlacement(frame,size,viewport):{x:(size-w0)/2+(frame.offsetX??0)*scale,y:frame.anchorY!==undefined?size*.94-frame.anchorY*scale+(frame.offsetY??0)*scale:Math.max(1,size*.94-h0),w:w0,h:h0}
       if(attachment&&attachment!=='sit')({x,y,w,h}=perchPlacement(frame,size,attachment,flip,cutout))
       ctx.clearRect(0,0,viewport,viewport)
       if(!!frame.flipX!==flip){ctx.save();ctx.translate(x+w,y);ctx.scale(-1,1);ctx.drawImage(source,0,0,w,h);ctx.restore()}
       else ctx.drawImage(source,x,y,w,h)
       if(attachment?.startsWith('icon')){
        // The new atlas retains the actual fur and paws crossing the prop's
        // colored silhouette. Neither a rectangular wipe nor a second guessed
        // foreground mask is needed: one complete alpha sprite is authoritative.
        if(!frame.objectBox)clearIconPicture(ctx,cutout)
        if(paws){if(!!frame.flipX!==flip){ctx.save();ctx.translate(x+w,y);ctx.scale(-1,1);ctx.drawImage(paws,0,0,w,h);ctx.restore()}else ctx.drawImage(paws,x,y,w,h)}
       }
       painted.current?.(target);setFailed(false)
     }catch{if(!disposed)setFailed(true);return}finally{active=false}
     if(!disposed&&animated&&!document.hidden&&sequence.length>1&&(loop||index<sequence.length-1)){
       timer=window.setTimeout(()=>void paint(),Math.max(16,boundary-position,startAtMs===undefined?0:startAtMs-Date.now()))
     }
   }
   const visibility=()=>{clearTimeout(timer);if(!document.hidden)void paint()}
   const resize=()=>{clearTimeout(timer);void paint()}
   window.addEventListener('resize',resize);document.addEventListener('visibilitychange',visibility)
   void loadAtlas(theme).then(atlas=>{if(!disposed){sequence=select(atlas);started=performance.now()-offsetMs;void paint()}}).catch(()=>{if(!disposed)setFailed(true)})
   return()=>{disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('resize',resize)}
 },[theme,select,size,animated,frameMs,loop,pixel,offsetMs,durationMs,startAtMs,flip,reserve,viewport,attachment,cutout])
 return <span className={'xm-fox-player '+className+(pixel?' is-pixel':'')} style={{width:viewport,height:viewport}} role={title?'img':undefined} aria-label={title} aria-hidden={!title}>
 <canvas ref={canvas} style={{width:viewport,height:viewport}}/>{failed&&<span className="xm-fox-unavailable">素材加载中</span>}</span>
}
interface Props{attachment?:string;cutout?:[number,number,number,number]|null;attachmentPhase?:'enter'|'hold'|'leave';startAtMs?:number;durationMs?:number;offsetMs?:number;reserve?:boolean;onPaint?:(canvas:HTMLCanvasElement)=>void;theme:ThemeKey;action?:FoxAction;direction?:FoxDirection;size?:number;animated?:boolean;className?:string;title?:string}
export const FoxSprite=memo(function FoxSprite({attachment,cutout,attachmentPhase='hold',startAtMs,durationMs,offsetMs=0,reserve=false,onPaint,theme,action='idle',direction='right',size=96,animated=true,className='',title}:Props){
 const attached=!!attachment&&attachment!=='sit'
 const select=useMemo(()=>(a:Atlas)=>attached?a.perches[perchKind(attachment!)][attachmentPhase]:action==='walk'&&direction==='left'?a.left:action==='idle'&&direction==='front'?(a.frontIdle??a.front):action==='idle'&&direction==='left'?(a.leftIdle??[a.left[0]]):a.actions[action],[action,direction,attached,attachment,attachmentPhase])
 const flip=attached?(attachment==='right'||attachment==='icon'):direction==='left'&&action!=='idle'&&action!=='walk'&&!/^(dock|edge|undock)-/.test(action)
 return <Player attachment={attachment} cutout={cutout} startAtMs={startAtMs} durationMs={durationMs} offsetMs={offsetMs} flip={flip} reserve={reserve} onPaint={onPaint} theme={theme} select={select} size={size} animated={animated} frameMs={FOX_ACTIONS[action].frameMs} loop={attached?attachmentPhase==='hold':loopActions.has(action)} title={title} className={className}/>
})
export function FoxPortrait({theme,emotion,size=64,onPaint}:{theme:ThemeKey;emotion:FoxEmotion;size?:number;onPaint?:(canvas:HTMLCanvasElement)=>void}){
 const selection=useRef({emotion,fn:(a:Atlas)=>a.expressions[emotion]})
 if(selection.current.emotion!==emotion)selection.current={emotion,fn:a=>a.expressions[emotion]}
 return <Player onPaint={onPaint} theme={theme} select={selection.current.fn} size={size} animated={false} frameMs={1000} loop={false}/>
}
export function FoxAccessory({theme,kind='souvenir',size=64,onPaint}:{theme:ThemeKey;kind?:'bag'|'scarf'|'souvenir'|'lamp';size?:number;onPaint?:(canvas:HTMLCanvasElement)=>void}){
 const selection=useRef({kind,fn:(a:Atlas)=>a.accessories[kind]})
 if(selection.current.kind!==kind)selection.current={kind,fn:a=>a.accessories[kind]}
 return <Player onPaint={onPaint} theme={theme} select={selection.current.fn} size={size} animated={false} frameMs={1000} loop={false}/>
}

/** Warm a complete action before desktop movement begins, so the first stride never waits on decoding. */
export async function preloadFoxAction(theme:ThemeKey,action:FoxAction,direction:FoxDirection='right'){
 const atlas=await loadAtlas(theme),sequence=action==='walk'&&direction==='left'?atlas.left:atlas.actions[action]
 await Promise.all(sequence.map(drawable))
}
export async function preloadFoxPerch(theme:ThemeKey,mode:string){
 const atlas=await loadAtlas(theme),poses=atlas.perches[perchKind(mode)]
 if(poses)await Promise.all(Object.values(poses).flat().map(drawable))
 await Promise.all([preloadFoxAction(theme,'walk','left'),preloadFoxAction(theme,'walk','right'),preloadFoxAction(theme,'attention')])
}

