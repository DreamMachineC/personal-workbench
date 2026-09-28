import dayjs from 'dayjs'
import { db } from './db'

export const today = () => dayjs().format('YYYY-MM-DD')
export const fmt = d => d.format('YYYY-MM-DD')

// 分钟数 → "2h30m" / "45m"
export const fmtDuration = m => {
  if (!m || m <= 0) return ''
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? (m % 60) + 'm' : ''}` : `${m}m`
}

// 问候语（借鉴参考设计：按时段问候）
export function greeting(d = dayjs()) {
  const h = d.hour()
  if (h < 5) return '夜深了'
  if (h < 9) return '早上好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

// 完整中文日期：2026年9月26日 星期六
export function fullDateCN(d = dayjs()) {
  const W = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.year()}年${d.month() + 1}月${d.date()}日 星期${W[d.day()]}`
}

// 周起始日 = 周一（全局口径，见 Plan 12.2 #5）
export function getWeekRange(d = dayjs()) {
  const dow = (d.day() + 6) % 7 // 周一=0
  return { start: d.subtract(dow, 'day'), end: d.subtract(dow, 'day').add(6, 'day') }
}

// ---------- 节假日（holiday-cn 运行时拉取入库，周末规则兜底） ----------
export async function loadHolidays(year) {
  const cached = await db.holidays.where('year').equals(year).count()
  if (cached > 0) return
  try {
    const res = await fetch(`https://raw.githubusercontent.com/NateScarlet/holiday-cn/${year}/.output.json`)
    if (!res.ok) throw new Error('http ' + res.status)
    const data = await res.json()
    const days = Array.isArray(data.days) ? data.days : []
    await db.holidays.bulkPut(days.map(d => ({
      date: d.date, name: d.name, year,
      type: d.isOffDay ? 'holiday' : 'workday' // workday = 调休补班日
    })))
  } catch (e) {
    console.warn('holiday-cn 拉取失败，暂按周末规则兜底', e)
  }
}

// 某日是否工作日（含调休补班判断）
export async function isWorkday(dateStr) {
  const h = await db.holidays.get(dateStr)
  if (h) return h.type === 'workday'
  const dow = dayjs(dateStr).day()
  return dow >= 1 && dow <= 5
}

// ---------- 重复规则：四档 daily / weekdays / weekly / interval ----------
// task.rrule = { freq, byweekday?: number[], interval?: number }
// task.rruleStart = 起算日（interval 档用）
export function taskOccursOn(task, dateStr, workday = true) {
  if (!task.rrule) return false
  const r = task.rrule
  const d = dayjs(dateStr)
  switch (r.freq) {
    case 'daily': return true
    case 'weekdays': return workday
    case 'weekly': return (r.byweekday || []).includes(d.day())
    case 'interval': {
      if (!task.rruleStart) return true
      const diff = d.diff(dayjs(task.rruleStart), 'day')
      return diff >= 0 && diff % (r.interval || 1) === 0
    }
    default: return false
  }
}

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export function rruleLabel(task) {
  if (!task.rrule) return ''
  const r = task.rrule
  if (r.freq === 'daily') return '每天'
  if (r.freq === 'weekdays') return '仅工作日'
  if (r.freq === 'weekly') return '每周 ' + (r.byweekday || []).map(i => WEEKDAY_LABELS[i]).join('、')
  if (r.freq === 'interval') return `每 ${r.interval || 1} 天`
  return ''
}
