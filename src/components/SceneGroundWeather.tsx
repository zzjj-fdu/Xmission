import { memo, useId, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { ThemeKey } from '../themes'
import { sceneUrl } from '../scenes'
import type { ScenePhase } from '../scenes'
import { useIslandViewport } from '../hooks/useIslandViewport'

type Pool = { d: string; x: number; y: number; rx: number; ry: number }
interface Landscape { width: number; height: number; pools: Pool[] }

// Puddles follow the same fixed source camera as the terrain and water.
const LANDSCAPES: Record<ThemeKey, Landscape> = {
  'pixel-jrpg': {
    width: 1920, height: 768,
    pools: [
      { d: 'M337 659L349 656L361 658L365 662L378 663L381 667L367 669L353 667L340 666L331 662Z', x: 356, y: 663, rx: 21, ry: 5 },
      { d: 'M425 713L439 709L457 712L463 716L477 717L480 722L462 726L446 722L429 722L418 717Z', x: 450, y: 718, rx: 27, ry: 7 },
      { d: 'M763 602L776 600L788 603L789 606L776 608L762 606L756 604Z', x: 774, y: 604, rx: 14, ry: 3 },
      { d: 'M801 645L815 641L830 644L834 648L821 651L808 650L795 647Z', x: 815, y: 647, rx: 17, ry: 4 },
    ],
  },
  'parchment-journal': {
    width: 1620, height: 971,
    pools: [
      { d: 'M209 851Q222 844 238 849L255 854Q264 859 256 863L239 865Q225 861 212 863L202 858Z', x: 231, y: 856, rx: 25, ry: 7 },
      { d: 'M277 913Q296 904 316 911L335 917Q341 923 329 928L306 925Q289 929 274 921Z', x: 305, y: 918, rx: 28, ry: 8 },
      { d: 'M344 956Q362 948 379 953L401 960L405 966L375 968L354 965L336 961Z', x: 371, y: 960, rx: 29, ry: 6 },
      { d: 'M641 756Q652 752 666 755L683 759L678 763Q661 765 647 761Z', x: 661, y: 759, rx: 18, ry: 4 },
    ],
  },
  'animal-crossing': {
    width: 1920, height: 720,
    pools: [
      { d: 'M248 453Q262 446 278 450L298 455Q309 462 295 467Q280 470 265 464Q252 467 242 460Z', x: 276, y: 458, rx: 28, ry: 7 },
      { d: 'M433 426Q447 420 463 423L477 427Q483 432 472 436L449 435L431 433Z', x: 456, y: 430, rx: 21, ry: 5 },
      { d: 'M737 390Q758 386 781 389L809 391Q820 396 806 400L780 400L753 398L731 395Z', x: 777, y: 395, rx: 37, ry: 5 },
      { d: 'M911 383Q929 379 945 382L968 386L969 390L946 393L924 391L905 387Z', x: 939, y: 387, rx: 28, ry: 5 },
    ],
  },
  'stardew-valley': {
    width: 1920, height: 720,
    pools: [
      { d: 'M331 451L346 447L363 450L379 451L385 456L372 460L355 457L337 458L326 454Z', x: 354, y: 453, rx: 25, ry: 5 },
      { d: 'M596 598L609 594L624 597L638 597L644 602L635 606L619 606L607 603L591 603Z', x: 619, y: 601, rx: 23, ry: 5 },
      { d: 'M765 645L780 640L797 643L811 643L818 649L806 654L787 652L776 654L760 649Z', x: 788, y: 648, rx: 25, ry: 6 },
      { d: 'M917 692L934 688L952 691L968 693L978 699L966 704L943 702L928 704L911 698Z', x: 945, y: 697, rx: 29, ry: 7 },
    ],
  },
}

export const SceneGroundWeather = memo(function SceneGroundWeather({ theme, phase, weather }: {
  theme: ThemeKey; phase: ScenePhase; weather: 'rain' | 'snow'
}) {
  const id = 'ground-' + useId().replace(/:/g, '')
  const ref=useRef<SVGSVGElement>(null)
  const viewport=useIslandViewport(ref,theme === 'animal-crossing')
  const landscape = LANDSCAPES[theme]
  const pixel = theme === 'pixel-jrpg' || theme === 'stardew-valley'
  // All snowfall uses full winter artwork; this component only paints puddles.
  if (weather === 'snow') return null
  return <svg ref={ref} className={`xm-scenefx-ground is-${weather}${pixel ? ' is-pixel' : ''}`} viewBox={theme === 'animal-crossing' ? viewport.viewBox : `0 0 ${landscape.width} ${landscape.height}`} preserveAspectRatio="xMinYMid slice">
    <defs>
      <linearGradient id={`${id}-water`} x1="0" y1="0" x2=".1" y2="1">
        <stop offset="0" stopColor="var(--pool-sky)" stopOpacity=".75" /><stop offset=".48" stopColor="var(--pool-body)" stopOpacity=".35" /><stop offset="1" stopColor="var(--pool-shadow)" stopOpacity=".7" />
      </linearGradient>
      <linearGradient id={`${id}-glint`} x1="0" y1="0" x2="1" y2="0">
        <stop stopColor="var(--pool-glint)" stopOpacity="0" /><stop offset=".4" stopColor="var(--pool-glint)" stopOpacity=".7" /><stop offset="1" stopColor="var(--pool-glint)" stopOpacity="0" />
      </linearGradient>
      {weather === 'rain' && landscape.pools.map((pool, i) => <clipPath id={`${id}-pool-${i}`} key={i}><path d={pool.d} /></clipPath>)}
    </defs>
    {landscape.pools.map((pool, i) => <g key={i} className="xm-scenefx-pool">
      <path d={pool.d} fill="var(--pool-shadow)" opacity=".2" transform="translate(0 1.5)" />
      <g clipPath={`url(#${id}-pool-${i})`}>
        <path d={pool.d} fill={`url(#${id}-water)`} />
        {/* Reuse the decoded sky image for a subtle, vertically compressed reflection. */}
        <image href={sceneUrl(theme, phase)} width={landscape.width} height={landscape.height}
          transform={`translate(0 ${pool.y + landscape.height * .09}) scale(1 -.28)`} opacity=".24" />
        <path d={`M${pool.x - pool.rx} ${pool.y - pool.ry * .35}Q${pool.x} ${pool.y - pool.ry * .8} ${pool.x + pool.rx} ${pool.y - pool.ry * .2}`}
          fill="none" stroke={`url(#${id}-glint)`} strokeWidth={pixel ? 1.5 : 1} />
        {[0, 1].map((ring) => <g key={ring} transform={`translate(${pool.x + (ring ? pool.rx * .25 : -pool.rx * .2)} ${pool.y + (ring ? .5 : -1)})`}>
          {pixel ? <path className="xm-scenefx-ripple" d={`M${-pool.rx * .45} -1h${pool.rx * .12}v-1h${pool.rx * .65}v1h${pool.rx * .12}v2h${-pool.rx * .12}v1h${-pool.rx * .65}v-1h${-pool.rx * .12}Z`}
            style={{ '--ripple-delay': `${-i * .83 - ring * 1.7}s` } as CSSProperties} />
            : <ellipse className="xm-scenefx-ripple" rx={pool.rx * .5} ry={pool.ry * .7}
              style={{ '--ripple-delay': `${-i * .83 - ring * 1.7}s` } as CSSProperties} />}
        </g>)}
      </g>
    </g>)}
  </svg>
})
