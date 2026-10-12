import { memo, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ThemeKey } from '../themes'
import type { ScenePhase } from '../scenes'
import type { SceneMotion, SceneWeather } from '../store/sceneWeather'
import { SceneGroundWeather } from './SceneGroundWeather'
import { IslandRain } from './IslandRain'
import { IslandFog } from './IslandFog'
import type { SceneEnvironment } from '../scenes/environment'
import { useSceneViewport } from '../hooks/useSceneViewport'
import { SceneRain } from './SceneRain'
import { SceneFog } from './SceneFog'
import './SceneAtmosphere.css'

interface Props { theme: ThemeKey; phase: ScenePhase; weather: SceneWeather; motion: SceneMotion; active: boolean; environment?: SceneEnvironment }

function useAnimationPreferences() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [visible, setVisible] = useState(() => !document.hidden)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(query.matches)
    const visibility = () => setVisible(!document.hidden)
    query.addEventListener('change', change)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      query.removeEventListener('change', change)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])
  return { reduced, visible }
}

function particles(kind: string, count: number, speed: number, foreground = false) {
  return Array.from({ length: count }, (_, i) => <i key={kind + '-' + i} className={'xm-scenefx-particle is-' + kind + (foreground ? ' is-near' : '')} style={{
    '--x': ((i * 37 + 11) % 100) + '%', '--y': ((i * 29 + 17) % 80) + '%',
    '--delay': (-i * 1.71) + 's', '--duration': (speed + i % 5 * speed * .13) + 's',
    '--drift': ((i % 2 ? 1 : -1) * (28 + i % 6 * 17)) + 'px',
    '--scale': String(foreground ? .9 + i % 3 * .2 : .45 + i % 3 * .12),
  } as CSSProperties} />)
}

export const SceneAtmosphere = memo(function SceneAtmosphere({ theme, phase, weather, motion, active, environment }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const viewport = useSceneViewport(ref, theme)
  const particleCamera: CSSProperties = { width: viewport.width, height: viewport.height, top: viewport.offsetY, '--fall-distance': `${viewport.height*1.1}px` } as CSSProperties
  const preferences = useAnimationPreferences()
  const effectiveMotion = preferences.reduced && motion === 'full' ? 'reduced' : motion
  const animate = effectiveMotion === 'full'
  const night = phase === 'night' || phase === 'predawn'
  const quietSky = weather === 'clear' || weather === 'cloudy'
  const signature = theme === 'pixel-jrpg' ? (night ? 'star' : 'spark')
    : theme === 'parchment-journal' ? 'paper'
    : theme === 'animal-crossing' ? 'petal'
    : night ? 'firefly' : 'leaf'
  const wet = weather === 'rain' || weather === 'snow'
  const signatureCount = theme === 'stardew-valley' && night ? 12 : 8
  const wind = (environment?.direction ?? -1)*(environment?.wind ?? .2)
  return <div ref={ref} style={{ '--weather-cloud': environment?.cloud ?? .5, '--weather-wet': environment?.wet ?? .6, '--weather-wind': `${wind*150}px`, '--weather-slant': `${-wind*32}deg`, '--weather-speed': `${Math.max(45,110-(environment?.gust ?? .2)*65)}s` } as CSSProperties} className={'xm-scenefx theme-' + theme + ' weather-' + weather + ' phase-' + phase + ' motion-' + effectiveMotion + (active && preferences.visible ? '' : ' is-paused')} aria-hidden="true">
    <div className="xm-scenefx-tint" />
    {weather === 'rain' && <SceneGroundWeather theme={theme} phase={phase} weather={weather === 'rain' ? 'rain' : 'snow'} />}
    {weather === 'rain' && theme === 'animal-crossing' && <IslandRain animate={animate} active={active && preferences.visible} intensity={environment?.wet ?? .6} wind={wind} />}
    {weather === 'rain' && theme !== 'animal-crossing' && <SceneRain theme={theme} animate={animate} active={active && preferences.visible} intensity={environment?.wet ?? .6} wind={wind} />}
    {(weather === 'cloudy' || wet || (environment?.cloud ?? 0) > .35) && <div className="xm-scenefx-clouds" style={particleCamera}><b /><b /></div>}
    {weather === 'fog' && (theme === 'animal-crossing' ? <IslandFog /> : <SceneFog theme={theme} />)}
    {animate && <div className="xm-scenefx-particle-camera" style={particleCamera}>
      {quietSky && particles(signature, signatureCount, signature === 'paper' ? 20 : 13)}
      {quietSky && night && theme === 'pixel-jrpg' && particles('meteor', 2, 18)}
      {wet && <div className="xm-scenefx-precipitation">{particles(weather, weather === 'rain' ? 56 : 32, weather === 'rain' ? 1.25 : 19)}{particles(weather, weather === 'rain' ? 12 : 7, weather === 'rain' ? .95 : 14, true)}</div>}
      {weather === 'rain' && theme === 'parchment-journal' && particles('watermark', 5, 9)}
      {weather === 'wind' && particles(theme === 'animal-crossing' ? 'petal' : theme === 'parchment-journal' ? 'paper' : 'leaf', 14, 8, true)}
      {weather === 'wind' && particles('breeze', 4, 11)}
    </div>}
    {effectiveMotion !== 'full' && wet && <div className="xm-scenefx-particle-camera" style={particleCamera}><div className="xm-scenefx-still-weather" /></div>}
  </div>
})
