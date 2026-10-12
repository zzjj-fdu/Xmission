import{clamp,type Point}from'./math'
import type{PoseInput}from'./pose'
export interface HybridFrame{rect:[number,number,number,number];head:[number,number];chinY:number;neck:[number,number];flight:number;mask?:number[][]}
export interface HybridClip{image:string;basis:number;frameMs:number;frames:HybridFrame[]}
export interface HybridAtlas{version:number;walk:HybridClip;run:HybridClip;scarf:{image:string;parts:Record<'collar'|'long'|'short',[number,number,number,number]>}}
export function hybridFrame(data:HybridAtlas,input:PoseInput,animated=true){
 const running=input.action.startsWith('run'),clip=running?data.run:data.walk,time=Math.max(0,input.timeMs),finite=input.action==='run-start'||input.action==='run-stop'
 const order=input.action==='run-start'?[0,1]:input.action==='run-stop'?[4,6,7]:[0,1,2,3,4,5,6,7]
 const step=finite?Math.min(order.length-1,Math.floor(clamp(time/(input.durationMs||300),0,.999)*order.length)):Math.floor(time/clip.frameMs)%order.length
 const index=order[animated?step:finite?order.length-1:0],frame=clip.frames[index],scale=56/clip.basis,flip=input.direction==='left'
 const x=103-frame.head[0]*scale,y=142-frame.rect[3]*scale-frame.flight
 const neck={x:x+frame.neck[0]*scale,y:y+frame.neck[1]*scale}
 return{clip,index,frame,scale,x,y,flip,neck:{x:flip?150-neck.x:neck.x,y:neck.y}}
}
/** Three fixed-length cloth bones. Phase lag grows towards the free tip. */
export function scarfChain(root:Point,input:Pick<PoseInput,'action'|'direction'|'timeMs'>,length:number,offset=0):Point[]{
 const running=input.action.startsWith('run'),walk=input.action==='walk',speed=running?2*Math.PI/.6:walk?2*Math.PI:1.8,t=input.timeMs/1000,direction=input.direction==='left'?-1:1,points=[{...root}]
 for(let i=0;i<3;i++){
  const rest=running?-.14:walk?.22:.68,angle=Math.PI-rest+Math.sin(t*speed-i*.48+offset)*(running?.17:walk?.10:.045)+i*.035
  const last=points[points.length-1];points.push({x:last.x+Math.cos(angle)*length/3*direction,y:last.y+Math.sin(angle)*length/3})
 }return points
}
/** Ribbon follows the bone centreline. It keeps its width, without squashing. */
export function scarfVertices(chain:Point[],width:number){
 const out=new Float32Array(21*5*2)
 for(let col=0;col<21;col++){
  const t=(1-col/20)*3,j=Math.min(2,Math.floor(t)),p=t-j,a=chain[j],b=chain[j+1],dx=b.x-a.x,dy=b.y-a.y,len=Math.max(.001,Math.hypot(dx,dy))
  for(let row=0;row<5;row++){const side=(row/4-.5)*width,k=(row*21+col)*2,orientation=dx<0?1:-1;out[k]=a.x+dx*p+dy/len*side*orientation;out[k+1]=a.y+dy*p-dx/len*side*orientation}
 }return out
}
