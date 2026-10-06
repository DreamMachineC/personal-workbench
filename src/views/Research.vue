<template>
  <div>
    <div class="subnav">
      <button class="pill" :class="{ on: sub === 'project' }" @click="sub = 'project'">课题</button>
      <button class="pill" :class="{ on: sub === 'direction' }" @click="sub = 'direction'">方向</button>
      <button class="pill" :class="{ on: sub === 'todo' }" @click="sub = 'todo'">待办</button>
      <button class="pill" :class="{ on: sub === 'note' }" @click="sub = 'note'">心得</button>
    </div>

    <div class="two-col">
      <div>
        <!-- 课题 -->
        <div v-if="sub === 'project'" class="card">
          <h3>手上的课题 · {{ (projects || []).length }} 个</h3>
          <div class="row" style="margin-bottom:12px; flex-wrap:wrap">
            <n-input v-model:value="pf.name" placeholder="这个课题叫什么" class="grow" @keyup.enter="addProject" />
            <n-select v-model:value="pf.directionId" size="small" style="width:160px" :options="dirOptions" />
            <input type="date" v-model="pf.deadline" style="width:auto" title="预期收束的日子" />
            <n-button type="primary" @click="addProject">立题</n-button>
          </div>
          <n-empty v-if="!(projects || []).length" description="还没有立下的课题" size="small" />
          <div v-for="p in sortedProjects" :key="p.id" class="task-row">
            <div class="task-main">
              <div class="task-title" :class="{ done: p.status === 'done' }">{{ p.name }}</div>
              <div class="task-meta">
                <span v-if="dirName(p)">{{ dirName(p) }}</span>
                <span v-if="p.deadline">{{ p.deadline }} · {{ leftLabel(p) }}</span>
                <span>{{ statusLabel(p) }}</span>
                <span v-if="p.note">{{ p.note }}</span>
              </div>
              <!-- 子任务：课题拆出来的"下一步"，完成率反过来决定上面那条进度 -->
              <div v-if="subsOf(p.id).length" class="subs">
                <div v-for="s in subsOf(p.id)" :key="s.id" class="sub-row">
                  <div class="circle" :class="{ done: s.done }" @click="toggleSub(s)">✓</div>
                  <span class="sub-t" :class="{ done: s.done }">{{ s.title }}</span>
                  <button class="sub-x" title="删掉这一步" @click="delSub(s)">×</button>
                </div>
              </div>
              <div class="row" style="margin-top:6px; gap:6px">
                <n-input v-model:value="subDraft[p.id]" placeholder="下一步要做什么" size="small" class="grow"
                  @keyup.enter="addSub(p)" />
                <n-button size="small" type="primary" @click="addSub(p)">添一步</n-button>
              </div>

              <div class="mini-track" style="margin-top:7px">
                <div class="mini-fill" :class="{ ok: progressOf(p) >= 100 }" :style="{ width: progressOf(p) + '%' }" />
              </div>
            </div>
            <div class="row" style="flex-wrap:wrap; justify-content:flex-end">
              <span class="pct">{{ progressOf(p) }}%{{ subsOf(p.id).length ? ' · 自动' : '' }}</span>
              <button class="pill" v-if="p.status !== 'done' && !subsOf(p.id).length" @click="bump(p, 10)">＋10</button>
              <button class="pill" v-if="p.status !== 'done'" @click="toggleStatus(p)">{{ p.status === 'paused' ? '继续' : '暂搁' }}</button>
              <button class="pill" :class="{ on: p.status === 'done' }" @click="finish(p)">{{ p.status === 'done' ? '重开' : '收束' }}</button>
              <n-popconfirm @positive-click="delProject(p)">
                <template #trigger><n-button quaternary size="tiny" type="error">删除</n-button></template>
                先收进回收站，想留还能取回
              </n-popconfirm>
            </div>
          </div>
        </div>

        <!-- 方向 -->
        <div v-if="sub === 'direction'" class="card">
          <h3>长期跟踪的方向</h3>
          <div class="row" style="margin-bottom:12px">
            <n-input v-model:value="newDir" placeholder="一条想长期跟下去的线" class="grow" @keyup.enter="addDir" />
            <n-button type="primary" @click="addDir">添一条</n-button>
          </div>
          <n-empty v-if="!(directions || []).length" description="还没有定下方向" size="small" />
          <div v-for="d in directions" :key="d.id" class="goal-row">
            <div>
              <div class="goal-t">{{ d.name }}</div>
              <div class="muted" v-if="d.note">{{ d.note }}</div>
            </div>
            <div class="row">
              <span class="goal-d">{{ countOf(d.id) }} 个课题</span>
              <n-popconfirm @positive-click="archiveDir(d)">
                <template #trigger><n-button quaternary size="tiny">收起</n-button></template>
                收起这条方向？（课题保留）
              </n-popconfirm>
            </div>
          </div>
        </div>

        <!-- 待办 -->
        <div v-if="sub === 'todo'" class="card">
          <h3>科研待办 · 只在这里出现</h3>
          <div class="row" style="margin-bottom:12px">
            <n-input v-model:value="newTodo" placeholder="下一步要做什么" class="grow" @keyup.enter="addTodo" />
            <n-button type="primary" @click="addTodo">记下</n-button>
          </div>
          <n-empty v-if="!(todos || []).length" description="这一块暂时清空了" size="small" />
          <div v-for="r in todos" :key="r.task.id" class="task-row">
            <div class="task-main">
              <div class="task-title" :class="{ done: r.inst?.status === 'done' }">{{ r.task.title }}</div>
              <div class="task-meta">{{ r.inst?.date || '待安排' }}</div>
            </div>
            <div class="circle" :class="{ done: r.inst?.status === 'done' }" @click="toggleTodo(r)">✓</div>
            <n-popconfirm @positive-click="delTodo(r)">
              <template #trigger><n-button quaternary size="tiny" type="error">删除</n-button></template>
              先收进回收站，想留还能取回
            </n-popconfirm>
          </div>
          <div class="muted" style="margin-top:10px">
            这些事的统计只在科研页内计算，不进主页的今日统计、进度圈与搁浅清单
          </div>
        </div>

        <!-- 心得 -->
        <div v-if="sub === 'note'" class="card">
          <h3>心得笔记</h3>
          <div class="row" style="margin-bottom:8px; flex-wrap:wrap">
            <n-input v-model:value="nf.title" placeholder="记个标题" style="width:220px" />
            <n-select v-model:value="nf.projectId" size="small" style="width:170px" :options="projOptions" />
          </div>
          <n-input v-model:value="nf.text" type="textarea" rows="3" placeholder="读到的、想到的、卡住的地方…" />
          <div class="row" style="margin-top:8px">
            <n-button type="primary" @click="addNote">存下这篇</n-button>
          </div>
          <div style="margin-top:14px">
            <n-empty v-if="!(notes || []).length" description="还没有写下第一篇" size="small" />
            <div v-for="n in notes" :key="n.id" class="word-row">
              <div class="row spread">
                <div class="word-t"><b>{{ n.title || '无题' }}</b></div>
                <n-popconfirm @positive-click="delNote(n)">
                  <template #trigger><n-button quaternary size="tiny" type="error">删除</n-button></template>
                  先收进回收站，想留还能取回
                </n-popconfirm>
              </div>
              <div class="word-t">{{ n.text }}</div>
              <div class="word-d">
                {{ dayjs(n.createdAt).format('YYYY-MM-DD HH:mm') }}
                <span v-if="projName(n)"> · {{ projName(n) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="col-side">
        <div class="side-card">
          <h3>科研日程</h3>
          <div class="row" style="margin-bottom:8px; flex-wrap:wrap">
            <input type="date" v-model="ef.date" style="width:auto" />
            <n-input v-model:value="ef.title" placeholder="这天的安排" class="grow" @keyup.enter="addEvent" />
          </div>
          <n-button size="small" type="primary" secondary @click="addEvent">添进总日历</n-button>
          <div style="margin-top:12px">
            <n-empty v-if="!upcoming.length" description="近期没有科研安排" size="small" />
            <div v-for="e in upcoming" :key="e.id" class="goal-row">
              <div class="goal-t">{{ e.title }}</div>
              <div class="row">
                <span class="goal-d" :class="{ hot: e.date <= today() }">{{ dayLabel(e.date) }}</span>
                <n-popconfirm @positive-click="delEvent(e)">
                  <template #trigger><n-button quaternary size="tiny" type="error">删</n-button></template>
                  从日历里去掉这一条？
                </n-popconfirm>
              </div>
            </div>
          </div>
          <div class="muted" style="margin-top:8px">写在这里的安排会带「科研」标记汇入总日历</div>
        </div>

        <div class="side-card">
          <h3>这一摊的进度</h3>
          <div class="mini-row">
            <div class="mini-top"><span>进行中的课题</span><span class="mini-num">{{ activeProjects.length }} 个</span></div>
            <div class="mini-track">
              <div class="mini-fill" :class="{ ok: avgProgress >= 100 }" :style="{ width: avgProgress + '%' }" />
            </div>
            <div class="muted" style="margin-top:5px">平均推进 {{ avgProgress }}%</div>
          </div>
          <div class="goal-row"><span class="goal-t">待办</span><span class="goal-d">{{ todoDone }}/{{ (todos || []).length }} 已完成</span></div>
          <div class="goal-row"><span class="goal-t">心得</span><span class="goal-d">{{ (notes || []).length }} 篇</span></div>
          <div class="goal-row"><span class="goal-t">方向</span><span class="goal-d">{{ (directions || []).length }} 条在跟</span></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { NInput, NButton, NSelect, NEmpty, NPopconfirm } from 'naive-ui'
import dayjs from 'dayjs'
import { db } from '../db'
import { today } from '../date'
import {
  useResearchProjects, useResearchDirections, useResearchNotes, useResearchSubtasks,
  useResearchTodos, useResearchEvents, ensureResearchCategoryId
} from '../composables'

const projects = useResearchProjects()
const directions = useResearchDirections()
const notes = useResearchNotes()
const subtasks = useResearchSubtasks()
const todos = useResearchTodos()
const events = useResearchEvents()

const sub = ref('project')
const pf = ref({ name: '', directionId: null, deadline: '' })
const newDir = ref('')
const newTodo = ref('')
const nf = ref({ title: '', text: '', projectId: null })
const ef = ref({ date: today(), title: '' })

const dirName = p => (directions.value || []).find(d => d.id === p.directionId)?.name || ''
const projName = n => (projects.value || []).find(p => p.id === n.projectId)?.name || ''
const dirOptions = computed(() => [
  { label: '未归方向', value: null },
  ...(directions.value || []).map(d => ({ label: d.name, value: d.id })),
])
const projOptions = computed(() => [
  { label: '不挂课题', value: null },
  ...(projects.value || []).map(p => ({ label: p.name, value: p.id })),
])

// 子任务：课题下的"下一步"。挂了子任务的课题，进度由完成率算出来，不再手动加减
const subsOf = id => (subtasks.value || []).filter(s => s.projectId === id)
const progressOf = p => {
  const list = subsOf(p.id)
  if (!list.length) return p.progress || 0
  return Math.round(list.filter(s => s.done).length / list.length * 100)
}
const subDraft = ref({})
async function addSub(p) {
  const t = (subDraft.value[p.id] || '').trim()
  if (!t) return
  await db.researchSubtasks.add({
    projectId: p.id, title: t, done: false, createdAt: Date.now(), deletedAt: undefined,
  })
  subDraft.value = { ...subDraft.value, [p.id]: '' }
}
async function toggleSub(s) { await db.researchSubtasks.update(s.id, { done: !s.done }) }
async function delSub(s) { await db.researchSubtasks.update(s.id, { deletedAt: Date.now() }) }

const statusLabel = p => ({ active: '推进中', paused: '暂搁', done: '已收束' }[p.status] || '推进中')
const sortedProjects = computed(() => [...(projects.value || [])].sort((a, b) => {
  const rank = { active: 0, paused: 1, done: 2 }
  return (rank[a.status] ?? 0) - (rank[b.status] ?? 0) || (a.deadline || '9').localeCompare(b.deadline || '9')
}))
const activeProjects = computed(() => (projects.value || []).filter(p => p.status !== 'done'))
const avgProgress = computed(() => {
  const list = activeProjects.value
  if (!list.length) return 0
  // 用 progressOf，跟课题卡上那条进度同一口径（挂了子任务的按完成率算）
  return Math.round(list.reduce((s, p) => s + progressOf(p), 0) / list.length)
})
const todoDone = computed(() => (todos.value || []).filter(r => r.inst?.status === 'done').length)
const countOf = id => (projects.value || []).filter(p => p.directionId === id).length
const upcoming = computed(() => (events.value || []).filter(e => e.date >= today()).slice(0, 8))
const leftLabel = p => {
  const d = dayjs(p.deadline).diff(dayjs(today()), 'day')
  if (d < 0) return `已过 ${-d} 天`
  if (d === 0) return '就是今天'
  if (d === 1) return '明天'
  return `还有 ${d} 天`
}
const dayLabel = d => {
  const diff = dayjs(d).diff(dayjs(today()), 'day')
  if (diff === 0) return '就是今天'
  if (diff === 1) return '明天'
  return `${d.slice(5)} · 还有 ${diff} 天`
}

async function addProject() {
  const name = pf.value.name.trim()
  if (!name) return
  await db.researchProjects.add({
    name, directionId: pf.value.directionId, deadline: pf.value.deadline || '',
    note: '', progress: 0, status: 'active', createdAt: Date.now(), deletedAt: undefined,
  })
  pf.value = { name: '', directionId: null, deadline: '' }
}
async function bump(p, step) {
  await db.researchProjects.update(p.id, { progress: Math.min(100, (p.progress || 0) + step) })
}
async function toggleStatus(p) {
  await db.researchProjects.update(p.id, { status: p.status === 'paused' ? 'active' : 'paused' })
}
async function finish(p) {
  const done = p.status !== 'done'
  // 重开一个已完成的课题：进度归零，否则进度条还是满的
  await db.researchProjects.update(p.id, { status: done ? 'done' : 'active', progress: done ? 100 : 0 })
}
async function delProject(p) {
  await db.researchProjects.update(p.id, { deletedAt: Date.now() })
}

async function addDir() {
  const name = newDir.value.trim()
  if (!name) return
  await db.researchDirections.add({ name, note: '', createdAt: Date.now(), archivedAt: undefined })
  newDir.value = ''
}
async function archiveDir(d) {
  await db.researchDirections.update(d.id, { archivedAt: Date.now() })
}

async function addTodo() {
  const title = newTodo.value.trim()
  if (!title) return
  const catId = await ensureResearchCategoryId()
  const id = await db.tasks.add({ title, type: 'short', categoryId: catId, rrule: null, status: 'active', createdAt: Date.now() })
  await db.taskInstances.add({ taskId: id, date: today(), status: 'todo', completedAt: null, durationMin: 0, timerStart: null })
  newTodo.value = ''
}
async function toggleTodo(r) {
  const t = today()
  if (r.inst?.date === t) {
    const done = r.inst.status !== 'done'
    await db.taskInstances.update(r.inst.id, { status: done ? 'done' : 'todo', completedAt: done ? Date.now() : null })
  } else {
    await db.taskInstances.add({ taskId: r.task.id, date: t, status: 'done', completedAt: Date.now(), durationMin: 0, timerStart: null })
  }
}
async function delTodo(r) {
  await db.tasks.update(r.task.id, { deletedAt: Date.now() })
}

async function addNote() {
  const text = nf.value.text.trim()
  if (!text && !nf.value.title.trim()) return
  await db.researchNotes.add({
    title: nf.value.title.trim(), text, projectId: nf.value.projectId,
    createdAt: Date.now(), deletedAt: undefined,
  })
  nf.value = { title: '', text: '', projectId: null }
}
async function delNote(n) {
  await db.researchNotes.update(n.id, { deletedAt: Date.now() })
}

async function addEvent() {
  const title = ef.value.title.trim()
  if (!title) return
  await db.events.add({ date: ef.value.date || today(), title, source: 'research' })
  ef.value.title = ''
}
async function delEvent(e) { await db.events.delete(e.id) }
</script>

<style scoped>
.pct { font-size: 12px; font-weight: 400; color: var(--text-2); font-variant-numeric: tabular-nums; }
.task-row { flex-wrap: wrap; }
/* 子任务清单 */
.subs { margin: 7px 0 0; border-left: 1px solid var(--line); padding-left: 8px; }
.sub-row { display: flex; align-items: center; gap: 7px; padding: 3px 0; }
.sub-t { flex: 1; font-size: 12.5px; color: var(--text); }
.sub-t.done { color: var(--text-3); text-decoration: line-through; }
.sub-x {
  border: none; background: none; color: var(--text-3); cursor: pointer;
  font-size: 14px; line-height: 1; padding: 0 2px;
}
.sub-x:hover { color: var(--danger); }
</style>
