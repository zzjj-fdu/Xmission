import { useEffect, useMemo, useState } from 'react'
import { useSceneWeatherStore } from '../store/sceneWeather'
import type { SceneWeather } from '../store/sceneWeather'
import { sceneEnvironment } from '../scenes/environment'

export function useSceneEnvironment(weather: SceneWeather) {
  const seed = useSceneWeatherStore(s => s.seed)
  const observation = useSceneWeatherStore(s => s.mode === 'live' ? s.observation : null)
  const [time, setTime] = useState(Date.now)
  useEffect(() => {
    const update = () => { if (!document.hidden) setTime(Date.now()) }
    const timer = window.setInterval(update,60000)
    document.addEventListener('visibilitychange',update)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange',update) }
  }, [])
  return useMemo(() => sceneEnvironment(weather, observation, seed, time), [weather,observation,seed,time])
}
