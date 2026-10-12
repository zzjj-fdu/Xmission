import {useEffect,useRef,type RefObject} from 'react'
import type {ThemeKey} from '../themes'
import {THEMES} from '../themes'
import xmissionIcon from '../assets/xmission-icon.png'
import {PET_BALL_SIZE,petViewport} from './petGeometry'
import type {PetMorph} from './usePetMorph'
import {petMorphMotion} from './petMorphMotion'
let iconJob:Promise<HTMLImageElement>|undefined
function icon(){return iconJob??=new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>{iconJob=undefined;reject(new Error('悬浮球素材加载失败'))};image.src=xmissionIcon})}
function palette(theme:ThemeKey){const c=THEMES[theme].tokens.colors;return{paper:c.panel,accent:c.accent}}
export function drawPetBall(ctx:CanvasRenderingContext2D,bitmap:CanvasImageSource,x:number,y:number,size:number,theme:ThemeKey){
 const c=palette(theme),r=size/2;ctx.save();ctx.beginPath();ctx.arc(x,y,r-1,0,Math.PI*2);ctx.clip();ctx.fillStyle=c.paper;ctx.fillRect(x-r,y-r,size,size)
 ctx.drawImage(bitmap,x-size*35/86,y-size*35/86,size*35/43,size*35/43);ctx.restore()
 ctx.save();ctx.beginPath();ctx.arc(x,y,r-1,0,Math.PI*2);ctx.strokeStyle=c.accent;ctx.lineWidth=2;ctx.stroke();ctx.restore()
}
export function PetBall({theme,size=PET_BALL_SIZE,onPaint}:{theme:ThemeKey;size?:number;onPaint?:(canvas:HTMLCanvasElement)=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),painted=useRef(onPaint);painted.current=onPaint
 useEffect(()=>{let disposed=false;void icon().then(image=>{const target=canvas.current;if(disposed||!target)return;const dpr=Math.min(2,devicePixelRatio||1);target.width=target.height=Math.ceil(size*dpr);const ctx=target.getContext('2d')!;ctx.scale(dpr,dpr);drawPetBall(ctx,image,size/2,size/2,size,theme);painted.current?.(target)}).catch(()=>{});return()=>{disposed=true}},[theme,size])
 return <canvas ref={canvas} style={{display:'block',width:size,height:size}} aria-hidden="true"/>
}
/** A single alpha canvas keeps the visible light and the native hit region together. */
export function PetMorphCanvas({morph,theme,source,onPaint}:{morph:PetMorph;theme:ThemeKey;source:RefObject<HTMLCanvasElement|null>;onPaint:(canvas:HTMLCanvasElement)=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),latest=useRef(onPaint);latest.current=onPaint
 const viewport=petViewport(morph.size)
 useEffect(()=>{
  let disposed=false,frame=0,bitmap:HTMLImageElement|undefined,last=0
  void icon().then(image=>{bitmap=image}).catch(()=>{})
  const paint=(time:number)=>{
   if(disposed)return
   const target=canvas.current;if(!target)return
   const now=Date.now(),motion=petMorphMotion(morph,now),dpr=Math.min(2,devicePixelRatio||1)
   target.width=target.height=Math.ceil(viewport*dpr);const ctx=target.getContext('2d')!;ctx.scale(dpr,dpr);ctx.clearRect(0,0,viewport,viewport)
   // Read the live pose canvas: lifting and landing remain real sprite animation.
   if(source.current?.width){ctx.save();ctx.globalAlpha=motion.foxAlpha;ctx.translate(motion.sway*morph.size*.012,-motion.rise*morph.size*.16);ctx.drawImage(source.current,0,0,viewport,viewport);ctx.restore()}
   if(bitmap){ctx.globalAlpha=motion.ballAlpha;drawPetBall(ctx,bitmap,viewport/2,viewport/2,PET_BALL_SIZE,theme)}
   ctx.globalAlpha=1
   const light=motion.light,radius=PET_BALL_SIZE/2+viewport*.32*light,cx=viewport/2,cy=viewport/2
   if(motion.thread>0){ctx.save();ctx.strokeStyle='rgba(255,235,173,'+(.6*motion.thread)+')';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cx,1);ctx.quadraticCurveTo(cx+motion.sway*2,viewport*.11,cx+motion.sway,viewport*.26-motion.rise*morph.size*.1);ctx.stroke();ctx.restore()}
   const gradient=ctx.createRadialGradient(cx,cy,0,cx,cy,radius);gradient.addColorStop(0,'rgba(255,255,245,'+(.9*light)+')');gradient.addColorStop(.55,'rgba(255,224,148,'+(.62*light)+')');gradient.addColorStop(1,'rgba(255,219,140,0)')
   ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.fill()
   ctx.strokeStyle='rgba(255,243,199,'+(.8*light)+')';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(cx,cy,radius*.82,0,Math.PI*2);ctx.stroke()
   for(let i=0;i<8;i++){const angle=i*Math.PI/4+now/1100,x=cx+Math.cos(angle)*radius*.83,y=cy+Math.sin(angle)*radius*.83;ctx.fillStyle='rgba(255,248,210,'+light+')';const r=(theme==='pixel-jrpg'||theme==='stardew-valley'?2:2.5)*light;ctx.fillRect(x-r,y-r,r*2,r*2)}
   if(time-last>=30||motion.finished){last=time;latest.current(target)}
   if(!motion.finished||!source.current&&now<morph.startedAt+morph.durationMs+500)frame=requestAnimationFrame(paint)
  }
  frame=requestAnimationFrame(paint);return()=>{disposed=true;cancelAnimationFrame(frame)}
 },[morph,theme,source,viewport])
 return <canvas ref={canvas} className="xm-pet-morph-canvas" style={{width:viewport,height:viewport}} aria-hidden="true"/>
}
