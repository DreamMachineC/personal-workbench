<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import Gantt from 'frappe-gantt'
import 'frappe-gantt-css'
import dayjs from 'dayjs'
import { NButton, NInput, NSelect, NPopover, NInputNumber, NEmpty, NTag } from 'naive-ui'
import { db } from '../db'
import { today, rruleLabel, fmtDuration } from '../date'
import { useProfile, useCategories, useDayInstances, useLongTasks, useForgotten } from '../composables'
import { showUndo } from '../undo'
import { aiSplitTasks, parseSpoken, startDictation, dictationSupported } from '../ai'

const categories = useCategories()
const longTasks = useLongTasks()
const forgotten = useForgotten()

// 当前查看的这天（可前后翻，也可直接选日期）
const day = ref(today())
const withResearch = ref(false) // 科研待办默认不进这一页，可临时并入（Plan 附录 D 12.2 #3）
const instances = useDayInstances(day, withResearch)
const dayLabel = computed(() => {
  const t = today()
  if (day.value === t) return '今天'
  if (day.value === dayjs(t).add(1, 'day').format('YYYY-MM-DD')) return '明天'
  if (day.value === dayjs(t).subtract(1, 'day').format('YYYY-MM-DD')) return '昨天'
  return day.value.slice(5).replace('-', ' / ')
})
function shiftDay(n) { day.value = dayjs(day.value).add(n, 'day').format('YYYY-MM-DD') }

const catMap = computed(() => Object.fromEntries((categories.value || []).map(c => [c.id, c])))
const sub = ref('short') // short | long | forgotten
const view = ref('list') // list | timeline（仅短期/重复子页）
const showForm = ref(false)

const emptyForm = () => ({ title: '', type: 'short', categoryId: null, deadline: '', date: day.value, defaultTime: '', freq: 'none', byweekday: [], interval: 1 })
const form = ref(emptyForm())
const editId = ref(null) // 非空 = 改已有的事（长按行触发）
const WD = ['日', '一', '二', '三', '四', '五', '六']
function openForm() { editId.value = null; form.value = emptyForm(); showForm.value = !showForm.value }
// 长按一行 → 带原值打开表单（重复规则反解回四档）
function openEdit(i) {
  const t = i.task
  if (!t) return
  editId.value = t.id
  const r = t.rrule || {}
  form.value = {
    title: t.title, type: t.type, categoryId: t.categoryId ?? null,
    deadline: t.deadline || '', date: i.date || day.value, defaultTime: t.defaultTime || '',
    freq: r.freq || 'none', byweekday: r.byweekday ? [...r.byweekday] : [], interval: r.interval || 1,
  }
  showForm.value = true
}

const catOptions = computed(() => [
  { label: '无分类', value: null },
  ...(categories.value || []).map(c => ({ label: c.name, value: c.id }))
])

async function addTask() {
  if (!form.value.title.trim()) return
  // 长期目标是"一直挂着的一件事"，不该按天重复；否则每天生成实例还会掉进"搁浅的计划"
  let rrule = null
  if (form.value.type !== 'long') {
    if (form.value.freq === 'daily') rrule = { freq: 'daily' }
    if (form.value.freq === 'weekdays') rrule = { freq: 'weekdays' }
    if (form.value.freq === 'weekly') rrule = { freq: 'weekly', byweekday: form.value.byweekday }
    if (form.value.freq === 'interval') rrule = { freq: 'interval', interval: form.value.interval }
  }
  if (editId.value) { // 改已有的事：只动模板，历史实例保留（Plan 决策 #4）
    await db.tasks.update(editId.value, {
      title: form.value.title.trim(),
      type: form.value.type,
      categoryId: form.value.categoryId,
      deadline: form.value.type === 'long' ? form.value.deadline || null : null,
      defaultTime: form.value.defaultTime || null,
      rrule,
    })
    editId.value = null
    showForm.value = false
    form.value = emptyForm()
    return
  }
  const id = await db.tasks.add({
    title: form.value.title.trim(),
    type: form.value.type,
    categoryId: form.value.categoryId,
    deadline: form.value.type === 'long' ? form.value.deadline || null : null,
    defaultTime: form.value.defaultTime || null,
    rrule,
    rruleStart: rrule ? (form.value.date || today()) : null,
    status: 'active',
    createdAt: Date.now()
  })
  if (form.value.type === 'short' && !rrule) {
    await db.taskInstances.add({ taskId: id, date: form.value.date || today(), status: 'todo', completedAt: null, durationMin: 0, timerStart: null })
  }
  showForm.value = false
  form.value = emptyForm()
}

// ---------- 说出来 → 拆成任务 ----------
const showSpeak = ref(false)
const spoken = ref('')
const interim = ref('')
const listening = ref(false)
const splitting = ref(false)
const candidates = ref([])
const speakErr = ref('')
const canDictate = dictationSupported()
const DATE_LABEL = { today: '今天', tomorrow: '明天', d2: '后天' }
const chosen = computed(() => candidates.value.filter(c => c.on))
let rec = null

function openSpeak() {
  showSpeak.value = !showSpeak.value
  stopListen()
  spoken.value = ''; interim.value = ''; candidates.value = []; speakErr.value = ''
}
function stopListen() { try { rec?.stop() } catch { /* 没在录就算了 */ } rec = null; listening.value = false }
function toggleListen() {
  if (listening.value) { stopListen(); return }
  interim.value = ''; speakErr.value = ''
  rec = startDictation({
    onResult: (finalT, i) => { spoken.value = finalT; interim.value = i },
    onEnd: () => { listening.value = false; interim.value = '' },
    onError: m => { listening.value = false; speakErr.value = m },
  })
  listening.value = !!rec
}
const catIdByName = n => (categories.value || []).find(c => c.name === n)?.id ?? null
async function splitSpoken() {
  if (!spoken.value.trim()) return
  splitting.value = true; speakErr.value = ''
  try {
    let items = []
    try { items = await aiSplitTasks(spoken.value, (categories.value || []).map(c => c.name)) }
    catch { /* 模型不可用就走本地规则 */ }
    if (!items.length) items = parseSpoken(spoken.value)
    candidates.value = items.map(i => ({ ...i, categoryId: catIdByName(i.catName) }))
  } catch (e) { speakErr.value = e.message || '没能拆开' }
  finally { splitting.value = false }
}
function cycleDate(c) { c.date = c.date === 'today' ? 'tomorrow' : c.date === 'tomorrow' ? 'd2' : 'today' }
const dateOf = k => k === 'tomorrow' ? dayjs(today()).add(1, 'day').format('YYYY-MM-DD')
  : k === 'd2' ? dayjs(today()).add(2, 'day').format('YYYY-MM-DD') : today()
async function saveSpoken() {
  for (const c of chosen.value) {
    const id = await db.tasks.add({
      title: c.title.trim(), type: 'short', categoryId: c.categoryId || null,
      deadline: null, defaultTime: c.time || null, rrule: null, rruleStart: null,
      status: 'active', createdAt: Date.now(),
    })
    await db.taskInstances.add({
      taskId: id, date: dateOf(c.date), status: 'todo',
      completedAt: null, durationMin: 0, timerStart: null,
    })
  }
  openSpeak()
}
onUnmounted(stopListen)

async function toggle(i) {
  if (i.status === 'done') await db.taskInstances.update(i.id, { status: 'todo', completedAt: null })
  else await db.taskInstances.update(i.id, { status: 'done', completedAt: new Date().toISOString() })
}

// ---------- 移动端手势：左滑完成 / 长按改这件事（仅窄屏，桌面不触发） ----------
let g = null
function rowStart(i, e) {
  if (e.touches?.length !== 1) return
  const t = e.touches[0]
  g = { x: t.clientX, y: t.clientY, i, long: null }
  g.long = setTimeout(() => { const s = g; g = null; s && openEdit(s.i) }, 520)
}
function rowMove(e) {
  if (!g || e.touches?.length !== 1) return
  const t = e.touches[0]
  if (Math.abs(t.clientX - g.x) > 8 || Math.abs(t.clientY - g.y) > 8) { clearTimeout(g.long); g.long = null }
}
function rowCancel() {
  if (!g) return
  clearTimeout(g.long)
  g = null
}
function rowEnd(e) {
  if (!g) return
  const s = g; g = null
  clearTimeout(s.long)
  const t = e.changedTouches?.[0]
  if (!t) return
  const dx = t.clientX - s.x, dy = t.clientY - s.y
  if (dx <= -60 && Math.abs(dy) < 40) toggle(s.i) // 左滑 = 完成 / 取消完成
}

// ---------- 计时：开始 / 停止（累计 durationMin）/ 手动补录 ----------
async function startTimer(i) {
  await db.taskInstances.update(i.id, { timerStart: Date.now() })
}
async function stopTimer(i) {
  if (!i.timerStart) return
  const add = Math.max(1, Math.round((Date.now() - i.timerStart) / 60000))
  await db.taskInstances.update(i.id, { timerStart: null, durationMin: (i.durationMin || 0) + add })
}
const manual = ref({ min: 15 })
async function addManual(i) {
  const m = Math.max(1, Math.round(manual.value.min || 0))
  await db.taskInstances.update(i.id, { durationMin: (i.durationMin || 0) + m })
}

// 时间轴（纵向 / 横向）：把一整天 0:00–24:00 串起来
const toMin = t => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m }
const timedItems = computed(() => (instances.value || [])
  .filter(i => i.task?.defaultTime)
  .map(i => ({ ...i, min: toMin(i.task.defaultTime) }))
  .sort((a, b) => a.min - b.min))
const untimedItems = computed(() => (instances.value || []).filter(i => !i.task?.defaultTime))
const tlItems = computed(() => [...timedItems.value, ...untimedItems.value])

// ---------- 日程：给当天的事分时段 ----------
const SCH_START = 6, SCH_END = 24, SCH_ROW = 44 // 06:00–24:00，一格 44px
const SCH_HOURS = Array.from({ length: SCH_END - SCH_START }, (_, i) => SCH_START + i)
const pick = ref(null) // 正在给哪个时段挑事
const fmtMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// 只认亲手排进去的时段：执行时刻（时间轴用）不自动落位，否则「×」取不出来、也挪不动
const scheduled = computed(() => {
  const items = (instances.value || [])
    .filter(i => i.startTime)
    .map(i => {
      const s = toMin(i.startTime)
      return { ...i, s, e: toMin(i.endTime) ?? s + 60 }
    })
    .sort((a, b) => a.s - b.s)
  return items.map((b, k) => {
    const s = Math.min(Math.max(b.s, SCH_START * 60), SCH_END * 60 - 15)
    const e = Math.min(Math.max(b.e, s + 15), SCH_END * 60)
    const clash = items.some((o, j) => j !== k && b.s < o.e && o.s < b.e)
    return { ...b, top: (s - SCH_START * 60) / 60 * SCH_ROW + 2, h: (e - s) / 60 * SCH_ROW - 4,
      clash, span: `${fmtMin(s)}–${fmtMin(e)}` }
  })
})
const unscheduled = computed(() => (instances.value || []).filter(i => !i.startTime))

function assign(i, h) {
  const s = `${String(h).padStart(2, '0')}:00`
  const e = `${String(Math.min(h + 1, 24)).padStart(2, '0')}:00`
  return db.taskInstances.update(i.id, { startTime: s, endTime: e }).then(() => { pick.value = null })
}
function clearBlock(b) {
  return db.taskInstances.update(b.id, { startTime: null, endTime: null })
}

const nowMin = ref(null)
let clock = null
onMounted(() => {
  const tick = () => { const d = new Date(); nowMin.value = d.getHours() * 60 + d.getMinutes() }
  tick(); clock = setInterval(tick, 30000)
})
onUnmounted(() => clearInterval(clock))
const nowPct = computed(() => (day.value === today() && nowMin.value !== null ? nowMin.value / 1440 * 100 : null))

// ---------- 看板：待办 / 进行中 / 已完成，可跨栏拖拽 ----------
const colTodo = ref([]), colDoing = ref([]), colDone = ref([])
watch(() => instances.value, (list) => {
  const by = s => (list || []).filter(i => i.status === s).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  colTodo.value = by('todo'); colDoing.value = by('doing'); colDone.value = by('done')
}, { immediate: true })

const boardCols = computed(() => [
  { key: 'todo', name: '待办', list: colTodo.value },
  { key: 'doing', name: '进行中', list: colDoing.value },
  { key: 'done', name: '已完成', list: colDone.value },
])

async function persistBoard() {
  for (const [status, arr] of [['todo', colTodo.value], ['doing', colDoing.value], ['done', colDone.value]]) {
    for (let idx = 0; idx < arr.length; idx++) {
      const i = arr[idx]
      const patch = { status, order: idx }
      if (status === 'done' && !i.completedAt) patch.completedAt = new Date().toISOString()
      if (status !== 'done' && i.completedAt) patch.completedAt = null
      await db.taskInstances.update(i.id, patch)
    }
  }
}

// ---------- 长期计划的时间尺（frappe-gantt，默认不开，避免时间刻度压迫感） ----------
const longView = ref('list') // list | gantt
const ganttMode = ref('Month') // Week | Month | Year
const ganttEl = ref(null)
let gantt = null

const longList = computed(() => (longTasks.value || []).filter(t => !t.deletedAt))
const ganttItems = computed(() => longList.value.filter(t => t.deadline).map(t => {
  const end = dayjs(t.deadline)
  const born = dayjs(t.createdAt || Date.now())
  return {
  id: 'g' + t.id,
  name: t.title,
  start: (born.isAfter(end) ? end.subtract(1, 'day') : born).format('YYYY-MM-DD'),
  end: t.deadline,
  progress: t.status === 'done' ? 100 : 0,
  custom_class: t.status === 'done' ? 'g-done' : (t.deadline < today() ? 'g-late' : ''),
  }
}))
const undatedCount = computed(() => longList.value.filter(t => !t.deadline).length)

function renderGantt() {
  if (!ganttEl.value || !ganttItems.value.length) return
  if (gantt) { gantt.refresh(ganttItems.value); return }
  gantt = new Gantt(ganttEl.value, ganttItems.value, {
    language: 'zh-CN',
    view_mode: ganttMode.value,
    readonly: true,          // 只读：改期仍在清单里改，甘特只负责看
    today_button: true,
    bar_height: 32,
    bar_corner_radius: 6,
    padding: 20,
    popup: ctx => {
      ctx.set_title(ctx.task.name)
      ctx.set_subtitle('')
      ctx.set_details(`${dayjs(ctx.task._start).format('YYYY-MM-DD')} → ${dayjs(ctx.task._end).format('YYYY-MM-DD')}`)
    },
  })
}
watch(() => longView.value, async v => {
  gantt = null // 容器随 v-if 重建，实例一并重建
  if (v === 'gantt') { await nextTick(); renderGantt() }
})
watch(() => ganttItems.value.length, () => { if (longView.value === 'gantt') renderGantt() })
watch(ganttMode, m => { if (gantt) gantt.change_view_mode(m) })

async function revive(i) {
  await db.taskInstances.update(i.id, { date: today() }) // 一键复活到今天
}
async function archive(i) {
  await db.taskInstances.update(i.id, { status: 'archived' })
}
async function doneLong(x) {
  await db.tasks.update(x.id, { status: 'done' })
}
async function delTask(id) {
  await db.tasks.update(id, { deletedAt: Date.now() }) // 软删除 → 回收站，30 天后自动清理
  showUndo('已收进回收站', () => db.tasks.update(id, { deletedAt: undefined }))
}
</script>

<template>
  <div>
    <div class="subnav spread">
      <div class="row" style="flex-wrap:wrap">
        <button class="pill" :class="{ on: sub === 'short' }" @click="sub = 'short'">日常与重复</button>
        <button class="pill" :class="{ on: sub === 'long' }" @click="sub = 'long'">遥远的目标</button>
        <button class="pill" :class="{ on: sub === 'forgotten' }" @click="sub = 'forgotten'">
          搁浅的计划{{ (forgotten||[]).length ? ` (${forgotten.length})` : '' }}
        </button>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn small" @click="openSpeak">说出来</button>
        <button class="btn small" @click="openForm">＋ 新事</button>
      </div>
    </div>

    <div v-if="showSpeak" class="card">
      <h3>说出来，我拆成清单</h3>
      <div class="row" style="align-items:flex-start; margin-bottom:8px">
        <n-input v-model:value="spoken" type="textarea" :rows="2" class="grow"
          placeholder="一口气说完，比如：下午三点交周报，明天记得取快递，还有看两页书" />
        <button v-if="canDictate" class="btn small" :class="{ on: listening }" @click="toggleListen">
          {{ listening ? '■ 停下' : '说' }}
        </button>
      </div>
      <div v-if="interim" class="muted" style="margin-bottom:6px">正在听：{{ interim }}</div>
      <div class="row" style="margin-bottom:8px">
        <button class="btn" :disabled="splitting || !spoken.trim()" @click="splitSpoken">
          {{ splitting ? '拆着…' : '拆成任务' }}
        </button>
        <span v-if="speakErr" class="muted">{{ speakErr }}</span>
      </div>
      <div v-if="candidates.length" class="speak-list">
        <div v-for="(c, i) in candidates" :key="i" class="speak-item">
          <input type="checkbox" v-model="c.on" />
          <input v-model="c.title" class="speak-title grow" />
          <button class="pill" @click="cycleDate(c)">{{ DATE_LABEL[c.date] }}</button>
          <input type="time" v-model="c.time" style="width:96px" title="执行时间" />
          <span v-if="c.catName" class="tag" style="padding:2px 9px; font-size:12px">{{ c.catName }}</span>
        </div>
      </div>
      <div v-if="candidates.length" class="row" style="margin-top:10px">
        <button class="btn" :disabled="!chosen.length" @click="saveSpoken">存下这 {{ chosen.length }} 件</button>
        <span class="muted">不想要的，把勾去掉</span>
      </div>
    </div>

    <div v-if="showForm" class="card">
      <div class="row" style="margin-bottom:8px">
        <n-input v-model:value="form.title" placeholder="想做成什么？" class="grow" @keyup.enter="addTask" />
        <n-select v-model:value="form.type" style="width:110px" size="small"
          :options="[{label:'短期',value:'short'},{label:'长期',value:'long'}]" />
      </div>
      <div class="row" style="margin-bottom:8px; flex-wrap:wrap">
        <n-select v-model:value="form.categoryId" style="width:130px" size="small" :options="catOptions" />
        <input v-if="form.type === 'long'" type="date" v-model="form.deadline" class="grow" style="width:auto" title="截止日" />
        <template v-if="form.type === 'short'">
          <input type="date" v-model="form.date" style="width:160px" title="安排在哪天" />
          <input type="time" v-model="form.defaultTime" style="width:120px" title="执行时间（可选，用于时间轴排序）" />
        </template>
      </div>
      <div class="row" v-if="form.type === 'short'" style="margin-bottom:8px; flex-wrap:wrap">
        <span class="muted">节奏：</span>
        <n-select v-model:value="form.freq" style="width:130px" size="small" :options="[
          { label: '不重复', value: 'none' },
          { label: '每天', value: 'daily' },
          { label: '仅工作日', value: 'weekdays' },
          { label: '每周的某几天', value: 'weekly' },
          { label: '每隔几天', value: 'interval' },
        ]" />
        <template v-if="form.freq === 'weekly'">
          <button v-for="(w, i) in WD" :key="i" class="pill"
            :class="{ on: form.byweekday.includes(i) }"
            @click="form.byweekday.includes(i) ? form.byweekday.splice(form.byweekday.indexOf(i), 1) : form.byweekday.push(i)">
            {{ w }}
          </button>
        </template>
        <input v-if="form.freq === 'interval'" type="number" v-model="form.interval" min="1" style="width:70px" />
      </div>
      <button class="btn" @click="addTask">{{ editId ? '改好' : '存下' }}</button>
      <button v-if="editId" class="btn plain" style="margin-left:8px" @click="openForm(); showForm = false">取消改动</button>
    </div>

    <!-- 短期/重复：今日实例 -->
    <template v-if="sub === 'short'">
      <div class="row spread" style="margin-bottom:10px; flex-wrap:wrap">
        <div class="row">
          <button class="pill" :class="{ on: view === 'list' }" @click="view = 'list'">清单</button>
          <button class="pill" :class="{ on: view === 'timeline' }" @click="view = 'timeline'">时间轴</button>
          <button class="pill" :class="{ on: view === 'board' }" @click="view = 'board'">看板</button>
          <button class="pill" :class="{ on: view === 'schedule' }" @click="view = 'schedule'">日程</button>
          <button class="pill" :class="{ on: withResearch }" @click="withResearch = !withResearch"
            title="科研待办默认不在此页">含科研</button>
        </div>
        <div class="row" style="gap:6px">
          <button class="pill" @click="shiftDay(-1)" title="前一天">‹</button>
          <input type="date" v-model="day" style="width:160px" />
          <button class="pill" @click="shiftDay(1)" title="后一天">›</button>
          <button class="pill" :class="{ on: day === today() }" @click="day = today()">今天</button>
        </div>
      </div>

      <!-- 列表视图（默认，无时间刻度） -->
      <div v-if="view === 'list'" class="card">
        <h3>{{ dayLabel }}的清单</h3>
        <n-empty v-if="!(instances||[]).length" description="今天的清单还是空的" size="small" />
        <p v-else class="touch-hint muted" style="font-size:12.5px; margin:-2px 0 8px">手机上：左滑一行完成它，长按一下改这件事</p>
        <div v-for="i in instances" :key="i.id" class="task-row"
          @touchstart.passive="rowStart(i, $event)" @touchmove.passive="rowMove" @touchend.passive="rowEnd"
          @touchcancel.passive="rowCancel">
          <div class="circle" :class="{ done: i.status === 'done' }" @click="toggle(i)">✓</div>
          <div class="task-main">
            <div class="task-title" :class="{ done: i.status === 'done' }">{{ i.task.title }}</div>
            <div class="task-meta">
              <n-tag v-if="i.task.categoryId && catMap[i.task.categoryId]" size="tiny" round
                :color="{ color: catMap[i.task.categoryId].color, textColor: '#fff' }">
                {{ catMap[i.task.categoryId].name }}
              </n-tag>
              <span v-if="i.task.defaultTime">⏰ {{ i.task.defaultTime }}</span>
              <span v-if="rruleLabel(i.task)">{{ rruleLabel(i.task) }}</span>
              <span v-if="fmtDuration(i.durationMin)">⏱ {{ fmtDuration(i.durationMin) }}</span>
              <span v-if="i.timerStart" class="timer-on">● 计时中</span>
            </div>
          </div>
          <div class="row" style="gap:4px; flex-wrap:nowrap">
            <n-button v-if="!i.timerStart && i.status !== 'done'" quaternary size="tiny" type="primary" @click="startTimer(i)">▶ 计时</n-button>
            <n-button v-else-if="i.timerStart" quaternary size="tiny" type="warning" @click="stopTimer(i)">■ 停下</n-button>
            <n-popover trigger="click" :show-arrow="false" v-if="i.status !== 'done'">
              <template #trigger><n-button quaternary size="tiny">＋补记</n-button></template>
              <div class="row">
                <n-input-number v-model:value="manual.min" size="small" :min="1" style="width:90px" />
                <n-button size="small" type="primary" @click="addManual(i)">确定</n-button>
              </div>
            </n-popover>
            <n-button quaternary size="tiny" type="error" @click="delTask(i.task.id)">删除</n-button>
          </div>
        </div>
      </div>

      <!-- 看板视图：三栏拖拽 -->
      <div v-else-if="view === 'board'" class="board">
        <div v-for="col in boardCols" :key="col.key" class="board-col">
          <div class="board-head">{{ col.name }}<span class="board-cnt">{{ col.list.length }}</span></div>
          <VueDraggable v-model="col.list" group="board" :animation="160" class="board-list" @end="persistBoard">
            <div v-for="i in col.list" :key="i.id" class="board-item">
              <div class="task-title" :class="{ done: i.status === 'done' }">{{ i.task?.title }}</div>
              <div class="task-meta">
                <span v-if="i.task?.defaultTime">{{ i.task.defaultTime }}</span>
                <span v-if="fmtDuration(i.durationMin)">{{ fmtDuration(i.durationMin) }}</span>
              </div>
            </div>
          </VueDraggable>
        </div>
      </div>

      <!-- 日程：把这一天切成时段，事情放进去 -->
      <div v-else-if="view === 'schedule'" class="card">
        <h3>{{ dayLabel }}的时段<span class="cnt">已排 {{ scheduled.length }} 件 · 未排 {{ unscheduled.length }} 件</span></h3>
        <div class="sch">
          <div v-for="h in SCH_HOURS" :key="h" class="sch-row">
            <span class="sch-h">{{ String(h).padStart(2, '0') }}:00</span>
            <button class="sch-slot" :title="`把事情排到 ${h} 点`" @click="pick = (pick === h ? null : h)">＋</button>
          </div>
          <div v-for="b in scheduled" :key="b.id" class="sch-block" :class="{ done: b.status === 'done', clash: b.clash }"
            :style="{ top: b.top + 'px', height: b.h + 'px' }">
            <span class="sch-t">{{ b.task.title }}</span>
            <span class="sch-d">{{ b.span }}</span>
            <button class="sch-x" title="取消排程" @click.stop="clearBlock(b)">×</button>
          </div>
        </div>
        <div v-if="pick !== null" class="sch-pick">
          <span class="muted">排到 {{ String(pick).padStart(2, '0') }}:00 →</span>
          <button v-for="i in unscheduled" :key="i.id" class="pill" @click="assign(i, pick)">
            <span v-if="i.task.defaultTime" class="sch-hint">⏰{{ i.task.defaultTime }}</span>{{ i.task.title }}
          </button>
          <button class="pill" @click="pick = null">算了</button>
        </div>
        <div v-if="!scheduled.length && !unscheduled.length" class="empty-box">
          这一天还没有事。<br />先去上面「今日之计」里定几件，再来给它们分时段。
        </div>
      </div>

      <!-- 时间轴：先看横轴概览，再沿竖轴走一遍这一日 -->
      <div v-else class="card">
        <h3>{{ dayLabel }}的一天<span class="cnt">共 {{ timedItems.length + untimedItems.length }} 件 · 已定时 {{ timedItems.length }} 件</span></h3>
        <div v-if="!timedItems.length && !untimedItems.length" class="empty-box">
          这一天还空着。<br />给事情定个时刻，它就会落在这条轴上。
        </div>
        <div v-else>
          <!-- 横轴：左 00:00 · 右 24:00 -->
          <div class="hday">
            <div class="haxis-label">一日长河</div>
            <div class="htrack">
              <span v-for="h in [0,3,6,9,12,15,18,21,24]" :key="h" class="htick" :style="{ left: h / 24 * 100 + '%' }">
                <i /><em>{{ h }}</em>
              </span>
              <span v-if="nowPct !== null" class="hnow" :style="{ left: nowPct + '%' }"><i /><em>此刻</em></span>
              <span v-for="(i, idx) in timedItems" :key="i.id" class="hnode" :class="{ done: i.status === 'done', up: idx % 2 === 0 }"
                :style="{ left: i.min / 1440 * 100 + '%' }" @click="toggle(i)">
                <i /><em>{{ i.task.defaultTime }} {{ i.task.title }}</em>
              </span>
            </div>
            <div v-if="untimedItems.length" class="hfree">
              <span class="muted">未定时刻：</span>
              <button v-for="i in untimedItems" :key="i.id" class="pill" :class="{ on: i.status === 'done' }" @click="toggle(i)">
                {{ i.task.title }}
              </button>
            </div>
          </div>

          <div class="axis-split"></div>

          <!-- 竖轴：粉色长线串起这一日 -->
          <div class="tl-line" style="margin-top:4px">
            <div v-for="i in tlItems" :key="i.id" class="tl-item" :class="{ done: i.status === 'done' }">
              <div class="row" style="align-items:flex-start">
                <span class="tl-time">{{ i.task.defaultTime || '—' }}</span>
                <div class="task-main">
                  <div class="task-title" :class="{ done: i.status === 'done' }">{{ i.task.title }}</div>
                  <div class="task-meta">
                    <span v-if="rruleLabel(i.task)">{{ rruleLabel(i.task) }}</span>
                    <span v-if="fmtDuration(i.durationMin)">⏱ {{ fmtDuration(i.durationMin) }}</span>
                  </div>
                </div>
                <div class="circle" :class="{ done: i.status === 'done' }" @click="toggle(i)">✓</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 长任务 -->
    <div v-if="sub === 'long'" class="card">
      <div class="row spread" style="margin-bottom:10px; flex-wrap:wrap">
        <h3 style="margin:0">遥远的目标</h3>
        <div class="row">
          <button class="pill" :class="{ on: longView === 'list' }" @click="longView = 'list'">清单</button>
          <button class="pill" :class="{ on: longView === 'gantt' }" @click="longView = 'gantt'">进度尺</button>
        </div>
      </div>

      <template v-if="longView === 'gantt'">
        <div class="row" style="margin-bottom:10px; flex-wrap:wrap">
          <button v-for="m in ['Week','Month','Year']" :key="m" class="pill" :class="{ on: ganttMode === m }" @click="ganttMode = m">
            {{ { Week: '按周', Month: '按月', Year: '按年' }[m] }}
          </button>
          <span class="muted">竖线是今天 · 点色条看起止</span>
        </div>
        <div v-if="!ganttItems.length" class="empty-box">
          还没有定下截止日的目标。<br />给遥远的目标填一个期限，它就会出现在尺上。
        </div>
        <template v-else>
          <div ref="ganttEl" class="gantt-box"></div>
          <div class="muted" style="margin-top:8px">
            横条从立下那天拉到截止日<span v-if="undatedCount">；另有 {{ undatedCount }} 个目标还没定截止日，故不在此尺上</span>
          </div>
        </template>
      </template>

      <n-empty v-if="!longList.length" description="还没有立下遥远的目标" size="small" />
      <div v-for="x in [...longList].sort((a,b)=>(a.deadline||'9').localeCompare(b.deadline||'9'))" :key="x.id" class="task-row">
        <div class="task-main">
          <div class="task-title">{{ x.title }}</div>
          <div class="task-meta">
            <span v-if="x.deadline">截止 {{ x.deadline }}</span>
            <span v-if="x.deadline && x.deadline < today()" class="badge-danger">已逾期</span>
          </div>
        </div>
        <n-button size="tiny" type="primary" secondary @click="doneLong(x)">完成</n-button>
        <n-button size="tiny" quaternary @click="delTask(x.id)">删除</n-button>
      </div>
    </div>

    <!-- 被遗忘的计划 -->
    <div v-if="sub === 'forgotten'" class="card">
      <h3>搁浅的计划</h3>
      <n-empty v-if="!(forgotten||[]).length" description="没有搁浅的事，很棒" size="small" />
      <div v-for="i in forgotten" :key="i.id" class="task-row">
        <div class="task-main">
          <div class="task-title">{{ i.task.title }}</div>
          <div class="task-meta">曾计划在 {{ i.date }}</div>
        </div>
        <n-button size="tiny" type="primary" @click="revive(i)">回到今天</n-button>
        <n-button size="tiny" quaternary @click="archive(i)">收进旧档</n-button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.board { display: grid; grid-template-columns: 1fr; gap: 12px; margin-bottom: 12px; }
@media (min-width: 900px) { .board { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.board-col { background: #fff; border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; }
.board-head { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; margin-bottom: 10px; }
.board-cnt { font-size: 11.5px; font-weight: 400; color: var(--text-3); background: var(--bg-sunken); border-radius: var(--r-sm); padding: 1px 7px; }
.board-list { min-height: 60px; display: flex; flex-direction: column; gap: 8px; }
.board-item { background: var(--card); border: 1px solid var(--line); border-radius: var(--r-box); padding: 10px 12px; cursor: grab; transition: border-color .15s; }
.board-item:hover { border-color: var(--primary); }
.board-item:active { cursor: grabbing; }
.board-item .task-title { font-size: 13.5px; font-weight: 500; }
.hday { padding: 12px 0 4px; }
.haxis-label { font-size: 12px; font-weight: 400; color: var(--text-3); letter-spacing: .02em; margin: 0 0 8px 4px; }
.axis-split { height: 1px; background: var(--line); margin: 16px 0 12px; }
.htrack { position: relative; height: 96px; margin: 0 36px; }
.htrack::before { content: ''; position: absolute; left: 0; right: 0; top: 47px; height: 1px; background: var(--line-2); }
.htick i, .hnow i, .hnode i { position: absolute; left: 0; top: 47px; width: 1px; height: 7px; background: var(--line-2); }
.hnow i { background: var(--danger); height: 96px; top: 0; }
.htick em, .hnow em { position: absolute; top: 58px; left: 0; transform: translateX(-50%); font-size: 11px; font-style: normal; color: var(--text-3); white-space: nowrap; }
.hnow em { top: -2px; color: var(--danger); font-weight: 500; }
.hnode { cursor: pointer; }
.hnode i { top: 41px; width: 1px; height: 13px; background: var(--primary); }
.hnode em { position: absolute; top: 68px; left: 0; transform: translateX(-50%); max-width: 140px; overflow: hidden; text-overflow: ellipsis; font-size: 11.5px; font-style: normal; font-weight: 400; white-space: nowrap; background: #fff; border: 1px solid var(--line); border-radius: var(--r-sm); padding: 1px 6px; }
.hnode.up em { top: 4px; }
.hnode.up i { top: 18px; }
.hnode.done i { background: var(--text); }
.hnode.done em { color: var(--text-2); text-decoration: line-through; }
.hfree { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 10px 4px 0; }
.gantt-box { overflow-x: auto; background: var(--bg-sunken); border: 1px solid var(--line); border-radius: var(--radius); padding: 10px; }
.gantt-box .gantt .bar-wrapper.g-done .bar { fill: var(--text-3); }
.gantt-box .gantt .bar-wrapper.g-done .bar-progress { fill: var(--text-2); }
.gantt-box .gantt .bar-wrapper.g-late .bar { fill: #fde2e2; /* var(--danger) 淡色，逾期未完成 */ }
.gantt-box .gantt .bar-wrapper.g-late .bar-progress { fill: var(--danger); }
.gantt-box .gantt .bar-label { fill: var(--text); font-weight: 500; }
.gantt-box .gantt .today-highlight { fill: rgba(64,158,255,.08); }
/* 说出来 → 候选清单 */
.speak-list { display: flex; flex-direction: column; gap: 6px; }
.speak-item { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.speak-title {
  min-width: 160px; padding: 6px 10px; font: inherit; font-size: 13px; color: var(--text);
  background: var(--card-alt); border: 1px solid var(--line); border-radius: var(--r-input);
}
.speak-title:focus { outline: none; border-color: var(--primary-hover); }

/* 日程（时间块排程） */
.sch { position: relative; }
.sch-row { display: flex; align-items: center; gap: 8px; height: 44px; border-bottom: 1px solid var(--line); }
.sch-row:last-child { border-bottom: none; }
.sch-h { width: 46px; flex-shrink: 0; font-size: 11.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.sch-slot {
  flex: 1; height: 34px; margin-left: 6px;
  border: 1px dashed var(--line); border-radius: var(--r-sm);
  background: #fff; color: var(--text-3); font-size: 14px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; transition: all .15s;
}
.sch-slot:hover { border-color: var(--primary); color: var(--primary); }
.sch-block {
  position: absolute; left: 60px; right: 0; display: flex; align-items: center; gap: 8px;
  padding: 0 10px; border-radius: var(--r-sm);
  background: var(--primary-soft); border: 1px solid #c6e2ff;
  font-size: 12.5px; color: var(--text); overflow: hidden;
  transition: opacity .15s;
  pointer-events: none; /* 让底下时段的「＋」仍然点得到 */
}
.sch-block.done { opacity: .55; }
.sch-block.done .sch-t { text-decoration: line-through; }
.sch-block.clash { background: var(--danger-soft); border-color: #fbc4c4; }
.sch-t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sch-d { font-size: 11.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.sch-x { border: none; background: none; color: var(--text-3); cursor: pointer; font-size: 15px; line-height: 1; padding: 0 2px; flex-shrink: 0; pointer-events: auto; }
.sch-x:hover { color: var(--danger); }
.sch-pick { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.sch-hint { color: var(--text-3); font-size: 11.5px; margin-right: 4px; font-variant-numeric: tabular-nums; }
</style>
