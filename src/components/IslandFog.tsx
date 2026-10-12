import { memo, useId, useRef } from 'react'
import { useIslandViewport } from '../hooks/useIslandViewport'
import { ISLAND_WATER } from '../scenes/islandGeometry'

/** Depth haze follows distant islands and water; it never covers the near cottage. */
export const IslandFog = memo(function IslandFog() {
  const id=useId().replace(/:/g,'')
  const ref=useRef<SVGSVGElement>(null)
  const viewport=useIslandViewport(ref)
  return <svg ref={ref} className="xm-island-fog-details" viewBox={viewport.viewBox} preserveAspectRatio={viewport.preserveAspectRatio}>
    <defs>
      <linearGradient id={id+'far'} x1="0" y1="0" x2="0" y2="1"><stop stopColor="white" stopOpacity="0"/><stop offset=".5" stopColor="white" stopOpacity=".6"/><stop offset=".72" stopColor="white"/><stop offset="1" stopColor="white" stopOpacity="0"/></linearGradient>
      <linearGradient id={id+'depth'}><stop stopColor="white" stopOpacity="0"/><stop offset=".35" stopColor="white" stopOpacity=".22"/><stop offset=".7" stopColor="white" stopOpacity=".82"/><stop offset="1" stopColor="white"/></linearGradient>
      <mask id={id+'far-mask'}><rect x="600" y="150" width="1320" height="430" fill={`url(#${id}depth)`}/></mask>
      <mask id={id+'edge-mask'}><rect x="600" y="150" width="1320" height="430" fill={`url(#${id}far)`}/></mask>
      <clipPath id={id+'water'}><path d={ISLAND_WATER} clipRule="evenodd"/></clipPath>
      <filter id={id+'wisps'} x="-20%" y="-90%" width="140%" height="280%">
        <feTurbulence type="fractalNoise" baseFrequency=".007 .026" numOctaves="2" seed="13" result="noise"/>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="32" xChannelSelector="R" yChannelSelector="G"/>
        <feGaussianBlur stdDeviation="9 5"/>
      </filter>
    </defs>
    <g mask={`url(#${id}far-mask)`}><g mask={`url(#${id}edge-mask)`}>
      <rect className="xm-island-fog-distance" x="600" y="150" width="1320" height="430" fill="var(--haze)"/>
    </g></g>
    <g className="xm-island-fog-bank is-far" filter={`url(#${id}wisps)`}>
      <path d="M1020 362Q1160 343 1295 364T1580 369T1970 359" fill="none" stroke="var(--haze)" strokeWidth="42" strokeLinecap="round"/>
      <path d="M890 321Q1010 295 1180 327T1480 316T1880 329" fill="none" stroke="var(--haze)" strokeWidth="24" strokeLinecap="round" opacity=".5"/>
    </g>
    <g clipPath={`url(#${id}water)`}>
      <g className="xm-island-fog-bank is-water" filter={`url(#${id}wisps)`}>
        <path d="M900 416Q1140 390 1390 424T1960 450" fill="none" stroke="var(--haze)" strokeWidth="23" strokeLinecap="round"/>
        <path d="M775 570Q840 554 905 574T1110 594" fill="none" stroke="var(--haze)" strokeWidth="20" strokeLinecap="round" opacity=".7"/>
      </g>
    </g>
  </svg>
})
