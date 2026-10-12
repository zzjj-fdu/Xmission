/** The winter plate changes while the textured snow veil is fully opaque. */
export const SNOW_TRANSITION_MS = 9000
export const SNOW_REVEAL_MS = 3400
export const SNOW_WHITEOUT_START_MS = 2850
export const SNOW_WHITEOUT_END_MS = 4100
export const SNOW_CLEAR_MS = 7450
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smooth = (value: number) => { const t = clamp(value); return t*t*(3-2*t) }

export function snowTransitionAt(elapsed: number) {
  const cover = elapsed < SNOW_WHITEOUT_END_MS
    ? smooth((elapsed-1000)/(SNOW_WHITEOUT_START_MS-1000))
    : 1-smooth((elapsed-SNOW_WHITEOUT_END_MS)/(SNOW_CLEAR_MS-SNOW_WHITEOUT_END_MS))
  const storm = smooth(elapsed/650)*(1-smooth((elapsed-4300)/(SNOW_TRANSITION_MS-4300)))
  const stage = elapsed >= SNOW_TRANSITION_MS ? 'settled'
    : elapsed >= SNOW_CLEAR_MS ? 'settling'
    : elapsed >= SNOW_WHITEOUT_END_MS ? 'clearing'
    : elapsed >= SNOW_WHITEOUT_START_MS ? 'whiteout' : 'rising'
  return { cover, storm, stage, reveal: elapsed >= SNOW_REVEAL_MS, done: elapsed >= SNOW_TRANSITION_MS }
}

