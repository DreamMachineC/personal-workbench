<script setup>
import { ref, computed, watch } from 'vue'
import dayjs from 'dayjs'
import { NInput, NButton, NPopconfirm, NEmpty } from 'naive-ui'
import { db } from '../db'
import { today } from '../date'
import { useCheckinsToday, useJournals, useMoods, useLiveQuery } from '../composables'
import { showUndo } from '../undo'
import { CalendarHeatmap } from 'vue3-calendar-heatmap'
import 'vue3-calendar-heatmap/dist/style.css'
import { polishJournal } from '../ai'

const sub = ref('checkin')
const checkins = useCheckinsToday()
const journals = useJournals()
const newJournal = ref('')

// 打卡热力图数据：每日完成项数（近一年）
const allRecords = useLiveQuery(() => db.checkins.toArray())
const allItems = useLiveQuery(() => db.checkinItems.toArray())
const perDay = computed(() => {
  const items = Object.fromEntries((allItems.value || []).map(i => [i.id, i]))
  const m = {}
  for (const r of allRecords.value || []) {
    const it = items[r.itemId]
    if (!it) continue
    if (it.type === 'bool' ? r.value >= 1 : r.value >= it.target) m[r.date] = (m[r.date] || 0) + 1
  }
  return m
})
const heatmapValues = computed(() => Object.entries(perDay.value).map(([date, count]) => ({ date, count })))
const heatmapMax = computed(() => Math.max(1, (allItems.value || []).length))

// 坚持的温度：连续天数 / 本月次数 / 今日完成度
const monthPrefix = computed(() => today().slice(0, 7))
const streak = computed(() => {
  let n = 0, d = dayjs(today())
  if (!perDay.value[d.format('YYYY-MM-DD')]) d = d.subtract(1, 'day')
  while (perDay.value[d.format('YYYY-MM-DD')]) { n++; d = d.subtract(1, 'day') }
  return n
})
const monthDone = computed(() =>
  Object.entries(perDay.value).filter(([d]) => d.startsWith(monthPrefix.value)).reduce((s, [, c]) => s + c, 0))
const todayDone = computed(() => (checkins.value || []).filter(c =>
  c.type === 'bool' ? c.record?.value >= 1 : (c.record?.value || 0) >= c.target).length)
const todayTotal = computed(() => (checkins.value || []).length)

// 心情：一天一条，date 唯一
const MOODS = ['很糟', '有点糟', '还行', '不错', '很好']
const moods = useMoods(30)
const moodToday = computed(() => (moods.value || []).find(m => m.date === today()) || null)
const moodNote = ref(moodToday.value?.note || '')
watch(() => moodToday.value?.note, v => { moodNote.value = v || '' })
async function setMood(n) {
  const cur = moodToday.value
  if (cur && cur.score === n) { await db.moods.delete(cur.id); return } // 再点一次即收回
  if (cur) await db.moods.update(cur.id, { score: n })
  else await db.moods.add({ date: today(), score: n, note: '' })
}
async function saveMoodNote() {
  const note = moodNote.value.trim()
  const cur = moodToday.value
  if (cur) await db.moods.update(cur.id, { note })
  else if (note) await db.moods.add({ date: today(), score: 0, note })
}

// 随笔：那年今日 + 写的分量
const memory = computed(() => (journals.value || []).filter(j =>
  j.date.slice(5) === today().slice(5) && j.date.slice(0, 4) < today().slice(0, 4)))
const jMonth = computed(() => (journals.value || []).filter(j => j.date.startsWith(monthPrefix.value)).length)
const jStreak = computed(() => {
  const set = new Set((journals.value || []).map(j => j.date))
  let n = 0, d = dayjs(today())
  if (!set.has(d.format('YYYY-MM-DD'))) d = d.subtract(1, 'day')
  while (set.has(d.format('YYYY-MM-DD'))) { n++; d = d.subtract(1, 'day') }
  return n
})

// 打卡交互分型（Plan 12.2 #9）：布尔型点击即完成；计次型点一下 +1
async function punch(c) {
  if (c.type === 'bool') {
    const v = c.record ? (c.record.value >= 1 ? 0 : 1) : 1
    if (c.record) await db.checkins.update(c.record.id, { value: v })
    else await db.checkins.add({ itemId: c.id, date: today(), value: v })
  } else {
    // 计次型：一直累加，超过目标也继续计（不归零重计）
    const v = (c.record?.value || 0) + 1
    if (c.record) await db.checkins.update(c.record.id, { value: v })
    else await db.checkins.add({ itemId: c.id, date: today(), value: v })
  }
}

// AI 润色：给出两版，由人选；forId 为日记 id，为空表示作用在输入框
const polish = ref({ loading: false, list: [], err: '', forId: null, forText: '' })
async function runPolish(text, id = null) {
  const t = String(text || '').trim()
  if (!t) return
  polish.value = { loading: true, list: [], err: '', forId: id, forText: t }
  try {
    const r = await polishJournal(t)
    if (r[0]?.blocked === 'privacy') {
      polish.value.err = '还没授权 AI 读取正文。去「设置」里打开「允许 AI 读取详细内容」。'
      polish.value.loading = false
      return
    }
    polish.value.list = r
    polish.value.err = r.length ? '' : 'AI 这次没给出可用的两版，过一会儿再试'
  } catch (e) {
    polish.value.err = e.message
  } finally {
    polish.value.loading = false
  }
}
function closePolish() { polish.value = { loading: false, list: [], err: '', forId: null, forText: '' } }
async function pickPolished(item) {
  if (polish.value.forId) await db.journals.update(polish.value.forId, { text: item.text })
  else newJournal.value = item.text
  closePolish()
}

async function addJournal() {
  const text = newJournal.value.trim()
  if (!text) return
  await db.journals.add({ date: today(), text, createdAt: Date.now(), deletedAt: undefined })
  newJournal.value = ''
}
async function delJournal(id) {
  await db.journals.update(id, { deletedAt: Date.now() }) // 软删除 → 回收站
  showUndo('已收进回收站', () => db.journals.update(id, { deletedAt: undefined }))
}
</script>

<template>
  <div>
    <div class="subnav">
      <button class="pill" :class="{ on: sub === 'checkin' }" @click="sub = 'checkin'">日常印记</button>
      <button class="pill" :class="{ on: sub === 'journal' }" @click="sub = 'journal'">心绪随笔</button>
    </div>

    <div v-if="sub === 'checkin'" class="two-col">
      <div class="card">
        <h3>今日印记 · {{ today() }}</h3>
        <div v-for="c in checkins" :key="c.id" class="checkin-row">
          <div class="name">
            {{ c.name }}
            <span class="muted" v-if="c.type === 'count'">（{{ c.record?.value || 0 }}/{{ c.target }}{{ c.unit || '' }}）</span>
          </div>
          <button v-if="c.type === 'bool'" class="pill" :class="{ on: c.record?.value >= 1 }" @click="punch(c)">
            {{ c.record?.value >= 1 ? '已点亮' : '点一下' }}
          </button>
          <button v-else class="pill" @click="punch(c)">再记一次</button>
        </div>
        <div class="muted" style="margin-top:10px">想增减这些小事，去「设置」；身体的练习记在「成长 → 体魄」</div>
      </div>
      <aside class="col-side">
        <div class="side-card">
          <div class="eyebrow teal">STREAK</div>
          <h3>坚持的温度</h3>
          <div class="focus-num">{{ streak }}<span class="num-xl" style="font-size:16px; font-weight:600; color:var(--text-2)"> 天连着</span></div>
          <div class="mini-row" style="margin-top:16px">
            <div class="mini-top"><span>今日已完成</span><span class="mini-num" :class="{ ok: todayDone === todayTotal && todayTotal }">{{ todayDone }}/{{ todayTotal }}</span></div>
            <div class="mini-track"><div class="mini-fill" :class="{ ok: todayDone === todayTotal && todayTotal }" :style="{ width: (todayTotal ? todayDone / todayTotal * 100 : 0) + '%' }" /></div>
          </div>
          <div class="mini-row">
            <div class="mini-top"><span>本月点亮</span><span class="mini-num">{{ monthDone }} 次</span></div>
            <div class="mini-track"><div class="mini-fill" :style="{ width: Math.min(100, monthDone / Math.max(30, monthDone) * 100) + '%' }" /></div>
          </div>
        </div>
        <div class="side-card">
          <div class="eyebrow">A YEAR</div>
          <h3>一年的坚持</h3>
          <CalendarHeatmap :values="heatmapValues" :end-date="today()" :max="heatmapMax"
            tooltip-unit="项完成" :range-color="['#f4ece2','#dfe9cf','#bcd4a0','#97bd6d','#6f9a63']" />
          <div class="heat-legend">
            <span>少</span>
            <i v-for="c in ['#f4ece2','#dfe9cf','#bcd4a0','#97bd6d','#6f9a63']" :key="c" :style="{ background: c }" />
            <span>多</span>
          </div>
        </div>
      </aside>
    </div>

    <div v-else class="two-col">
      <div class="col-side">
        <div class="card">
          <h3>今天过得怎样<span class="cnt">只记给自己看</span></h3>
          <div class="row" style="flex-wrap:wrap; gap:10px; margin-bottom:10px">
            <button v-for="(lb, i) in MOODS" :key="i" class="pill" :class="{ on: moodToday?.score === i + 1 }" @click="setMood(i + 1)">
              {{ lb }}
            </button>
          </div>
          <n-input v-model:value="moodNote" placeholder="为什么是这个分数（可留空）" @blur="saveMoodNote" @keyup.enter="saveMoodNote" />
        </div>
        <div class="card">
          <h3>此刻，心里在想什么 · {{ today() }}</h3>
          <n-input v-model:value="newJournal" type="textarea" rows="3" placeholder="想到什么就写什么，哪怕只是一句…" />
          <div class="row" style="margin-top:8px">
            <n-button type="primary" @click="addJournal">写下这一刻</n-button>
            <n-button v-if="newJournal.trim()" quaternary :disabled="polish.loading"
              @click="runPolish(newJournal)">{{ polish.loading ? '正在润色…' : '让 AI 润一润' }}</n-button>
            <span v-else class="muted">写上几句后，可以让 AI 给出两版，由你挑</span>
          </div>
          <div v-if="polish.loading || polish.err || polish.list.length" class="ai-box">
            <div class="ai-head">
              <span>AI 的两版写法</span>
              <button class="ai-close" @click="closePolish">收起</button>
            </div>
            <div v-if="polish.loading" class="muted">正在读你写的这句，稍等…</div>
            <div v-else-if="polish.err" class="muted">{{ polish.err }}</div>
            <div v-else class="ai-list">
              <button v-for="p in polish.list" :key="p.key" class="ai-card" @click="pickPolished(p)">
                <span class="ai-tone">{{ p.tone }}</span>
                <span class="ai-text">{{ p.text }}</span>
              </button>
            </div>
            <div v-if="!polish.loading && polish.list.length" class="muted" style="margin-top:8px">点一版就用它</div>
          </div>
        </div>
        <div class="card">
          <h3>往日心声<span class="cnt">共 {{ (journals||[]).length }} 句</span></h3>
          <n-empty v-if="!(journals||[]).length" description="还没有写下第一句" size="small" />
          <div v-for="j in journals" :key="j.id" class="journal-item">
            <div class="time row spread">
              <span>{{ dayjs(j.createdAt).format('YYYY-MM-DD HH:mm') }}</span>
              <span class="row" style="gap:0; flex-wrap:nowrap">
                <n-button quaternary size="tiny" @click="runPolish(j.text, j.id)">润一润</n-button>
                <n-popconfirm @positive-click="delJournal(j.id)">
                  <template #trigger><n-button quaternary size="tiny" type="error">删除</n-button></template>
                  先收进回收站，想留还能取回
                </n-popconfirm>
              </span>
            </div>
            <div>{{ j.text }}</div>
          </div>
        </div>
      </div>
      <aside class="col-side">
        <div class="side-card">
          <div class="eyebrow gold">WORDS</div>
          <h3>写的分量</h3>
          <div class="focus-num">{{ (journals||[]).length }}<span class="num-xl" style="font-size:16px; font-weight:600; color:var(--text-2)"> 句心声</span></div>
          <div class="goal-row" style="margin-top:14px"><span class="goal-t">本月写下</span><span class="goal-d">{{ jMonth }} 句</span></div>
          <div class="goal-row"><span class="goal-t">连续写着</span><span class="goal-d">{{ jStreak }} 天</span></div>
          <div class="goal-row"><span class="goal-t">最早的一句</span><span class="goal-d">{{ (journals||[]).length ? [...journals].sort((a,b)=>a.date.localeCompare(b.date))[0].date : '—' }}</span></div>
        </div>
        <div class="side-card">
          <div class="eyebrow teal">ON THIS DAY</div>
          <h3>那年今日</h3>
          <div v-for="j in memory" :key="j.id" class="word-row">
            <div class="word-t">{{ j.text }}</div>
            <div class="word-d">{{ j.date }}</div>
          </div>
          <div class="muted" v-if="!memory.length">往年的这一天还没有留字，今年的一句就是明年的回望</div>
        </div>
      </aside>
    </div>
  </div>
</template>
