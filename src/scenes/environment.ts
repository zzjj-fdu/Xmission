import { scenePhaseAt } from './index'
import type { ScenePhase } from './index'
import type { SceneWeather, WeatherCity, WeatherObservation } from '../store/sceneWeather'

export interface SceneEnvironment { cloud: number; wet: number; wind: number; gust: number; direction: number }
const clamp = (n: number, low = 0, high = 1) => Math.min(high, Math.max(low, n))

// Use city-local calendar strings, never interpret provider timestamps in the computer's zone.
export function cityClock(now: Date, city: WeatherCity | null) {
  if (!city) return { day: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`, minute: now.getHours()*60+now.getMinutes() }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: city.timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(now)
    const values = Object.fromEntries(parts.map(p => [p.type, p.value]))
    return { day: `${values.year}-${values.month}-${values.day}`, minute: Number(values.hour)*60+Number(values.minute) }
  } catch { return cityClock(now, null) }
}
export function solarScenePhase(now: Date, city: WeatherCity | null, observation: WeatherObservation | null): ScenePhase {
  if (!city) return scenePhaseAt(now)
  const { day, minute } = cityClock(now, city)
  const solar = observation?.solar?.find(s => s.date === day)
  const time = (iso: string) => Number(iso.slice(11,13))*60+Number(iso.slice(14,16))
  const rise = solar ? time(solar.sunrise) : 360
  const set = solar ? time(solar.sunset) : 1080
  if (!Number.isFinite(rise) || !Number.isFinite(set) || set <= rise) {
    return minute < 300 ? 'predawn' : minute < 420 ? 'dawn' : minute < 660 ? 'morning' : minute < 960 ? 'noon' : minute < 1140 ? 'sunset' : 'night'
  }
  if (minute < rise-40) return minute < 240 ? 'predawn' : 'night'
  if (minute < rise+25) return 'dawn'
  if (minute < Math.min(rise+240, (rise+set)/2)) return 'morning'
  if (minute < set-40) return 'noon'
  if (minute < set+25) return 'sunset'
  return 'night'
}

export function sceneEnvironment(weather: SceneWeather, observation: WeatherObservation | null, seed: number, now = Date.now()): SceneEnvironment {
  // Continuous, slow variation: returning to the page doesn't re-roll a storm.
  const wave = .5+.5*Math.sin(now/900000+seed*12.9898)
  const live = observation && now-observation.fetchedAt < 3*3600000 ? observation : null
  const cloud = live && Number.isFinite(live.cloudCover) ? clamp(live.cloudCover!/100) : weather === 'clear' ? .12 : weather === 'wind' ? .36 : .7+wave*.2
  const wet = weather === 'rain' || weather === 'snow' ? live && Number.isFinite(live.precipitation) ? clamp(.25+live.precipitation!/5,.25,1) : .38+wave*.32 : 0
  const wind = live && Number.isFinite(live.windSpeed) ? clamp(live.windSpeed!/50) : weather === 'wind' ? .6+wave*.3 : .12+wave*.16
  const gust = live && Number.isFinite(live.windGust) ? clamp(live.windGust!/65) : Math.min(1,wind+.12*wave)
  const direction = live && Number.isFinite(live.windDirection) ? -Math.sin(live.windDirection!*Math.PI/180) : Math.sin(seed*7) >= 0 ? 1 : -1
  return { cloud, wet, wind, gust, direction }
}

export type PassageKind = 'sunrise' | 'sunset' | 'lamps'
export function passageBetween(from: ScenePhase, to: ScenePhase): PassageKind | null {
  if ((from === 'night' || from === 'predawn') && to === 'dawn') return 'sunrise'
  if (from === 'noon' && to === 'sunset') return 'sunset'
  if (from === 'sunset' && to === 'night') return 'lamps'
  return null // Clock jumps and missed boundaries never produce catch-up sequences.
}
