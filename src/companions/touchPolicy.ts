/** Pointer motion, not a selected toolbar item, decides direct care. */
export type DirectCare = 'stroke' | 'brush'
export function directCare(part:string,onFur:boolean,pressed:boolean):DirectCare|null{
 if(!onFur||pressed)return null
 return part==='head'?'stroke':'brush'
}
export function careReady(kind:DirectCare,elapsed:number,distance:number,size:number){
 return kind==='stroke'?elapsed>=700:elapsed>=500&&distance>=Math.max(8,size*.2)
}
export function careMayInterrupt(gesture:string|null){
 return gesture===null||gesture==='pet'||gesture==='groom'||gesture==='attention'||gesture==='sit'||gesture==='daily'
}
