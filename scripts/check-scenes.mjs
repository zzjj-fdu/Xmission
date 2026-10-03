import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const compile = async (path, replacements = {}) => {
  let source = await readFile(resolve(root, path), 'utf8')
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to)
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
}
const memory = new Map()
globalThis.localStorage = globalThis.sessionStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
}
const sceneModule = await compile('src/scenes/index.ts')
const { scenePhaseAt, SCENE_PHASES } = await import(sceneModule)
for (const [hour, minute, phase] of [[0,0,'predawn'],[4,59,'predawn'],[5,0,'dawn'],[6,59,'dawn'],[7,0,'morning'],[10,59,'morning'],[11,0,'noon'],[15,59,'noon'],[16,0,'sunset'],[18,59,'sunset'],[19,0,'night'],[23,59,'night']]) {
  assert.equal(scenePhaseAt(new Date(2026, 9, 1, hour, minute)), phase)
}
const RealDate = Date
let now = new RealDate(2026, 9, 1, 6, 30).getTime()
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])) }
  static now() { return now }
}
const zustand = pathToFileURL(resolve(root, 'node_modules/zustand/esm/index.mjs')).href
const sessionModule = await compile('src/store/sceneSession.ts', { "'../scenes'": JSON.stringify(sceneModule), "'zustand'": JSON.stringify(zustand) })
const { useSceneSession } = await import(sessionModule)
assert.equal(useSceneSession.getState().phase, 'dawn')
now = new RealDate(2026, 9, 1, 20, 30).getTime()
assert.equal(useSceneSession.getState().phase, 'dawn', 'An open session must stay in its original phase')
useSceneSession.getState().hide()
assert.equal(useSceneSession.getState().visible, false)
assert.equal(useSceneSession.getState().phase, 'dawn')
useSceneSession.getState().reopen()
assert.equal(useSceneSession.getState().phase, 'night')
assert.equal(useSceneSession.getState().visible, true)
const settingsStub = 'data:text/javascript,' + encodeURIComponent('export async function getSetting(){return null} export async function setSetting(){}')
const weatherModule = await compile('src/store/sceneWeather.ts', { "'../api/settings'": JSON.stringify(settingsStub), "'zustand'": JSON.stringify(zustand) })
const { useSceneWeatherStore, currentSceneWeather } = await import(weatherModule)
for (const weather of ['clear','cloudy','rain','snow','wind','fog']) {
  useSceneWeatherStore.getState().setManual(weather)
  assert.equal(currentSceneWeather(useSceneWeatherStore.getState()), weather)
}
useSceneWeatherStore.getState().setMotion('reduced')
assert.equal(JSON.parse(memory.get('xmission-scene-weather-v1')).motion, 'reduced')
useSceneWeatherStore.getState().setManual('fog')
useSceneWeatherStore.setState({ mode: 'live', observation: { weather: 'rain', temperature: 12, observedAt: '', fetchedAt: now - 4 * 3600000 } })
assert.equal(currentSceneWeather(useSceneWeatherStore.getState()), 'fog', 'Expired weather must fall back to the user choice')
globalThis.Date = RealDate
const manifest = JSON.parse(await readFile(resolve(root, 'design/scenes/manifest.json'), 'utf8'))
const themes = ['pixel-jrpg','parchment-journal','animal-crossing','stardew-valley']
assert.equal(manifest.length, 24)
assert.equal(new Set(manifest.map((item) => item.path)).size, 24)
for (const theme of themes) for (const phase of SCENE_PHASES) {
  const item = manifest.find((item) => item.theme === theme && item.phase === phase)
  assert.ok(item, `${theme}/${phase} missing`)
  assert.ok(item.bytes < 500000 && item.width <= 1920)
  await access(resolve(root, item.path))
}
console.log('PASS: 12 phase boundaries, open/hide/reopen lifecycle, six weather choices, reduced-motion persistence, stale-weather fallback and 24 compressed assets')
