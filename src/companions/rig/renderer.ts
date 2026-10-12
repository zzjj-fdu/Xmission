import'pixi.js/unsafe-eval'
import{autoDetectRenderer,Container,Rectangle,Sprite,Texture,MeshPlane,type Renderer}from'pixi.js'
import type{ThemeKey}from'../../themes'
import type{PoseInput}from'./pose'
import{skinPlan,skinVertices,type SkinAtlas,type SkinPlan}from'./skin'
import{hybridFrame,type HybridAtlas}from'./hybrid'
export const PANDA_REVISION='red-panda-hybrid-v4-body-only'
const skins:Record<ThemeKey,string>={'pixel-jrpg':'jrpg','parchment-journal':'journal','animal-crossing':'island','stardew-valley':'farm'}
interface LoadedHybrid{data:HybridAtlas;walk:Texture[];run:Texture[]}
interface LoadedAtlas{textures:Record<string,Texture>;data:SkinAtlas;pixel:boolean;hybrid?:LoadedHybrid}
const atlasCache=new Map<string,Promise<LoadedAtlas>>()
let rendererPromise:Promise<Renderer>|undefined
export function pandaRenderer(){
 if(!rendererPromise)rendererPromise=autoDetectRenderer({width:512,height:512,resolution:1,backgroundAlpha:0,preference:'webgl',antialias:true,preserveDrawingBuffer:true}).catch(e=>{rendererPromise=undefined;throw e})
 return rendererPromise
}
async function imageAt(url:string){return new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('小熊猫原画加载失败'));img.src=url})}
export function loadPandaAtlas(theme:ThemeKey,outfit:'theme'|'scarf'|'none'='theme'):Promise<LoadedAtlas>{
 const skin=skins[theme],key=skin+(outfit==='theme'?'':'-bare');let job=atlasCache.get(key)
 if(!job){job=(async()=>{
  const root=import.meta.env.BASE_URL+'pets/red-panda/',response=await fetch(root+key+'-skin.json?v='+PANDA_REVISION);if(!response.ok)throw new Error('小熊猫完整体型清单加载失败')
  const data=await response.json()as SkinAtlas;if(!/^[a-z-]+\.png$/.test(data.image))throw new Error('小熊猫原画路径无效')
  const image=await imageAt(root+data.image+'?v='+PANDA_REVISION),pixel=theme==='pixel-jrpg'||theme==='stardew-valley',textures:Record<string,Texture>={}
  for(const[name,frame]of Object.entries(data.bases)){
   const[x,y,w,h]=frame.rect;if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0||x<0||y<0||x+w>image.width||y+h>image.height)throw new Error('小熊猫姿势范围无效')
   const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,x,y,w,h,0,0,w,h)
   if(frame.mask.length){const mask=document.createElement('canvas');mask.width=w;mask.height=h;const mc=mask.getContext('2d')!;mc.fillStyle='#fff';for(const[row,...runs]of frame.mask)for(let i=0;i<runs.length;i+=2)mc.fillRect(runs[i],row,runs[i+1],1);ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0);ctx.globalCompositeOperation='source-over'}
   const texture=Texture.from(canvas);texture.source.scaleMode=pixel?'nearest':'linear';textures[name]=texture
  }
  let hybrid:LoadedHybrid|undefined
  if(outfit==='theme'){
   const r=await fetch(root+skin+'-hybrid-v3.json?v='+PANDA_REVISION);if(!r.ok)throw new Error('小熊猫混合动作清单加载失败')
   const h=await r.json()as HybridAtlas
   const[walking,running]=await Promise.all([imageAt(root+h.walk.image+'?v='+PANDA_REVISION),imageAt(root+h.run.image+'?v='+PANDA_REVISION)])
   const slice=(im:HTMLImageElement,rect:[number,number,number,number],runs?:number[][])=>{const[x,y,w,h]=rect;if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0||x<0||y<0||x+w>im.width||y+h>im.height)throw new Error('小熊猫动作范围无效');if(runs?.length){const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d')!;ctx.drawImage(im,x,y,w,h,0,0,w,h);const mask=document.createElement('canvas');mask.width=w;mask.height=h;const mc=mask.getContext('2d')!;mc.fillStyle='#fff';for(const[row,...rowRuns]of runs)for(let i=0;i<rowRuns.length;i+=2)mc.fillRect(rowRuns[i],row,rowRuns[i+1],1);ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0);const texture=Texture.from(canvas);texture.source.scaleMode=pixel?'nearest':'linear';return texture}const source=Texture.from(im).source;source.scaleMode=pixel?'nearest':'linear';return new Texture({source,frame:new Rectangle(...rect)})}
   hybrid={data:h,walk:h.walk.frames.map(f=>slice(walking,f.rect,f.mask)),run:h.run.frames.map(f=>slice(running,f.rect,f.mask))}
  }
  return{textures,data,pixel,hybrid}
 })().catch(e=>{atlasCache.delete(key);throw e});atlasCache.set(key,job)}return job
}
/** Complete silhouettes are skinned; anatomy is never assembled from disconnected shafts. */
export class PandaDrawing{
 readonly stage=new Container();private meshes=new Map<string,MeshPlane>();private current='';private previous='';private changedAt=0
 private whole?:Sprite
 constructor(private atlas:LoadedAtlas){}
 draw(input:PoseInput,scale:number,animateTransition=true):SkinPlan{
  const plan=skinPlan(this.atlas.data,input),h=this.atlas.hybrid,locomotion=input.action==='walk'||input.action.startsWith('run')
  this.stage.scale.set(scale)
  if(h&&locomotion&&!input.attachment){
   for(const mesh of this.meshes.values())mesh.visible=false
   const p=hybridFrame(h.data,input,animateTransition||input.timeMs>0),frames=input.action.startsWith('run')?h.run:h.walk
   if(!this.whole){this.whole=new Sprite(frames[0]);this.stage.addChild(this.whole)}
   this.whole.visible=true;this.whole.texture=frames[p.index];this.whole.position.set(p.flip?150-p.x:p.x,p.y);this.whole.scale.set(p.flip?-p.scale:p.scale,p.scale)
   this.current='';this.previous='';return plan
  }
  if(this.whole)this.whole.visible=false
  const texture=this.atlas.textures[plan.base];let mesh=this.meshes.get(plan.base)
  if(!mesh){mesh=new MeshPlane({texture,verticesX:41,verticesY:49});mesh.autoResize=false;this.meshes.set(plan.base,mesh);this.stage.addChild(mesh)}
  if(this.current!==plan.base){this.previous=this.current;this.current=plan.base;this.changedAt=performance.now()}
  const q=animateTransition?Math.min(1,(performance.now()-this.changedAt)/240):1
  for(const[name,other]of this.meshes){other.visible=name===plan.base||q<1&&name===this.previous;other.alpha=name===plan.base?(this.previous?q:1):1-q}
  const buffer=mesh.geometry.getAttribute('aPosition').buffer;buffer.data.set(skinVertices(plan));buffer.update()
  return plan
 }
 destroy(){this.stage.destroy({children:true,texture:false,textureSource:false});this.meshes.clear()}
}
