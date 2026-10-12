import { memo, useEffect, useRef } from 'react'
import { SCENE_GEOMETRY, sourceViewport } from '../scenes/themeGeometry'
import type { LandscapeTheme } from '../scenes/themeGeometry'

const hash=(i:number)=>{const n=Math.sin(i*127.1+31.7)*43758.5453;return n-Math.floor(n)}
export const SceneRain=memo(function SceneRain({theme,animate,active,intensity,wind}:{theme:LandscapeTheme;animate:boolean;active:boolean;intensity:number;wind:number}){
  const ref=useRef<HTMLCanvasElement>(null),live=useRef({intensity,wind});live.current={intensity,wind}
  useEffect(()=>{
    const canvas=ref.current!,ctx=canvas.getContext('2d');if(!ctx)return
    const g=SCENE_GEOMETRY[theme],water=new Path2D(g.water)
    const impacts=g.waterBounds.flatMap((b,s)=>Array.from({length:s?34:100},(_,i)=>({x:b.x+hash(i*3+s*400)*b.w,y:b.y+hash(i*3+1+s*400)*b.h,delay:hash(i*3+2)*4,life:1.3+hash(i+50)*1.6})))
    let frame=0,last=0,width=0,height=0
    const paint=(time:number)=>{
      if(!width||!height)return
      const dpr=Math.min(1.5,devicePixelRatio||1);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height)
      const camera=sourceViewport(width,height,g.width,g.height);ctx.translate(0,camera.offsetY);ctx.scale(camera.scale,camera.scale)
      const {intensity:wet,wind:gust}=live.current,seconds=time/1000,swell=.58+.42*Math.sin(seconds*Math.PI/24)
      ctx.save();ctx.clip(water)
      for(let i=0;i<impacts.length;i++){
        const p=impacts[i];if(hash(i+300)>.22+wet*(.42+.5*swell))continue
        const t=animate?((seconds+p.delay)%p.life)/p.life:.55,perspective=.3+.7*(p.y-g.waterBounds[0].y)/Math.max(50,g.waterBounds[0].h),rx=(2+t*15)*Math.max(.25,perspective),ry=rx*.23,alpha=animate?Math.sin(t*Math.PI)*(.15+wet*.3):.08
        ctx.strokeStyle=`rgba(224,241,245,${alpha})`;ctx.lineWidth=g.pixel?1.1:.7
        ctx.beginPath()
        if(g.pixel){ctx.moveTo(p.x-rx,p.y);ctx.lineTo(p.x-rx*.5,p.y-ry);ctx.lineTo(p.x+rx*.5,p.y-ry);ctx.lineTo(p.x+rx,p.y);ctx.lineTo(p.x+rx*.5,p.y+ry);ctx.lineTo(p.x-rx*.5,p.y+ry);ctx.closePath()}else ctx.ellipse(p.x,p.y,rx,ry,0,0,Math.PI*2)
        ctx.stroke()
        if(t>.25){ctx.globalAlpha=.45;ctx.beginPath();ctx.ellipse(p.x,p.y,rx*.55,ry*.55,0,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1}
        if(t<.15&&animate){ctx.strokeStyle=`rgba(240,250,255,${(1-t/.15)*.4})`;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-1,p.y-3*(1-t/.15));ctx.stroke()}
      }
      ctx.restore()
      if(animate)g.eaves.forEach((p,i)=>{
        const period=1+i%4*.18,strength=.4+Math.min(1,wet)*.45,bead=((seconds+i*.37)%period)/period
        ctx.fillStyle=`rgba(225,242,246,${strength})`;ctx.fillRect(p.x-.7,p.y,.9,1+bead*2)
        for(let drop=0;drop<2;drop++){const t=((seconds+i*.37+drop*period*.5)%period)/period;if(t<.22||t>.94)continue
          const travel=(t-.22)/.72,y=p.y+2+travel*travel*p.fall,x=p.x+gust*travel*7,alpha=strength*(1-travel*.45)
          ctx.lineWidth=g.pixel?1.7:1;ctx.strokeStyle=`rgba(230,246,253,${alpha})`;ctx.beginPath();ctx.moveTo(x-gust,y-2-travel*8);ctx.lineTo(x,y);ctx.stroke()
        }
      })
    }
    const resize=()=>{const r=canvas.getBoundingClientRect();width=r.width;height=r.height;const dpr=Math.min(1.5,devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);paint(Date.now())}
    const tick=(time:number)=>{if(time-last>33){paint(Date.now());last=time}frame=requestAnimationFrame(tick)}
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize()
    if(animate&&active)frame=requestAnimationFrame(tick)
    return()=>{cancelAnimationFrame(frame);observer.disconnect()}
  },[theme,animate,active])
  return <canvas ref={ref} className="xm-island-rain-details" aria-hidden="true"/>
})

