import type {PetTrip} from './types'
import {FOX_ROUTES} from './assets'
const discoveries={
 'pixel-jrpg':['桥边的一点星砂','古石上淡淡的纹样','把罗盘校准，沿灯火返程'],
 'parchment-journal':['一片纹路漂亮的叶子','河边的旧邮戳与路标','把植物明信片夹好，准备回来'],
 'animal-crossing':['沙滩边的一枚小贝壳','水边泛光的海玻璃','把小惊喜装好，顺着桥灯回来'],
 'stardew-valley':['篱边的一颗新芽','田野里的一点种子与花瓣','扣好种子袋，沿小路返程'],
}as const
const weatherText={clear:'晴朗的小路',cloudy:'慢慢移动的云影',rain:'细雨中的旅途',snow:'沿薄雪留下的脚印',wind:'风把围巾轻轻吹起来',fog:'循着雾中的路标'}
export function PetJourneyNotes({trip,now}:{trip:PetTrip;now:number}){
 const progress=Math.max(0,Math.min(1,(now-trip.startedAt)/(trip.returnsAt-trip.startedAt)))
 const notes=discoveries[trip.theme],route=FOX_ROUTES[trip.theme][trip.route]
 const weather=trip.weather??'clear'
 return <section className="xm-pet-journey-notes" aria-label="旅途中发现">
  <small>{route?.name} · {weatherText[weather]}</small><progress value={progress} max={1}/><ol>{notes.map((text,i)=>{const revealed=progress>=[.2,.5,.8][i]||trip.state==='returned';return <li key={text} className={revealed?'is-revealed':''}><span>{revealed?'✦':'·'}</span><div><strong>{revealed?text:'前面还有一点小发现'}</strong>{revealed&&<small>{weather==='rain'&&i===0?'在屋檐下等了一阵雨，才把它收进包。':weather==='snow'&&i===1?'轻轻拂开薄雪，看看藏在下面的颜色。':weather==='wind'&&i===2?'在背风处扣好包，让纪念物稳稳待着。':'伙伴的旅途纸条'}</small>}</div></li>})}</ol>
 </section>
}
