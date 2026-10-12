import{worldBones,twoBone,clamp,ease,type Bone,type WorldBone}from'./math'
import type{PoseInput}from'./pose'
export interface SkinFrame{rect:[number,number,number,number];head:[number,number,number];marker:[number,number,number,number]|null;mask:number[][]}
export interface SkinAtlas{image:string;headWidth:number;bases:Record<string,SkinFrame>}
export interface SkinPlan{base:string;frame:SkinFrame;scale:number;headWidth:number;x:number;y:number;flip:boolean;rotation:number;bones:Bone[];restBones:Bone[];world:Record<string,WorldBone>;rest:Record<string,WorldBone>;marker?:[number,number,number,number];markerTarget?:[number,number,number,number]}
const loop=(t:number,cycle:number)=>t/cycle%1
/** Bind to the artist's complete anatomy. Bone lengths come from its own rest pose. */
export function skinPlan(atlas:SkinAtlas,input:PoseInput):SkinPlan{
 const t=Math.max(0,input.timeMs)/1000,left=input.direction==='left',walk=input.action==='walk'||input.action.startsWith('run'),progress=clamp(input.timeMs/(input.durationMs||900),0,1),sleep=input.action==='sleep'||input.action==='sleep-down'&&progress>.45||input.action==='wake'&&progress<.35,read=['focus','read-habit'].includes(input.action)||input.action==='book-open'&&progress>.45||input.action==='book-close'&&progress<.55,edge=/^(edge|dock|undock)-/.test(input.action)
 let base=sleep?'sleep':read?'read':walk?(left?'walk-left':'walk-right'):(left?'stand-left':'stand-right'),flip=false,rotation=0
 if(input.attachment?.startsWith('icon')){base='hug';flip=input.attachment==='icon'}
 else if(input.attachment==='bottom'||input.attachment==='top-hang'||input.attachment==='left'||input.attachment==='right'||input.action==='window-hang'){base='hang';rotation=input.attachment==='left'?Math.PI/2:input.attachment==='right'?-Math.PI/2:0}
 else if(input.attachment==='top'||input.attachment==='sit'||input.action==='sit')base='read'
 if(edge)base=input.action.endsWith('right')?'stand-left':'stand-right'
 const frame=atlas.bases[base];if(!frame)throw new Error('缺少完整小熊猫姿势：'+base)
 const w=frame.rect[2],h=frame.rect[3],scale=56/frame.head[2],headWidth=56,head={x:frame.head[0],y:frame.head[1]},body={x:w*.55,y:h*.69}
 const restBones:Bone[]=[{name:'root',x:0,y:0,rotation:0},{name:'body',parent:'root',...body,rotation:0},{name:'head',parent:'root',...head,rotation:0},{name:'neck',parent:'head',x:0,y:frame.head[2]*.3,rotation:0},{name:'ear-left',parent:'head',x:-frame.head[2]*.3,y:-frame.head[2]*.28,rotation:0},{name:'ear-right',parent:'head',x:frame.head[2]*.3,y:-frame.head[2]*.28,rotation:0}]
 const bones=restBones.map(b=>({...b})),phase=loop(t,input.action.startsWith('run')?.24:.45),breath=Math.sin(t*1.6)
 bones[0].y=breath*.65/scale
 bones[2].rotation=input.action==='pet'?.035*Math.sin(t*2):input.action==='attention'||input.action==='respond'?.04*Math.sin(t*1.8):input.action==='wind'?.018*Math.sin(t*6):.006*Math.sin(t*.8)
 if(['sleep-down','book-open','book-close','wake','stretch'].includes(input.action)){bones[0].y+=Math.sin(progress*Math.PI)*2/scale;bones[2].rotation-=Math.sin(progress*Math.PI)*.05}
 if(input.action==='snow')bones[0].x+=Math.sin(t*22)*.22/scale
 if(input.action==='rain')bones[2].rotation-=.045
 if(input.action==='groom')bones[2].rotation+=Math.sin(t*2.5)*.02
 if(['celebrate','milestone','game-match'].includes(input.action))bones[0].y-=Math.abs(Math.sin(t*3))*2/scale
 if(['lift','lifted'].includes(input.action))bones[0].y-=4/scale
 if(input.action==='land')bones[0].y-=3*Math.max(0,1-t/.8)/scale
 const mirror=(x:number)=>base.endsWith('left')?1-x:x
 const endpoints=walk?[[.83,.94,.74,.72],[.73,.92,.67,.70],[.33,.94,.40,.76],[.46,.94,.46,.73]]:base==='hang'?[[.43,.035,.43,.40],[.76,.035,.73,.40],[.44,.72,.47,.64],[.77,.72,.69,.64]]:base==='hug'?[[.39,.58,.38,.47],[.90,.57,.81,.49],[.42,.94,.46,.78],[.86,.92,.72,.78]]:base==='read'?[[.44,.60,.42,.47],[.86,.61,.78,.46],[.38,.93,.48,.78],[.88,.93,.72,.78]]:[[.85,.62,.78,.49],[.43,.63,.46,.50],[.53,.95,.55,.79],[.81,.95,.70,.79]]
 for(let i=0;i<4;i++){
  const[fx,fy,rx,ry]=endpoints[i],start={x:mirror(rx)*w,y:ry*h},foot={x:mirror(fx)*w,y:fy*h},vector={x:foot.x-start.x,y:foot.y-start.y},len=Math.hypot(vector.x,vector.y),angle=Math.atan2(vector.y,vector.x),upper=len*.52,lower=len*.52
  const rest=twoBone(start,foot,upper,lower,i%2?-1:1),target={...foot}
  if(walk){const p=(phase+(i===0||i===3?0:.5))%1,stance=.62,amplitude=input.action==='run-start'?ease(progress):input.action==='run-stop'?1-ease(progress):1;target.x+=(p<stance?5-10*p/stance:-5+10*(p-stance)/(1-stance))/scale*(left?-1:1)*amplitude;target.y-=(p<stance?0:3*Math.sin((p-stance)/(1-stance)*Math.PI))/scale*amplitude;}
  if(!walk&&['pet','snack','groom','toy-catch','celebrate','game-turn','game-match'].includes(input.action)&&i<2)target.y-=Math.sin(t*3+i)*1.3/scale
  const actual=twoBone(start,target,upper,lower,i%2?-1:1)
  const up:Bone={name:'limb-'+i,parent:'root',...start,rotation:rest.upper},low:Bone={name:'joint-'+i,parent:up.name,x:upper,y:0,rotation:rest.lower-rest.upper},paw:Bone={name:'paw-'+i,parent:low.name,x:lower,y:0,rotation:-rest.lower}
  restBones.push(up,low,paw);bones.push({...up,rotation:actual.upper},{...low,rotation:actual.lower-actual.upper},{...paw,rotation:-actual.lower})
  // Non-rendering pole bones document the intended anatomical bend direction.
  restBones.push({name:'pole-'+i,parent:'root',x:start.x+Math.cos(angle+Math.PI/2)*len*.25,y:start.y+Math.sin(angle+Math.PI/2)*len*.25,rotation:0});bones.push({...restBones[restBones.length-1]})
 }
 const tailX=base.endsWith('left')?.85:.16,tailY=base==='sleep'?.82:base==='hang'?.89:.36
 for(let i=0;i<3;i++){const b:Bone={name:'tail-'+i,parent:'root',x:tailX*w,y:(tailY+i*.12)*h,rotation:0};restBones.push(b);bones.push({...b,rotation:Math.sin(t*1.3-i*.5)*.012});}
 let x=(150-w*scale)/2,y=142-h*scale
 if(edge){const desired=input.action.endsWith('left')?108:42;x=desired-head.x*scale;}
 if(input.attachment==='top'||input.attachment==='sit')y=(input.attachment==='top'?108:142)-h*scale
 if(base==='hang'){
  const center={x:w*.60,y:h*.04},pin={x:input.attachment==='left'?122:input.attachment==='right'?28:75,y:input.attachment==='left'||input.attachment==='right'?70:14},c=Math.cos(rotation),s=Math.sin(rotation)
  x=pin.x-(center.x*c-center.y*s)*scale;y=pin.y-(center.x*s+center.y*c)*scale
 }
 let marker:SkinPlan['marker'],markerTarget:SkinPlan['markerTarget']
 if(base==='hug'&&input.cutout&&frame.marker){
  marker=frame.marker;const box=input.cutout,ow=(marker[2]-marker[0])*scale,oh=(marker[3]-marker[1])*scale,tw=Math.min(box[2]-box[0],ow*1.08),th=Math.min(box[3]-box[1],oh*1.08)
  markerTarget=flip?[box[2]-tw,box[1],box[2],box[1]+th]:[box[0],box[1],box[0]+tw,box[1]+th]
  x=flip?markerTarget[2]+marker[0]*scale:markerTarget[0]-marker[0]*scale;y=markerTarget[1]-marker[1]*scale
 }
 return{base,frame,scale,headWidth,x,y,flip,rotation,bones,restBones,world:worldBones(bones),rest:worldBones(restBones),marker,markerTarget}
}
export function skinVertices(plan:SkinPlan){
 const{frame,rest,world}=plan,w=frame.rect[2],h=frame.rect[3],data=new Float32Array(41*49*2),radius=frame.head[2]*.24
 const influences=['head','paw-0','paw-1','paw-2','paw-3','joint-0','joint-1','joint-2','joint-3','tail-0','tail-1','tail-2']
 for(let row=0;row<49;row++)for(let col=0;col<41;col++){
  const px=col/40*w,py=row/48*h;let dx=world.root.x,dy=world.root.y,total=1
  for(const id of influences){const r=rest[id],b=world[id],head=id==='head',rad=head?frame.head[2]*.6:radius,distance=((px-r.x)**2+(py-r.y)**2)/(rad*rad),weight=Math.exp(-distance*2)*(head?6:id.startsWith('paw')?4:2)
   if(weight<.002)continue
   const angle=b.rotation-r.rotation,c=Math.cos(angle),s=Math.sin(angle),ox=px-r.x,oy=py-r.y
   dx+=(b.x-r.x+ox*c-oy*s-ox)*weight;dy+=(b.y-r.y+ox*s+oy*c-oy)*weight;total+=weight
  }
  let sx=px+clamp(dx/total,-radius*.35,radius*.35),sy=py+clamp(dy/total,-radius*.35,radius*.35)
  if(plan.marker&&plan.markerTarget){
   const m=plan.marker,target=plan.markerTarget,tx=clamp((sx-m[0])/(m[2]-m[0]),0,1),ty=clamp((sy-m[1])/(m[3]-m[1]),0,1)
   // Change the grip interval only. Outside it the anatomy translates as a
   // whole; clamping absolute positions would squash the tail into the prop.
   sx+=((target[2]-target[0])/plan.scale-(m[2]-m[0]))*tx
   sy+=((target[3]-target[1])/plan.scale-(m[3]-m[1]))*ty
  }
  const c=Math.cos(plan.rotation),s=Math.sin(plan.rotation),xx=plan.flip?-sx:sx,index=(row*41+col)*2
  data[index]=plan.x+(xx*c-sy*s)*plan.scale;data[index+1]=plan.y+(xx*s+sy*c)*plan.scale
 }return data
}
