from pathlib import Path
import json,math
import numpy as np
from PIL import Image

def sprite(frame):
    image=Image.open((Path(__file__).resolve().parent.parent/'public/pets/fox')/frame['source']).convert('RGBA')
    x,y,w,h=frame['rect'];pixels=np.array(image.crop((x,y,x+w,y+h)))
    keep=np.zeros((h,w),dtype=bool)
    for row,*runs in frame['mask']:
        for i in range(0,len(runs),2):keep[row,runs[i]:runs[i]+runs[i+1]]=True
    pixels[:,:,3]=np.where(keep,pixels[:,:,3],0)
    return pixels

def head(frame):
    px=sprite(frame);a=px[:,:,3]>128;r,g,b=px[:,:,:3].astype(float).transpose(2,0,1)
    orange=a&(r>110)&(r>g*1.5)&(r>b*1.7)
    visited=np.zeros(orange.shape,dtype=bool);height,width=orange.shape;groups=[]
    for y,x in zip(*np.where(orange)):
        if visited[y,x]:continue
        pending=[(int(x),int(y))];visited[y,x]=True;coords=[]
        while pending:
            xx,yy=pending.pop();coords.append((xx,yy))
            for dx,dy in ((-1,0),(1,0),(0,-1),(0,1)):
                nx,ny=xx+dx,yy+dy
                if 0<=nx<width and 0<=ny<height and orange[ny,nx] and not visited[ny,nx]:visited[ny,nx]=True;pending.append((nx,ny))
        if len(coords)>60:
            xs,ys=zip(*coords);box=(min(xs),min(ys),max(xs)+1,max(ys)+1)
            groups.append((len(coords)*(height-(box[1]+box[3])/2)**2,box))
    box=max(groups)[1];return box,math.sqrt((box[2]-box[0])*(box[3]-box[1]))

if __name__=='__main__':
    for theme in ('jrpg','journal','island','farm'):
        data=json.loads(((Path(__file__).resolve().parent.parent/'public/pets/fox')/(theme+'.json')).read_text())
        print(theme)
        for action in ('idle','attention','book-open','adjust-scarf','daily','snack','snow','edge-left','edge-right'):
            f=data['actions'][action][0];box,span=head(f)
            print(action,'basis',f['basis'],'head',box,'span',round(span,2))

