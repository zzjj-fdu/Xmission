import { create } from 'zustand'
import { getSetting, setSetting } from '../api/settings'

export type SceneWeather = 'clear' | 'cloudy' | 'rain' | 'snow' | 'wind' | 'fog'
export type SceneMotion = 'full' | 'reduced' | 'off'
export type WeatherMode = 'manual' | 'live'
export interface WeatherCity { id: number; name: string; region: string; country: string; latitude: number; longitude: number; timezone: string }
interface WeatherObservation { weather: SceneWeather; temperature: number; observedAt: string; fetchedAt: number }
interface WeatherPreferences { mode: WeatherMode; manual: SceneWeather; city: WeatherCity | null; motion: SceneMotion }
interface WeatherState extends WeatherPreferences {
  observation: WeatherObservation | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  setMode: (mode: WeatherMode) => void
  setManual: (weather: SceneWeather) => void
  setCity: (city: WeatherCity) => void
  setMotion: (motion: SceneMotion) => void
  refresh: (force?: boolean) => Promise<void>
  hydrate: () => Promise<void>
}

const STORAGE_KEY = 'xmission-scene-weather-v1'
const CACHE_KEY = 'xmission-scene-weather-cache-v1'
const CACHE_MS = 30 * 60_000
const defaults: WeatherPreferences = { mode: 'manual', manual: 'clear', city: null, motion: 'full' }

function readPreferences(): WeatherPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<WeatherPreferences>
    return {
      mode: stored.mode === 'live' ? 'live' : 'manual',
      manual: isWeather(stored.manual) ? stored.manual : 'clear',
      city: stored.city && Number.isFinite(stored.city.latitude) && Number.isFinite(stored.city.longitude) ? stored.city : null,
      motion: stored.motion === 'reduced' || stored.motion === 'off' ? stored.motion : 'full',
    }
  } catch { return defaults }
}

function isWeather(value: unknown): value is SceneWeather {
  return value === 'clear' || value === 'cloudy' || value === 'rain' || value === 'snow' || value === 'wind' || value === 'fog'
}

function persist(preferences: WeatherPreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  void setSetting('scene_weather_preferences', JSON.stringify(preferences)).catch((error: unknown) => console.error('[weather] 保存设置失败', error))
}

function readCache(cityId: number): WeatherObservation | null {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as { cityId: number; observation: WeatherObservation }
    return cached.cityId === cityId && isWeather(cached.observation?.weather) && Number.isFinite(cached.observation.fetchedAt)
      && Number.isFinite(cached.observation.temperature) ? cached.observation : null
  } catch { return null }
}

function weatherFromCode(code: number, windSpeed: number): SceneWeather {
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain'
  if (code === 45 || code === 48) return 'fog'
  if (windSpeed >= 35) return 'wind'
  if (code >= 1 && code <= 3) return 'cloudy'
  return 'clear'
}

export async function searchWeatherCities(query: string): Promise<WeatherCity[]> {
  if (query.trim().length < 2) return []
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.searchParams.set('name', query.trim())
  url.searchParams.set('count', '8')
  url.searchParams.set('language', 'zh')
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`城市搜索失败（${response.status}）`)
  const data = await response.json() as { results?: Array<{ id: number; name: string; admin1?: string; country?: string; latitude: number; longitude: number; timezone?: string }> }
  return (data.results ?? []).map((item) => ({
    id: item.id, name: item.name, region: item.admin1 ?? '', country: item.country ?? '',
    latitude: item.latitude, longitude: item.longitude, timezone: item.timezone ?? 'Asia/Shanghai',
  }))
}

let activeRequest: Promise<void> | null = null
let activeCityId: number | null = null
const initial = readPreferences()
export const useSceneWeatherStore = create<WeatherState>((set, get) => ({
  ...initial,
  observation: initial.city ? readCache(initial.city.id) : null,
  status: 'idle',
  error: '',
  setMode(mode) {
    const next = { mode, manual: get().manual, city: get().city, motion: get().motion }
    persist(next)
    set({ mode, error: '' })
    if (mode === 'live') void get().refresh()
  },
  setManual(manual) {
    const next = { mode: get().mode, manual, city: get().city, motion: get().motion }
    persist(next)
    set({ manual })
  },
  setCity(city) {
    const next = { mode: 'live' as const, manual: get().manual, city, motion: get().motion }
    persist(next)
    set({ mode: 'live', city, observation: readCache(city.id), status: 'idle', error: '' })
    void get().refresh(true)
  },
  setMotion(motion) {
    persist({ mode: get().mode, manual: get().manual, city: get().city, motion })
    set({ motion })
  },
  async refresh(force = false) {
    const city = get().city
    if (get().mode !== 'live' || !city) return
    const cached = readCache(city.id)
    if (!force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
      set({ observation: cached, status: 'ready', error: '' })
      return
    }
    if (activeRequest) {
      if (activeCityId === city.id) return activeRequest
      await activeRequest
      return get().refresh(force)
    }
    activeCityId = city.id
    set({ status: 'loading', error: '' })
    activeRequest = (async () => {
      try {
        const url = new URL('https://api.open-meteo.com/v1/forecast')
        url.searchParams.set('latitude', String(city.latitude))
        url.searchParams.set('longitude', String(city.longitude))
        url.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m')
        url.searchParams.set('timezone', city.timezone)
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw new Error(`天气读取失败（${response.status}）`)
        const data = await response.json() as { current?: { time: string; temperature_2m: number; weather_code: number; wind_speed_10m: number } }
        if (!data.current || !Number.isFinite(data.current.weather_code) || !Number.isFinite(data.current.temperature_2m))
          throw new Error('天气服务未返回有效的当前天气')
        const observation = {
          weather: weatherFromCode(data.current.weather_code, data.current.wind_speed_10m),
          temperature: data.current.temperature_2m,
          observedAt: data.current.time,
          fetchedAt: Date.now(),
        }
        localStorage.setItem(CACHE_KEY, JSON.stringify({ cityId: city.id, observation }))
        if (get().city?.id === city.id) set({ observation, status: 'ready', error: '' })
      } catch (error) {
        if (get().city?.id === city.id) set({ observation: cached, status: 'error', error: String(error) })
      }
    })().finally(() => { activeRequest = null; activeCityId = null })
    return activeRequest
  },
  async hydrate() {
    if (!localStorage.getItem(STORAGE_KEY)) {
      try {
        const stored = await getSetting('scene_weather_preferences')
        if (stored) {
          localStorage.setItem(STORAGE_KEY, stored)
          const prefs = readPreferences()
          set({ ...prefs, observation: prefs.city ? readCache(prefs.city.id) : null })
        }
      } catch { /* Browser preview uses local preferences. */ }
    }
    await get().refresh()
  },
}))

export function currentSceneWeather(state: WeatherState): SceneWeather {
  return state.mode === 'live' && state.observation && Date.now() - state.observation.fetchedAt < 3 * 60 * 60_000
    ? state.observation.weather : state.manual
}
