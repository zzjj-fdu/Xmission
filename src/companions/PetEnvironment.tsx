import {FoxAccessory} from './FoxSprite'
import type {useFox} from './useFox'
import type {FoxDirection} from './types'
import {petViewport} from './petGeometry'
import {PetToyArt} from './PetDesktopToy'
export function PetEnvironment({pet,direction='right',onPaint}:{pet:ReturnType<typeof useFox>;direction?:FoxDirection;onPaint?:()=>void}){
 const p=pet.preferences,night=pet.phase==='night'||pet.phase==='predawn',reading=['focus','book-open','book-close','remind'].includes(pet.action)||pet.activity==='focus',snow=pet.weather==='snow'
 const rain=p.followEnvironment&&pet.weather==='rain'&&reading,lamp=p.followEnvironment&&night&&(reading||pet.activity==='focus'||pet.activity==='sleep'||pet.action==='sleep'),badge=pet.action==='milestone'
 const viewport=petViewport(p.size)
 return <span style={{width:p.size,height:p.size,left:(viewport-p.size)/2,top:viewport-p.size*1.02}} className={'xm-pet-environment theme-'+pet.theme+(pet.animated?'':' is-still')+(direction==='left'?' is-facing-left':'')} aria-hidden="true">
 {rain&&<svg className="xm-pet-reading-umbrella" viewBox="0 0 100 65"><path className="pet-canopy" d={pet.theme==='pixel-jrpg'||pet.theme==='stardew-valley'?'M8 32V24H20V16H35V10H65V16H80V24H92V32H8Z':pet.theme==='animal-crossing'?'M8 33Q25 4 52 10Q78 4 94 33Q79 39 67 31Q50 40 34 31Q20 38 8 33Z':'M8 32Q50 -9 92 32Q70 22 50 32Q30 22 8 32Z'}/><path className="pet-umbrella-stick" d="M50 12V53Q50 65 60 58"/></svg>}
 {lamp&&<span className="xm-pet-floor-lamp"><FoxAccessory theme={pet.theme} kind="lamp" onPaint={onPaint} size={Math.round(p.size*.29)}/></span>}
 {p.followEnvironment&&snow&&reading&&<span className="xm-pet-local-flakes"><i>❅</i><i>·</i><i>❅</i></span>}
 {pet.home?.keepsake&&pet.action==='keepsake'&&<span className="xm-pet-cherished-item"><FoxAccessory theme={pet.home.keepsake.theme} kind="souvenir" onPaint={onPaint} size={Math.round(p.size*.23)}/></span>}
 {pet.home?.journal?.unlocks.some(u=>u.id==='bookmark'&&u.unlocked)&&reading&&<svg className="xm-pet-reading-bookmark" viewBox="0 0 12 22"><path d="M2 1H10V21L6 17L2 21Z" fill={pet.theme==='pixel-jrpg'?'#d1ae52':pet.theme==='parchment-journal'?'#a66c4f':pet.theme==='animal-crossing'?'#78ac63':'#b8843e'}/></svg>}
 {badge&&<span className="xm-pet-main-keepsake"><FoxAccessory theme={pet.theme} kind="souvenir" onPaint={onPaint} size={Math.round(p.size*.3)}/></span>}
 {pet.paperPlaying&&<PetToyArt theme={pet.theme} className="xm-pet-idle-paper"/>}
 {pet.fetchPhase==='catch'&&<PetToyArt theme={pet.theme} className="xm-pet-held-toy"/>}
 </span>
}
