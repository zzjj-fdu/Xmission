import { memo, useId } from 'react'
import { SCENE_GEOMETRY } from '../scenes/themeGeometry'
import type { LandscapeTheme } from '../scenes/themeGeometry'

export const SceneFog=memo(function SceneFog({theme}:{theme:LandscapeTheme}){
  const g=SCENE_GEOMETRY[theme],f=g.fog,id=useId().replace(/:/g,'')
  return <svg className={`xm-island-fog-details xm-theme-fog theme-${theme}`} viewBox={`0 0 ${g.width} ${g.height}`} preserveAspectRatio="xMinYMid slice">
    <defs>
      <linearGradient id={id+'depth'}><stop stopColor="white" stopOpacity="0"/><stop offset=".4" stopColor="white" stopOpacity=".28"/><stop offset="1" stopColor="white"/></linearGradient>
      <linearGradient id={id+'height'} x2="0" y2="1"><stop stopColor="white" stopOpacity="0"/><stop offset=".4" stopColor="white"/><stop offset=".65" stopColor="white" stopOpacity=".7"/><stop offset="1" stopColor="white" stopOpacity="0"/></linearGradient>
      <mask id={id+'depth-mask'} maskUnits="userSpaceOnUse" x="0" y="0" width={g.width} height={g.height}><rect x={f.x} y={f.y} width={f.w} height={f.h} fill={`url(#${id}depth)`}/></mask>
      <mask id={id+'height-mask'} maskUnits="userSpaceOnUse" x="0" y="0" width={g.width} height={g.height}><rect x={f.x} y={f.y} width={f.w} height={f.h} fill={`url(#${id}height)`}/></mask>
      <clipPath id={id+'water'}><path d={g.water}/></clipPath>
      <filter id={id+'wisps'} x="-20%" y="-100%" width="140%" height="300%"><feTurbulence type="fractalNoise" baseFrequency={g.pixel?".009 .037":".005 .024"} numOctaves="2" seed={g.pixel?7:19} result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale={g.pixel?20:37} xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation={g.pixel?"5 3":"11 5"}/></filter>
    </defs>
    <g mask={`url(#${id}depth-mask)`}><g mask={`url(#${id}height-mask)`}><rect className="xm-island-fog-distance" x={f.x} y={f.y} width={f.w} height={f.h} fill="var(--haze)"/></g></g>
    {f.banks.map((path,i)=><g key={i} className={`xm-island-fog-bank ${i?'is-water':'is-far'}`} filter={`url(#${id}wisps)`}><path d={path} fill="none" stroke="var(--haze)" strokeWidth={i?22:38} strokeLinecap="round" opacity={1-i*.2}/></g>)}
    <g clipPath={`url(#${id}water)`}><g className="xm-island-fog-bank is-water" filter={`url(#${id}wisps)`}>{g.waterBounds.map((b,i)=><path key={i} d={`M${b.x} ${b.y+b.h*.6}Q${b.x+b.w*.25} ${b.y+b.h*.2} ${b.x+b.w*.5} ${b.y+b.h*.55}T${b.x+b.w} ${b.y+b.h*.6}`} fill="none" stroke="var(--haze)" strokeWidth="21"/>)}</g></g>
  </svg>
})

