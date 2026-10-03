import { memo, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { activeTheme as pixelJrpg } from '../themes'
import { THEMES, currentThemeKey, THEME_STORAGE_KEY } from '../themes'
import type { ThemeKey } from '../themes'
import { getSetting, setSetting } from '../api/settings'
import { searchWeatherCities, useSceneWeatherStore } from '../store/sceneWeather'
import type { SceneMotion, SceneWeather, WeatherCity } from '../store/sceneWeather'
import { SCENE_PHASES, SCENE_PHASE_LABELS, scenePreviewUrl } from '../scenes'
import { useSceneSession } from '../store/sceneSession'
import { getLlmConfig, setLlmConfig, testLlmConnection, listLlmModels } from '../api/llm'
import type { LlmModelInfo } from '../api/llm'
import { QuestPanel } from '../components/QuestPanel'
import { PixelIcon } from '../components/PixelIcon'
import { PixelInput } from '../components/PixelInput'
import { PixelSelect } from '../components/PixelSelect'
import { JrpgButton } from '../components/JrpgButton'

const { colors, font } = pixelJrpg

/** Base URL 预设；自定义 = 手动填 baseUrl */
const BASE_URL_PRESETS = [
  { key: 'kimi-cn', label: 'Kimi · 国内', baseUrl: 'https://api.moonshot.cn/v1', models: ['kimi-k3', 'kimi-k2.6', 'kimi-k2.7-code'] },
  { key: 'kimi-intl', label: 'Kimi · 国际', baseUrl: 'https://api.moonshot.ai/v1', models: ['kimi-k3', 'kimi-k2.6', 'kimi-k2.7-code'] },
  { key: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'] },
  { key: 'qwen-cn', label: '阿里百炼 · 北京', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3.7-flash'] },
  { key: 'qwen-intl', label: '阿里百炼 · 新加坡', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', models: ['qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-plus'] },
  { key: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', models: ['deepseek-ai/DeepSeek-V4-Flash', 'Pro/zai-org/GLM-5.1', 'moonshotai/Kimi-K2.7-Code'] },
  { key: 'volc', label: '火山方舟 · 按量', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-seed-2.1-pro', 'doubao-seed-2.1-lite', 'doubao-seed-2.0-mini'] },
  { key: 'paratera-chat', label: '并行科技 · 对话接口', baseUrl: 'https://llmapi.paratera.com/v1', models: ['DeepSeek-V4-Flash', 'DeepSeek-V4-Pro', 'DeepSeek-V3.2-Exp', 'DeepSeek-R1'] },
  { key: 'paratera-responses', label: '并行科技 · Responses', baseUrl: 'https://llmapi.paratera.com/v1/responses', models: ['DeepSeek-V4-Flash', 'DeepSeek-V4-Pro', 'DeepSeek-V3.2-Exp', 'DeepSeek-R1'] },
  { key: 'custom', label: '自定义兼容接口', baseUrl: '', models: [] },
] as const

type BaseUrlKey = (typeof BASE_URL_PRESETS)[number]['key']

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: colors.textMuted,
  fontFamily: font.body,
  letterSpacing: '0.1em',
}

/**
 * 换肤：写 localStorage（模块初始化时同步读取的源）+ settings 表（持久备份），
 * 然后整页刷新生效；悬浮窗与主窗口同 localStorage 源，下次加载自动同肤。
 * 不做运行时热切换（全项目模块顶层解构主题 token 的既有模式）。
 */
function applyTheme(key: ThemeKey) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, key)
    const url = new URL(window.location.href)
    url.searchParams.delete('theme')
    window.history.replaceState(null, '', url)
  } catch (err) {
    console.error('[settings] 写入主题到 localStorage 失败', err)
  }
  setSetting('theme', key)
    .catch((err: unknown) => console.error('[settings] 保存主题设置失败', err))
    .finally(() => {
      // Theme refresh keeps the open session's lighting until the next real reopen.
      sessionStorage.setItem('xmission-scene-theme-refresh', useSceneSession.getState().openedAt.toISOString())
      window.location.reload()
    })
}

/** 皮肤卡片：显示名 + 4 个主题色色板条 + 一句气质描述；当前主题高亮金框 */
const ThemeCard = memo(function ThemeCard({ themeKey }: { themeKey: ThemeKey }) {
  const meta = THEMES[themeKey]
  const active = currentThemeKey() === themeKey
  const c = meta.tokens.colors
  const [hover, setHover] = useState(false)
  const chapter = ({ 'pixel-jrpg': '01 / ADVENTURE', 'parchment-journal': '02 / FIELD NOTES', 'animal-crossing': '03 / ISLAND DAYS', 'stardew-valley': '04 / FARM LIFE' } as const)[themeKey]
  const shortName = ({ 'pixel-jrpg': '暮色冒险', 'parchment-journal': '旅人手账', 'animal-crossing': '小岛日常', 'stardew-valley': '星露农场' } as const)[themeKey]
  return (
    <button
      className={`xm-theme-card xm-theme-card-${themeKey}${active ? ' is-active' : ''}`}
      type="button"
      onClick={() => !active && applyTheme(themeKey)}
      title={active ? '当前皮肤' : `切换到「${meta.name}」`}
      style={{
        width: '100%',
        minWidth: 0,
        minHeight: 288,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        cursor: active ? 'default' : 'pointer',
        textAlign: 'left',
        background: c.panel,
        border: `3px solid ${active ? c.accent : c.border}`,
        boxShadow: active
          ? `inset 0 0 0 1px ${colors.goldDark}, 0 0 0 1px ${colors.accent}`
          : hover
            ? `inset 0 0 0 1px ${c.border}`
            : 'none',
        borderRadius: pixelJrpg.radius ?? 0,
        fontFamily: font.body,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="xm-theme-card-image" style={{
        display: 'block', position: 'relative', height: 142, width: '100%',
        backgroundImage: `url("${scenePreviewUrl(themeKey, 'noon')}")`,
        backgroundSize: 'cover', backgroundPosition: 'center',
        border: `1px solid ${c.border}`,
        borderRadius: meta.tokens.radius ? 6 : 0,
      }}>
        <span className="xm-theme-card-chapter">{chapter}</span>
        <span className="xm-theme-card-image-title">{shortName}</span>
      </span>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: c.text,
          fontFamily: meta.tokens.font.display,
          fontSize: 17,
          fontWeight: meta.tokens.panelStyle === 'soft' ? 700 : 400,
        }}
      >
        {meta.name}
        {active && <span style={{ color: c.accent, fontSize: 12, marginLeft: 'auto' }}>✦ 当前</span>}
      </span>
      {/* 4 色色板条：底 / 面板 / 主强调 / 次强调 */}
      <span style={{ display: 'flex', gap: 4 }}>
        {[c.bg, c.panel, c.accent, c.accentAlt].map((hex) => (
          <span
            key={hex}
            style={{
              width: 28,
              height: 14,
              backgroundColor: hex,
              border: `1px solid ${c.border}`,
              borderRadius: meta.tokens.radius ? 4 : 0,
            }}
          />
        ))}
      </span>
      <span style={{ color: c.textMuted, fontSize: 12, lineHeight: 1.6, marginTop: 'auto' }}>{meta.blurb}</span>
    </button>
  )
})

/** 改动即保存，并短暂显示「已保存」 */
function useSavedToast() {
  const [saved, setSaved] = useState(false)
  const timer = useRef<number | null>(null)
  const flash = () => {
    setSaved(true)
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setSaved(false), 1500)
  }
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current)
    },
    [],
  )
  return { saved, flash }
}

export default function SettingsPage() {
  const supportsWindowsAutostart = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')
  const [galleryOpen, setGalleryOpen] = useState(false)
  const sceneWeather = useSceneWeatherStore()
  const scenePhase = useSceneSession((state) => state.phase)
  const [cityQuery, setCityQuery] = useState('')
  const [cityResults, setCityResults] = useState<WeatherCity[]>([])
  const [citySearching, setCitySearching] = useState(false)
  const [citySearchError, setCitySearchError] = useState('')
  const [softCap, setSoftCap] = useState('3')
  const [workMin, setWorkMin] = useState('25')
  const [breakMin, setBreakMin] = useState('5')
  const [widgetOpacity, setWidgetOpacity] = useState('100')
  const [edgeHide, setEdgeHide] = useState('false')
  const [widgetAiSummary, setWidgetAiSummary] = useState('true')
  const [loaded, setLoaded] = useState(false)
  const { saved, flash } = useSavedToast()
  const [exportBusy, setExportBusy] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  const [autostart, setAutostart] = useState(false)
  const [startupMessage, setStartupMessage] = useState('')

  const findCity = async () => {
    if (citySearching || cityQuery.trim().length < 2) return
    setCitySearching(true)
    setCitySearchError('')
    setCityResults([])
    try {
      const cities = await searchWeatherCities(cityQuery)
      setCityResults(cities)
      if (!cities.length) setCitySearchError('没有找到城市，请试试完整地名。')
    } catch (error) { setCitySearchError(`搜索失败：${String(error)}`) }
    finally { setCitySearching(false) }
  }

  useEffect(() => {
    invoke<boolean>('get_autostart').then(setAutostart).catch((error: unknown) => console.error('[settings] 读取开机启动失败', error))
  }, [])

  const toggleAutostart = async () => {
    setStartupMessage('')
    try { setAutostart(await invoke<boolean>('set_autostart', { enabled: !autostart })); setStartupMessage('已保存') }
    catch (error) { setStartupMessage(String(error)) }
  }

  const runExport = (command: 'export_daily_report' | 'export_json_backup') => {
    setExportBusy(true)
    setExportMessage('')
    invoke<string>(command)
      .then((path) => setExportMessage(`已保存到：${path}`))
      .catch((err: unknown) => setExportMessage(`导出失败：${String(err)}`))
      .finally(() => setExportBusy(false))
  }

  // LLM 设置状态
  const [llmLoaded, setLlmLoaded] = useState(false)
  const [baseUrlKey, setBaseUrlKey] = useState<BaseUrlKey>('kimi-cn')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [llmSaving, setLlmSaving] = useState(false)
  const [llmTesting, setLlmTesting] = useState(false)
  const [llmError, setLlmError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  // 远端模型列表（刷新模型列表按钮拉取，供模型下拉建议）
  const [models, setModels] = useState<LlmModelInfo[] | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)

  // 进页面读取三项设置，缺省值由读取方兜底（settings.rs 不内置默认值）
  useEffect(() => {
    Promise.all([
      getSetting('main_quest_soft_cap'),
      getSetting('pomodoro_work_min'),
      getSetting('pomodoro_break_min'),
      getSetting('widget_opacity'),
      getSetting('widget_edge_hide'),
      getSetting('widget_ai_summary'),
    ])
      .then(([cap, work, rest, alpha, hide, summary]) => {
        if (cap != null) setSoftCap(cap)
        if (work != null) setWorkMin(work)
        if (rest != null) setBreakMin(rest)
        if (alpha != null) setWidgetOpacity(alpha)
        if (hide != null) setEdgeHide(hide)
        if (summary != null) setWidgetAiSummary(summary)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        console.error('[settings] 读取设置失败', err)
        setLoaded(true)
      })
  }, [])

  // 进页面回显 LLM 配置（key 本体永不回传，只有 hasKey）
  useEffect(() => {
    getLlmConfig()
      .then((cfg) => {
        setBaseUrl(cfg.baseUrl)
        setModel(cfg.model)
        setHasKey(cfg.hasKey)
        const hit = BASE_URL_PRESETS.find(
          (p) => p.key !== 'custom' && p.baseUrl === cfg.baseUrl,
        )
        setBaseUrlKey(hit ? hit.key : 'custom')
        setLlmLoaded(true)
      })
      .catch((err: unknown) => {
        console.error('[settings] 读取 LLM 配置失败', err)
        setLlmLoaded(true)
      })
  }, [])

  const applyBaseUrlPreset = (key: BaseUrlKey) => {
    setBaseUrlKey(key)
    const p = BASE_URL_PRESETS.find((x) => x.key === key)
    if (p && key !== 'custom') {
      setBaseUrl(p.baseUrl)
      setModel(p.models[0] ?? '')
      setModels(null)
      setTestResult(null)
    }
  }

  /** 刷新模型列表：用已保存的 baseUrl + key 拉 GET /models */
  const refreshModels = () => {
    setModelsLoading(true)
    setModelsError(null)
    listLlmModels()
      .then((list) => setModels(list))
      .catch((err: unknown) => {
        console.error('[settings] 拉取模型列表失败', err)
        setModelsError(typeof err === 'string' ? err : '拉取模型列表失败')
      })
      .finally(() => setModelsLoading(false))
  }

  const runLlmTest = () => {
    setLlmTesting(true)
    setTestResult(null)
    testLlmConnection()
      .then((msg) => setTestResult({ ok: true, msg: `连接成功：${msg}` }))
      .catch((err: unknown) => {
        console.error('[settings] LLM 连接测试失败', err)
        setTestResult({
          ok: false,
          msg: typeof err === 'string' ? err : '连接失败，请检查配置',
        })
      })
      .finally(() => setLlmTesting(false))
  }

  /** 保存 LLM 配置：apiKey 留空 = 不动已存 key（契约语义）；保存成功后自动跑一次连接测试 */
  const saveLlm = () => {
    if (!baseUrl.trim() || !model.trim()) {
      setLlmError('Base URL 和模型不能为空')
      return
    }
    setLlmSaving(true)
    setLlmError(null)
    setTestResult(null)
    setLlmConfig(baseUrl.trim(), model.trim(), apiKey)
      .then(() => {
        flash()
        setHasKey((prev) => prev || apiKey.trim() !== '')
        setApiKey('')
        runLlmTest()
      })
      .catch((err: unknown) => {
        console.error('[settings] 保存 LLM 配置失败', err)
        setLlmError(typeof err === 'string' ? err : '保存失败，请稍后再试')
      })
      .finally(() => setLlmSaving(false))
  }

  const save = (key: string, value: string) => {
    setSetting(key, value)
      .then(() => flash())
      .catch((err: unknown) => {
        console.error(`[settings] 保存设置失败 key=${key}`, err)
      })
  }

  /** 分钟数输入：非法值（<1 或非数字）不写库，仅保留本地输入 */
  const saveMinutes = (key: string, raw: string) => {
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 1) return
    save(key, String(Math.floor(n)))
  }

  return (
    <div style={{ width: '100%' }}>
      <h1
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: font.display,
          color: colors.accent,
          fontSize: 24,
          margin: '0 0 20px',
        }}
      >
        <PixelIcon name="hourglass" size={24} />
        设置
        {saved && (
          <span style={{ color: colors.accentAlt, fontSize: 12, marginLeft: 8 }}>已保存</span>
        )}
      </h1>
      <QuestPanel>
        <div
          style={{
            color: colors.accent,
            fontFamily: font.display,
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          皮肤（切换后自动刷新生效，悬浮窗同肤）
        </div>
        <div className="xm-theme-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
          {(Object.keys(THEMES) as ThemeKey[]).map((k) => (
            <ThemeCard key={k} themeKey={k} />
          ))}
        </div>
      </QuestPanel>
      <QuestPanel>
        <div style={{ color: colors.accent, fontFamily: font.display, fontSize: 12, marginBottom: 12 }}>风景与天气</div>
        <p style={{ color: colors.textMuted, fontSize: 12, lineHeight: 1.7, margin: '0 0 12px' }}>每套风景都有晨曦、早上、正午、夕阳、灯火夜晚、凌晨六个时段。关闭主窗口后再次打开，才按电脑当地时间更新；打开期间保持当前时段。当前：{SCENE_PHASE_LABELS[scenePhase]}。</p>
        <div className="xm-weather-controls">
          <label style={labelStyle}>天气来源
            <PixelSelect value={sceneWeather.mode} onChange={(event) => sceneWeather.setMode(event.target.value === 'live' ? 'live' : 'manual')}>
              <option value="manual">手动选择</option>
              <option value="live">按城市读取实时天气</option>
            </PixelSelect>
          </label>
          <label style={labelStyle}>手动天气 / 离线回退
            <PixelSelect value={sceneWeather.manual} onChange={(event) => sceneWeather.setManual(event.target.value as SceneWeather)}>
              <option value="clear">晴朗 · 主题原生动效</option>
              <option value="cloudy">多云</option>
              <option value="rain">下雨</option>
              <option value="snow">下雪</option>
              <option value="wind">刮风</option>
              <option value="fog">雾</option>
            </PixelSelect>
          </label>
          <label style={labelStyle}>动态效果
            <PixelSelect value={sceneWeather.motion} onChange={(event) => sceneWeather.setMotion(event.target.value as SceneMotion)}>
              <option value="full">完整 · 主题粒子与天气</option>
              <option value="reduced">减少动态效果 · 静态天气氛围</option>
              <option value="off">关闭动画</option>
            </PixelSelect>
          </label>
        </div>
        <p className="xm-weather-status">JRPG 的星光与流星、手账的纸尘与水痕、小岛的花瓣与柔和雨滴、农场的萤火虫与落叶各自呈现。系统开启减少动态效果时也会自动减少动画。</p>
        <details className="xm-scene-gallery" onToggle={(event) => setGalleryOpen(event.currentTarget.open)}>
          <summary>浏览当前主题的六个时段</summary>
          {galleryOpen && <div>{SCENE_PHASES.map((phase) => <figure key={phase}><img src={scenePreviewUrl(currentThemeKey(), phase)} loading="lazy" decoding="async" width={640} height={240} alt={`${SCENE_PHASE_LABELS[phase]}风景`} /><figcaption>{SCENE_PHASE_LABELS[phase]}</figcaption></figure>)}</div>}
        </details>
        {sceneWeather.mode === 'live' && <div className="xm-weather-city">
          <div className="xm-weather-city-search">
            <label style={{ ...labelStyle, flex: '1 1 220px' }}>城市
              <PixelInput value={cityQuery} placeholder="输入城市，如上海" onChange={(event) => setCityQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void findCity() } }} />
            </label>
            <JrpgButton variant="ghost" disabled={citySearching || cityQuery.trim().length < 2} onClick={() => { void findCity() }}>{citySearching ? '搜索中…' : '搜索城市'}</JrpgButton>
          </div>
          {cityResults.length > 0 && <div className="xm-weather-city-results" aria-label="城市搜索结果">
            {cityResults.map((city) => <button key={city.id} type="button" onClick={() => { sceneWeather.setCity(city); setCityResults([]); setCityQuery('') }}>
              {city.name}{city.region ? ` · ${city.region}` : ''}{city.country ? ` · ${city.country}` : ''}
            </button>)}
          </div>}
          {citySearchError && <p role="status" className="xm-weather-status is-error">{citySearchError}</p>}
          {sceneWeather.city ? <p className="xm-weather-status">
            当前城市：{sceneWeather.city.name}{sceneWeather.city.region ? ` · ${sceneWeather.city.region}` : ''}　
            {sceneWeather.status === 'loading' ? '正在更新天气…' : sceneWeather.status === 'error' ? '联网失败，已使用手动天气或缓存' : sceneWeather.observation ? `${sceneWeather.observation.temperature}℃ · ${sceneWeather.observation.observedAt.replace('T', ' ')} 更新` : '等待天气数据'}
            <button type="button" onClick={() => { void sceneWeather.refresh(true) }}>刷新</button>
          </p> : <p className="xm-weather-status">先搜索并选择城市；在选定前使用手动天气。</p>}
          {sceneWeather.error && <p role="status" className="xm-weather-status is-error">{sceneWeather.error}</p>}
          <p className="xm-weather-status">天气数据：<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · 每 30 分钟更新一次；离线时使用手动天气。</p>
        </div>}
      </QuestPanel>
      <QuestPanel>
        <div style={{ color: colors.accent, fontFamily: font.display, fontSize: 12, marginBottom: 12 }}>
          悬浮窗
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <label style={labelStyle}>
            透明度
            <PixelSelect value={widgetOpacity} onChange={(e) => {
              setWidgetOpacity(e.target.value)
              save('widget_opacity', e.target.value)
            }}>
              {[40, 50, 60, 70, 80, 90, 100].map((n) =>
                <option key={n} value={String(n)}>{n}%</option>)
              }
            </PixelSelect>
          </label>
          <label style={labelStyle}>
            靠屏幕边缘自动隐藏
            <PixelSelect value={edgeHide} onChange={(e) => {
              setEdgeHide(e.target.value)
              save('widget_edge_hide', e.target.value)
            }}>
              <option value="false">关闭</option>
              <option value="true">开启（留 12px 把手）</option>
            </PixelSelect>
          </label>
          <label style={labelStyle}>
            窄悬浮窗自动概括长任务
            <PixelSelect value={widgetAiSummary} onChange={(e) => {
              setWidgetAiSummary(e.target.value)
              save('widget_ai_summary', e.target.value)
            }}>
              <option value="true">开启（配置 API 后自动生效）</option>
              <option value="false">关闭</option>
            </PixelSelect>
          </label>
        </div>
      </QuestPanel>
      <QuestPanel>
        {!loaded ? (
          <p style={{ color: colors.textMuted, margin: 0, fontSize: 12 }}>加载中…</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <label style={labelStyle}>
              主线并行软上限（1~5）
              <PixelSelect
                value={softCap}
                onChange={(e) => {
                  setSoftCap(e.target.value)
                  save('main_quest_soft_cap', e.target.value)
                }}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </PixelSelect>
            </label>
            <label style={labelStyle}>
              番茄钟工作时长（分钟，默认 25）
              <PixelInput
                type="number"
                min={1}
                style={{ width: 120 }}
                value={workMin}
                onChange={(e) => setWorkMin(e.target.value)}
                onBlur={() => saveMinutes('pomodoro_work_min', workMin)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    saveMinutes('pomodoro_work_min', workMin)
                  }
                }}
              />
            </label>
            <label style={labelStyle}>
              番茄钟休息时长（分钟，默认 5）
              <PixelInput
                type="number"
                min={1}
                style={{ width: 120 }}
                value={breakMin}
                onChange={(e) => setBreakMin(e.target.value)}
                onBlur={() => saveMinutes('pomodoro_break_min', breakMin)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    saveMinutes('pomodoro_break_min', breakMin)
                  }
                }}
              />
            </label>
          </div>
        )}
      </QuestPanel>
      <QuestPanel>
        <div
          style={{
            color: colors.accent,
            fontFamily: font.display,
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          LLM 设置（AI 课表截图识别）
        </div>
        {!llmLoaded ? (
          <p style={{ color: colors.textMuted, margin: 0, fontSize: 12 }}>加载中…</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
              <label style={labelStyle}>
                接口地址预设
                <PixelSelect
                  value={baseUrlKey}
                  onChange={(e) => applyBaseUrlPreset(e.target.value as BaseUrlKey)}
                >
                  {BASE_URL_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </PixelSelect>
              </label>
              <label style={{ ...labelStyle, flex: '1 1 260px' }}>
                Base URL
                <PixelInput
                  value={baseUrl}
                  disabled={baseUrlKey !== 'custom'}
                  placeholder="https://…"
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </label>
              <label style={{ ...labelStyle, flex: '1 1 200px' }}>
                模型（可输入，或从下拉建议选）
                <PixelInput
                  value={model}
                  placeholder="如 kimi-k3"
                  list="llm-model-suggestions"
                  onChange={(e) => setModel(e.target.value)}
                />
                <datalist id="llm-model-suggestions">
                  {Array.from(new Set([...(BASE_URL_PRESETS.find((p) => p.key === baseUrlKey)?.models ?? []), ...(models ?? []).map((m) => m.id)])).map((id) => (
                    <option
                      key={id}
                      value={id}
                      label={(models ?? []).find((m) => m.id === id)?.supportsImageIn ? `${id}（支持识图）` : id}
                    />
                  ))}
                </datalist>
              </label>
              <label style={{ ...labelStyle, flex: '1 1 220px' }}>
                API Key
                <PixelInput
                  type="password"
                  value={apiKey}
                  placeholder={hasKey ? '已保存（输入以替换）' : '原始 Key、Bearer、Authorization 或 JSON'}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </label>
              <JrpgButton onClick={saveLlm} disabled={llmSaving}>
                {llmSaving ? '保存中…' : '保存'}
              </JrpgButton>
              <JrpgButton variant="ghost" onClick={runLlmTest} disabled={llmTesting}>
                {llmTesting ? '测试中…' : '测试连接'}
              </JrpgButton>
              <JrpgButton variant="ghost" onClick={refreshModels} disabled={modelsLoading}>
                {modelsLoading ? '刷新中…' : '刷新模型列表'}
              </JrpgButton>
            </div>
            {models && models.length > 0 && (
              <p
                style={{
                  color: colors.textMuted,
                  fontSize: 12,
                  margin: '8px 0 0',
                  fontFamily: font.body,
                  lineHeight: 1.8,
                }}
              >
                可用模型 {models.length} 个：
                {models
                  .map((m) => (m.supportsImageIn ? `${m.id}（支持识图）` : m.id))
                  .join('、')}
              </p>
            )}
            <p style={{ color: colors.textMuted, fontSize: 12, margin: '8px 0 0' }}>
              可粘贴原始 Key、Bearer、Authorization: Bearer、OPENAI_API_KEY= 或含 api_key 的 JSON。保存后会用当前模型测试通路；并行科技 Responses 预设会使用 /v1/responses。模型可点“刷新模型列表”核对账号实际可用名称；截图识别请选择支持图片输入的模型。
            </p>
            {modelsError && (
              <p style={{ color: colors.danger, fontSize: 12, margin: '8px 0 0' }}>
                {modelsError}
              </p>
            )}
            {llmError && (
              <p style={{ color: colors.danger, fontSize: 12, margin: '8px 0 0' }}>
                {llmError}
              </p>
            )}
            {testResult && (
              <p
                style={{
                  color: testResult.ok ? colors.accentAlt : colors.danger,
                  fontSize: 12,
                  margin: '8px 0 0',
                }}
              >
                {testResult.msg}
              </p>
            )}
            <p
              style={{
                color: colors.textMuted,
                fontSize: 12,
                lineHeight: 1.8,
                margin: '12px 0 0',
                fontFamily: font.body,
              }}
            >
              课表截图识别需要支持图片输入的模型（如 kimi-k3）；API Key 存系统钥匙串不落库；
              仅发送你主动选择的课表截图。moonshot-v1 系列已停用，老配置会自动迁移到 kimi-k3。
            </p>
          </>
        )}
      </QuestPanel>
      <QuestPanel>
        <div style={{ color: colors.accent, fontFamily: font.display, fontSize: 12, marginBottom: 12 }}>启动与窗口</div>
        <p style={{ color: colors.textMuted, lineHeight: 1.7, margin: '0 0 12px' }}>主窗口右上角 × 会收起到系统托盘；悬浮窗 × 会收成小悬浮球。退出程序请使用下方按钮。</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          {supportsWindowsAutostart && <JrpgButton variant="ghost" onClick={() => { void toggleAutostart() }}>{autostart ? '✓ 已开启开机启动' : '开启开机启动'}</JrpgButton>}
          <JrpgButton variant="danger" onClick={() => { void invoke('quit_app') }}>退出 Xmission</JrpgButton>
          {startupMessage && <span role="status" style={{ fontSize: 12, color: colors.textMuted }}>{startupMessage}</span>}
        </div>
      </QuestPanel>
      <QuestPanel>
        <div style={{ color: colors.accent, fontFamily: font.display, fontSize: 12, marginBottom: 12 }}>
          数据导出
        </div>
        <p style={{ color: colors.textMuted, margin: '0 0 12px', lineHeight: 1.7 }}>
          日报包含今天完成的任务、番茄钟与收获；JSON 备份包含本地任务、课表和记录。文件保存在“文档/Xmission”。API Key 不会导出。
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <JrpgButton disabled={exportBusy} onClick={() => runExport('export_daily_report')}>导出今日日报</JrpgButton>
          <JrpgButton disabled={exportBusy} variant="ghost" onClick={() => runExport('export_json_backup')}>导出 JSON 备份</JrpgButton>
        </div>
        {exportMessage && <p role="status" style={{ color: exportMessage.startsWith('导出失败') ? colors.danger : colors.accentAlt, overflowWrap: 'anywhere' }}>{exportMessage}</p>}
      </QuestPanel>
      <p
        style={{
          color: colors.textMuted,
          fontSize: 12,
          marginTop: 40,
          fontFamily: font.body,
        }}
      >
        Xmission v0.67
      </p>
    </div>
  )
}
