import type { ThemeKey } from '../themes'
export type FoxAction='idle'|'walk'|'run'|'run-start'|'run-stop'|'sit'|'stretch'|'focus'|'remind'|'celebrate'|'sleep'|'depart'|'return'|'rain'|'wind'|'snow'|'night'|'lifted'|'respond'|'attention'|'pet'|'groom'|'lift'|'land'|'bag-open'|'bag-close'|'book-open'|'book-close'|'sleep-down'|'wake'|'tail'|'milestone'|'adjust-scarf'|'daily'|'snack'|'keepsake'|'read-habit'|'game-turn'|'game-wait'|'game-match'|'game-miss'|'dock-left'|'dock-right'|'edge-left'|'edge-right'|'undock-left'|'undock-right'|'window-hang'|'toy-catch'
export type FoxActivity='idle'|'focus'|'sleep'
export type FoxEmotion='happy'|'serious'|'curious'|'sleepy'|'surprised'|'calm'
export type FoxDirection='right'|'left'|'front'
export type CompanionCharacter='fox'|'red-panda'
export type CompanionOutfit='theme'|'scarf'|'none'
export const COMPANION_NAMES:Record<CompanionCharacter,string>={fox:'小狐狸','red-panda':'小熊猫'}
export interface PetPreferences {character:CompanionCharacter;outfit:CompanionOutfit;enabled:boolean;desktopEnabled:boolean;name:string;size:number;wander:boolean;reminders:boolean;proactive:boolean;quietStart:string;quietEnd:string;reducedMotion:boolean;mutedUntil:number;appearance:'follow'|ThemeKey;displayMode:'normal'|'mini'|'edge'|'closed';taskClick:'single'|'double';wanderRange:number;edgeSide:'left'|'right';importantDuringFocus:boolean;followEnvironment:boolean;autoDock:boolean;autoPerch:boolean;sound:boolean}
export interface PetTrip{id:string;theme:ThemeKey;route:string;durationMin:number;startedAt:number;returnsAt:number;state:'away'|'returned'|'claimed';itemKey:string;itemName:string;story:string;weather:import('../store/sceneWeather').SceneWeather;phase:import('../scenes').ScenePhase}
export interface PetSouvenir{id:string;tripId:string;theme:ThemeKey;itemKey:string;itemName:string;route:string;story:string;collectedAt:number}
export interface PetReminder{key:string;id:string;kind:'task'|'course'|'trip';title:string;detail:string;whenAt:number;importance:number}
export interface PetNotice{items:PetReminder[];createdAt:number;message?:string|null;title?:string|null;tab?:string|null;reply?:PetReply|null}
export interface PetGrowth{stage:string;careDays:number;playDays:number;paperSkill:boolean;next:string}
export interface PetHome{growth:PetGrowth;preferences:PetPreferences;trip:PetTrip|null;collection:PetSouvenir[];today:PetReminder[];focus:boolean;xpTotal:number;now:number;collectionTotal:number;care:PetCare;journal:PetJournal;keepsake:PetSouvenir|null}
export interface PetReply{text:string;emotion:FoxEmotion;suggestedTask:string|null;source:'local'|'ai';draftId?:string|null}
export const DEFAULT_PET_PREFERENCES:PetPreferences={character:'fox',outfit:'theme',enabled:true,desktopEnabled:true,name:'小狐狸',size:96,wander:false,reminders:true,proactive:true,quietStart:'22:00',quietEnd:'08:00',reducedMotion:false,mutedUntil:0,appearance:'follow',displayMode:'normal',taskClick:'double',wanderRange:96,edgeSide:'right',importantDuringFocus:false,followEnvironment:true,autoDock:true,autoPerch:true,sound:false}
/** Older saved preferences belong to the original fox. */
export function normalizePetPreferences(preferences:Partial<PetPreferences>):PetPreferences {
 const character=preferences.character==='red-panda'?'red-panda':'fox'
 const outfit=preferences.outfit==='scarf'||preferences.outfit==='none'?preferences.outfit:'theme'
 return {...DEFAULT_PET_PREFERENCES,...preferences,character,outfit,name:preferences.name||COMPANION_NAMES[character]}
}
export interface PetCare {affection:number;bestMoves:number|null;completedGames:number;caredToday:string[]}

export interface PetDockState{side:'left'|'right'|null;hidden:boolean;transitioning:boolean;folded:boolean}
export interface PetFeedback{batchId:string;kind:'completed'|'main'|'receipt';count:number}

export interface PetMemory{eventKey:string;kind:string;title:string;detail:string;theme:ThemeKey|null;day:string;createdAt:number}
export interface PetUnlock{id:string;title:string;rule:string;progress:number;target:number;unlocked:boolean}
export interface PetJournal{memories:PetMemory[];unlocks:PetUnlock[];relationship:string;memoryTotal:number;careDays:number}
export interface PetGoal{id:string;title:string;category:'reading'|'writing'|null}
