export type PetTool='stroke'|'brush'|null
export interface TouchPath{x:number;y:number;lastX:number;lastY:number;path:number;reversals:number;vx:number;vy:number;drag:boolean}
export function startTouch(x:number,y:number):TouchPath{return{x,y,lastX:x,lastY:y,path:0,reversals:0,vx:0,vy:0,drag:false}}
export function moveTouch(s:TouchPath,x:number,y:number,size:number,mode:'body'|'stroke'|'brush'){
 const dx=x-s.lastX,dy=y-s.lastY,step=Math.hypot(dx,dy)
 if(step>=1){if(s.vx*dx+s.vy*dy<0)s.reversals++;s.path+=Math.min(step,size*.35);s.vx=dx;s.vy=dy;s.lastX=x;s.lastY=y}
 if(mode==='body'&&Math.hypot(x-s.x,y-s.y)>4||mode==='stroke'&&Math.hypot(x-s.x,y-s.y)>size*.40)s.drag=true
 return s
}
export function completedCare(s:TouchPath,mode:'body'|'stroke'|'brush',size:number):PetTool{
 return !s.drag&&mode!=='body'&&s.path>=size*.65&&s.reversals>=2?mode:null
}
export function bodyPart(x:number,y:number,facing:'left'|'right'|'front'){
 if(y<.63&&(facing==='front'?x>.25&&x<.78:facing==='right'?x>.57:x<.43))return'head'
 if(y>.28&&y<.85&&(facing==='right'?x<.3:facing==='left'?x>.7:x>.7))return'tail'
 if(y>.47&&y<.88&&x>.25&&x<.78)return'bag'
 return'body'
}
