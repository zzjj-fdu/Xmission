import {useEffect,useRef} from 'react'
import type {useFox} from './useFox'
import {quietNow} from './behavior'
export function usePetSound(pet:ReturnType<typeof useFox>){
 const context=useRef<AudioContext|null>(null),last=useRef(0),latest=useRef(pet);latest.current=pet
 useEffect(()=>{
  if(!pet.preferences.sound){void context.current?.close().catch(()=>{});context.current=null;return}
  const enable=()=>{context.current??=new AudioContext();void context.current.resume().catch(()=>{})}
  window.addEventListener('pointerdown',enable,{passive:true})
  return()=>window.removeEventListener('pointerdown',enable)
 },[pet.preferences.sound])
 useEffect(()=>{
  const p=latest.current,ctx=context.current,now=Date.now()
  if(!ctx||ctx.state!=='running'||!p.preferences.sound||!p.preferences.enabled||p.home?.focus||quietNow(p.preferences,now)||now-last.current<15000||!['snack','game-match','celebrate','milestone','daily'].includes(p.gesture??''))return
  last.current=now;const start=ctx.currentTime
  const note=(frequency:number,at:number,length:number,type:OscillatorType,gain:number)=>{
   const osc=ctx.createOscillator(),volume=ctx.createGain();osc.type=type;osc.frequency.value=frequency
   volume.gain.setValueAtTime(.0001,start+at);volume.gain.exponentialRampToValueAtTime(gain,start+at+.015);volume.gain.exponentialRampToValueAtTime(.0001,start+at+length)
   osc.connect(volume);volume.connect(ctx.destination);osc.start(start+at);osc.stop(start+at+length+.03);osc.onended=()=>{osc.disconnect();volume.disconnect()}
  }
  if(p.theme==='pixel-jrpg'){note(1046,0,.20,'sine',.018);note(1568,.06,.26,'sine',.011)}
  else if(p.theme==='parchment-journal'){
   const buffer=ctx.createBuffer(1,Math.floor(ctx.sampleRate*.10),ctx.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length)
   const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),volume=ctx.createGain();source.buffer=buffer;filter.type='bandpass';filter.frequency.value=950;filter.Q.value=.8;volume.gain.value=.025
   source.connect(filter);filter.connect(volume);volume.connect(ctx.destination);source.start(start);source.onended=()=>{source.disconnect();filter.disconnect();volume.disconnect()}
  }else if(p.theme==='animal-crossing'){note(659,0,.16,'triangle',.016);note(830,.10,.18,'sine',.014)}
  else{note(247,0,.08,'triangle',.022);note(330,.075,.10,'triangle',.014)}
 },[pet.gesture,pet.gestureStarted,pet.theme])
 useEffect(()=>()=>{void context.current?.close().catch(()=>{});context.current=null},[])
}
