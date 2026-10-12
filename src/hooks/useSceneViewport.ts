import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { ThemeKey } from '../themes'
import { SCENE_GEOMETRY, sourceViewport } from '../scenes/themeGeometry'

export function useSceneViewport(ref: RefObject<Element>, theme: ThemeKey) {
  const [size,setSize]=useState({width:0,height:0})
  useLayoutEffect(()=>{
    const element=ref.current
    if(!element)return
    const update=()=>{const {width,height}=element.getBoundingClientRect();setSize(old=>Math.abs(old.width-width)<1&&Math.abs(old.height-height)<1?old:{width,height})}
    const observer=new ResizeObserver(update);observer.observe(element);update()
    return()=>observer.disconnect()
  },[ref])
  const g=theme==='animal-crossing'?{width:1920,height:720}:SCENE_GEOMETRY[theme]
  return sourceViewport(size.width,size.height,g.width,g.height)
}
