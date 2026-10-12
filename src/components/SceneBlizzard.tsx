import { memo, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { ThemeKey } from '../themes'
import type { ScenePhase } from '../scenes'
import type { SceneEnvironment } from '../scenes/environment'
import { SCENE_GEOMETRY, sourceViewport } from '../scenes/themeGeometry'
import { snowTransitionAt, SNOW_TRANSITION_MS } from '../scenes/snowTransition'

const hash = (i: number) => { const v = Math.sin(i*127.1+41.9)*43758.5453; return v-Math.floor(v) }
const wrap = (value: number, span: number) => (value%span+span)%span
const profiles = {
  'pixel-jrpg': { count: 720, speed: 1.12, size: .88, haze: '#83a8c4', snow: '#f1f8ff', warm: '#dfeefa' },
  'parchment-journal': { count: 590, speed: .84, size: .72, haze: '#aaa99d', snow: '#f4f0e5', warm: '#e9e2d0' },
  'animal-crossing': { count: 660, speed: .9, size: 1.05, haze: '#91b3bd', snow: '#f4f8f2', warm: '#e7efe1' },
  'stardew-valley': { count: 690, speed: 1, size: .92, haze: '#94acb2', snow: '#f4f5e8', warm: '#eae6d4' },
} as const

function surface(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  return canvas
}

/** Render each flake once: powder, a crisp crystal, and a soft out-of-focus foreground flake. */
function snowSprites(pixel: boolean, warm: string) {
  return Array.from({ length: 4 }, (_, kind) => {
    const canvas = surface(64,64), ctx = canvas.getContext('2d')!
    ctx.translate(32,32)
    if (kind === 0 || kind === 3) {
      const glow = ctx.createRadialGradient(0,0,0,0,0,23)
      glow.addColorStop(0,'#ffffff'); glow.addColorStop(kind === 3 ? .3 : .12, warm)
      glow.addColorStop(1,'rgba(240,250,255,0)')
      ctx.fillStyle = glow; ctx.fillRect(-25,-25,50,50)
    } else if (pixel) {
      ctx.fillStyle = kind === 1 ? '#ffffff' : warm
      ctx.fillRect(-3,-21,6,42); ctx.fillRect(-21,-3,42,6)
      for (const sign of [-1,1]) {
        ctx.fillRect(sign*10-3,-13,6,6); ctx.fillRect(sign*10-3,7,6,6)
        ctx.fillRect(-13,sign*10-3,6,6); ctx.fillRect(7,sign*10-3,6,6)
      }
      ctx.fillRect(-6,-6,12,12)
    } else {
      ctx.strokeStyle = kind === 1 ? '#ffffff' : warm
      ctx.lineWidth = kind === 1 ? 2 : 2.8; ctx.lineCap = 'round'
      for (let arm = 0; arm < 6; arm++) {
        ctx.save(); ctx.rotate(arm*Math.PI/3)
        ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-21)
        ctx.moveTo(0,-11); ctx.lineTo(-6,-16); ctx.moveTo(0,-11); ctx.lineTo(6,-16)
        ctx.moveTo(0,-16); ctx.lineTo(-4,-20); ctx.moveTo(0,-16); ctx.lineTo(4,-20)
        ctx.stroke(); ctx.restore()
      }
    }
    return canvas
  })
}

/** Cached, opaque cloud texture. Full coverage hides the plate swap without a flat white frame. */
function stormTexture(color: readonly number[], haze: string, warm: string) {
  const canvas = surface(768,384), ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgb('+color.join(',')+')'; ctx.fillRect(0,0,768,384)
  for (let i = 0; i < 38; i++) {
    ctx.save(); ctx.translate(hash(i+900)*768,hash(i+1000)*384); ctx.scale(2.8,.75)
    const cloud = ctx.createRadialGradient(0,0,0,0,0,35+hash(i+1200)*80)
    cloud.addColorStop(0,i%3 === 0 ? warm : haze); cloud.addColorStop(1,'rgba(220,235,244,0)')
    ctx.globalAlpha = .28+hash(i+1100)*.3; ctx.fillStyle = cloud
    ctx.fillRect(-120,-120,240,240); ctx.restore()
  }
  // Only generated once; subtle granular detail reads as airborne powder.
  ctx.globalAlpha = .22
  for (let i = 0; i < 3400; i++) {
    ctx.fillStyle = i%3 === 0 ? haze : '#ffffff'
    ctx.fillRect(hash(i+2000)*768,hash(i+6000)*384,1+hash(i+4000)*2,.7)
  }
  ctx.globalAlpha = 1
  return canvas
}

function powderBank(haze: string, snow: string) {
  const canvas = surface(768,256), ctx = canvas.getContext('2d')!
  // A long, broken stream with feathered edges, not a solid oval or geometric patch.
  for (let i = 0; i < 30; i++) {
    ctx.save(); ctx.translate(24+i*25,128+Math.sin(i*.71)*35); ctx.scale(2.1,.7)
    const puff = ctx.createRadialGradient(0,0,0,0,0,34+hash(i+500)*36)
    puff.addColorStop(0,i%4 === 0 ? haze : snow); puff.addColorStop(.3,snow)
    puff.addColorStop(1,'rgba(240,248,255,0)')
    ctx.globalAlpha = .14+hash(i+600)*.18; ctx.fillStyle = puff; ctx.fillRect(-72,-72,144,144); ctx.restore()
  }
  // Feather the sprite boundary so crossing streams never expose a rectangular edge.
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'destination-in'
  const edge = ctx.createLinearGradient(0,0,768,0)
  edge.addColorStop(0,'rgba(255,255,255,0)'); edge.addColorStop(.18,'#fff')
  edge.addColorStop(.82,'#fff'); edge.addColorStop(1,'rgba(255,255,255,0)')
  ctx.fillStyle = edge; ctx.fillRect(0,0,768,256)
  return canvas
}

interface Props { theme: ThemeKey; phase: ScenePhase; environment: SceneEnvironment; arrivingRef: RefObject<HTMLDivElement> }
/** Temporary 30 fps storm. Sprites/textures are cached for this passage and released at its end. */
export const SceneBlizzard = memo(function SceneBlizzard({ theme, phase, environment, arrivingRef }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const windRef = useRef(environment)
  windRef.current = environment
  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext('2d'), arriving = arrivingRef.current
    // Capture this exact layer so a cancelled storm cannot reveal a newer selection.
    if (!ctx) { arriving?.style.setProperty('opacity','1'); return }
    let revealed = false
    const g = theme === 'animal-crossing' ? { width:1920, height:720, pixel:false } : SCENE_GEOMETRY[theme]
    const profile = profiles[theme], night = phase === 'night' || phase === 'predawn'
    const color = night ? theme === 'parchment-journal' ? [110,121,131] : [84,108,130]
      : theme === 'parchment-journal' ? [222,221,207] : theme === 'animal-crossing' ? [206,224,226] : [205,223,237]
    const haze = night ? '#5c788f' : profile.haze, snow = night ? '#bed1dc' : profile.snow
    const sprites = snowSprites(g.pixel,night ? '#c4d6df' : profile.warm)
    const texture = stormTexture(color,haze,night ? '#aac1d0' : profile.warm)
    const bank = powderBank(haze,snow)
    const flakes = Array.from({ length:profile.count }, (_, i) => {
      const depth = i < profile.count*.48 ? 0 : i < profile.count*.81 ? 1 : i < profile.count*.95 ? 2 : 3
      return { x:hash(i)*g.width, y:hash(i+200)*g.height, depth,
        size:(depth === 0 ? 2+hash(i+700)*3 : depth === 1 ? 5+hash(i+700)*6 : depth === 2 ? 11+hash(i+700)*11 : 28+hash(i+700)*32)*profile.size,
        weight:.65+hash(i+1400)*.7, seed:hash(i+1800)*Math.PI*2, sprite:depth === 3 ? 3 : depth === 0 ? 0 : i%3 === 0 ? 2 : 1 }
    })
    let width = 0, height = 0, frame = 0, last = 0, previous = 0
    const dpr = Math.min(1.5,devicePixelRatio||1), start = performance.now()
    const resize = () => {
      const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height
      canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr)
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize()
    const paint = (now: number) => {
      const elapsed = now-start, { cover, storm, stage, done, reveal } = snowTransitionAt(elapsed)
      // Reveal in the same frame that draws the opaque veil; CSS animation clocks can drift.
      if (reveal && !revealed) { arriving?.style.setProperty('opacity','1'); revealed = true }
      const dt = Math.min(.065,(now-(previous||start))/1000); previous = now
      if (canvas.dataset.snowStage !== stage) canvas.dataset.snowStage = stage
      const second = String(Math.floor(elapsed/1000))
      if (canvas.dataset.snowSecond !== second) canvas.dataset.snowSecond = second
      ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height)
      const camera = sourceViewport(width,height,g.width,g.height)
      ctx.translate(0,camera.offsetY); ctx.scale(camera.scale,camera.scale)
      const seconds = elapsed/1000, direction = windRef.current.direction < 0 ? -1 : 1
      // Every depth and powder stream shares the same gust, with a little rolling eddy motion.
      const gust = .72+.22*Math.sin(seconds*2.25)+.12*Math.sin(seconds*4.7)
      const wind = direction*(65+storm*(370+windRef.current.gust*85)*gust)*profile.speed
      ctx.globalAlpha = cover
      // Two softly blended offsets move the texture without a visible tiled edge.
      ctx.drawImage(texture,0,0,g.width,g.height)
      ctx.globalAlpha = cover*.28
      ctx.drawImage(texture,-120+Math.sin(seconds*.7)*100,-30+Math.sin(seconds*.5)*25,g.width+240,g.height+60)
      ctx.globalAlpha = 1
      // Passing snow banks gather before the opaque veil and linger while winter emerges.
      for (let i = 0; i < 5; i++) {
        const speed = (145+i*43)*profile.speed
        const bankWidth = g.width*(.7+hash(i+60)*.4), bankHeight = g.height*(.31+hash(i+80)*.24)
        const x = wrap(hash(i+90)*(g.width+bankWidth)+direction*seconds*speed,g.width+bankWidth)-bankWidth
        const y = g.height*(.04+i*.19)+Math.sin(seconds*1.1+i)*g.height*.06-bankHeight/2
        ctx.globalAlpha = storm*(.32+.19*Math.sin(seconds*1.6+i)**2)
        ctx.drawImage(bank,x,y,bankWidth,bankHeight)
      }
      ctx.imageSmoothingEnabled = !g.pixel
      for (let i = 0; i < flakes.length; i++) {
        const flake = flakes[i], depth = flake.depth, parallax = .42+depth*.46
        const curl = Math.sin(seconds*1.7+flake.y/g.height*5+flake.seed)*storm*(16+depth*17)
        flake.x = wrap(flake.x+(wind*parallax+curl)*dt+80,g.width+160)-80
        flake.y = wrap(flake.y+((48+depth*47)*flake.weight+storm*curl*.3)*dt+80,g.height+160)-80
        const tumble = .66+.34*Math.sin(seconds*(.8+flake.weight)+flake.seed)**2
        const alpha = storm*(depth === 0 ? .55 : depth === 1 ? .78 : depth === 2 ? .83 : .26)*tumble
        if (alpha < .006) continue
        ctx.globalAlpha = alpha
        const size = flake.size, x = g.pixel ? Math.round(flake.x) : flake.x, y = g.pixel ? Math.round(flake.y) : flake.y
        // Keep most flakes compact; only a handful receive short wind trails.
        if (depth === 1 && i%8 === 0 && storm > .45) {
          ctx.strokeStyle = snow; ctx.lineWidth = g.pixel ? 1.5 : 1
          ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x-direction*(7+storm*10),y-3); ctx.stroke()
        }
        if (depth === 2 && !g.pixel) {
          ctx.save(); ctx.translate(x,y); ctx.rotate(seconds*.23+flake.seed)
          ctx.drawImage(sprites[flake.sprite],-size/2,-size/2,size,size); ctx.restore()
        } else ctx.drawImage(sprites[flake.sprite],x-size/2,y-size/2,size,size*tumble)
      }
      ctx.globalAlpha = 1
      if (!done) frame = requestAnimationFrame(tick)
    }
    const tick = (time: number) => {
      if (time-last >= 33 || time-start >= SNOW_TRANSITION_MS) { last = time; paint(time) }
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); arriving?.style.removeProperty('opacity') }
  },[theme,phase])
  return <canvas ref={ref} className="xm-scene-blizzard" aria-hidden="true"/>
})

