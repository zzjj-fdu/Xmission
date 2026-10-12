import { useEffect } from 'react'
import { useScenePassage } from '../store/scenePassage'
import { useSceneSession } from '../store/sceneSession'
import { SCENE_PASSAGE_DURATION, SCENE_PASSAGE_ENTER } from '../scenes/islandTimeline'

/** Owns no task state; the existing UI remains mounted under the scenery. */
export function useScenePassageController(blocked: boolean) {
  const visible = useSceneSession(s => s.visible)
  const motion = useScenePassage(s => s.pending !== null || s.active !== null)
  useEffect(() => {
    if (!motion) return
    const editing = document.activeElement?.matches('input,textarea,[contenteditable="true"]')
    let lastInput = editing ? performance.now() : 0, pointer = false, composing = false
    const input = () => { lastInput = performance.now() }
    const down = () => { pointer = true; input() }
    const up = () => { pointer = false; input() }
    const compositionStart = () => { composing = true; input() }
    const compositionEnd = () => { composing = false; input() }
    const check = () => {
      const state = useScenePassage.getState()
      const unfocused = !document.hasFocus() && !document.documentElement.hasAttribute('data-xm-lighting-preview')
      if (!visible || document.hidden || unfocused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { state.finish(); return }
      if (state.active) { if (state.active.previewProgress === undefined && performance.now()-state.active.startedAt >= SCENE_PASSAGE_DURATION+SCENE_PASSAGE_ENTER) state.finish(); return }
      if (!blocked && !pointer && !composing && performance.now()-lastInput >= 2800) state.start()
    }
    const events = [['input',input],['keydown',input],['pointerdown',down],['pointerup',up],['pointercancel',up],['compositionstart',compositionStart],['compositionend',compositionEnd],['visibilitychange',check]] as const
    for (const [name, listener] of events) document.addEventListener(name,listener,true)
    const timer = window.setInterval(check,250)
    check()
    return () => { window.clearInterval(timer); for (const [name,listener] of events) document.removeEventListener(name,listener,true) }
  }, [motion, blocked, visible])
}
