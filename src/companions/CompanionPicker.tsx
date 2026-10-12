import {useEffect,useState} from 'react'
import {useCompanionStore,startCompanionStore} from '../store/companion'
import {currentThemeKey} from '../themes'
import {COMPANION_NAMES,DEFAULT_PET_PREFERENCES,type CompanionCharacter,type PetPreferences} from './types'
import {CompanionSprite} from './CompanionSprite'
import './companion-picker.css'

const characters:CompanionCharacter[]=['fox','red-panda']
export function CompanionPicker(){
 const home=useCompanionStore(s=>s.home),save=useCompanionStore(s=>s.save),storeError=useCompanionStore(s=>s.error)
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 useEffect(startCompanionStore,[])
 const p=home?.preferences??DEFAULT_PET_PREFERENCES,theme=p.appearance==='follow'?currentThemeKey():p.appearance
 const travelling=home?.trip?.state==='away'||home?.trip?.state==='returned'
 const hidden=!p.enabled||!p.desktopEnabled||p.displayMode==='closed'
 const update=async(patch:Partial<PetPreferences>)=>{
  if(busy||!home)return
  setBusy(true);setError('')
  try{await save(patch)}catch(e){setError(String(e))}finally{setBusy(false)}
 }
 return <section className={'xm-companion-picker theme-'+theme} aria-label="选择桌面宠物" aria-busy={busy}>
  <div className="xm-companion-choice-grid" role="group" aria-label="宠物形象">
   {characters.map(character=><button type="button" key={character} aria-label={'选择'+COMPANION_NAMES[character]} aria-pressed={p.character===character} disabled={busy||!home||!!travelling&&p.character!==character} onClick={()=>{if(character!==p.character)void update({character})}}>
    <span className="xm-companion-choice-art" aria-hidden="true"><CompanionSprite character={character} outfit="theme" theme={theme} action="idle" direction="right" size={88} reserve animated={false}/></span>
    <span className="xm-companion-choice-name">{COMPANION_NAMES[character]}<small>{p.character===character?'✓ 已选择':'选择这位伙伴'}</small></span>
    <span className="xm-companion-choice-copy">{character==='fox'?'蓬松尾巴，随身的小行囊':'圆耳白眉，环纹的大尾巴'}</span>
   </button>)}
  </div>
  <p className="xm-companion-choice-help">选择后同步切换桌面形象。每位伙伴分别保留名字、成长、旅途与收藏。</p>
  {travelling&&<p className="xm-companion-choice-help" role="status">等伙伴旅行归来、收好纪念物后，就能换另一位伙伴。</p>}
  {home&&hidden&&<button type="button" className="xm-companion-recall" aria-label={'让'+COMPANION_NAMES[p.character]+'来桌面'} disabled={busy} onClick={()=>void update({enabled:true,desktopEnabled:true,displayMode:'normal'})}>让{COMPANION_NAMES[p.character]}来桌面</button>}
  {!home&&!storeError&&<p role="status" className="xm-companion-choice-help">正在读取伙伴设置…</p>}
  {(error||storeError)&&<p role="alert" className="xm-companion-choice-error">{error||storeError}</p>}
 </section>
}
