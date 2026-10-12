export interface Point{x:number;y:number}
export interface Bone extends Point{name:string;parent?:string;rotation:number}
export interface WorldBone extends Point{rotation:number}
export const clamp=(n:number,a:number,b:number)=>Math.min(b,Math.max(a,n))
export const ease=(t:number)=>{const p=clamp(t,0,1);return p*p*(3-2*p)}
export const mix=(a:number,b:number,t:number)=>a+(b-a)*t
export const angleMix=(a:number,b:number,t:number)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t
/** A continuous textured tail surface, deformed by four bone control points. */
export function tailMesh(curve:Point[],width:number){
 const data=new Float32Array(5*9*2),[a,b,c,d]=curve
 for(let row=0;row<9;row++){
  const t=1-row/8,u=1-t
  const x=u**3*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t**3*d.x,y=u**3*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t**3*d.y
  const dx=3*u*u*(b.x-a.x)+6*u*t*(c.x-b.x)+3*t*t*(d.x-c.x),dy=3*u*u*(b.y-a.y)+6*u*t*(c.y-b.y)+3*t*t*(d.y-c.y),len=Math.max(1e-6,Math.hypot(dx,dy))
  for(let col=0;col<5;col++){const offset=(col/4-.5)*width,index=(row*5+col)*2;data[index]=x-dy/len*offset;data[index+1]=y+dx/len*offset}
 }return data
}
/** World angles for a two-link limb. Unreachable targets stop at the natural reach. */
export function twoBone(root:Point,target:Point,upperLength:number,lowerLength:number,bend=1){
 const dx=target.x-root.x,dy=target.y-root.y,raw=Math.hypot(dx,dy)
 const distance=clamp(raw,Math.abs(upperLength-lowerLength)+1e-6,upperLength+lowerLength-1e-6)
 const aim=Math.atan2(dy,dx),offset=Math.acos(clamp((upperLength**2+distance**2-lowerLength**2)/(2*upperLength*distance),-1,1))
 const upper=aim-offset*Math.sign(bend||1),elbow={x:root.x+upperLength*Math.cos(upper),y:root.y+upperLength*Math.sin(upper)}
 const reachable={x:root.x+distance*Math.cos(aim),y:root.y+distance*Math.sin(aim)}
 return{upper,lower:Math.atan2(reachable.y-elbow.y,reachable.x-elbow.x),elbowX:elbow.x,elbowY:elbow.y}
}
export function worldBones(bones:Bone[]):Record<string,WorldBone>{
 const result:Record<string,WorldBone>={},definitions=new Map(bones.map(b=>[b.name,b])),visiting=new Set<string>()
 const visit=(name:string):WorldBone=>{
  if(result[name])return result[name]
  if(visiting.has(name))throw new Error('Skeleton cycle: '+name)
  const b=definitions.get(name);if(!b)throw new Error('Unknown bone: '+name)
  visiting.add(name);const p=b.parent?visit(b.parent):{x:0,y:0,rotation:0},c=Math.cos(p.rotation),s=Math.sin(p.rotation)
  result[name]={x:p.x+b.x*c-b.y*s,y:p.y+b.x*s+b.y*c,rotation:p.rotation+b.rotation};visiting.delete(name);return result[name]
 }
 for(const bone of bones)visit(bone.name)
 return result
}
