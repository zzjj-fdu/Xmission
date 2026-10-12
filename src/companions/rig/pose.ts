import{twoBone,worldBones,ease,mix,angleMix,type Bone,type Point}from'./math'
export const PANDA_ACTIONS=['idle','walk','run','run-start','run-stop','sit','stretch','focus','remind','celebrate','sleep','depart','return','rain','wind','snow','night','lifted','respond','attention','pet','groom','lift','land','bag-open','bag-close','book-open','book-close','sleep-down','wake','tail','milestone','adjust-scarf','daily','snack','keepsake','read-habit','game-turn','game-wait','game-match','game-miss','dock-left','dock-right','edge-left','edge-right','undock-left','undock-right','window-hang','toy-catch']as const
export type PandaAction=typeof PANDA_ACTIONS[number]
export interface RigPart{ id:string;asset:string;x:number;y:number;width:number;height:number;rotation:number;alpha:number;z:number;counterFlip?:boolean }
export interface PandaPose{parts:RigPart[];bones:Bone[];contacts:Array<Point&{hand:string}>;flip:boolean;headWidth:number;tailCurve:Point[]}
export interface PoseInput{action:PandaAction;direction?:'left'|'right'|'front';timeMs:number;attachment?:string;cutout?:[number,number,number,number]|null;attachmentPhase?:'enter'|'hold'|'leave';durationMs?:number;outfit?:'theme'|'scarf'|'none';pixel?:boolean;scarfMotion?:boolean;scarfOnly?:boolean}
/** Model units share a fixed 100-unit ruler in a 150-unit desktop viewport. */
function steadyPose(input:PoseInput):PandaPose{
 const{action,direction='right',timeMs,attachment,cutout,outfit='theme'}=input,t=Math.max(0,timeMs)/1000
 const phase=t/(/run/.test(action)?.48:.92)%1,breath=Math.sin(t*1.7),beat=Math.sin(t*4.2)
 const running=/^run/.test(action),walking=action==='walk'||running,asleep=['sleep','sleep-down'].includes(action),reading=['focus','read-habit','book-open','book-close'].includes(action)
 const sitting=reading||asleep||['sit','snack','keepsake','game-wait','night'].includes(action)||!!attachment
 const hanging=attachment==='bottom'||attachment==='top-hang'||action==='window-hang',edge=/^(edge|dock|undock)-/.test(action)
 let flip=attachment?['right','icon'].includes(attachment):direction==='left'
 if(edge)flip=action.endsWith('right')
 const bones:Bone[]=[],parts:RigPart[]=[],contacts:PandaPose['contacts']=[]
 const bone=(name:string,x:number,y:number,rotation=0,parent?:string)=>bones.push({name,x,y,rotation,parent})
 const part=(id:string,asset:string,x:number,y:number,width:number,height:number,z:number,rotation=0,alpha=1,counterFlip=false)=>parts.push({id,asset,x,y,width,height,z,rotation,alpha,counterFlip})
 let cx=75,cy=walking?113:sitting?112:106,headX=walking?103:78,headY=walking?98:sitting?86:73
 let torsoW=walking?58:sitting?43:42,torsoH=walking?33:sitting?38:44,bodyRotation=walking?.035*beat:.012*breath,headRotation=.025*Math.sin(t*.8)
 let ground=walking?138:141,book=reading,held=['keepsake','return','remind'].includes(action),lift=0
 if(action==='attention'||action==='respond'){headRotation=.11*Math.sin(t*2);headX+=2*Math.sin(t);}
 if(action==='game-miss'){headRotation=-.13+.025*beat;headY+=2;}
 if(action==='depart'){headRotation=-.05;bodyRotation=.04*Math.sin(t*2);}
 if(action==='stretch'){torsoH+=7*ease(Math.sin(t)*.5+.5);headY-=4;bodyRotation=.1*Math.sin(t);}
 if(action==='pet'){headRotation=.08*Math.sin(t*3);headY+=2;}
 if(action==='groom'){bodyRotation=.03*Math.sin(t*3);headRotation=-.08;}
 if(action==='snow'){headY-=2*Math.max(0,beat);headRotation=.11*Math.sin(t*2);}
 if(action==='wind'){bodyRotation=.06*Math.sin(t*7);headRotation=-.08;}
 if(action==='rain'){headY+=2;headRotation=-.09;}
 if(['celebrate','milestone','game-match'].includes(action)){lift=4*Math.abs(Math.sin(t*4));headRotation=.045*beat;}
 if(['lift','lifted'].includes(action)){lift=action==='lift'?8*ease(t/.65):8;torsoH+=3;headRotation=.08*Math.sin(t*2);}
 if(action==='land'){lift=5*(1-ease(t/.55));torsoH-=4*Math.sin(Math.min(1,t/.55)*Math.PI);}
 if(asleep){headX=89;headY=119;torsoW=43;torsoH=30;cy=126;headRotation=.16;}
 if(action==='wake'){const q=ease(t/1.8);headX=mix(89,78,q);headY=mix(119,73,q);cy=mix(126,106,q);torsoW=mix(43,34,q);torsoH=mix(30,46,q);}
 if(hanging){cy=69;headY=94;bodyRotation=Math.PI;headRotation=.08*Math.sin(t*1.5);ground=111;}
 if(edge){cx=112;cy=119;headX=cx+4;headY=91;torsoW=33;torsoH=36;}
 let topTarget:Point|undefined,frontTarget:Point|undefined
 if(attachment?.startsWith('icon')&&cutout){
  // Solve in mirrored model space; the real icon stays in its original native position.
  const box=flip?[150-cutout[2],cutout[1],150-cutout[0],cutout[3]]:cutout
  const w=box[2]-box[0],h=box[3]-box[1],press=Math.min(3,2,w*.045)
  cx=box[0]-17;cy=box[1]+Math.min(h*.6,24);headX=cx+2;headY=box[1]-13;ground=cy+26;torsoW=34;torsoH=37
  topTarget={x:box[0]+Math.min(12,w*.3),y:box[1]+press};frontTarget={x:box[0]+press,y:box[1]+Math.min(h*.62,36)}
 }
 if(attachment&&!attachment.startsWith('icon')){
  const pin={x:attachment==='left'?122:attachment==='right'?28:75,y:attachment==='sit'?142:attachment==='top'?108:attachment==='bottom'||attachment==='top-hang'?14:70}
  if(hanging){cx=pin.x;cy=pin.y+30;headX=cx+3;headY=cy+26;ground=cy+58;topTarget={x:cx-13,y:pin.y};frontTarget={x:cx+13,y:pin.y};}
  else if(attachment==='left'||attachment==='right'){cx=attachment==='left'?pin.x-25:150-pin.x-25;cy=95;headX=cx+5;headY=69;topTarget={x:cx+25,y:pin.y-14};frontTarget={x:cx+25,y:pin.y+14};ground=128;}
  else{cy=pin.y-23;headY=pin.y-49;cx=75;headX=78;ground=pin.y;topTarget={x:cx+20,y:pin.y+1};frontTarget={x:cx-16,y:pin.y+1};}
 }
 cy-=lift;headY-=lift;ground-=lift
 bone('root',cx,cy,bodyRotation);bone('torso',0,0,0,'root');bone('hip',-10,12,0,'root');bone('neck',headX-cx,headY-cy,headRotation-bodyRotation,'root');bone('head',0,0,0,'neck');bone('ear-left',-16,-15,.04*Math.sin(t*2),'head');bone('ear-right',16,-15,.04*Math.sin(t*2+.5),'head')
 const tailCurl=asleep?1:action==='tail'||action==='groom'?.5:0
 bone('tail-base',-torsoW*.38,torsoH*.18,-1.75+.08*breath+tailCurl*.85,'root')
 bone('tail-middle',21,0,-.35+.10*Math.sin(t*1.5-.5)+tailCurl*.55,'tail-base')
 bone('tail-tip',20,0,-.3+.13*Math.sin(t*1.5-1)+tailCurl*.6,'tail-middle')
 const bodyWorld=worldBones(bones)
 const tb=bodyWorld['tail-tip'],tailCurve=[bodyWorld['tail-base'],bodyWorld['tail-middle'],tb,{x:tb.x+Math.cos(tb.rotation)*17,y:tb.y+Math.sin(tb.rotation)*17}].map(p=>({x:p.x,y:p.y}))
 const tailLeft=Math.min(...tailCurve.map(p=>p.x))-16,tailRight=Math.max(...tailCurve.map(p=>p.x))+16,tailTop=Math.min(...tailCurve.map(p=>p.y))-16,tailBottom=Math.max(...tailCurve.map(p=>p.y))+16
 part('tail','tail-base',(tailLeft+tailRight)/2,(tailTop+tailBottom)/2,tailRight-tailLeft,tailBottom-tailTop,asleep?13:0)
 part('torso',walking?'body-quad':'body',cx,cy,torsoW,torsoH,5,bodyRotation)
 const foreRoot={x:walking?93:cx+12,y:walking?117:cy+3},farRoot=attachment?.startsWith('icon')?{x:cx+8,y:cy-8}:attachment==='left'||attachment==='right'?{x:cx+9,y:cy-19}:{x:walking?88:cx-9,y:walking?115:cy+2}
 const locomotionFoot=(base:number,offset:number):Point=>{const p=(phase+offset)%1,stance=.62;if(p<stance)return{x:base+6-12*p/stance,y:ground};const swing=(p-stance)/(1-stance);return{x:base-6+12*ease(swing),y:ground-(running?8:5)*Math.sin(swing*Math.PI)}}
 const limb=(id:string,root:Point,target:Point,fore:boolean,z:number,bend:number)=>{
  const upper=fore?(attachment?18:walking?14:12):(walking?12:14),lower=fore?(attachment?18:walking?14:10):(walking?12:10),solution=twoBone(root,target,upper,lower,bend)
  const dx=root.x-cx,dy=root.y-cy,c=Math.cos(bodyRotation),s=Math.sin(bodyRotation)
  bone(id+'-upper',dx*c+dy*s,-dx*s+dy*c,solution.upper-bodyRotation,'root');bone(id+'-lower',upper,0,solution.lower-solution.upper,id+'-upper');bone(id+'-paw',lower,0,-solution.lower,id+'-lower')
  const world=worldBones(bones),elbow=world[id+'-lower'],end=world[id+'-paw']
  part(id+'-upper',fore?'fore-upper':'hind-upper',(root.x+elbow.x)/2,(root.y+elbow.y)/2,fore?14:16,upper+5,z,solution.upper-Math.PI/2)
  part(id+'-lower',fore?'fore-lower':'hind-lower',(elbow.x+end.x)/2,(elbow.y+end.y)/2,fore?12:13,lower+5,z+.1,solution.lower-Math.PI/2)
  part(id,fore?'fore-paw':'hind-paw',end.x,end.y,fore?12:14,fore?10:10,z+.2)
  return end
 }
 const backX=walking?49:cx-12
 limb('hind-far',{x:backX+4,y:cy+(walking?5:9)},walking?locomotionFoot(backX+2,.5):{x:cx-12,y:ground},false,3,-1)
 limb('hind-near',{x:backX,y:cy+(walking?7:12)},walking?locomotionFoot(backX,0):{x:cx-5,y:ground},false,7,-1)
 let nearGoal=walking?locomotionFoot(100,.5):{x:cx+22,y:cy+10},farGoal=walking?locomotionFoot(95,0):{x:cx-21,y:cy+9}
 if(reading){nearGoal={x:cx+13,y:cy+17};farGoal={x:cx-12,y:cy+14};}
 if(asleep){nearGoal={x:cx+17,y:cy+11};farGoal={x:cx+2,y:cy+9};}
 if(['snack','keepsake','bag-open','bag-close','remind','return'].includes(action)){nearGoal={x:cx+7,y:cy-9+beat};farGoal={x:cx-2,y:cy-7};}
 if(action==='depart'){nearGoal={x:cx-6,y:cy+12};farGoal={x:cx-14,y:cy+14};}
 if(['celebrate','milestone','game-match','toy-catch','game-turn'].includes(action)){nearGoal={x:cx+26,y:cy-18};farGoal={x:cx-23,y:cy-16+beat*2};}
 if(action==='adjust-scarf'){nearGoal={x:headX+6,y:headY+17};}
 if(topTarget)farGoal=topTarget
 if(frontTarget)nearGoal=frontTarget
 // Both hands use the same real IK endpoints as the rendered paws.
 const far=limb('paw-far',farRoot,farGoal,true,4,1),near=limb('paw-near',foreRoot,nearGoal,true,10,-1)
 if(topTarget)contacts.push({...far,hand:'paw-far'})
 if(frontTarget)contacts.push({...near,hand:'paw-near'})
 let headAsset=direction==='front'&&!walking?'head-front':direction==='left'?'head-left':'head-open'
 if(asleep)headAsset='head-sleep'
 else if(['pet','snack','celebrate','game-match','milestone','return'].includes(action))headAsset='head-happy'
 else if((t%5.7)>5.52)headAsset='head-blink'
 part('head',headAsset,headX,headY,56,48,11,headRotation,1,headAsset==='head-left')
 const garmentX=cx,garmentY=cy-3
 if(outfit==='theme')part('vest',walking?'vest-quad':'vest',garmentX,garmentY,torsoW+3,torsoH*.86,8,bodyRotation)
 if(outfit==='scarf')part('scarf','scarf',headX,headY+19,31,18,12,bodyRotation)
 if(outfit!=='none'){part('pendant','pendant',cx+4,cy-4,10,14,9,.035*Math.sin(t*2));part('satchel','satchel',cx-13,cy+11,19,23,9,.04*beat);}
 if(book)part('book','book',cx,cy+18,34,22,9,.03*breath)
 if(held)part('keepsake','pendant',cx+2,cy-11,17,23,9,.03*beat)
 for(const[name,x,y]of[['vest',garmentX,garmentY],['scarf',headX,headY+19],['satchel',cx-13,cy+11],['pendant',cx+4,cy-4],['book',cx,cy+18]]as const)bone(name,x-cx,y-cy,0,'root')
 if(input.pixel)for(const p of parts){p.x=Math.round(p.x*2)/2;p.y=Math.round(p.y*2)/2;p.rotation=Math.round(p.rotation*36)/36;}
 if(flip){for(const c of contacts)c.x=150-c.x;}
 // Public coordinates describe the rendered viewport, while flip is used by the renderer.
 if(flip)for(const p of parts){p.x=150-p.x;p.rotation=-p.rotation;}
 if(flip)for(const p of tailCurve)p.x=150-p.x
 return{parts:parts.sort((a,b)=>a.z-b.z),bones,contacts,flip,headWidth:56,tailCurve}
}
/** Blend local limb positions, not two complete silhouettes. Attachments remain locked. */
export function blendPandaPoses(from:PandaPose,to:PandaPose,t:number):PandaPose{
 const q=ease(t),old=new Map(from.parts.map(p=>[p.id,p])),next=new Set(to.parts.map(p=>p.id))
 const parts=to.parts.map(p=>{const o=old.get(p.id);if(!o)return{...p,alpha:p.alpha*q};return{...p,x:mix(o.x,p.x,q),y:mix(o.y,p.y,q),rotation:angleMix(o.rotation,p.rotation,q),width:mix(o.width,p.width,q),height:mix(o.height,p.height,q)}})
 for(const p of from.parts)if(!next.has(p.id)&&q<1)parts.push({...p,alpha:p.alpha*(1-q)})
 const contacts=to.contacts.map(c=>{const p=parts.find(p=>p.id===c.hand)!;return{...c,x:p.x,y:p.y}})
 const tailCurve=to.tailCurve.map((p,i)=>({x:mix(from.tailCurve[i].x,p.x,q),y:mix(from.tailCurve[i].y,p.y,q)}))
 return{...to,parts:parts.sort((a,b)=>a.z-b.z),contacts,tailCurve}
}
/** Explicit action clips keep entry, hold and exit separate from idle micro-motion. */
export function samplePandaPose(input:PoseInput):PandaPose{
 const full=steadyPose(input),clean={...input,attachment:undefined,cutout:null,attachmentPhase:undefined}
 const progress=(fallback:number)=>input.timeMs/(input.durationMs||fallback)
 if(input.attachment&&input.attachmentPhase&&input.attachmentPhase!=='hold'){
  const base=steadyPose({...clean,action:'idle',direction:full.flip?'left':'right'})
  return input.attachmentPhase==='enter'?blendPandaPoses(base,full,progress(440)):blendPandaPoses(full,base,progress(440))
 }
 if(input.action==='sleep-down')return blendPandaPoses(steadyPose({...clean,action:'idle'}),full,progress(1800))
 if(input.action==='book-open')return blendPandaPoses(steadyPose({...clean,action:'idle'}),full,progress(1200))
 if(input.action==='book-close')return blendPandaPoses(full,steadyPose({...clean,action:'idle'}),progress(1000))
 if(input.action==='run-start')return blendPandaPoses(steadyPose({...clean,action:'idle'}),full,progress(320))
 if(input.action==='run-stop')return blendPandaPoses(full,steadyPose({...clean,action:'idle'}),progress(240))
 if(input.action.startsWith('dock-')||input.action.startsWith('undock-')){
  const base=steadyPose({...clean,action:'idle',direction:full.flip?'left':'right'})
  return input.action.startsWith('dock-')?blendPandaPoses(base,full,progress(280)):blendPandaPoses(full,base,progress(280))
 }
 return full
}
