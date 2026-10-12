import type {PoseGeometry} from './petGeometry'
export type PerchMode='top'|'top-hang'|'left'|'right'|'bottom'|'icon'|'icon-left'|'sit'
export const perchKind=(mode:string)=>mode.startsWith('icon')?'icon':mode==='left'||mode==='right'?'side':mode==='top-hang'?'bottom':mode
export function perchPin(mode:string,size:number){
 return {x:size*(mode==='left'?1.22:mode==='icon-left'?1.1:mode==='right'?.28:mode==='icon'?.4:.75),y:size*(mode==='top'?1.08:mode==='bottom'||mode==='top-hang'?.14:mode.startsWith('icon')?.95:.70)}
}
export function perchPlacement(frame:PoseGeometry,size:number,mode:string,flip:boolean,iconBox?:[number,number,number,number]|null){
 if(mode.startsWith('icon')&&frame.objectBox&&iconBox){
  const box=frame.objectBox,scale=Math.min((iconBox[2]-iconBox[0])/(box[2]-box[0]),size/frame.basis*(frame.drawScale??1)*1.08),w=frame.rect[2]*scale,h=frame.rect[3]*scale
  // A large icon is hugged at its near top corner, without inflating the fox.
  // Seat both paws inside rounded edges; translate the intact pose, never resize it.
  const press=Math.min(3,size*.02,(iconBox[2]-iconBox[0])*.045)
  return{x:(flip?iconBox[2]-w+box[0]*scale:iconBox[0]-box[0]*scale)+(flip?-press:press),y:iconBox[1]-box[1]*scale+press,w,h,scale}
 }
 const scale=size/frame.basis*(frame.drawScale??1),w=frame.rect[2]*scale,h=frame.rect[3]*scale
 const contact=frame.contact??[frame.rect[2]/2,frame.rect[3]],pin=perchPin(mode,size)
 return {x:pin.x-(flip?w-contact[0]*scale:contact[0]*scale),y:pin.y-contact[1]*scale,w,h,scale}
}
