import {invoke} from '@tauri-apps/api/core'
const svgs=new Map<string,Promise<HTMLImageElement>>(),tickets=new WeakMap<HTMLCanvasElement,number>()
function svgImage(svg:SVGSVGElement){
 const copy=svg.cloneNode(true)as SVGSVGElement;copy.setAttribute('xmlns','http://www.w3.org/2000/svg');const bounds=svg.getBoundingClientRect();copy.setAttribute('width',String(bounds.width));copy.setAttribute('height',String(bounds.height))
 // Preserve the material colors when SVG is decoded outside its document.
 const originals=Array.from(svg.querySelectorAll('path')),paths=Array.from(copy.querySelectorAll('path'))
 paths.forEach((p,i)=>{const c=getComputedStyle(originals[i]);p.setAttribute('fill',c.fill);p.setAttribute('stroke',c.stroke);p.setAttribute('stroke-width',c.strokeWidth)})
 const source=new XMLSerializer().serializeToString(copy)
 let job=svgs.get(source);if(!job){job=new Promise<HTMLImageElement>((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(source)});svgs.set(source,job)}
 return job
}
type Mask={width:number;height:number;spans:number[][]}
let pending:Mask|null=null,sending=false,lastFingerprint=''
function queueMask(mask:Mask){
 // Keep one request in flight; old animation frames must not flood native IPC.
 pending=mask
 if(sending)return
 const flush=async()=>{
  sending=true
  try{
   while(pending){
    const next:Mask=pending;pending=null
    const fingerprint=JSON.stringify(next)
    if(fingerprint===lastFingerprint)continue
    try{await invoke('set_companion_hit_mask',next);lastFingerprint=fingerprint}catch{lastFingerprint=''}
   }
  }finally{sending=false}
 }
 void flush()
}
export async function postPetHitMask(canvas:HTMLCanvasElement){
 const root=canvas.closest('button');if(!root||!canvas.width)return
 const ticket=(tickets.get(canvas)??0)+1;tickets.set(canvas,ticket)
 const svgNodes=Array.from(root.querySelectorAll<SVGSVGElement>('.xm-pet-environment svg'))
 const decoded=await Promise.all(svgNodes.map(svgImage)).catch(()=>[])
 if(tickets.get(canvas)!==ticket||!root.isConnected)return
 const box=root.getBoundingClientRect();if(!box.width||!box.height)return
 const width=canvas.width,height=canvas.height,target=document.createElement('canvas');target.width=width;target.height=height
 const ctx=target.getContext('2d')!;const place=(node:Element)=>{const r=node.getBoundingClientRect();return[(r.left-box.left)/box.width*width,(r.top-box.top)/box.height*height,r.width/box.width*width,r.height/box.height*height]as const}
 for(const source of Array.from(root.querySelectorAll('canvas'))){if(source.closest('[data-pet-source-hidden="true"]'))continue;const[x,y,w,h]=place(source);ctx.drawImage(source,x,y,w,h)}
 svgNodes.forEach((node,i)=>{if(decoded[i]){const[x,y,w,h]=place(node);ctx.drawImage(decoded[i],x,y,w,h)}})
 for(const node of Array.from(root.querySelectorAll<HTMLElement>('.xm-pet-local-flakes i'))){
 const[x,y,w,h]=place(node);ctx.fillStyle='#ecf6ff';ctx.font=Math.max(6,h)+'px sans-serif';ctx.fillText(node.textContent??'',x,y+h*.85,w)
 }
 const data=ctx.getImageData(0,0,width,height).data,spans:number[][]=[]
 for(let y=0;y<height;y++){let start=-1;for(let x=0;x<=width;x++){const solid=x<width&&data[(y*width+x)*4+3]>32;if(solid&&start<0)start=x;else if(!solid&&start>=0){spans.push([y,start,x-start]);start=-1}}}
 queueMask({width,height,spans})
}
