import {memo,type ComponentProps} from 'react'
import {useCompanionStore} from '../store/companion'
import {FoxSprite,FoxPortrait,preloadFoxAction,preloadFoxPerch} from './FoxSprite'
import {PandaSprite,preloadPanda} from './PandaSprite'
import type {ThemeKey} from '../themes'
import type {CompanionCharacter,CompanionOutfit,FoxAction,FoxDirection,FoxEmotion} from './types'

export type CompanionSpriteProps=ComponentProps<typeof FoxSprite>&{character?:CompanionCharacter;outfit?:CompanionOutfit}
export const CompanionSprite=memo(function CompanionSprite({character:override,outfit:outfitOverride,...props}:CompanionSpriteProps){
 const character=useCompanionStore(s=>override??s.home?.preferences.character??'fox')
 const outfit=useCompanionStore(s=>outfitOverride??s.home?.preferences.outfit??'theme')
 return character==='red-panda'?<PandaSprite key={character} {...props} outfit={outfit}/>:<FoxSprite key={character} {...props}/>
})

const portraitActions:Record<FoxEmotion,FoxAction>={happy:'celebrate',serious:'focus',curious:'attention',sleepy:'sleep',surprised:'respond',calm:'idle'}
export function CompanionPortrait({character:override,outfit,...props}:ComponentProps<typeof FoxPortrait>&{character?:CompanionCharacter;outfit?:CompanionOutfit}){
 const character=useCompanionStore(s=>override??s.home?.preferences.character??'fox')
 return character==='red-panda'?<CompanionSprite character={character} outfit={outfit} theme={props.theme} action={portraitActions[props.emotion]} direction="front" size={props.size??64} animated={false} onPaint={props.onPaint}/>:<FoxPortrait {...props}/>
}

/** Warm the selected species before native movement or a transformation starts. */
export async function preloadCompanionAction(theme:ThemeKey,action:FoxAction,direction:FoxDirection='right',character:CompanionCharacter=useCompanionStore.getState().home?.preferences.character??'fox'){
 if(character==='red-panda')await preloadPanda(theme,useCompanionStore.getState().home?.preferences.outfit??'theme')
 else await preloadFoxAction(theme,action,direction)
}
export async function preloadCompanionPerch(theme:ThemeKey,mode:string,character:CompanionCharacter=useCompanionStore.getState().home?.preferences.character??'fox'){
 if(character==='red-panda')await preloadPanda(theme,useCompanionStore.getState().home?.preferences.outfit??'theme')
 else await preloadFoxPerch(theme,mode)
}
