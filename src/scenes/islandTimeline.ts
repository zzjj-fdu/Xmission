import type { ScenePhase } from './index'
import type { PassageKind } from './environment'

export const SCENE_PASSAGE_DURATION = 7600
export const SCENE_PASSAGE_ENTER = 400
export const smooth = (value: number) => { const t=Math.max(0,Math.min(1,value)); return t*t*(3-2*t) }
const mix = (from: number, to: number, progress: number) => from+(to-from)*progress
const SUN = {
  predawn:{x:1370,y:423,opacity:0}, dawn:{x:1450,y:208,opacity:1},
  morning:{x:1510,y:130,opacity:1}, noon:{x:1570,y:72,opacity:1},
  sunset:{x:1620,y:411,opacity:0}, night:{x:1620,y:423,opacity:0},
}
const MOON = {
  predawn:{x:1667,y:109,opacity:1}, dawn:{x:1775,y:420,opacity:0},
  morning:{x:1775,y:420,opacity:0}, noon:{x:1550,y:430,opacity:0},
  sunset:{x:1550,y:423,opacity:0}, night:{x:1667,y:109,opacity:1},
}

export function islandCelestials(from: ScenePhase, to: ScenePhase, kind: PassageKind | undefined, progress: number) {
  const t=smooth(progress)
  const sun = {x:mix(SUN[from].x,SUN[to].x,t),y:mix(SUN[from].y,SUN[to].y,t),opacity:mix(SUN[from].opacity,SUN[to].opacity,t)}
  const moon = {x:mix(MOON[from].x,MOON[to].x,t),y:mix(MOON[from].y,MOON[to].y,t),opacity:mix(MOON[from].opacity,MOON[to].opacity,t)}
  // Discs stay visible until they really pass behind the horizon, not a dissolve.
  if(kind==='sunrise') { sun.opacity=smooth(progress/.16); moon.opacity=1-smooth((progress-.6)/.3) }
  if(kind==='sunset') sun.opacity=1-smooth((progress-.93)/.07)
  if(kind==='lamps') moon.opacity=smooth(progress/.2)
  return {sun,moon}
}
