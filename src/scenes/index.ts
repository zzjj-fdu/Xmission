import type { ThemeKey } from '../themes'

export const SCENE_PHASES = ['dawn', 'morning', 'noon', 'sunset', 'night', 'predawn'] as const
export type ScenePhase = typeof SCENE_PHASES[number]
export const SCENE_PHASE_LABELS: Record<ScenePhase, string> = {
  dawn: '晨曦', morning: '早上', noon: '正午', sunset: '夕阳', night: '灯火夜晚', predawn: '凌晨',
}

export function scenePhaseAt(date: Date): ScenePhase {
  const hour = date.getHours()
  if (hour < 5) return 'predawn'
  if (hour < 7) return 'dawn'
  if (hour < 11) return 'morning'
  if (hour < 16) return 'noon'
  if (hour < 19) return 'sunset'
  return 'night'
}

// Public assets stay out of the JavaScript bundle; only the selected image is decoded.
export function sceneUrl(theme: ThemeKey, phase: ScenePhase): string {
  return `${import.meta.env.BASE_URL}scenes/${theme}/${phase}.webp`
}

export function scenePreviewUrl(theme: ThemeKey, phase: ScenePhase): string {
  return `${import.meta.env.BASE_URL}scenes/${theme}/previews/${phase}.webp`
}
