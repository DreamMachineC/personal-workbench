import { liveQuery } from 'dexie'
import { useObservable } from '@vueuse/rxjs'
import { from } from 'rxjs'
import dayjs from 'dayjs'
import { db, SOFT_DELETE_TABLES } from './db'
import { today, getWeekRange } from './date'
import { ref, watchEffect, onScopeDispose } from 'vue'

// Dexie liveQuery → Vue 响应式（数据变化 UI 自动更新）
export function useLiveQuery(fn) {
  // 加 onError：任一 liveQuery 抛错时不要变成"静默空数据 + 未捕获异常"，至少能在控制台看到
  return useObservable(from(liveQuery(fn)), { onError: e => console.error('[liveQuery]', e) })
}

export const useProfile = () => useLiveQuery(() => db.profile.get(1))
export const useCategories = () => useLiveQuery(() => db.categories.toArray())

// 科研分类 id 集合：科研待办默认不计入生活侧统计（Plan 附录 D 12.2 #3）
export async function researchCatIds() {
  const cats = await db.categories.toArray()
  return new Set(cats.filter(c => c.key === 'research' || c.name === '科研').map(c => c.id))
}

export function useTodayInstances(includeResearch = false) {
  return useLiveQuery(async () => {
    const t = today()
    const list = await db.taskInstances.where('date').equals(t).toArray()
    const tasks = await db.tasks.toArray()
    const map = Object.fromEntries(tasks.map(x => [x.id, x]))
    const rIds = includeResearch ? new Set() : await researchCatIds()
    return list
      .map(i => ({ ...i, task: map[i.taskId] }))
      .filter(i => i.task && !i.task.deletedAt && i.task.type !== 'long' && !rIds.has(i.task.categoryId))
  })
}

// 任意某天的清单：跟着传入的日期 ref 重新订阅；includeResearch 控制是否并入科研待办
export function useDayInstances(day, includeResearchRef = null) {
  const res = ref([])
  let sub = null
  watchEffect(() => {
    const d = day.value
    const inc = includeResearchRef ? includeResearchRef.value : false
    if (sub) sub.unsubscribe()
    sub = from(liveQuery(async () => {
      const list = await db.taskInstances.where('date').equals(d).toArray()
      const tasks = await db.tasks.toArray()
      const map = Object.fromEntries(tasks.map(x => [x.id, x]))
      const rIds = inc ? new Set() : await researchCatIds()
      return list
        .map(i => ({ ...i, task: map[i.taskId] }))
        .filter(i => i.task && !i.task.deletedAt && i.task.type !== 'long' && !rIds.has(i.task.categoryId))
    })).subscribe({ next: v => { res.value = v }, error: e => console.error('[liveQuery:day]', e) })
  })
  onScopeDispose(() => { if (sub) sub.unsubscribe() })
  return res
}

export function useForgotten() {
  return useLiveQuery(async () => {
    const t = today()
    const list = await db.taskInstances.where('status').equals('todo').toArray()
    const tasks = await db.tasks.toArray()
    const map = Object.fromEntries(tasks.map(x => [x.id, x]))
    const rIds = await researchCatIds()
    return list.map(i => ({ ...i, task: map[i.taskId] }))
      .filter(i => i.date < t && i.task && !i.task.deletedAt && !rIds.has(i.task.categoryId))
  })
}

export function useLongTasks() {
  return useLiveQuery(async () => (await db.tasks.where('type').equals('long').toArray()).filter(t => !t.deletedAt))
}

// 回收站：凡是被软删除的内容都要能在这里取回，也都要能被 30 天清理
// 表清单以 db.js 的 SOFT_DELETE_TABLES 为唯一出处；这里只负责"取出来 + 起个能认的名字"
const BIN_TEXT = {
  tasks: r => r.title,
  journals: r => r.text,
  checkinItems: r => r.name,
  researchProjects: r => r.name,
  researchNotes: r => r.title || r.text,
  researchSubtasks: r => r.title,
  assets: r => r.title || r.name || r.type,
}
const BIN_LABEL = {
  tasks: '计划', journals: '心声', checkinItems: '打卡项',
  researchProjects: '科研课题', researchNotes: '科研心得',
  researchSubtasks: '课题子任务', assets: '库房',
}
export function useRecycleBin() {
  return useLiveQuery(async () => {
    const out = []
    for (const t of SOFT_DELETE_TABLES) {
      for (const r of await db[t].filter(x => !!x.deletedAt).toArray()) {
        const text = String(BIN_TEXT[t]?.(r) ?? '')
        out.push({ table: t, label: BIN_LABEL[t] || t, id: r.id, deletedAt: r.deletedAt,
          text: text.length > 30 ? text.slice(0, 30) + '…' : text })
      }
    }
    return out.sort((a, b) => b.deletedAt - a.deletedAt)
  })
}

// ---------- Phase 2：复盘 / 健身 / 技能 ----------
export const useReviews = () => useLiveQuery(() => db.reviews.toArray())
export const useSkills = () => useLiveQuery(() => db.skills.filter(s => !s.archivedAt).toArray())

// 连续天数 🔥：截至今天（今天未完成不打断），每天有打卡完成或任务完成即算
export function useStreak() {
  return useLiveQuery(async () => {
    const items = (await db.checkinItems.toArray()).filter(i => !i.deletedAt)
    const doneMap = Object.fromEntries(items.map(i => [i.id, i]))
    const days = new Set()
    for (const r of await db.checkins.toArray()) {
      const it = doneMap[r.itemId]
      if (!it) continue
      const ok = it.type === 'bool' ? r.value >= 1 : r.value >= it.target
      if (ok) days.add(r.date)
    }
    // 已完成的任务实例：任务被删掉的不算，否则删了任务 streak 还挂着（与手帐页口径保持一致）
    const taskMap = Object.fromEntries((await db.tasks.toArray()).map(t => [t.id, t]))
    for (const i of await db.taskInstances.where('status').equals('done').toArray()) {
      const t = taskMap[i.taskId]
      if (t && !t.deletedAt) days.add(i.date)
    }
    let streak = 0
    let d = dayjs(today())
    if (!days.has(d.format('YYYY-MM-DD'))) d = d.subtract(1, 'day')
    while (days.has(d.format('YYYY-MM-DD'))) { streak++; d = d.subtract(1, 'day') }
    return streak
  })
}
export const useFitnessWeek = () => useLiveQuery(async () => {
  const { start, end } = getWeekRange()
  const s = start.format('YYYY-MM-DD'), e = end.format('YYYY-MM-DD')
  return (await db.fitness.toArray()).filter(f => f.date >= s && f.date <= e).sort((a, b) => b.date.localeCompare(a.date))
})

export const useFitnessToday = () => useLiveQuery(async () =>
  (await db.fitness.where('date').equals(today()).toArray()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)))

// ---------- 侧栏模块：显隐与排序 ----------
export const useModuleConfig = () => useLiveQuery(async () =>
  (await db.moduleConfig.toArray()).sort((a, b) => a.order - b.order))

// 复盘提醒状态：强横幅（复盘日当天 / 周末兜底）与轻提示（存在未完成周次）
export function useReviewStatus() {
  return useLiveQuery(async () => {
    const p = await db.profile.get(1)
    const reviewDay = p?.reviewDay ?? 6
    const t = today()
    const dow = new Date(t + 'T00:00:00').getDay()
    const { start, end } = getWeekRange()
    const weekStart = start.format('YYYY-MM-DD')
    const thisWeek = await db.reviews.where('weekStart').equals(weekStart).first()
    const allReviews = await db.reviews.toArray()
    const reviewedWeeks = new Set(allReviews.map(r => r.weekStart))
    // 找最近一个未完成的周次（最多回溯 8 周）
    let missedWeekStart = null
    for (let i = 0; i < 8; i++) {
      const ws = start.subtract(i, 'week').format('YYYY-MM-DD')
      if (!reviewedWeeks.has(ws)) { missedWeekStart = ws; break }
    }
    const isReviewDay = dow === reviewDay
    const isWeekend = dow === 0 || dow === 6
    const strong = (isReviewDay && !thisWeek) || (isWeekend && !thisWeek)
    const light = !thisWeek && !strong && !!missedWeekStart
    return { reviewDay, weekStart, thisWeek: !!thisWeek, isReviewDay, isWeekend, strong, light, missedWeekStart }
  })
}

export function useCheckinsToday() {
  return useLiveQuery(async () => {
    const t = today()
    const items = (await db.checkinItems.toArray()).filter(i => !i.deletedAt)
    const records = await db.checkins.where('date').equals(t).toArray()
    const map = Object.fromEntries(records.map(r => [r.itemId, r]))
    return items.map(i => ({ ...i, record: map[i.id] || null }))
  })
}

// 最近 N 天的心情（默认 30 天，供曲线使用）
export function useMoods(days = 30) {
  return useLiveQuery(async () => {
    const from = dayjs(today()).subtract(days - 1, 'day').format('YYYY-MM-DD')
    return await db.moods.where('date').aboveOrEqual(from).toArray()
  })
}

// 成长页当前子页（回望/体魄/技艺/殿堂/库房/日与周），全局搜索命中后可跨页定位到这里
export const growthSub = ref('review')

// ---------- 成就殿堂 / 长期资产库 ----------
export const useAchievements = () => useLiveQuery(async () =>
  (await db.achievements.toArray()).filter(a => !a.archivedAt).sort((a, b) => b.date.localeCompare(a.date)))
export const useAssets = () => useLiveQuery(async () =>
  (await db.assets.toArray()).filter(a => !a.deletedAt).sort((a, b) => b.createdAt - a.createdAt))

// 复盘写完自动进库房（同一条复盘只留一件，重复保存则更新）
export async function archiveReview(id, weekStart, text) {
  const exist = (await db.assets.toArray()).find(a => a.type === 'review' && a.refId === id)
  const title = `${weekStart.slice(5)} 那一周的回望`
  const summary = [text.good, text.bad, text.next].filter(Boolean).join(' / ')
  if (exist) await db.assets.update(exist.id, { title, summary })
  else await db.assets.add({
    type: 'review', module: 'growth', refId: id, title, summary, text: '',
    fileName: null, fileData: null, fileSize: null, createdAt: Date.now(), deletedAt: undefined,
  })
}

// ---------- 科研专区（独立板块，不并入生活侧统计） ----------
export const useResearchProjects = () => useLiveQuery(() => db.researchProjects.filter(p => !p.deletedAt).toArray())
export const useResearchDirections = () => useLiveQuery(() => db.researchDirections.filter(d => !d.archivedAt).toArray())
export const useResearchNotes = () => useLiveQuery(async () =>
  (await db.researchNotes.toArray()).filter(n => !n.deletedAt).sort((a, b) => b.createdAt - a.createdAt))
export const useResearchEvents = () => useLiveQuery(async () =>
  (await db.events.toArray()).filter(e => e.source === 'research').sort((a, b) => a.date.localeCompare(b.date)))
// 科研子任务：挂在课题下的"下一步"，完成率反过来驱动课题进度
export const useResearchSubtasks = () => useLiveQuery(async () =>
  (await db.researchSubtasks.toArray()).filter(s => !s.deletedAt).sort((a, b) => a.createdAt - b.createdAt))

// 科研待办：复用 task 表（categoryId 属科研分类），只取短/重复类；长线目标走 researchProjects
export function useResearchTodos() {
  return useLiveQuery(async () => {
    const rIds = await researchCatIds()
    const t = today()
    const tasks = (await db.tasks.toArray())
      .filter(x => !x.deletedAt && rIds.has(x.categoryId) && x.type !== 'long')
    const insts = await db.taskInstances.toArray()
    const latest = {}
    for (const i of insts) {
      const cur = latest[i.taskId]
      if (!cur || i.date === t || i.date > cur.date) latest[i.taskId] = i
    }
    return tasks.map(task => ({ task, inst: latest[task.id] || null }))
      .sort((a, b) => (a.inst?.status === 'done' ? 1 : 0) - (b.inst?.status === 'done' ? 1 : 0))
  })
}

// 取（或建）科研分类 id，用于新建科研待办
export async function ensureResearchCategoryId() {
  const cats = await db.categories.toArray()
  const hit = cats.find(c => c.key === 'research' || c.name === '科研')
  if (hit) return hit.id
  return await db.categories.add({ name: '科研', color: '#909399', system: true, key: 'research' })
}

export function useJournals() {
  // 已收进回收站的随笔不进列表、不进统计、也不给 AI 看
  return useLiveQuery(async () =>
    (await db.journals.orderBy('createdAt').reverse().toArray()).filter(j => !j.deletedAt))
}

export function useQuote() {
  const quote = ref(null)
  const t = today()
  db.quotes.where('date').equals(t).first().then(async cached => {
    if (cached) { quote.value = cached.text; return }
    try {
      const res = await fetch('https://v1.hitokoto.cn/?c=i&c=k&encode=json')
      const data = await res.json()
      const text = `${data.hitokoto} —— ${data.from || '佚名'}`
      await db.quotes.add({ date: t, text })
      quote.value = text
    } catch {
      quote.value = '不积跬步，无以至千里。 —— 《荀子》'
    }
  })
  return quote
}

export { getWeekRange, today }
