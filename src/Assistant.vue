<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import dayjs from 'dayjs'
import { db } from './db'
import { today, getWeekRange, fmtDuration } from './date'
import {
  useLiveQuery, useTodayInstances, useMoods, useJournals, useSkills, useFitnessWeek, researchCatIds,
} from './composables'
import { chatReply, ASKS, loadScope } from './ai'

const open = ref(false)
const input = ref('')
const busy = ref(false)
const messages = ref([])
const boxEl = ref(null)
let ctrl = null

// ---------- 上下文：同一个 <useXXX> 的口径跟别处保持一致 ----------
const instances = useTodayInstances()
const moods = useMoods(7)
const journals = useJournals()
const skills = useSkills()
const fitness = useFitnessWeek()

const week = useLiveQuery(async () => {
  const rIds = await researchCatIds()
  const { start, end } = getWeekRange()
  const s = start.format('YYYY-MM-DD')
  const e = end.format('YYYY-MM-DD')
  const rows = await db.taskInstances.where('date').between(s, e, true, true).toArray()
  // 已删除的任务不该出现在给 AI 的近况里
  const tasks = Object.fromEntries((await db.tasks.toArray()).filter(t => !t.deletedAt).map(t => [t.id, t]))
  let plan = 0, done = 0, focus = 0
  for (const i of rows) {
    const t = tasks[i.taskId]
    if (!t || rIds.has(t.categoryId)) continue
    plan++
    if (i.status === 'done') done++
    focus += i.durationMin || 0
  }
  return { plan, done, focus }
})

const ctx = computed(() => {
  const list = instances.value || []
  const md = (moods.value || []).filter(m => m.score > 0)
  return {
    date: today(),
    todayTotal: list.length,
    todayDone: list.filter(i => i.status === 'done').length,
    todayLeft: list.filter(i => i.status !== 'done').map(i => i.task?.title).filter(Boolean),
    weekTotal: week.value?.plan || 0,
    weekDone: week.value?.done || 0,
    focus: week.value?.focus || 0,
    mood: md.length ? +(md.reduce((s, m) => s + m.score, 0) / md.length).toFixed(1) : null,
    topSkill: skills.value?.[0]?.name || '',
    body: (fitness.value || []).length,
    journal: (journals.value || [])[0]?.text || '',
  }
})

async function scrollDown() {
  await nextTick()
  if (boxEl.value) boxEl.value.scrollTop = boxEl.value.scrollHeight
}

async function send(q) {
  const text = String(q || '').trim()
  if (!text || busy.value) return
  messages.value.push({ role: 'user', text })
  input.value = ''
  const aiIdx = messages.value.push({ role: 'ai', text: '' }) - 1
  busy.value = true
  ctrl = new AbortController()
  await scrollDown()
  try {
    await chatReply(text, ctx.value, {
      signal: ctrl.signal,
      onDelta: d => { messages.value[aiIdx].text += d; scrollDown() },
    })
  } catch (e) {
    if (e?.name !== 'AbortError') messages.value[aiIdx].text = e.message || '这次没能答上来'
    else if (!messages.value[aiIdx].text) messages.value[aiIdx].text = '已停下'
  } finally {
    busy.value = false
    ctrl = null
  }
}

function stop() { ctrl?.abort() }
function clear() { messages.value = [] }
watch(open, v => { if (v) scrollDown() })
</script>

<template>
  <div class="assistant">
    <button class="ask-fab" :class="{ on: open }" @click="open = !open" :title="open ? '收起小助手' : '问一句'">
      <svg viewBox="0 0 24 24" class="ico"><path d="M12 3a8 8 0 0 0-8 8c0 2.6 1.3 4.9 3.3 6.3L6.6 21l3.2-1.6c.7.1 1.4.2 2.2.2a8 8 0 1 0 0-16z" /></svg>
    </button>

    <div v-if="open" class="ask-panel">
      <div class="ask-head">
        <span>随身小助手</span>
        <span class="row" style="gap:2px">
          <button class="mini" v-if="messages.length" @click="clear">清一次对话</button>
          <button class="mini" @click="open = false">收起</button>
        </span>
      </div>

      <div ref="boxEl" class="ask-body">
        <div v-if="!messages.length" class="ask-hello">
          <div class="muted">它会看到你今天与本周的真实数据。想问什么直接写：</div>
          <div class="ask-chips">
            <button v-for="q in ASKS" :key="q" class="pill" @click="send(q)">{{ q }}</button>
          </div>
        </div>
        <div v-for="(m, i) in messages" :key="i" class="ask-msg" :class="m.role">
          <div class="bubble">{{ m.text || (busy && i === messages.length - 1 ? '正在想…' : '') }}</div>
        </div>
      </div>

      <div class="ask-foot">
        <input v-model="input" type="text" placeholder="问一句，回车送出" @keyup.enter="send(input)" />
        <button v-if="busy" class="ask-stop" @click="stop">停下</button>
        <button v-else class="ask-send" :disabled="!input.trim()" @click="send(input)">送出</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.assistant { position: fixed; right: 18px; bottom: 18px; z-index: 60; }
.ask-fab {
  width: 44px; height: 44px; border-radius: 50%; cursor: pointer;
  border: none; background: var(--primary); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, .14); transition: background .15s ease;
}
.ask-fab:hover { background: var(--primary-hover); }
.ask-fab .ico { width: 22px; height: 22px; fill: currentColor; }
.ask-panel {
  position: absolute; right: 0; bottom: 66px; width: 380px; max-width: calc(100vw - 32px);
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: 0 8px 28px rgba(0, 0, 0, .12); overflow: hidden;
  display: flex; flex-direction: column; max-height: 62vh;
}
.ask-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--line);
  font-size: 13.5px; font-weight: 600;
}
.ask-head .mini { border: none; background: none; color: var(--text-2); font-size: 12.5px; cursor: pointer; padding: 4px 6px; }
.ask-head .mini:hover { color: var(--text); }
.ask-body { padding: 12px 14px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 8px; }
.ask-hello .muted { margin-bottom: 10px; }
.ask-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.ask-msg { display: flex; }
.ask-msg.user { justify-content: flex-end; }
.bubble {
  max-width: 84%; padding: 8px 12px; border-radius: var(--r-box); font-size: 13px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
}
.ask-msg.ai .bubble { background: var(--bg-sunken); border: 1px solid var(--line); border-bottom-left-radius: var(--r-sm); }
.ask-msg.user .bubble { background: var(--primary); color: #fff; border-bottom-right-radius: var(--r-sm); }
.ask-foot { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--line); }
.ask-foot input { flex: 1; }
.ask-send, .ask-stop {
  border: none; border-radius: var(--r-input); padding: 0 14px; cursor: pointer;
  font-size: 12.5px; font-weight: 400; color: #fff; background: var(--primary); white-space: nowrap;
}
.ask-stop { background: var(--warning); }
.ask-send:disabled { opacity: .4; cursor: not-allowed; }
@media (max-width: 768px) {
  .assistant { right: 14px; bottom: 76px; }
  .ask-panel { width: calc(100vw - 28px); bottom: 64px; max-height: 66vh; }
}
</style>
