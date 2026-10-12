import type { FoxAction,PetPreferences,PetTrip } from './types'
import type { ScenePhase } from '../scenes'
import type { SceneWeather } from '../store/sceneWeather'
export const FOX_ACTIONS:Record<FoxAction,{label:string;row:number;column:number;frameMs:number;duration:number}>={
 idle:{label:'待机',row:0,column:0,frameMs:600,duration:0},
 walk:{label:'走路',row:0,column:4,frameMs:120,duration:1920},
 run:{label:'追小玩具',row:0,column:0,frameMs:70,duration:0},
 'run-start':{label:'准备追跑',row:0,column:0,frameMs:160,duration:320},
 'run-stop':{label:'轻轻停稳',row:0,column:0,frameMs:120,duration:240},
 sit:{label:'坐下',row:1,column:0,frameMs:450,duration:6000},
 stretch:{label:'伸懒腰',row:1,column:4,frameMs:350,duration:2800},
 focus:{label:'专注',row:2,column:0,frameMs:850,duration:0},
 remind:{label:'提醒',row:2,column:4,frameMs:450,duration:10000},
 celebrate:{label:'庆祝',row:3,column:0,frameMs:230,duration:1900},
 sleep:{label:'睡觉',row:3,column:4,frameMs:1000,duration:0},
 depart:{label:'出发',row:4,column:0,frameMs:430,duration:2200},
 return:{label:'归来',row:4,column:4,frameMs:600,duration:4800},
 rain:{label:'撑伞',row:5,column:0,frameMs:800,duration:0},
 wind:{label:'风天',row:5,column:4,frameMs:350,duration:0},
 snow:{label:'看雪',row:6,column:0,frameMs:850,duration:0},
 night:{label:'夜灯',row:6,column:4,frameMs:1000,duration:0},
 lifted:{label:'提起',row:7,column:0,frameMs:500,duration:0},
 respond:{label:'回应',row:7,column:4,frameMs:400,duration:2400},
 attention:{label:'注意你',row:0,column:0,frameMs:240,duration:960},
 pet:{label:'摸摸头',row:0,column:0,frameMs:400,duration:1600},
 groom:{label:'梳梳毛',row:0,column:0,frameMs:450,duration:1800},
 lift:{label:'收拢爪子',row:0,column:0,frameMs:160,duration:640},
 land:{label:'轻轻落地',row:0,column:0,frameMs:200,duration:800},
 'bag-open':{label:'取出纸条',row:0,column:0,frameMs:350,duration:1400},
 'bag-close':{label:'收好行囊',row:0,column:0,frameMs:300,duration:1200},
 'book-open':{label:'翻开书',row:0,column:0,frameMs:300,duration:1200},
 'book-close':{label:'合好书',row:0,column:0,frameMs:250,duration:1000},
 'sleep-down':{label:'准备睡觉',row:0,column:0,frameMs:450,duration:1800},
 wake:{label:'醒来舒展',row:0,column:0,frameMs:350,duration:1400},
 tail:{label:'看看尾巴',row:0,column:0,frameMs:350,duration:1400},
 'adjust-scarf':{label:'整理围巾',row:0,column:0,frameMs:240,duration:1200},
 milestone:{label:'主线完成',row:0,column:0,frameMs:230,duration:2800},
 daily:{label:'主题小日常',row:0,column:0,frameMs:500,duration:3500},
 snack:{label:'接住小点心',row:0,column:0,frameMs:500,duration:3400},
 keepsake:{label:'看看纪念物',row:0,column:0,frameMs:700,duration:2600},
 'read-habit':{label:'翻翻书签',row:0,column:0,frameMs:800,duration:8000},
 'game-turn':{label:'一起翻牌',row:0,column:0,frameMs:320,duration:650},
 'game-wait':{label:'记住这张卡',row:0,column:0,frameMs:1600,duration:1600},
 'game-match':{label:'找到一对',row:0,column:0,frameMs:500,duration:1800},
 'game-miss':{label:'再看看卡片',row:0,column:0,frameMs:500,duration:1500},
 'dock-left':{label:'躲到左边',row:0,column:0,frameMs:70,duration:280},
 'dock-right':{label:'躲到右边',row:0,column:0,frameMs:70,duration:280},
 'edge-left':{label:'左边探头',row:0,column:0,frameMs:1600,duration:0},
 'edge-right':{label:'右边探头',row:0,column:0,frameMs:1600,duration:0},
 'undock-left':{label:'从左边出来',row:0,column:0,frameMs:70,duration:280},
 'undock-right':{label:'从右边出来',row:0,column:0,frameMs:70,duration:280},
 'window-hang':{label:'挂在窗沿',row:0,column:0,frameMs:1000,duration:0},
 'toy-catch':{label:'接住小玩具',row:0,column:0,frameMs:270,duration:1100},
}
export function quietMinute(start:string,end:string,minute:number){
 const parse=(s:string)=>{const [h,m]=s.split(':').map(Number);return h*60+m}
 const from=parse(start),to=parse(end)
 return from===to?false:from<to?minute>=from&&minute<to:minute>=from||minute<to
}
export function quietHoursNow(p:PetPreferences,now:number){
 const date=new Date(now)
 return quietMinute(p.quietStart,p.quietEnd,date.getHours()*60+date.getMinutes())
}
export function quietNow(p:PetPreferences,now:number){return now<p.mutedUntil||quietHoursNow(p,now)}
interface Context {preferences:PetPreferences;trip:PetTrip|null;focus:boolean;dragging:boolean;gesture:FoxAction|null;gestureUntil:number;weather:SceneWeather;phase:ScenePhase;now:number;notice: boolean}
export function resolveFoxAction(c:Context):FoxAction{
 if(c.dragging)return c.gesture==='book-close'||c.gesture==='wake'||c.gesture==='lift'?c.gesture:'lifted'
 if(c.trip?.state==='away'){if(c.gesture&&c.now<c.gestureUntil&&['book-close','wake','depart','bag-open','bag-close','adjust-scarf'].includes(c.gesture))return c.gesture;return 'depart'}
 if(c.gesture&&c.now<c.gestureUntil)return c.gesture
 if(c.focus)return 'focus'
 if(quietHoursNow(c.preferences,c.now))return 'sleep'
 if(c.notice&&c.preferences.reminders)return 'remind'
 return 'idle'
}
