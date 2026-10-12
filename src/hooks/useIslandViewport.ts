import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'
import { islandViewport } from '../scenes/islandGeometry'

export function useIslandViewport(ref: RefObject<Element>, enabled = true) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!enabled || !element) return
    const update = () => {
      const { width, height } = element.getBoundingClientRect()
      setSize(old => Math.abs(old.width-width) < 1 && Math.abs(old.height-height) < 1 ? old : { width, height })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, enabled])
  return islandViewport(size.width, size.height)
}
