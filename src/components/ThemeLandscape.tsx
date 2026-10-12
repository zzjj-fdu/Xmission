import { memo, useEffect, useId, useRef } from 'react'
import { sceneUrl } from '../scenes'
import type { ScenePhase } from '../scenes'
import type { ScenePassage } from '../store/scenePassage'
import type { SceneEnvironment } from '../scenes/environment'
import type { SceneWeather } from '../store/sceneWeather'
import { SCENE_GEOMETRY, themeCelestials } from '../scenes/themeGeometry'
import type { LandscapeTheme } from '../scenes/themeGeometry'
import { smooth, SCENE_PASSAGE_DURATION, SCENE_PASSAGE_ENTER } from '../scenes/islandTimeline'
import './IslandLandscape.css'
import './ThemeLandscape.css'

const LIGHT = {
  predawn:{night:1,dusk:0,dawn:0,brightness:.43,warmth:0,lamps:.45,mist:.22},
  dawn:{night:0,dusk:0,dawn:1,brightness:.94,warmth:.24,lamps:0,mist:.09},
  morning:{night:0,dusk:0,dawn:0,brightness:1,warmth:.04,lamps:0,mist:0},
  noon:{night:0,dusk:0,dawn:0,brightness:1,warmth:0,lamps:0,mist:0},
  sunset:{night:0,dusk:1,dawn:0,brightness:.65,warmth:.62,lamps:.08,mist:0},
  night:{night:1,dusk:0,dawn:0,brightness:.4,warmth:0,lamps:1,mist:.08},
} as const
export const landscapeAsset=(theme:LandscapeTheme,name:string)=>`${import.meta.env.BASE_URL}scenes/${theme}/${name}.webp`

export const ThemeLandscape=memo(function ThemeLandscape({theme,phase,weather,environment,passage}:{
  theme:LandscapeTheme;phase:ScenePhase;weather:SceneWeather;environment:SceneEnvironment;passage?:ScenePassage|null
}) {
  const g=SCENE_GEOMETRY[theme],id=useId().replace(/:/g,''),ref=useRef<HTMLDivElement>(null)
  const plate=landscapeAsset(theme,weather==='snow'?'snow-landscape':'sky-day-clean')
  useEffect(()=>{
    const root=ref.current!,shared=root.closest<HTMLElement>('.xm-passage-overlay')
    const sun=root.querySelector<SVGElement>('[data-sun]')!,moon=root.querySelector<SVGElement>('[data-moon]')!
    const waterSun=root.querySelector<SVGElement>('[data-sun-reflection]')!,waterMoon=root.querySelector<SVGElement>('[data-moon-reflection]')!
    const lamps=root.querySelectorAll<SVGElement>('[data-lamp]')
    let frame=0,last=0
    const paint=(progress:number)=>{
      const from=LIGHT[passage?.from??phase],to=LIGHT[passage?.to??phase],t=smooth(progress)
      for(const key of Object.keys(to) as Array<keyof typeof to>)root.style.setProperty('--island-'+key,String(from[key]+(to[key]-from[key])*t))
      shared?.style.setProperty('--passage-brightness',String(from.brightness+(to.brightness-from.brightness)*t))
      shared?.style.setProperty('--passage-night',String(from.night+(to.night-from.night)*t))
      root.style.setProperty('--island-cloud',String(environment.cloud));root.style.setProperty('--island-direct',String(Math.max(.06,1-environment.cloud*.9)))
      const bodies=themeCelestials(theme,passage?.from??phase,passage?.to??phase,passage?.kind,progress)
      for(const [node,body] of [[sun,bodies.sun],[moon,bodies.moon]] as const){node.setAttribute('transform',`translate(${body.x} ${body.y})`);node.style.opacity=String(body.opacity*(1-environment.cloud*.72))}
      root.style.setProperty('--island-sun-low',String(smooth((bodies.sun.y-130)/230)))
      for(const [node,body] of [[waterSun,bodies.sun],[waterMoon,bodies.moon]] as const){node.setAttribute('transform',`translate(${body.x} ${g.waterBounds[0].y})`);node.style.opacity=String(body.opacity*(1-environment.cloud*.7)*.55)}
      lamps.forEach((lamp,i)=>{lamp.style.opacity=String(passage?.kind==='lamps'?smooth((progress-.1-i*.037)/.32):from.lamps+(to.lamps-from.lamps)*t)})
    }
    if(!passage){paint(1);return}
    const tick=(time:number)=>{const p=passage.previewProgress??Math.min(1,Math.max(0,(time-passage.startedAt-SCENE_PASSAGE_ENTER)/SCENE_PASSAGE_DURATION));if(time-last>32){paint(p);last=time}if(p<1&&passage.previewProgress===undefined)frame=requestAnimationFrame(tick)}
    paint(passage.previewProgress??0);frame=requestAnimationFrame(tick)
    return()=>cancelAnimationFrame(frame)
  },[theme,phase,environment,passage,g])
  return <div ref={ref} className={`xm-island-landscape xm-theme-landscape theme-${theme}`} aria-hidden="true">
    <svg viewBox={`0 0 ${g.width} ${g.height}`} preserveAspectRatio="xMinYMid slice">
      <defs>
        <filter id={id+'soft'}><feGaussianBlur stdDeviation={g.pixel?.7:1.5}/></filter>
        <filter id={id+'shadow'}><feGaussianBlur stdDeviation={g.pixel?3:9}/></filter>
        <filter id={id+'sky-key'} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 -1.6 -.2 1.8 0 -.15"/></filter>
        <clipPath id={id+'edge-limit'}><rect width={g.width} height={g.horizon}/></clipPath>
        <mask id={id+'edge'} maskUnits="userSpaceOnUse" x="0" y="0" width={g.width} height={g.height}><path d={g.sky} fill="none" stroke="white" strokeWidth="34"/></mask>
        <mask id={id+'sky'} maskUnits="userSpaceOnUse" x="0" y="0" width={g.width} height={g.height}><path d={g.sky} fill="white" filter={`url(#${id}soft)`}/><image href={plate} width={g.width} height={g.height} filter={`url(#${id}sky-key)`} mask={`url(#${id}edge)`} clipPath={`url(#${id}edge-limit)`}/></mask>
        <clipPath id={id+'orbit'}><path d={g.sky}/></clipPath>
        <clipPath id={id+'water'}><path d={g.water}/></clipPath>
        <clipPath id={id+'moon-disc'}><circle r={g.moon.r}/></clipPath>
        <radialGradient id={id+'halo'}><stop stopColor={g.glow} stopOpacity=".65"/><stop offset=".3" stopColor={g.glow} stopOpacity=".24"/><stop offset="1" stopColor={g.glow} stopOpacity="0"/></radialGradient>
        <radialGradient id={id+'moon-halo'}><stop stopColor="#e3e9ff" stopOpacity=".3"/><stop offset="1" stopColor="#aebcec" stopOpacity="0"/></radialGradient>
        <linearGradient id={id+'warm'} x1="1" x2="0" y1="0" y2="1"><stop stopColor="#ffb562"/><stop offset=".65" stopColor="#e88c7e" stopOpacity=".4"/><stop offset="1" stopColor="#392f5e" stopOpacity="0"/></linearGradient>
        <linearGradient id={id+'mist'} x2="0" y2="1"><stop stopColor="#dde6e8" stopOpacity="0"/><stop offset=".5" stopColor="#dde6e8" stopOpacity=".5"/><stop offset="1" stopColor="#dde6e8" stopOpacity="0"/></linearGradient>
        {g.windows.map((w,i)=><clipPath key={i} id={id+'w'+i}><rect x={w.x} y={w.y} width={w.w} height={w.h}/></clipPath>)}
      </defs>
      <image className="xm-island-fixed-plate" href={plate} width={g.width} height={g.height}/>
      <g mask={weather==='snow'?`url(#${id}sky)`:undefined}>
        <image className="xm-island-dawn-sky" href={landscapeAsset(theme,'sky-dawn-clean')} width={g.width} height={g.height}/>
        <image className="xm-island-dusk-sky" href={landscapeAsset(theme,'sky-sunset-clean')} width={g.width} height={g.height}/>
        <image className="xm-island-night-sky" href={landscapeAsset(theme,'sky-night-clean')} width={g.width} height={g.height}/>
      </g>
      <g clipPath={`url(#${id}orbit)`}>
        <g data-sun=""><circle r={g.sun.r*5.8} fill={`url(#${id}halo)`}/><circle className="xm-island-sun-disc" r={g.sun.r}/>{g.pixel&&<path d={`M${-g.sun.r} 7h${g.sun.r*2}M${-g.sun.r+4} 13h${g.sun.r*2-8}`} stroke="#f6cd93" strokeWidth="2" opacity=".5"/>}</g>
        <g data-moon=""><circle r={g.moon.r*3.2} fill={`url(#${id}moon-halo)`}/><g clipPath={`url(#${id}moon-disc)`}><image href={sceneUrl(theme,'night')} x={-g.moon.x} y={-g.moon.y} width={g.width} height={g.height}/></g></g>
        <rect className="xm-island-overcast" width={g.width} height={g.horizon} fill="#75899e"/>
      </g>
      <rect className="xm-island-sunlight" width={g.width} height={g.height} fill={`url(#${id}warm)`}/>
      <rect className="xm-island-moonlight" width={g.width} height={g.height} fill={g.night}/>
      <path className="xm-theme-long-shadow" d={g.shadows} fill="#333657" filter={`url(#${id}shadow)`}/>
      <rect className="xm-island-depth-mist" x={g.fog.x} y={g.fog.y} width={g.fog.w} height={g.fog.h} fill={`url(#${id}mist)`}/>
      {g.windows.map((w,i)=><g key={i} data-lamp=""><ellipse cx={w.x+w.w/2} cy={w.y+w.h/2} rx={w.w*1.9} ry={w.h*1.7} fill={`url(#${id}halo)`}/><image href={sceneUrl(theme,'night')} width={g.width} height={g.height} clipPath={`url(#${id}w${i})`}/></g>)}
      <g clipPath={`url(#${id}water)`}>
        <g data-sun-reflection="" className="xm-island-solar-reflection">{Array.from({length:28},(_,i)=><path key={i} d={`M${-8-i*1.5+i%3*3} ${i*6}h${16+i*3}`} stroke={g.glow} strokeWidth={g.pixel?2:1} opacity={.5-i*.012}/>)}</g>
        <g data-moon-reflection="" className="xm-island-solar-reflection">{Array.from({length:28},(_,i)=><path key={i} d={`M${-6-i+i%3*3} ${i*6}h${12+i*2}`} stroke="#dce7ff" strokeWidth={g.pixel?1.5:.8} opacity={.4-i*.011}/>)}</g>
        {theme==='stardew-valley'&&<g className="xm-island-reflections xm-island-water-light">{Array.from({length:12},(_,i)=><path key={i} d={`M${895-i*3+i%3*5} ${460+i*4}h${12+i*5}`} stroke="#ffc56e" strokeWidth="2" opacity={.4-i*.025}/>)}</g>}
      </g>
    </svg>
  </div>
})

