export const PET_VIEWPORT_RATIO=1.5
export const PET_PEEK_RATIO=.55
export const PET_BALL_SIZE=43
export const petViewport=(size:number)=>Math.ceil(size*PET_VIEWPORT_RATIO)
export const petMovementMargin=(size:number)=>Math.round(Math.min(10,size*.125))
/** Keep the real desktop icon visible and clickable inside the actor's alpha region. */
export function clearIconPicture(ctx:Pick<CanvasRenderingContext2D,'clearRect'>,box?:[number,number,number,number]|null){
 if(box&&box.every(Number.isFinite)&&box[2]>box[0]&&box[3]>box[1])ctx.clearRect(box[0],box[1],box[2]-box[0],box[3]-box[1])
}
export interface PoseGeometry {rect:[number,number,number,number];basis:number;anchorY?:number;offsetX?:number;offsetY?:number;drawScale?:number;alphaBounds?:[number,number,number,number];gripSide?:'left'|'right';peekTop?:number;contact?:[number,number];objectBox?:[number,number,number,number]}
/** Keep the same character ruler; reserve space instead of shrinking a wide pose. */
export function posePlacement(frame:PoseGeometry,size:number,viewport=petViewport(size)){
 const scale=size/frame.basis*(frame.drawScale??1),w=frame.rect[2]*scale,h=frame.rect[3]*scale,baseline=viewport-size*.08
 let x=(viewport-w)/2+(frame.offsetX??0)*scale,y=baseline-(frame.anchorY??frame.rect[3])*scale+(frame.offsetY??0)*scale
 if(frame.gripSide&&frame.alphaBounds){
  const box=frame.alphaBounds,travel=viewport*(1-PET_PEEK_RATIO),width=(box[2]-box[0])*scale
  const margin=petMovementMargin(size)
  const left=frame.gripSide==='left'?travel+margin+2:viewport-travel-width-margin-2
  x=left-box[0]*scale
  const top=Math.min(baseline+size*(frame.peekTop??-.8),viewport-2-Math.min(6,margin)-(box[3]-box[1])*scale)
  y=top-box[1]*scale
 }
 return{x,y,w,h,scale,viewport}
}
