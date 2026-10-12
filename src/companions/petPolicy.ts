import type {FoxAction,FoxDirection} from './types'

export interface PetSurroundings {leftRoom:number;rightRoom:number;cursorX:number;cursorY:number;size:number;blocked:boolean}
const clamp=(n:number)=>Math.max(0,Math.min(1,n))
/** Turn toward the usable desktop more often as either edge approaches. */
export function facingRightChance(left:number,right:number,size:number){
 const reach=Math.max(1,size*3)
 return clamp(.5+.46*(clamp(1-left/reach)-clamp(1-right/reach)))
}
export function idleFacing(c:PetSurroundings,random:number):FoxDirection{
 return random<facingRightChance(c.leftRoom,c.rightRoom,c.size)?'right':'left'
}
export function cursorFacing(c:PetSurroundings):FoxDirection|null{
 const dx=c.cursorX-c.size/2,dy=c.cursorY-c.size/2
 if(c.blocked||Math.hypot(dx,dy)>c.size*3||Math.hypot(dx,dy)<c.size*.55)return null
 // Ignore cursors on neighbouring monitors instead of looking through the edge.
 if(c.cursorX<-c.leftRoom||c.cursorX>c.size+c.rightRoom)return null
 return Math.abs(dx)<c.size*.25?'front':dx<0?'left':'right'
}
export interface LifeClock {idleAt:number;weatherAt:number;restUntil:number;weatherKey:string;weatherLast:number;lastAction:FoxAction|null}
export function createLifeClock(now:number,random=Math.random):LifeClock{
 return{idleAt:now+75000+random()*90000,weatherAt:now+30000+random()*60000,restUntil:now,weatherKey:'',weatherLast:0,lastAction:null}
}
export function nextLifeAction(clock:LifeClock,now:number,key:string,environment:FoxAction|null,choices:FoxAction[],random=Math.random):FoxAction|null{
 if(clock.weatherKey!==key){
  if(clock.weatherKey)clock.weatherAt=Math.max(now+18000+random()*18000,clock.weatherLast+180000)
  clock.weatherKey=key
 }
 if(now<clock.restUntil)return null
 let action:FoxAction|null=null
 if(now>=clock.weatherAt){
  clock.weatherAt=now+240000+random()*240000
  if(environment&&environment!==clock.lastAction&&random()<.7){action=environment;clock.weatherLast=now}
 }
 if(!action&&now>=clock.idleAt){
  const available=choices.filter(a=>a!==clock.lastAction)
  clock.idleAt=now+150000+random()*150000
  if(available.length&&random()<.75)action=available[Math.min(available.length-1,Math.floor(random()*available.length))]
 }
 if(action){clock.lastAction=action;clock.restUntil=now+60000;clock.idleAt=Math.max(clock.idleAt,clock.restUntil)}
 return action
}
