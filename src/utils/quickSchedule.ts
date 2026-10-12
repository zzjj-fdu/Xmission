/** Local, conservative recognition. Incomplete dates/times stay manual. */
export function recognizeQuickSchedule(text: string, now = new Date()): { localTime: string; recurrence: 'none' | 'daily' | 'weekly'; recurDays: string | null } | null {
  const number = (raw: string) => {
    if (/^\d+$/.test(raw)) return Number(raw)
    const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
    if (raw === '十') return 10
    if (raw.includes('十')) { const [a, b] = raw.split('十'); return (a ? digits[a] : 1) * 10 + (b ? digits[b] : 0) }
    return digits[raw]
  }
  const clock = text.match(/(?<!\d)(上午|早上|下午|晚上|傍晚|中午)?\s*(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})(?:点|[:：])(?:(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})(?:分)?|(半))?(?!\d)/)
  if (!clock) return null
  let hour = number(clock[2]), minute = clock[4] ? 30 : clock[3] ? number(clock[3]) : 0
  if (['下午', '晚上', '傍晚', '中午'].includes(clock[1] ?? '') && hour < 12) hour += 12
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null
  if (hour === 12 && /晚上|今晚|明晚|午夜|夜里/.test(text)) return null
  const day = new Date(now), p = (n: number) => String(n).padStart(2, '0')
  let recurrence: 'none' | 'daily' | 'weekly' = 'none', recurDays: string | null = null
  const exact = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  const weekly = text.match(/(下周|这周|每周|周|星期)([一二三四五六日天])/)
  if (exact) {
    day.setFullYear(Number(exact[1]), Number(exact[2]) - 1, Number(exact[3]))
    if (day.getFullYear() !== Number(exact[1]) || day.getMonth() !== Number(exact[2]) - 1 || day.getDate() !== Number(exact[3])) return null
  } else if (weekly) {
    const wd = '一二三四五六日'.indexOf(weekly[2] === '天' ? '日' : weekly[2]) + 1, current = day.getDay() || 7
    const delta = weekly[1] === '下周' ? 7 - current + wd : weekly[1] === '这周' ? wd - current : (wd - current + 7) % 7
    day.setDate(day.getDate() + delta)
    if (weekly[1] === '每周') { recurrence = 'weekly'; recurDays = String(wd); if (delta === 0 && hour * 60 + minute <= now.getHours() * 60 + now.getMinutes()) day.setDate(day.getDate() + 7) }
  } else if (/后天/.test(text)) day.setDate(day.getDate() + 2)
  else if (/明天|明晚/.test(text)) day.setDate(day.getDate() + 1)
  else if (/今天|今晚/.test(text)) { /* An explicitly stated date can be overdue. */ }
  else if (/每天/.test(text)) { recurrence = 'daily'; if (hour * 60 + minute <= now.getHours() * 60 + now.getMinutes()) day.setDate(day.getDate() + 1) }
  else return null
  if (/明晚|今晚/.test(text) && hour < 12) hour += 12
  day.setHours(hour, minute, 0, 0)
  return { localTime: `${day.getFullYear()}-${p(day.getMonth() + 1)}-${p(day.getDate())}T${p(day.getHours())}:${p(day.getMinutes())}`, recurrence, recurDays }
}
