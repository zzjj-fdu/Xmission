import { useEffect, useRef, useState } from 'react'
import { SNOW_TRANSITION_MS } from '../scenes/snowTransition'

export const SCENE_FADE_MS = 1200

/** Keep the opaque old landscape until the decoded new landscape covers it.
 * This avoids a dark flash halfway through two translucent fades. */
export function useSceneFade<T>(key: string, value: T, images: string[], enabled: boolean, transition?: (previous: T, next: T) => 'fade' | 'blizzard') {
  const [layers, setLayers] = useState<{ current: { key: string; value: T }; previous: T | null; transition: 'fade' | 'blizzard' }>(() => ({ current: { key, value }, previous: null, transition: 'fade' }))
  const committedKey = useRef(key)
  const latest = useRef(value)
  latest.current = value
  const shown = useRef(value)
  const settleTimer = useRef<number>()
  const current = layers.current.key === key ? value : layers.current.value
  shown.current = current
  useEffect(() => () => {
    if (settleTimer.current !== undefined) window.clearTimeout(settleTimer.current)
  }, [])

  useEffect(() => {
    if (!enabled) {
      if (settleTimer.current !== undefined) window.clearTimeout(settleTimer.current)
      committedKey.current = key
      setLayers({ current: { key, value: latest.current }, previous: null, transition: 'fade' })
      return
    }
    if (key === committedKey.current) return
    let cancelled = false
    let failed = false
    const loaders: HTMLImageElement[] = []
    const finishLoads: Array<() => void> = []
    const ready = images.map(src => new Promise<void>(resolve => {
      const image = new Image()
      loaders.push(image)
      finishLoads.push(resolve)
      image.onload = () => { void image.decode().catch(() => {}).then(resolve) }
      image.onerror = () => { failed = true; resolve() }
      image.src = src
    }))
    void Promise.all(ready).then(() => {
      if (cancelled || failed) return
      const previous = shown.current
      committedKey.current = key
      if (settleTimer.current !== undefined) window.clearTimeout(settleTimer.current)
      const kind = transition?.(previous, latest.current) ?? 'fade'
      setLayers({ current: { key, value: latest.current }, previous, transition: kind })
      settleTimer.current = window.setTimeout(() => {
        setLayers(state => ({ ...state, previous: null, transition: 'fade' }))
        settleTimer.current = undefined
      }, kind === 'blizzard' ? SNOW_TRANSITION_MS : SCENE_FADE_MS)
    })
    return () => {
      cancelled = true
      loaders.forEach(image => { image.onload = null; image.onerror = null })
      finishLoads.forEach(resolve => resolve())
    }
    // A live weather intensity update must not restart an in-progress fade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  return { current, previous: layers.previous, key: layers.current.key, transition: layers.transition }
}
