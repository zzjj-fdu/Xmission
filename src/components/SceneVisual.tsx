import { memo, useEffect, useRef, useState } from 'react'
import { sceneUrl } from '../scenes'
import type { ScenePhase } from '../scenes'
import type { ThemeKey } from '../themes'
import type { SceneWeather, SceneMotion } from '../store/sceneWeather'
import type { ScenePassage } from '../store/scenePassage'
import type { SceneEnvironment } from '../scenes/environment'
import { useSceneFade, SCENE_FADE_MS } from '../hooks/useSceneFade'

import { IslandLandscape } from './IslandLandscape'
import { ThemeLandscape, landscapeAsset } from './ThemeLandscape'
import { SceneAtmosphere } from './SceneAtmosphere'
import { SceneBlizzard } from './SceneBlizzard'
import './SceneVisual.css'

interface SceneProps {
  theme:ThemeKey;phase:ScenePhase;weather:SceneWeather;motion:SceneMotion;active:boolean
  environment:SceneEnvironment;passage?:ScenePassage|null;atmospherePhase?:ScenePhase;cinematic?:boolean
}
const transitionKind=(previous:SceneProps,next:SceneProps)=>previous.theme===next.theme&&previous.weather!=='snow'&&next.weather==='snow'?'blizzard' as const:'fade' as const
export const SceneVisual=memo(function SceneVisual(props:SceneProps){
  const [reduced,setReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [visible,setVisible]=useState(()=>!document.hidden)
  useEffect(()=>{
    const query=window.matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(query.matches),visibility=()=>setVisible(!document.hidden)
    query.addEventListener('change',change);document.addEventListener('visibilitychange',visibility)
    return()=>{query.removeEventListener('change',change);document.removeEventListener('visibilitychange',visibility)}
  },[])
  const key=`${props.theme}:${props.phase}:${props.weather}`
  const directory=`${import.meta.env.BASE_URL}scenes/${props.theme}/`
  const images=props.theme==='animal-crossing'?[sceneUrl(props.theme,props.phase)]:[landscapeAsset(props.theme,'sky-day-clean')]
  if(props.weather==='snow')images.push(directory+'snow-landscape.webp')
  if(props.phase==='night'||props.phase==='predawn')images.push(directory+'sky-night-clean.webp')
  if(props.phase==='sunset')images.push(directory+'sky-sunset-clean.webp')
  if(props.phase==='dawn')images.push(directory+'sky-dawn-clean.webp')
  const layers=useSceneFade(key,props,images,props.active&&visible&&props.motion==='full'&&!reduced,transitionKind)
  const blizzard=!!layers.previous&&layers.transition==='blizzard'
  const arrivingRef=useRef<HTMLDivElement>(null)
  const renderScene=(scene:SceneProps)=><>
    {scene.theme==='animal-crossing'?<IslandLandscape phase={scene.phase} environment={scene.environment} weather={scene.weather} passage={scene.passage} cinematic={scene.cinematic}/>:<ThemeLandscape theme={scene.theme} phase={scene.phase} weather={scene.weather} environment={scene.environment} passage={scene.passage}/>}
    <SceneAtmosphere theme={scene.theme} phase={scene.atmospherePhase??scene.phase} weather={scene.weather} motion={scene.motion} active={scene.active} environment={scene.environment}/>
  </>
  return <div className={`xm-scene-visual${blizzard?' is-entering-winter':''}`} aria-hidden="true">
    {layers.previous&&<div className="xm-scene-visual-layer is-previous">{renderScene({...layers.previous,active:false})}</div>}
    <div ref={arrivingRef} key={layers.key} className={`xm-scene-visual-layer${layers.previous?(blizzard?' is-snow-arriving':' is-arriving'):''}`} style={{animationDuration:`${SCENE_FADE_MS}ms`,opacity:blizzard?0:undefined}}>{renderScene(layers.current)}</div>
    {blizzard&&<SceneBlizzard key={'snow-'+layers.key} theme={layers.current.theme} phase={layers.current.phase} environment={layers.current.environment} arrivingRef={arrivingRef}/>}
  </div>
})


