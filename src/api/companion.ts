import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import type { ThemeKey } from '../themes'
import type { FoxAction,PetHome,PetPreferences,PetReply,PetTrip,PetSouvenir } from '../companions/types'
export const getCompanionHome=()=>invoke<PetHome>('get_companion_home')
export const updateCompanionPreferences=(patch:Partial<PetPreferences>)=>invoke<PetPreferences>('update_companion_preferences',{patch})
export const startCompanionTrip=(requestId:string,theme:ThemeKey,route:string,durationMin:number,weather?:string,phase?:string)=>invoke<PetTrip>('start_companion_trip',{requestId,theme,route,durationMin,weather,phase})
export const claimCompanionTrip=(id:string)=>invoke<PetSouvenir>('claim_companion_trip',{id})
export const companionChat=(message:string,includeToday:boolean,scenario:'chat'|'hint'|'example'|'tutorial'='chat',sharedText?:string)=>invoke<PetReply>('companion_chat',{message,includeToday,scenario,sharedText:sharedText??null})
export const companionGesture=(action:FoxAction,duration?:number)=>emit('companion-gesture',{action,duration})
export const openCompanionHome=()=>invoke<void>('open_companion_home')
