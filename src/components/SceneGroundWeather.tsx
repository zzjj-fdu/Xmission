import { memo, useId } from 'react'
import type { CSSProperties } from 'react'
import type { ThemeKey } from '../themes'
import { sceneUrl } from '../scenes'
import type { ScenePhase } from '../scenes'

type Snow = { d: string; opacity?: number }
type Pool = { d: string; x: number; y: number; rx: number; ry: number }
interface Landscape { width: number; height: number; roofs: Snow[]; ground: Snow[]; pools: Pool[] }

// Coordinates belong to each source landscape, not the viewport. SVG's centered
// cover crop keeps the surfaces attached when the scene divider or fullscreen changes.
const LANDSCAPES: Record<ThemeKey, Landscape> = {
  'pixel-jrpg': {
    width: 1920, height: 768,
    roofs: [
      { d: 'M398 140L408 95L424 141L419 147L414 127L408 112L403 138L402 145Z', opacity: .8 },
      { d: 'M361 176L375 145L391 180L386 184L378 162L374 155L368 178Z', opacity: .78 },
      { d: 'M282 224L299 190L316 225L309 229L301 207L297 201L289 224Z', opacity: .7 },
      { d: 'M203 334L218 333L219 337L229 336L230 340L250 339L252 343L271 342L272 345L302 344L302 350L278 349L262 347L242 345L218 341L201 340Z', opacity: .7 },
    ],
    ground: [
      { d: 'M286 636L301 634L309 640L326 640L330 645L342 644L350 650L338 653L321 649L313 648L299 643L286 642Z' },
      { d: 'M365 681L381 679L390 684L407 684L408 688L430 691L435 696L416 699L404 695L385 691L366 690Z' },
      { d: 'M466 729L481 726L496 729L500 733L517 733L518 737L541 741L540 747L515 746L500 741L479 738L464 735Z' },
      { d: 'M710 603L724 598L738 596L739 600L729 603L716 609L702 611L695 609Z', opacity: .64 },
      { d: 'M772 634L787 630L800 632L801 636L786 638L775 640L761 640L757 637Z', opacity: .6 },
      { d: 'M1135 640L1148 636L1166 638L1179 644L1197 645L1200 650L1181 651L1166 646L1149 643L1134 644Z', opacity: .62 },
    ],
    pools: [
      { d: 'M337 659L349 656L361 658L365 662L378 663L381 667L367 669L353 667L340 666L331 662Z', x: 356, y: 663, rx: 21, ry: 5 },
      { d: 'M425 713L439 709L457 712L463 716L477 717L480 722L462 726L446 722L429 722L418 717Z', x: 450, y: 718, rx: 27, ry: 7 },
      { d: 'M763 602L776 600L788 603L789 606L776 608L762 606L756 604Z', x: 774, y: 604, rx: 14, ry: 3 },
      { d: 'M801 645L815 641L830 644L834 648L821 651L808 650L795 647Z', x: 815, y: 647, rx: 17, ry: 4 },
    ],
  },
  'parchment-journal': {
    width: 1620, height: 971,
    roofs: [
      { d: 'M206 149Q209 130 214 120L221 146L218 153L214 133L211 142L210 153Z', opacity: .7 },
      { d: 'M253 225L257 207L264 223L265 230L260 221L257 218L256 229Z', opacity: .65 },
      { d: 'M25 244Q54 240 82 245L103 240L114 247L107 251L84 251Q55 246 29 250Z', opacity: .66 },
    ],
    ground: [
      { d: 'M181 823Q198 817 213 825Q221 832 237 830L245 835Q239 843 225 840Q207 831 191 834L178 830Z', opacity: .87 },
      { d: 'M228 864Q243 857 262 866Q277 874 292 872L300 879Q289 886 273 880Q249 870 229 874L220 870Z', opacity: .85 },
      { d: 'M320 909Q337 899 361 910L390 916Q407 921 404 929Q386 933 369 926L348 921Q329 917 314 919Z', opacity: .88 },
      { d: 'M164 722Q181 716 193 723L213 727L222 735Q207 740 191 732Q171 728 157 731Z', opacity: .68 },
      { d: 'M463 871Q482 867 497 874L525 881L537 893Q525 896 511 889L486 882L468 882Z', opacity: .65 },
      { d: 'M752 792Q773 788 786 794L811 795L818 801Q798 806 779 800L752 799Z', opacity: .45 },
    ],
    pools: [
      { d: 'M209 851Q222 844 238 849L255 854Q264 859 256 863L239 865Q225 861 212 863L202 858Z', x: 231, y: 856, rx: 25, ry: 7 },
      { d: 'M277 913Q296 904 316 911L335 917Q341 923 329 928L306 925Q289 929 274 921Z', x: 305, y: 918, rx: 28, ry: 8 },
      { d: 'M344 956Q362 948 379 953L401 960L405 966L375 968L354 965L336 961Z', x: 371, y: 960, rx: 29, ry: 6 },
      { d: 'M641 756Q652 752 666 755L683 759L678 763Q661 765 647 761Z', x: 661, y: 759, rx: 18, ry: 4 },
    ],
  },
  'animal-crossing': {
    width: 1920, height: 720,
    roofs: [
      { d: 'M194 101Q230 95 262 106L319 117Q354 119 394 145L385 154Q360 138 337 135L291 125L250 116L222 113L197 114Z' },
      { d: 'M217 202Q256 207 310 211L334 207L347 193Q370 164 393 155Q409 154 425 169L475 233L468 240L424 184Q408 166 396 166Q375 172 361 193L343 218Q331 225 307 222L218 215Z' },
      { d: 'M336 82L356 77L384 86L384 94L366 90L347 91L335 88Z', opacity: .9 },
      { d: 'M715 226L738 199L786 197Q808 202 830 224L821 228L784 207L742 209L724 229Z', opacity: .7 },
      { d: 'M883 215L900 187L916 216L910 220L902 201L891 220Z', opacity: .65 },
    ],
    ground: [
      { d: 'M188 467Q220 453 249 459L278 456Q297 456 313 463Q288 469 272 466L248 468Q220 466 196 477Z', opacity: .83 },
      { d: 'M403 425Q440 412 466 416L476 422Q455 423 434 429L407 434Z', opacity: .77 },
      { d: 'M562 396Q720 359 852 365L895 361Q952 361 1008 369L1016 380Q948 374 903 377L854 379Q717 371 570 409Z', opacity: .9 },
      { d: 'M987 474Q1007 459 1032 459Q1057 466 1068 476L1056 480Q1027 466 1000 482Z', opacity: .75 },
      { d: 'M1138 579Q1155 569 1171 572Q1195 568 1206 579L1201 587Q1178 579 1159 586L1141 585Z', opacity: .76 },
      { d: 'M1294 560Q1323 546 1350 554L1367 565Q1346 566 1328 562L1301 570Z', opacity: .72 },
    ],
    pools: [
      { d: 'M248 453Q262 446 278 450L298 455Q309 462 295 467Q280 470 265 464Q252 467 242 460Z', x: 276, y: 458, rx: 28, ry: 7 },
      { d: 'M433 426Q447 420 463 423L477 427Q483 432 472 436L449 435L431 433Z', x: 456, y: 430, rx: 21, ry: 5 },
      { d: 'M737 390Q758 386 781 389L809 391Q820 396 806 400L780 400L753 398L731 395Z', x: 777, y: 395, rx: 37, ry: 5 },
      { d: 'M911 383Q929 379 945 382L968 386L969 390L946 393L924 391L905 387Z', x: 939, y: 387, rx: 28, ry: 5 },
    ],
  },
  'stardew-valley': {
    width: 1920, height: 720,
    roofs: [
      { d: 'M119 220L151 223L184 226L242 218L250 224L225 232L185 239L150 234L120 231Z' },
      { d: 'M238 218L251 216L299 277L320 293L309 299L290 280L249 230L235 231Z' },
      { d: 'M54 331L99 314L120 310L157 305L191 309L198 315L150 319L118 323L91 331L51 341Z', opacity: .82 },
      { d: 'M177 315L227 318L271 322L311 328L347 330L370 342L362 349L341 341L306 339L264 335L216 331L176 327Z' },
      { d: 'M499 294L542 288L577 284L620 280L626 286L584 295L545 300L500 306Z' },
      { d: 'M620 279L630 281L656 300L664 325L689 366L682 372L657 336L647 310L625 291Z', opacity: .88 },
      { d: 'M472 359L505 359L542 357L560 354L565 360L548 367L512 369L472 370Z', opacity: .87 },
      { d: 'M500 239Q503 220 523 216Q542 215 551 239L546 244Q535 226 523 227Q507 228 505 246Z', opacity: .82 },
    ],
    ground: [
      { d: 'M362 447L377 445L393 448L419 447L429 451L425 456L404 457L391 454L369 454L356 451Z', opacity: .85 },
      { d: 'M556 578L571 573L590 576L604 578L612 583L604 588L580 584L567 586L550 582Z' },
      { d: 'M689 619L704 615L723 618L731 623L751 623L758 629L744 633L724 629L713 625L692 628L684 623Z' },
      { d: 'M836 665L854 660L871 664L887 665L894 672L914 672L920 678L903 682L881 676L866 674L846 673L830 669Z' },
      { d: 'M948 700L967 696L984 699L1001 704L1018 704L1026 711L1011 715L989 711L976 708L955 709L943 705Z' },
      { d: 'M1259 634L1272 629L1291 632L1307 631L1320 638L1314 642L1296 639L1279 640L1260 638Z', opacity: .58 },
    ],
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
  const landscape = LANDSCAPES[theme]
  const pixel = theme === 'pixel-jrpg' || theme === 'stardew-valley'
  return <svg className={`xm-scenefx-ground is-${weather}${pixel ? ' is-pixel' : ''}`} viewBox={`0 0 ${landscape.width} ${landscape.height}`} preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id={`${id}-snow`} x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
        <stop offset="0" stopColor="var(--snow-light)" /><stop offset=".5" stopColor="var(--snow-body)" /><stop offset="1" stopColor="var(--snow-shade)" />
      </linearGradient>
      <linearGradient id={`${id}-water`} x1="0" y1="0" x2=".1" y2="1">
        <stop offset="0" stopColor="var(--pool-sky)" stopOpacity=".75" /><stop offset=".48" stopColor="var(--pool-body)" stopOpacity=".35" /><stop offset="1" stopColor="var(--pool-shadow)" stopOpacity=".7" />
      </linearGradient>
      <linearGradient id={`${id}-glint`} x1="0" y1="0" x2="1" y2="0">
        <stop stopColor="var(--pool-glint)" stopOpacity="0" /><stop offset=".4" stopColor="var(--pool-glint)" stopOpacity=".7" /><stop offset="1" stopColor="var(--pool-glint)" stopOpacity="0" />
      </linearGradient>
      <pattern id={`${id}-powder`} width="13" height="11" patternUnits="userSpaceOnUse">
        <path d="M2 2h2M9 7h1M5 10h2" stroke="var(--snow-light)" strokeWidth="1" opacity=".6" />
        <path d="M8 3h2M1 8h1" stroke="var(--snow-shade)" strokeWidth="1" opacity=".28" />
      </pattern>
      {weather === 'rain' && landscape.pools.map((pool, i) => <clipPath id={`${id}-pool-${i}`} key={i}><path d={pool.d} /></clipPath>)}
    </defs>
    {weather === 'snow' ? <>
      {landscape.roofs.map((surface, i) => <g key={`roof-${i}`} opacity={surface.opacity ?? .92}>
        <path d={surface.d} fill="var(--snow-shadow)" opacity=".36" transform="translate(0 2.5)" />
        <path d={surface.d} fill={`url(#${id}-snow)`} />
        <path d={surface.d} fill={`url(#${id}-powder)`} opacity=".55" />
      </g>)}
      {landscape.ground.map((surface, i) => <g key={`bank-${i}`} opacity={surface.opacity ?? .86}>
        <path d={surface.d} fill="var(--snow-shadow)" opacity=".28" transform="translate(0 2)" />
        <path d={surface.d} fill={`url(#${id}-snow)`} />
        <path d={surface.d} fill={`url(#${id}-powder)`} opacity=".7" />
      </g>)}
    </> : landscape.pools.map((pool, i) => <g key={i} className="xm-scenefx-pool">
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
