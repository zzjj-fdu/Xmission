import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const calls = []
const events = new Map()
const requests = []
const memory = new Map()
globalThis.sessionStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
}
globalThis.loadingTest = {
  isTauri: () => true,
  listen: async (name, callback) => { events.set(name, callback); return () => events.delete(name) },
  invoke: (name, args) => {
    calls.push({ name, args })
    if (name === 'set_setting') return Promise.resolve()
    return new Promise((resolve, reject) => requests.push({ name, resolve, reject }))
  },
}
const stub = 'data:text/javascript,' + encodeURIComponent('export const {invoke,isTauri,listen}=globalThis.loadingTest')
async function compile(path, replacements = {}) {
  let source = await readFile(resolve(root, path), 'utf8')
  for (const [from, to] of Object.entries({ "'@tauri-apps/api/core'": JSON.stringify(stub), "'@tauri-apps/api/event'": JSON.stringify(stub), ...replacements })) source = source.replaceAll(from, to)
  return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64')
}
const settings = await import(await compile('src/api/settings.ts'))
const reads = ['widget_opacity', 'pomodoro_work_min', 'main_quest_soft_cap'].map(settings.getSetting)
assert.equal(calls.filter((call) => call.name === 'get_settings').length, 1)
requests.shift().resolve({ widget_opacity: '80', pomodoro_work_min: '25', main_quest_soft_cap: '3' })
assert.deepEqual(await Promise.all(reads), ['80', '25', '3'])
assert.equal(await settings.getSetting('widget_opacity'), '80')
assert.equal(calls.length, 1, 'Revisiting uses the existing configuration')
events.get('settings-changed')({ payload: { key: 'widget_opacity', value: '90' } })
assert.equal(await settings.getSetting('widget_opacity'), '90', 'Other-window updates invalidate old values')
await settings.setSetting('widget_opacity', '75')
assert.equal(await settings.getSetting('widget_opacity'), '75')

const profileApi = await compile('src/api/profile.ts')
const zustand = pathToFileURL(resolve(root, 'node_modules/zustand/esm/index.mjs')).href
const { useProfileStore } = await import(await compile('src/store/profile.ts', { "'../api/profile'": JSON.stringify(profileApi), "'zustand'": JSON.stringify(zustand) }))
await Promise.resolve()
const fetches = [useProfileStore.getState().fetch(), useProfileStore.getState().fetch()]
assert.equal(calls.filter((call) => call.name === 'get_wallet').length, 1)
const oldWallet = { xpTotal: 100, coins: 20, level: 2, xpIntoLevel: 0, xpToNext: 200, streak: 1 }
const newWallet = { ...oldWallet, xpTotal: 120, coins: 30, xpIntoLevel: 20 }
events.get('wallet-updated')({ payload: newWallet })
requests.shift().resolve(oldWallet)
await Promise.all(fetches)
assert.deepEqual(useProfileStore.getState().wallet, newWallet, 'Slow reads cannot overwrite a newer reward event')
assert.deepEqual(JSON.parse(memory.get('xmission-wallet-snapshot')), newWallet)
const retry = useProfileStore.getState().fetch()
requests.shift().reject(new Error('temporary IPC failure'))
await assert.rejects(retry)
const recovered = useProfileStore.getState().fetch()
requests.shift().resolve(newWallet)
await recovered
console.log('PASS: settings read deduplication, instant revisits, cross-window updates, wallet deduplication, event/query race and retry after failure')
