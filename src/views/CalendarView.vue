<script setup>
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import FullCalendar from '@fullcalendar/vue3'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import zhCnLocale from '@fullcalendar/core/locales/zh-cn'
import { db } from '../db'
import { today, getWeekRange } from '../date'
import { useLiveQuery, researchCatIds } from '../composables'

const selected = ref(today())

const holidays = useLiveQuery(() => db.holidays.toArray())
const events = useLiveQuery(() => db.events.toArray())
const instances = useLiveQuery(() => db.taskInstances.toArray())
const tasks = useLiveQuery(() => db.tasks.toArray())
// 科研待办只在科研页出现，不进总日历
const researchIds = useLiveQuery(async () => [...(await researchCatIds())])
const isResearch = id => (researchIds.value || []).includes(id)

const hMap = computed(() => Object.fromEntries((holidays.value || []).map(h => [h.date, h])))
const taskMap = computed(() => Object.fromEntries((tasks.value || []).map(t => [t.id, t])))

// 日历事件：手动日程 + 长任务截止日 + 重复任务实例（只汇总展示，不生成事件实体）
const calendarEvents = computed(() => {
  const list = (events.value || []).map(e => ({
    id: 'e' + e.id,
    title: (e.source === 'research' ? '科研 · ' : '') + e.title,
    date: e.date,
    classNames: e.source === 'research' ? ['ev-research'] : [],
  }))
  for (const i of instances.value || []) {
    const t = taskMap.value[i.taskId]
    if (!t || t.type === 'long' || isResearch(t.categoryId)) continue
    // 有执行时间的实例带时刻，周视图里落在对应时段；没时间的按全天排
    const at = t.defaultTime ? `${i.date}T${t.defaultTime}` : i.date
    list.push({ id: 'i' + i.id, title: t.title, date: at, classNames: i.status === 'done' ? ['ev-done'] : [] })
  }
  for (const t of tasks.value || []) {
    if (t.type === 'long' && t.deadline && t.status !== 'done')
      list.push({ id: 't' + t.id, title: t.title, date: t.deadline, classNames: ['ev-long'] })
  }
  return list
})

// 节假日/调休补班：休=红、班=橙
function dayCellDidMount(arg) {
  const h = hMap.value[dayjs(arg.date).format('YYYY-MM-DD')]
  if (!h) return
  const el = document.createElement('span')
  el.className = 'hl-badge ' + (h.type === 'workday' ? 'ban' : 'xiu')
  el.textContent = h.type === 'workday' ? '班' : '休'
  el.title = h.name
  arg.el.querySelector('.fc-daygrid-day-top')?.appendChild(el)
}

const calendarOptions = computed(() => ({
  plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
  initialView: 'dayGridMonth',
  locale: zhCnLocale,
  buttonText: { month: '月', week: '周', today: '今天' },
  views: { timeGridWeek: { slotMinTime: '07:00:00', slotMaxTime: '23:00:00' } },
  height: 'auto',
  firstDay: 1, // 周一起始（全局口径）
  headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
  events: calendarEvents.value,
  dateClick: info => { selected.value = info.dateStr },
  dayCellDidMount,
  eventClick: info => { selected.value = dayjs(info.event.start).format('YYYY-MM-DD') }
}))

// 选中日详情
const dayDetail = computed(() => {
  const evs = (events.value || []).filter(e => e.date === selected.value)
  const list = (instances.value || []).filter(i => i.date === selected.value)
    .map(i => ({ ...i, task: taskMap.value[i.taskId] }))
    .filter(i => i.task && !isResearch(i.task.categoryId))
  const longs = (tasks.value || []).filter(t => t.type === 'long' && t.deadline === selected.value && t.status !== 'done')
  return { evs, list, longs }
})

// 本周任务栏：选中日所在周（周一起），按天排；只做汇总展示，不生成事件实体
const WD = ['日', '一', '二', '三', '四', '五', '六']
const weekTasks = computed(() => {
  const { start, end } = getWeekRange(dayjs(selected.value))
  const s = start.format('YYYY-MM-DD')
  const e = end.format('YYYY-MM-DD')
  const rows = (instances.value || [])
    .filter(i => i.date >= s && i.date <= e)
    .map(i => ({ ...i, task: taskMap.value[i.taskId] }))
    .filter(i => i.task && !isResearch(i.task.categoryId))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.task.defaultTime || '').localeCompare(String(b.task.defaultTime || '')))
  return {
    range: `${s.slice(5).replace('-', '/')} – ${e.slice(5).replace('-', '/')}`,
    rows,
    done: rows.filter(r => r.status === 'done').length,
  }
})

// 将至的日子：今天之后的日程与长期截止日
const daysLeft = d => dayjs(d).startOf('day').diff(dayjs(today()).startOf('day'), 'day')
const upcoming = computed(() => {
  const evs = (events.value || []).filter(e => e.date >= today())
    .map(e => ({ date: e.date, title: e.title, kind: '日程' }))
  const longs = (tasks.value || []).filter(t => t.type === 'long' && t.deadline && t.deadline >= today() && t.status !== 'done')
    .map(t => ({ date: t.deadline, title: t.title, kind: '截止' }))
  return [...evs, ...longs].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7)
})

const newEvent = ref('')
async function addEvent() {
  if (!newEvent.value.trim()) return
  await db.events.add({ date: selected.value, title: newEvent.value.trim(), source: 'manual' })
  newEvent.value = ''
}
</script>

<template>
  <div class="two-col">
    <div class="card">
      <FullCalendar :options="calendarOptions" />
      <div class="muted" style="margin-top:8px">
        节假日取自 holiday-cn（离线缓存）；<span class="hl-badge xiu">休</span> 放假 · <span class="hl-badge ban">班</span> 调休补班
      </div>
    </div>

    <aside class="col-side">
    <div class="card">
      <h3>{{ selected }} · 这一天的安排</h3>
      <div v-if="!dayDetail.evs.length && !dayDetail.list.length && !dayDetail.longs.length" class="muted">这一天还空着，可以慢慢填满</div>
      <div v-for="e in dayDetail.evs" :key="'e'+e.id" class="task-row">
        <div class="task-main">
          <div class="task-title">{{ e.title }}<span v-if="e.source === 'research'" class="src-tag">科研</span></div>
        </div>
      </div>
      <div v-for="i in dayDetail.list" :key="'i'+i.id" class="task-row">
        <div class="task-main">
          <div class="task-title" :class="{ done: i.status === 'done' }">{{ i.task.title }}</div>
          <div class="task-meta">{{ i.status === 'done' ? '已完成' : '待完成' }}</div>
        </div>
      </div>
      <div v-for="t in dayDetail.longs" :key="'t'+t.id" class="task-row">
        <div class="task-main">
          <div class="task-title">{{ t.title }}</div>
          <div class="task-meta">长期计划 · 截止日</div>
        </div>
      </div>
      <div class="row" style="margin-top:10px">
        <input type="text" v-model="newEvent" placeholder="添一件事，回车即存" @keyup.enter="addEvent" />
        <button class="btn" @click="addEvent">添加</button>
      </div>
    </div>

      <div class="side-card">
        <div class="eyebrow teal">THIS WEEK</div>
        <h3>本周任务<span class="cnt">{{ weekTasks.done }}/{{ weekTasks.rows.length }}</span></h3>
        <div class="week-range">{{ weekTasks.range }}</div>
        <div v-for="r in weekTasks.rows" :key="'w'+r.id" class="week-row">
          <span class="wd">{{ WD[dayjs(r.date).day()] }}</span>
          <span class="wt" :class="{ done: r.status === 'done' }">{{ r.task.title }}</span>
          <span class="wtime" v-if="r.task.defaultTime">{{ r.task.defaultTime }}</span>
        </div>
        <div class="muted" v-if="!weekTasks.rows.length">这一周还没有排上任务</div>
      </div>

      <div class="side-card">
        <div class="eyebrow gold">NEXT</div>
        <h3>将至的日子</h3>
        <div v-for="(u, idx) in upcoming" :key="idx" class="goal-row">
          <span class="goal-t">{{ u.kind }} · {{ u.title }}</span>
          <span class="goal-d" :class="{ hot: daysLeft(u.date) <= 3 }">
            {{ daysLeft(u.date) === 0 ? '就是今天' : daysLeft(u.date) === 1 ? '明天' : `还有 ${daysLeft(u.date)} 天` }}
          </span>
        </div>
        <div class="muted" v-if="!upcoming.length">往前看，暂时没有排着的事</div>
      </div>
    </aside>
  </div>
</template>
