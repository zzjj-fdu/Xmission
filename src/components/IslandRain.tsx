import { memo, useEffect, useRef } from 'react'
import { ISLAND_RIVER, ISLAND_SEA, ISLAND_SEA_ROCK, islandViewport } from '../scenes/islandGeometry'

const hash = (index: number) => { const value=Math.sin(index*127.1+31.7)*43758.5453; return value-Math.floor(value) }
const impacts = Array.from({length:124},(_,i) => ({
  sea:i>=54, x:i<54 ? 766+hash(i*3)*475 : 1170+hash(i*3)*750,
  y:i<54 ? 506+hash(i*3+1)*214 : 369+hash(i*3+1)*195,
  delay:hash(i*3+2)*4, life:1.35+hash(i+40)*1.2,
}))
// Fixed source coordinates: roof runoff, striped awning, then bridge edges.
const drips=[
  {x:219,y:232,fall:54},{x:240,y:234,fall:59},{x:263,y:235,fall:56},{x:287,y:236,fall:64},
  {x:311,y:235,fall:55},{x:334,y:225,fall:65},{x:447,y:220,fall:46},{x:467,y:238,fall:50},
  {x:222,y:270,fall:38},{x:254,y:274,fall:42},{x:286,y:277,fall:44},{x:318,y:277,fall:41},{x:347,y:274,fall:40},
  {x:566,y:401,fall:28},{x:664,y:386,fall:25},{x:744,y:381,fall:24},{x:851,y:379,fall:26},{x:984,y:394,fall:32},
]

/** One 30 fps canvas replaces hundreds of animated ring elements. */
export const IslandRain = memo(function IslandRain({ animate, active, intensity, wind = 0 }: { animate: boolean; active: boolean; intensity: number; wind?: number }) {
  const ref=useRef<HTMLCanvasElement>(null)
  const intensityRef=useRef(intensity)
  intensityRef.current=intensity
  const windRef=useRef(wind)
  windRef.current=wind
  useEffect(() => {
    const canvas=ref.current!
    const ctx=canvas.getContext('2d')
    if(!ctx) return
    const river=new Path2D(ISLAND_RIVER), sea=new Path2D(ISLAND_SEA+' '+ISLAND_SEA_ROCK)
    let frame=0, last=0, width=0, height=0
    const paint = (time: number) => {
      if(!width || !height) return
      const dpr=Math.min(1.5,window.devicePixelRatio || 1)
      ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height)
      const viewport=islandViewport(width,height)
      ctx.translate(0,viewport.offsetY); ctx.scale(viewport.scale,viewport.scale)
      const wet=intensityRef.current
      // Wall-clock phase stays continuous when the app is hidden/reopened.
      const seconds=time/1000, swell=.58+.42*Math.sin(seconds*Math.PI/24)
      for(const [surface,path] of [['river',river],['sea',sea]] as const) {
        ctx.save(); ctx.clip(path,'evenodd')
        for(let i=0;i<impacts.length;i++) {
          const p=impacts[i]
          if(p.sea !== (surface==='sea')) continue
          const strength=Math.min(1,.24+wet*(.42+.5*swell))
          if(hash(i+300)>strength) continue
          const progress=animate ? ((seconds+p.delay)%p.life)/p.life : .55
          const perspective=p.sea ? .25+(p.y-369)/195*.8 : .6+(p.y-500)/220*.8
          const rx=(3+progress*17)*perspective, ry=rx*.24
          const alpha=animate ? Math.sin(progress*Math.PI)*(.14+wet*.32) : .09
          ctx.lineWidth=.7*perspective; ctx.strokeStyle=`rgba(219,244,248,${alpha})`
          ctx.beginPath();ctx.ellipse(p.x,p.y,rx,ry,0,0,Math.PI*2);ctx.stroke()
          if(progress>.25) {ctx.strokeStyle=`rgba(220,243,245,${alpha*.48})`;ctx.beginPath();ctx.ellipse(p.x,p.y,rx*.58,ry*.58,0,0,Math.PI*2);ctx.stroke()}
          if(progress<.16 && animate) {
            ctx.strokeStyle=`rgba(235,250,255,${(1-progress/.16)*.5})`
            ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-1,p.y-3*perspective*(1-progress/.16));ctx.stroke()
          }
        }
        ctx.restore()
      }
      if(animate) for(let i=0;i<drips.length;i++) {
        const p=drips[i], period=.95+i%4*.19
        const strength=.4+Math.min(1,wet)*.45
        // Water first gathers under the edge, then detaches and accelerates.
        const bead=((seconds+i*.37)%period)/period
        ctx.fillStyle=`rgba(221,246,251,${strength})`
        ctx.beginPath();ctx.ellipse(p.x,p.y+1,1.1,1+Math.min(bead/.22,1)*1.1,0,0,Math.PI*2);ctx.fill()
        for(let drop=0;drop<2;drop++) {
          const t=((seconds+i*.37+drop*period*.5)%period)/period
          if(t<.22 || t>.94) continue
          const travel=(t-.22)/.72, y=p.y+2+travel*travel*p.fall
          const x=p.x+windRef.current*travel*7
          const alpha=strength*(1-travel*.45), length=2+travel*9
          // A faint cool outline keeps runoff legible against cream plaster.
          ctx.lineWidth=2.3;ctx.strokeStyle=`rgba(48,85,103,${alpha*.28})`
          ctx.beginPath();ctx.moveTo(x-windRef.current*.8,y-length);ctx.lineTo(x,y);ctx.stroke()
          ctx.lineWidth=1.1;ctx.strokeStyle=`rgba(221,246,251,${alpha})`
          ctx.beginPath();ctx.moveTo(x-windRef.current*.8,y-length);ctx.lineTo(x,y);ctx.stroke()
          ctx.fillStyle=`rgba(244,253,255,${alpha})`
          ctx.beginPath();ctx.ellipse(x,y,.8,1.4,0,0,Math.PI*2);ctx.fill()
        }
      }
    }
    const resize=()=> {
      const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height
      const dpr=Math.min(1.5,window.devicePixelRatio || 1)
      canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);paint(Date.now())
    }
    const tick=(time:number)=> {if(time-last>33) {paint(Date.now());last=time}frame=requestAnimationFrame(tick)}
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize()
    if(animate && active) frame=requestAnimationFrame(tick)
    return ()=>{cancelAnimationFrame(frame);observer.disconnect()}
  },[animate,active])
  return <canvas ref={ref} className="xm-island-rain-details" aria-hidden="true"/>
})
