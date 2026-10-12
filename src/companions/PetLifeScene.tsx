import {FoxAccessory} from './FoxSprite'
import {CompanionSprite} from './CompanionSprite'
import type {useFox} from './useFox'
export function PetLifeScene({pet,dialogue:spoken,onMemory,onKeepsake}:{pet:ReturnType<typeof useFox>;dialogue?:string;onMemory:()=>void;onKeepsake:()=>void}){
 const journal=pet.home?.journal,keepsake=pet.home?.keepsake
 const away=pet.home?.trip?.state==='away'
 const line=spoken||(away?'小路上的新发现，都收在行囊里。':pet.home?.focus?'我翻到书签这一页，安静陪你。':pet.activity==='sleep'?'先蜷起来睡一会儿，醒来再见。':journal?.memories[0]?.title??'不赶路，今天也一起慢慢过。')
 return <section className="xm-pet-life-scene">
  <div className="xm-pet-life-mat">{pet.travelBag?<FoxAccessory theme={pet.home?.trip?.theme??pet.theme} kind="bag" size={102}/>:<CompanionSprite theme={pet.theme} action={pet.action} size={112} animated={pet.animated}/>}
   {keepsake&&<button className="xm-pet-mat-keepsake" title={keepsake.itemName} aria-label={'看看'+keepsake.itemName} onClick={onKeepsake}><FoxAccessory theme={keepsake.theme} kind="souvenir" size={30}/></button>}
   {journal?.unlocks.some(u=>u.id==='reader'&&u.unlocked)&&<span className="xm-pet-mat-books" title="一起养成的阅读小习惯" aria-label="阅读小书堆"><i/><i/><i/></span>}
   {journal?.unlocks.some(u=>u.id==='bookmark'&&u.unlocked)&&<span className="xm-pet-mat-bookmark" title="我们一起完成专注的第一张书签" aria-label="第一张书签">✦</span>}
  </div>
  <div className="xm-pet-life-copy"><small className="xm-pet-life-status"><i/>{away?'替你看看远方':pet.home?.focus?'陪你专注':pet.activity==='sleep'?'正在休息':'今天也在这里'}</small><p title={line} aria-live={spoken?'polite':'off'}>{line}</p>
   <button className="xm-pet-relationship" onClick={onMemory}><span>{journal?.relationship??'初次相识'}</span><b>›</b></button>
   {journal?.memoryTotal? <small className="xm-pet-life-history">一起留下 {journal.memoryTotal} 件小事</small>:null}
  </div>
 </section>
}
