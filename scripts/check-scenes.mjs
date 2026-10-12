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
const sceneModule = await compile('src/scenes/index.ts', { 'import.meta.env.BASE_URL': "'/'" })
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
useSceneSession.getState().refresh()
assert.equal(useSceneSession.getState().phase, 'night', 'An open session follows the local time')
useSceneSession.getState().hide()
assert.equal(useSceneSession.getState().visible, false)
now = new RealDate(2026, 9, 2, 6, 30).getTime()
useSceneSession.getState().refresh()
assert.equal(useSceneSession.getState().phase, 'dawn', 'A hidden session also follows the local time')
assert.equal(useSceneSession.getState().openedAt.toDateString(), new Date().toDateString(), 'The daily caption updates across midnight')
useSceneSession.getState().reopen()
assert.equal(useSceneSession.getState().phase, 'dawn')
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
// Exercise the real clock hook with loaded-image and transition APIs, without native windows.
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="clock"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let hidden = false, reduced = false, fadeCount = 0
Object.defineProperty(document, 'hidden', { get: () => hidden })
window.matchMedia = () => ({ matches: reduced })
const callbacks = new Map()
let timerId = 0
window.setInterval = (callback) => { callbacks.set(++timerId, callback); return timerId }
window.clearInterval = (id) => callbacks.delete(id)
globalThis.Image = class {
  onload = null; onerror = null
  set src(_value) { queueMicrotask(() => this.onload?.()) }
  decode() { return Promise.resolve() }
}
document.startViewTransition = (update) => {
  fadeCount++; update()
  return { finished: Promise.resolve(), skipTransition() {} }
}
const reactPath = pathToFileURL(resolve(root, 'node_modules/react/index.js')).href
const reactDomPath = pathToFileURL(resolve(root, 'node_modules/react-dom/index.js')).href
const { createElement, act } = await import(reactPath)
const { createRoot } = await import(pathToFileURL(resolve(root, 'node_modules/react-dom/client.js')).href)
const themeStub = 'data:text/javascript,' + encodeURIComponent("export const currentThemeKey=()=> 'pixel-jrpg'")
useSceneWeatherStore.setState({ mode: 'manual', city:null, observation:null, motion:'full' })
const environmentModule = await compile('src/scenes/environment.ts', { "'./index'":JSON.stringify(sceneModule) })
const passageModule = await compile('src/store/scenePassage.ts', { "'../scenes/environment'":JSON.stringify(environmentModule), "'zustand'":JSON.stringify(zustand) })
const clockModule = await compile('src/hooks/useSceneClock.ts', {
  "'react'": JSON.stringify(reactPath), "'react-dom'": JSON.stringify(reactDomPath),
  "'../themes'": JSON.stringify(themeStub), "'../scenes'": JSON.stringify(sceneModule),
  "'../store/sceneSession'": JSON.stringify(sessionModule),
  "'../store/sceneWeather'": JSON.stringify(weatherModule), "'../scenes/environment'": JSON.stringify(environmentModule), "'../store/scenePassage'":JSON.stringify(passageModule),
})
const { useSceneClock } = await import(clockModule)
function ClockProbe() { useSceneClock(); return null }
const clockRoot = createRoot(document.getElementById('clock'))
document.documentElement.dataset.xmLighting = 'day'
await act(async () => { clockRoot.render(createElement(ClockProbe)) })
const tick = async (hour, day = 2) => {
  await act(async () => {
    now = new RealDate(2026, 9, day, hour).getTime()
    for (const callback of [...callbacks.values()]) callback()
  })
}
await tick(20)
assert.equal(useSceneSession.getState().phase, 'night')
assert.equal(document.documentElement.dataset.xmLighting, 'night')
assert.equal(fadeCount, 1, 'Visible phase changes fade the background and palette together')
await act(async () => { useSceneSession.getState().hide() })
hidden = true
await tick(6, 3)
assert.equal(useSceneSession.getState().phase, 'dawn', 'The hook still updates a hidden window')
assert.equal(document.documentElement.dataset.xmLighting, 'day')
assert.equal(fadeCount, 1, 'Hidden windows do not waste work animating invisible snapshots')
hidden = false
now = new RealDate(2026, 9, 3, 20).getTime()
await act(async () => { useSceneSession.getState().reopen() })
assert.equal(useSceneSession.getState().phase, 'night', 'Reopen immediately calibrates the time')
assert.equal(fadeCount, 2)
reduced = true
await tick(8, 4)
assert.equal(document.documentElement.dataset.xmLighting, 'day')
assert.equal(fadeCount, 2, 'Reduced motion applies the new palette without a fade')
// JRPG now receives the same idle-controlled passages as the island.
reduced=false
document.hasFocus=()=>true
document.documentElement.setAttribute('data-xm-main','')
const {useScenePassage: clockPassage}=await import(passageModule)
await tick(12,4)
await tick(18,4)
assert.equal(clockPassage.getState().pending?.kind,'sunset','A non-island theme queues its time passage')
assert.equal(useSceneSession.getState().phase,'noon','The target stays pending until the passage finishes')
await act(async()=>{clockPassage.getState().start();clockPassage.getState().finish()})
assert.equal(useSceneSession.getState().phase,'sunset')
await tick(20,4)
assert.equal(clockPassage.getState().pending?.kind,'lamps')
await act(async()=>{clockPassage.getState().finish()})
assert.equal(useSceneSession.getState().phase,'night')
await act(async () => { clockRoot.unmount() })
assert.equal(callbacks.size, 0, 'Unmount removes the clock timer')
// Decode and fade races: rapidly changing weather must not leave old rain
// canvases alive forever, flash a missing image or commit a stale selection.
const snowTimelineModule = await compile('src/scenes/snowTransition.ts')
const {snowTransitionAt,SNOW_TRANSITION_MS,SNOW_REVEAL_MS,SNOW_WHITEOUT_START_MS,SNOW_WHITEOUT_END_MS,SNOW_CLEAR_MS}=await import(snowTimelineModule)
const { useSceneFade } = await import(await compile('src/hooks/useSceneFade.ts', { "'react'": JSON.stringify(reactPath), "'../scenes/snowTransition'":JSON.stringify(snowTimelineModule) }))
const imageRequests = new Map(), fadeTimers = new Map(), fadeDurations = new Map()
globalThis.Image = class {
  onload = null; onerror = null
  set src(value) { imageRequests.set(value,this) }
  decode() { return Promise.resolve() }
}
window.setTimeout = (callback, duration) => { fadeTimers.set(++timerId,callback); fadeDurations.set(timerId,duration); return timerId }
window.clearTimeout = id => { fadeTimers.delete(id); fadeDurations.delete(id) }
function FadeProbe({ choice, enabled = true }) {
  const layers = useSceneFade(choice,choice,[choice+'.webp'],enabled,(previous,next)=>previous!=='snow'&&next==='snow'?'blizzard':'fade')
  return createElement('div',null,createElement('output',{id:'fade-current'},layers.current),createElement('output',{id:'fade-previous'},layers.previous ?? 'none'),createElement('output',{id:'fade-kind'},layers.transition))
}
const fadeRoot = createRoot(document.getElementById('clock'))
const selectScene = async (choice,enabled = true) => { await act(async () => fadeRoot.render(createElement(FadeProbe,{choice,enabled}))) }
const decodeScene = async choice => { await act(async () => { imageRequests.get(choice+'.webp').onload?.() }) }
const currentScene = () => document.getElementById('fade-current').textContent
const previousScene = () => document.getElementById('fade-previous').textContent
await selectScene('clear')
await selectScene('rain')
assert.equal(currentScene(),'clear','The old scene stays visible until the new image decodes')
await decodeScene('rain')
assert.equal(currentScene(),'rain'); assert.equal(previousScene(),'clear')
await selectScene('fog')
await selectScene('rain')
await act(async () => { for(const callback of [...fadeTimers.values()]) callback(); fadeTimers.clear() })
assert.equal(previousScene(),'none','Reselecting the current scene still disposes its outgoing layer')
await selectScene('snow')
const staleLoad = imageRequests.get('snow.webp').onload
await selectScene('wind')
await act(async () => staleLoad?.())
assert.equal(currentScene(),'rain','An earlier image request cannot replace the latest weather choice')
await decodeScene('wind')
assert.equal(currentScene(),'wind'); assert.equal(previousScene(),'rain')
await selectScene('missing')
await act(async () => imageRequests.get('missing.webp').onerror?.())
assert.equal(currentScene(),'wind','An unavailable picture cannot replace a visible scene with a blank layer')
await selectScene('snow',false)
assert.equal(currentScene(),'snow'); assert.equal(previousScene(),'none')
assert.equal(fadeTimers.size,0,'Reduced motion clears the outgoing layer and timer immediately')
await selectScene('rain')
await decodeScene('rain')
await selectScene('snow')
await decodeScene('snow')
assert.equal(document.getElementById('fade-kind').textContent,'blizzard')
assert.ok([...fadeTimers.keys()].some(id=>fadeDurations.get(id)===SNOW_TRANSITION_MS),'The outgoing summer scene remains until the snow veil clears')
await selectScene('fog')
await decodeScene('fog')
assert.equal(document.getElementById('fade-kind').textContent,'fade','A rapid weather change cancels the blizzard')
assert.equal(fadeTimers.size,1,'Only the latest transition owns a settlement timer')
await selectScene('snow',false)
assert.equal(document.getElementById('fade-kind').textContent,'fade','Hidden/reduced windows never replay the snow storm')
assert.equal(fadeTimers.size,0)
await selectScene('rain')
await decodeScene('rain')
await act(async () => fadeRoot.unmount())
assert.equal(fadeTimers.size,0,'Unmount releases fade timers')
dom.window.close()
globalThis.Date = RealDate
const { solarScenePhase, cityClock, sceneEnvironment, passageBetween } = await import(environmentModule)
const city = { timezone:'America/New_York' }
assert.equal(cityClock(new Date('2026-10-05T12:00:00Z'),city).minute,480)
const solar = { solar:[{date:'2026-10-05',sunrise:'2026-10-05T07:00',sunset:'2026-10-05T18:30'}] }
assert.equal(solarScenePhase(new Date('2026-10-05T10:30:00Z'),city,solar),'dawn')
assert.equal(solarScenePhase(new Date('2026-10-05T22:05:00Z'),city,solar),'sunset')
assert.equal(solarScenePhase(new Date('2026-10-05T23:00:00Z'),city,solar),'night')
assert.equal(passageBetween('noon','night'),null,'Missed transitions are never queued')
assert.equal(passageBetween('sunset','night'),'lamps')
const islandTimelineModule=await compile('src/scenes/islandTimeline.ts')
const {islandCelestials,SCENE_PASSAGE_DURATION}=await import(islandTimelineModule)
const {islandViewport,ISLAND_HORIZON}=await import(await compile('src/scenes/islandGeometry.ts'))
for(const [from,to,kind,body,direction] of [['predawn','dawn','sunrise','sun',-1],['noon','sunset','sunset','sun',1],['sunset','night','lamps','moon',-1]]) {
  const first=islandCelestials(from,to,kind,0)[body], middle=islandCelestials(from,to,kind,.5)[body], last=islandCelestials(from,to,kind,1)[body]
  assert.ok((last.y-first.y)*direction>200,'Each passage has a visible independent rise/set')
  assert.ok((middle.y-first.y)*direction>60 && (last.y-middle.y)*direction>60,'Motion is distributed across the passage')
  assert.ok(Math.min(first.y,last.y)<ISLAND_HORIZON-100 && Math.max(first.y,last.y)>ISLAND_HORIZON+25,'The disc actually crosses the horizon')
}
assert.ok(SCENE_PASSAGE_DURATION<=8000,'Shorter passages must have meaningful changes per second')
const narrowCamera=islandViewport(300,700), wideCamera=islandViewport(1260,700)
assert.equal(narrowCamera.scale,wideCamera.scale,'Dragging the divider reveals the fixed camera, without changing magnification')
assert.equal(narrowCamera.width,wideCamera.width,'Particles retain the same scene plane instead of redistributing across the visible width')
assert.equal(narrowCamera.offsetY,wideCamera.offsetY)
const fixedMoon=islandCelestials('sunset','night','lamps',1).moon
assert.equal(fixedMoon.x,1667,'Celestial positions stay in source coordinates, even when outside the crop')
for (const point of [{x:276,y:458},{x:1570,y:72},{x:939,y:387}]) {
  assert.equal(point.x*narrowCamera.scale,point.x*wideCamera.scale,'Sun and scene-bound weather must retain their screen anchor through divider resizing')
  assert.equal(point.y*narrowCamera.scale+narrowCamera.offsetY,point.y*wideCamera.scale+wideCamera.offsetY)
}
assert.equal(snowTransitionAt(0).cover,0)
assert.ok(snowTransitionAt(650).storm>=1,'Snow escalates quickly into a blizzard')
assert.equal(snowTransitionAt(1000).cover,0,'The initial gust stays transparent so the snowfall is visible')
assert.equal(snowTransitionAt(SNOW_WHITEOUT_START_MS).cover,1)
assert.equal(snowTransitionAt(SNOW_REVEAL_MS-1).reveal,false)
assert.equal(snowTransitionAt(SNOW_REVEAL_MS).cover,1,'The scene changes only behind a fully opaque snow veil')
assert.equal(snowTransitionAt(SNOW_REVEAL_MS).reveal,true)
assert.equal(snowTransitionAt(SNOW_WHITEOUT_END_MS).cover,1,'Coverage holds past the image swap')
assert.ok(SNOW_REVEAL_MS-SNOW_WHITEOUT_START_MS>=500 && SNOW_WHITEOUT_END_MS-SNOW_REVEAL_MS>=500,'Both sides of the hidden image swap have an opaque safety margin')
assert.ok(SNOW_TRANSITION_MS>=8000 && SNOW_TRANSITION_MS<=10000,'The longer storm still has a bounded duration')
assert.ok(snowTransitionAt(6000).cover>0 && snowTransitionAt(6000).cover<1,'Winter gradually emerges through moving snow')
assert.ok(snowTransitionAt(SNOW_CLEAR_MS).storm>0,'Fine flakes linger after the veil clears')
assert.equal(snowTransitionAt(SNOW_CLEAR_MS).stage,'settling')
let previousCover=1,previousStorm=1
for(let elapsed=SNOW_WHITEOUT_END_MS;elapsed<=SNOW_TRANSITION_MS;elapsed+=50){
  const sample=snowTransitionAt(elapsed)
  assert.ok(sample.cover<=previousCover && sample.storm<=previousStorm,'Wind and coverage taper without a second flash')
  previousCover=sample.cover;previousStorm=sample.storm
}
assert.equal(snowTransitionAt(SNOW_TRANSITION_MS).cover,0)
assert.equal(snowTransitionAt(SNOW_TRANSITION_MS).storm,0,'Blizzard settles completely into normal light snow')
assert.equal(snowTransitionAt(SNOW_TRANSITION_MS).done,true)
const geometryModule=await compile('src/scenes/themeGeometry.ts', { "'./islandTimeline'":JSON.stringify(islandTimelineModule) })
const {SCENE_GEOMETRY,themeCelestials,sourceViewport}=await import(geometryModule)
for(const [theme,g] of Object.entries(SCENE_GEOMETRY)){
  for(const [from,to,kind,body,direction] of [['predawn','dawn','sunrise','sun',-1],['noon','sunset','sunset','sun',1],['sunset','night','lamps','moon',-1]]){
    const first=themeCelestials(theme,from,to,kind,0)[body],last=themeCelestials(theme,from,to,kind,1)[body]
    assert.ok((last.y-first.y)*direction>=200,theme+' has a meaningful independent rise/set')
    assert.ok(Math.max(first.y,last.y)>g.horizon+25 && Math.min(first.y,last.y)<g.horizon-100,theme+' crosses its own horizon')
  }
  const narrow=sourceViewport(300,700,g.width,g.height),wide=sourceViewport(1100,700,g.width,g.height)
  assert.equal(narrow.width,wide.width,theme+' retains its particle plane through divider dragging')
  assert.equal(narrow.offsetY,wide.offsetY)
  assert.ok(g.eaves.length>=9 && g.waterBounds.length>=1 && g.fog.banks.length>=2)
  for(const asset of ['sky-day-clean','sky-night-clean','sky-dawn-clean','sky-sunset-clean','snow-landscape']){
    const path=resolve(root,'public/scenes',theme,asset+'.webp');await access(path)
    const {size}=await (await import('node:fs/promises')).stat(path)
    assert.ok(size<500000,theme+'/'+asset+' exceeds the compressed asset budget')
  }
}
const a=sceneEnvironment('rain',null,42,1000000), b=sceneEnvironment('rain',null,42,1000001)
assert.ok(Math.abs(a.wet-b.wet)<.0001,'Manual weather changes smoothly across reopen')
const windy=sceneEnvironment('rain',{fetchedAt:1000000,cloudCover:90,precipitation:3,windSpeed:30,windGust:40,windDirection:90},42,1000000)
assert.equal(windy.cloud,.9); assert.ok(windy.wind>.5 && windy.wet>.5 && windy.direction<0)
const {useScenePassage, requestScenePassage}=await import(passageModule)
// Restore a document for the independent passage state tests.
globalThis.document={hidden:false,documentElement:{hasAttribute:()=>true}}
let commits=0
assert.equal(requestScenePassage('sunset','night',()=>commits++),true)
assert.equal(useScenePassage.getState().active,null,'A requested transition waits for idle')
useScenePassage.getState().start(); useScenePassage.getState().finish(); useScenePassage.getState().finish()
assert.equal(commits,1,'Skip/finish commits the target exactly once')
document.hidden=true
assert.equal(requestScenePassage('sunset','night',()=>commits++),false)
const manifest = JSON.parse(await readFile(resolve(root, 'design/scenes/manifest.json'), 'utf8'))
await access(resolve(root,'public/scenes/animal-crossing/snow-landscape.webp'))
const themes = ['pixel-jrpg','parchment-journal','animal-crossing','stardew-valley']
assert.equal(manifest.length, 24)
assert.equal(new Set(manifest.map((item) => item.path)).size, 24)
for (const theme of themes) for (const phase of SCENE_PHASES) {
  const item = manifest.find((item) => item.theme === theme && item.phase === phase)
  assert.ok(item, `${theme}/${phase} missing`)
  assert.ok(item.bytes < 500000 && item.width <= 1920)
  await access(resolve(root, item.path))
}
console.log('PASS: live scene clock, decoded weather fades, rapid-selection cleanup, missing-image fallback, reduced motion, fixed scene coordinates all four scene geometries, blizzard whiteout and compressed assets')



