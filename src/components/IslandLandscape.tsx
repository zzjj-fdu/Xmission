import { memo, useEffect, useId, useRef } from 'react'
import { sceneUrl } from '../scenes'
import type { ScenePhase } from '../scenes'
import type { ScenePassage } from '../store/scenePassage'
import type { SceneEnvironment } from '../scenes/environment'
import type { SceneWeather } from '../store/sceneWeather'
import { ISLAND_SKY, ISLAND_WATER, ISLAND_HORIZON, islandViewport } from '../scenes/islandGeometry'
import { islandCelestials, smooth, SCENE_PASSAGE_DURATION, SCENE_PASSAGE_ENTER } from '../scenes/islandTimeline'
import './IslandLandscape.css'

const WINDOWS = [
  { x:114,y:305,w:45,h:39 }, { x:240,y:286,w:61,h:57 },
  { x:726,y:232,w:13,h:18 }, { x:754,y:231,w:12,h:18 }, {x:789,y:232,w:12,h:17},
  { x:789,y:214,w:8,h:11 }, { x:904,y:221,w:10,h:13 },
  { x:575,y:356,w:16,h:22 }, { x:618,y:362,w:22,h:26 },
  { x:934,y:358,w:18,h:23 }, { x:995,y:367,w:19,h:22 },
]
const LIGHT = {
  predawn: { night:1, dusk:0, dawn:0, brightness:.43, warmth:0, lamps:.45, mist:.22 },
  dawn: { night:0, dusk:0, dawn:1, brightness:.94, warmth:.24, lamps:0, mist:.02 },
  morning: { night:0, dusk:0, dawn:0, brightness:1, warmth:.04, lamps:0, mist:0 },
  noon: { night:0, dusk:0, dawn:0, brightness:1, warmth:0, lamps:0, mist:0 },
  sunset: { night:0, dusk:1, dawn:0, brightness:.65, warmth:.62, lamps:0, mist:0 },
  night: { night:1, dusk:0, dawn:0, brightness:.4, warmth:0, lamps:1, mist:.06 },
} as const
const cleanSky = (name: string) => `${import.meta.env.BASE_URL}scenes/animal-crossing/sky-${name}-clean.webp`

export const IslandLandscape = memo(function IslandLandscape({ phase, environment, weather = 'clear', passage, cinematic = false }: {
  phase: ScenePhase; environment: SceneEnvironment; weather?: SceneWeather; passage?: ScenePassage | null; cinematic?: boolean
}) {
  const id = useId().replace(/:/g,'')
  const ref = useRef<HTMLDivElement>(null)
  const viewport = islandViewport(1920,720)
  const plate = weather === 'snow' ? `${import.meta.env.BASE_URL}scenes/animal-crossing/snow-landscape.webp` : sceneUrl('animal-crossing','noon')
  useEffect(() => {
    const root = ref.current!
    const sharedLight=root.closest<HTMLElement>('.xm-passage-overlay')
    const lamps = root.querySelectorAll<SVGElement>('[data-lamp]')
    const sun = root.querySelector<SVGElement>('[data-sun]')!
    const moon = root.querySelector<SVGElement>('[data-moon]')!
    const waterSun = root.querySelector<SVGElement>('[data-sun-reflection]')!
    const waterMoon = root.querySelector<SVGElement>('[data-moon-reflection]')!
    let frame = 0, last = 0
    const paint = (progress: number) => {
      const from = LIGHT[passage?.from ?? phase], to = LIGHT[passage?.to ?? phase]
      const t = smooth(progress)
      for (const key of Object.keys(to) as Array<keyof typeof to>) root.style.setProperty('--island-'+key, String(from[key]+(to[key]-from[key])*t))
      sharedLight?.style.setProperty('--passage-brightness',String(from.brightness+(to.brightness-from.brightness)*t))
      sharedLight?.style.setProperty('--passage-night',String(from.night+(to.night-from.night)*t))
      root.style.setProperty('--island-cloud', String(environment.cloud))
      root.style.setProperty('--island-direct', String(Math.max(.06,1-environment.cloud*.9)))
      const bodies=islandCelestials(passage?.from ?? phase,passage?.to ?? phase,passage?.kind,progress)
      for (const [node,body] of [[sun,bodies.sun],[moon,bodies.moon]] as const) {
        node.setAttribute('transform',`translate(${body.x} ${body.y})`)
        node.style.opacity=String(body.opacity*(1-environment.cloud*.72))
      }
      root.style.setProperty('--island-sun-low', String(smooth((bodies.sun.y-130)/230)))
      waterSun.setAttribute('transform',`translate(${bodies.sun.x} ${ISLAND_HORIZON+3})`)
      waterSun.style.opacity=String(bodies.sun.opacity*smooth((bodies.sun.y-130)/210)*(1-environment.cloud*.82))
      waterMoon.setAttribute('transform',`translate(${bodies.moon.x} ${ISLAND_HORIZON+3})`)
      waterMoon.style.opacity=String(bodies.moon.opacity*(1-environment.cloud*.7)*.6)
      lamps.forEach((lamp,i) => {
        const level = passage?.kind === 'lamps' ? smooth((progress-.13-i*.035)/.32) : from.lamps+(to.lamps-from.lamps)*t
        lamp.style.opacity=String(level)
      })
    }
    if (!passage) { paint(1); return }
    const tick = (time: number) => {
      const progress = passage.previewProgress ?? Math.min(1,Math.max(0,(time-passage.startedAt-SCENE_PASSAGE_ENTER)/SCENE_PASSAGE_DURATION))
      if (time-last>32) { paint(progress); last=time }
      if (progress<1 && passage.previewProgress === undefined) frame=requestAnimationFrame(tick)
    }
    paint(passage.previewProgress ?? 0); frame=requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, passage, environment])
  return <div ref={ref} className={`xm-island-landscape${cinematic ? ' is-cinematic' : ''}`} aria-hidden="true">
    <svg viewBox={viewport.viewBox} preserveAspectRatio={viewport.preserveAspectRatio}>
      <defs>
        <filter id={id+'soft'}><feGaussianBlur stdDeviation="1.5"/></filter>
        <filter id={id+'shadow'}><feGaussianBlur stdDeviation="7"/></filter>
        <filter id={id+'sun-soft'} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2"/></filter>
        {/* Refine the contour using blue dominance from the original pixels.
            This keeps thin windmill blades and foliage instead of a polygon gap. */}
        <filter id={id+'sky-key'} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 -1.6 -.2 1.8 0 -.15"/></filter>
        <clipPath id={id+'above-water'}><rect width="1920" height={ISLAND_HORIZON}/></clipPath>
        <mask id={id+'sky-edge'} maskUnits="userSpaceOnUse" x="0" y="0" width="1920" height="720"><path d={ISLAND_SKY} fill="none" stroke="white" strokeWidth="64"/></mask>
        <mask id={id+'sky'} maskUnits="userSpaceOnUse" x="0" y="0" width="1920" height="720">
          <path d={ISLAND_SKY} fill="white" filter={`url(#${id}soft)`}/>
          <image href={plate} width="1920" height="720" filter={`url(#${id}sky-key)`} mask={`url(#${id}sky-edge)`} clipPath={`url(#${id}above-water)`}/>
        </mask>
        <clipPath id={id+'orbit'}><path d={ISLAND_SKY}/></clipPath>
        <clipPath id={id+'water'}><path d={ISLAND_WATER} clipRule="evenodd"/></clipPath>
        <clipPath id={id+'moon-disc'}><circle r="30"/></clipPath>
        <radialGradient id={id+'glow'}><stop stopColor="#ffe6a2" stopOpacity=".65" /><stop offset="1" stopColor="#ffc774" stopOpacity="0" /></radialGradient>
        <radialGradient id={id+'sun-halo'}><stop stopColor="#fff3b4" stopOpacity=".55"/><stop offset=".25" stopColor="#ffd792" stopOpacity=".28"/><stop offset="1" stopColor="#ffdba0" stopOpacity="0"/></radialGradient>
        <radialGradient id={id+'moon-halo'}><stop stopColor="#e3e9ff" stopOpacity=".3"/><stop offset=".4" stopColor="#abbefc" stopOpacity=".12"/><stop offset="1" stopColor="#aebcec" stopOpacity="0"/></radialGradient>
        <linearGradient id={id+'warm'} x1="1" x2="0" y1="0" y2="1"><stop stopColor="#ffb562"/><stop offset=".65" stopColor="#e88c7e" stopOpacity=".4"/><stop offset="1" stopColor="#392f5e" stopOpacity="0"/></linearGradient>
        <linearGradient id={id+'mist'} x2="0" y2="1"><stop stopColor="#e1eeed" stopOpacity="0"/><stop offset=".45" stopColor="#e1eeed" stopOpacity=".6"/><stop offset="1" stopColor="#e1eeed" stopOpacity="0"/></linearGradient>
        {WINDOWS.map((w,i) => <clipPath key={i} id={id+'w'+i}><rect x={w.x} y={w.y} width={w.w} height={w.h} rx="2"/></clipPath>)}
      </defs>
      <image className="xm-island-fixed-plate" href={plate} width="1920" height="720"/>
      <g mask={`url(#${id}sky)`}>
        {weather !== 'snow' && <image href={cleanSky('day')} width="1920" height="720"/>}
        <image className="xm-island-dawn-sky" href={cleanSky('dawn')} width="1920" height="720"/>
        <image className="xm-island-dusk-sky" href={cleanSky('sunset')} width="1920" height="720"/>
        <image className="xm-island-night-sky" href={cleanSky('night')} width="1920" height="720"/>
      </g>
      <g clipPath={`url(#${id}orbit)`}>
        <g data-sun="">
          <circle r="155" fill={`url(#${id}sun-halo)`}/>
          <circle className="xm-island-sun-disc" r="29" filter={`url(#${id}sun-soft)`}/>
          <path d="M-21 8H21M-25 14H25M-18 20H18" stroke="#ffd68f" strokeWidth="1" opacity=".3"/>
        </g>
        <g data-moon="">
          <circle r="100" fill={`url(#${id}moon-halo)`}/>
          {/* Original painted moon clipped at its original pixel coordinates. */}
          <g clipPath={`url(#${id}moon-disc)`}><image href={sceneUrl('animal-crossing','night')} x="-1667" y="-109" width="1920" height="720"/></g>
        </g>
      </g>
      <g clipPath={`url(#${id}orbit)`}><rect className="xm-island-overcast" width="1920" height="370" fill="#75899e"/></g>
      <rect className="xm-island-sunlight" width="1920" height="720" fill={`url(#${id}warm)`}/>
      <rect className="xm-island-moonlight" width="1920" height="720" fill="#6585c9"/>
      <path className="xm-island-long-shadow" d="M394 394L709 459 622 468 390 401Z M531 414L745 470 662 474 524 421Z M1001 395L1183 452 1131 460 994 403Z" fill="#373556" filter={`url(#${id}shadow)`}/>
      <g className="xm-island-depth-mist"><path d="M479 267H1320V378H479Z" fill={`url(#${id}mist)`}/></g>
      {WINDOWS.map((w,i) => <g key={i} data-lamp="">
        <ellipse cx={w.x+w.w/2} cy={w.y+w.h/2} rx={w.w*1.65} ry={w.h*1.5} fill={`url(#${id}glow)`}/>
        <image href={sceneUrl('animal-crossing','night')} width="1920" height="720" clipPath={`url(#${id}w${i})`} />
      </g>)}
      <g clipPath={`url(#${id}water)`}>
        <g data-sun-reflection="" className="xm-island-solar-reflection">{Array.from({length:26},(_,i)=><path key={i} d={`M${-8-i*2+(i%3)*4} ${i*6}h${16+i*4}`} stroke="#ffdda0" strokeWidth={1.2+i*.025} opacity={.48-i*.012}/>)}</g>
        <g data-moon-reflection="" className="xm-island-solar-reflection">{Array.from({length:24},(_,i)=><path key={i} d={`M${-5-i*1.4+(i%4)*3} ${i*6}h${10+i*2.8}`} stroke="#e3ecff" strokeWidth="1" opacity={.5-i*.014}/>)}</g>
        <g className="xm-island-reflections">
          {[{x:804,y:553},{x:941,y:593},{x:1003,y:615}].map((r,i) => <g key={i} className="xm-island-water-light">
            {Array.from({length:15},(_,j) => <path key={j} d={`M${r.x-4-j*.75+(j%3)*2} ${r.y+j*7}h${7+j*1.7}`} stroke="#ffdc96" strokeWidth={1+j*.07} opacity={.65-j*.035}/>)}</g>)}
        </g>
      </g>
      <g className="xm-island-cloud-shadow" filter={`url(#${id}shadow)`}><path d="M300 420Q490 374 748 420T1270 465V600Q1070 480 700 535T280 514Z" fill="#364c64"/></g>
    </svg>
  </div>
})
