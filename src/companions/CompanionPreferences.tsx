import { useEffect,useState } from 'react'
import {invoke} from '@tauri-apps/api/core'
import { useFox } from './useFox'
import {COMPANION_NAMES,type PetPreferences} from './types'
import {CompanionAiPreferences} from './CompanionAiPreferences'
import {CompanionDesktopPreferences} from './CompanionDesktopPreferences'
export function CompanionPreferences({compact=false,showPicker=true}:{compact?:boolean;showPicker?:boolean}){
 const pet=useFox(),p=pet.preferences
 const [range,setRange]=useState(p.wanderRange)
 useEffect(()=>setRange(p.wanderRange),[p.wanderRange])
 const [name,setName]=useState(p.name),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 useEffect(()=>setName(p.name),[p.name])
 const mode=async(value:string)=>{setBusy(true);setError('');try{await invoke('set_companion_mode',{mode:value});await pet.refresh()}catch(e){setError(String(e))}finally{setBusy(false)}}
 const save=async(patch:Partial<PetPreferences>)=>{setBusy(true);setError('');try{await pet.save(patch)}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <section className={'xm-companion-preferences'+(compact?' is-compact':'')} aria-label="伙伴陪伴设置">
 {showPicker&&<><div className="xm-pet-section-heading"><span>你的桌面伙伴</span><small>{COMPANION_NAMES[p.character]}</small></div>
 <label>选择伙伴<select value={p.character} disabled={busy} onChange={e=>void save({character:e.target.value as PetPreferences['character']})}><option value="fox">小狐狸 · 蓬松尾巴的老朋友</option><option value="red-panda">小熊猫 · 环纹尾巴的森林朋友</option></select></label>
 <small className="xm-pet-help">小狐狸安静陪伴，带着小行囊出门；小熊猫有白眉圆耳、环纹尾巴和绿色吊坠。每位伙伴分别记住名字、成长、照顾、旅途和收藏。</small></>}
 {p.character==='red-panda'&&<label>小熊猫衣装<select value={p.outfit==='scarf'?'none':p.outfit} disabled={busy} onChange={e=>void save({outfit:e.target.value as PetPreferences['outfit']})}><option value="theme">主题衣装</option><option value="none">轻装</option></select></label>}
 <div className="xm-pet-section-heading"><span>陪伴方式</span><small>按你的节奏来</small></div>
 <label className="xm-pet-toggle"><span><strong>启用{COMPANION_NAMES[p.character]}</strong><small>在桌面安静陪伴你，显示时自动收起任务球</small></span><input type="checkbox" checked={p.enabled} disabled={busy} onChange={e=>void save({enabled:e.target.checked})}/></label>
 <label className="xm-pet-toggle"><span><strong>桌面陪伴</strong><small>轻扫头部是摸头，沿身体滑动是顺毛，按住拖动移动；右键菜单选择简易任务入口收成球，球双击变回伙伴</small></span><input type="checkbox" checked={p.desktopEnabled} disabled={busy||!p.enabled} onChange={e=>void save({desktopEnabled:e.target.checked})}/></label>
 <div className="xm-pet-preferences-grid">
 <label>桌面模式<select value={!p.enabled||!p.desktopEnabled?'closed':p.displayMode} disabled={busy} onChange={e=>void mode(e.target.value)}><option value="normal">普通陪伴</option><option value="mini">悬浮球 · 双击还原伙伴</option><option value="edge">贴边陪伴 · 自动收纳</option><option value="closed">完全收起</option></select></label>
 <label>任务入口<select value={p.taskClick} disabled={busy} onChange={e=>void save({taskClick:e.target.value as PetPreferences['taskClick']})}><option value="double">双击打开任务</option><option value="single">单击直接打开任务</option></select></label>
 </div>
 <div className="xm-pet-preferences-grid">
 <label>伙伴名字<input value={name} disabled={busy} maxLength={16} placeholder={p.name} onChange={e=>setName(e.target.value)} onBlur={()=>{if(name.trim()&&name.trim()!==p.name)void save({name:name.trim()})}}/></label>
 <label>桌面大小<select value={p.size} disabled={busy} onChange={e=>void save({size:Number(e.target.value)})}><option value={64}>小巧 · 64</option><option value={96}>日常 · 96</option><option value={128}>清晰 · 128</option></select></label>
 </div>
 <label className="xm-pet-toggle"><span><strong>靠近边缘自动收纳</strong><small>拖到屏幕左右边缘，离开后收进去；鼠标靠近展开，拖离边缘解除</small></span><input type="checkbox" checked={p.autoDock} disabled={busy} onChange={e=>void save({autoDock:e.target.checked})}/></label>
 <label className="xm-pet-toggle"><span><strong>允许小范围走动</strong><small>只在闲暇时慢慢走，专注和拖动时停下</small></span><input type="checkbox" checked={p.wander} disabled={busy} onChange={e=>void save({wander:e.target.checked})}/></label>
 <label className="xm-pet-toggle"><span><strong>自己找个舒服位置</strong><small>偶尔看看附近的窗沿和图标，靠近、抱一会儿再下来；刚去过的位置少去，输入和专注时暂缓。位置判断只在本机进行。</small></span><input type="checkbox" checked={p.autoPerch} disabled={busy} onChange={e=>void save({autoPerch:e.target.checked})}/></label>
 <label>散步范围（围绕你放置的位置）<input type="range" min="32" max="256" step="16" value={range} onChange={e=>setRange(Number(e.target.value))} onPointerUp={e=>void save({wanderRange:Number(e.currentTarget.value)})} onKeyUp={e=>void save({wanderRange:Number(e.currentTarget.value)})}/><small>{range} 像素</small></label>
 <label className="xm-pet-toggle"><span><strong>跟随天气与昼夜</strong><small>雨伞、夜灯和少量雪花可以与读书同时出现</small></span><input type="checkbox" checked={p.followEnvironment} disabled={busy} onChange={e=>void save({followEnvironment:e.target.checked})}/></label>
 <label className="xm-pet-toggle"><span><strong>专注时允许重要提醒</strong><small>只递送课程和高重要度任务，普通提醒等专注结束</small></span><input type="checkbox" checked={p.importantDuringFocus} disabled={busy} onChange={e=>void save({importantDuringFocus:e.target.checked})}/></label>
 <label className="xm-pet-toggle"><span><strong>日程提醒</strong><small>任务和课程临近时合并提醒，连堂课程合在一起</small></span><input type="checkbox" checked={p.reminders} disabled={busy} onChange={e=>void save({reminders:e.target.checked})}/></label>
 <label className="xm-pet-toggle"><span><strong>主动说说话</strong><small>偶尔推荐一个小目标或提醒休息，专注和安静时段不打扰</small></span><input type="checkbox" checked={p.proactive} disabled={busy} onChange={e=>void save({proactive:e.target.checked})}/></label>

 <div className="xm-pet-preferences-grid"><label>安静时段开始<input type="time" value={p.quietStart} disabled={busy} onChange={e=>void save({quietStart:e.target.value})}/></label><label>安静时段结束<input type="time" value={p.quietEnd} disabled={busy} onChange={e=>void save({quietEnd:e.target.value})}/></label></div>
 <small className="xm-pet-help">安静时段和专注期间暂停主动提醒；开始、结束设为同一时间可取消固定安静时段。应用需保持运行，收起到托盘后仍能提醒。</small>
 <label className="xm-pet-toggle"><span><strong>轻柔的主题音效</strong><small>只在喂食、小游戏和完成回应时轻响，默认关闭；专注和安静时段不播放</small></span><input type="checkbox" checked={p.sound} disabled={busy} onChange={e=>void save({sound:e.target.checked})}/></label>
 <label className="xm-pet-toggle"><span><strong>减少伙伴动作</strong><small>保留姿势、天气衣装和提醒，停止循环动画</small></span><input type="checkbox" checked={p.reducedMotion} disabled={busy} onChange={e=>void save({reducedMotion:e.target.checked})}/></label>
 {p.mutedUntil>Date.now()&&<button className="xm-pet-link" onClick={()=>void save({mutedUntil:0})}>恢复主动提醒</button>}
 {error&&<p role="alert" className="xm-pet-error">{error}</p>}
 <CompanionAiPreferences/>
 <CompanionDesktopPreferences/>
 </section>
}
