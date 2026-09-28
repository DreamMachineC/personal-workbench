<script setup>
import CircleProgress from 'vue3-circle-progress'
import 'vue3-circle-progress/dist/circle-progress.css'
import { db } from '../db'
import { today, getWeekRange, fmt, fmtDuration, greeting, fullDateCN } from '../date'
import {
  useProfile, useCategories, useTodayInstances, useLongTasks,
  useCheckinsToday, useQuote, useStreak, useLiveQuery,
  useJournals, useSkills, useMoods, useFitnessToday, researchCatIds
} from '../composables'
import { PARTS, togglePart } from '../fitness'
import { fetchAiNews, fetchCloudNews, loadNewsCache, saveNewsCache } from '../news'
import { newsBrief, translateTitles } from '../ai'
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { NButton, NInput, NTag } from 'naive-ui'

const profile = useProfile()
const categories = useCategories()
const instances = useTodayInstances()
const longTasks = useLongTasks()
const checkins = useCheckinsToday()
const quote = useQuote()
const streak = useStreak()

const emit = defineEmits(['goto'])

const catMap = computed(() => Object.fromEntries((categories.value || []).map(c => [c.id, c])))

// 进度圈口径：分子=已完成实例、分母=当日实例数（长任务不在此列）
const doneToday = computed(() => (instances.value || []).filter(i => i.status === 'done').length)
const totalToday = computed(() => (instances.value || []).length)
const pctToday = computed(() => totalToday.value ? Math.round(doneToday.value / totalToday.value * 100) : 0)

// 今日专注时长合计
const focusMinToday = computed(() => (instances.value || []).reduce((s, i) => s + (i.durationMin || 0), 0))

// 7 天内截止的长任务数
const dueSoonCount = computed(() => (longTasks.value || []).filter(x => {
  if (x.status === 'done' || !x.deadline || x.deletedAt) return false
  const days = Math.ceil((new Date(x.deadline) - new Date(today())) / 86400000)
  return days >= 0 && days <= 7
}).length)

const weekRange = getWeekRange()
const weekStat = computed(() => ({ start: fmt(weekRange.start), end: fmt(weekRange.end) }))

// 长任务：按 deadline 排序取前 6，彩色卡片化（参考图项目卡同款）
const CARD_COLORS = ['var(--yellow)', 'var(--pink)', 'var(--teal)', 'var(--purple)', 'var(--blue)', 'var(--lime)']
const sortedLong = computed(() => {
  const t = today()
  return (longTasks.value || [])
    .filter(x => x.status !== 'done' && x.deadline && !x.deletedAt)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, 6)
    .map((x, idx) => {
      const days = Math.ceil((new Date(x.deadline) - new Date(t)) / 86400000)
      return { ...x, days, urgent: days <= 3 && days >= 0, overdue: days < 0, color: CARD_COLORS[idx % CARD_COLORS.length] }
    })
})

const checkinDone = computed(() => (checkins.value || []).filter(c =>
  c.type === 'bool' ? c.record?.value >= 1 : c.record?.value >= c.target
).length)

// ---------- 今日体魄：首页快捷多选，与「成长 → 体魄」同一份部位清单 ----------
const todayFit = useFitnessToday()
const fitPicked = ref([])
const fitNote = ref('')
async function saveFitnessQuick() {
  if (!fitPicked.value.length) return
  await db.fitness.add({ date: today(), parts: [...fitPicked.value], note: fitNote.value.trim(), createdAt: Date.now() })
  fitPicked.value = []
  fitNote.value = ''
}

// ---------- 右列：真实数据模块（无装饰图形） ----------
const journals = useJournals()
const skills = useSkills()
const recentJournals = computed(() => (journals.value || []).slice(0, 3))

// 心绪曲线：近 30 天，只有打过分的那天才会连进线里
const MOOD_DAYS = 30
const moods = useMoods(MOOD_DAYS)
const moodDays = computed(() => Array.from({ length: MOOD_DAYS },
  (_, i) => dayjs(today()).subtract(MOOD_DAYS - 1 - i, 'day').format('YYYY-MM-DD')))
const moodMap = computed(() => Object.fromEntries((moods.value || []).filter(m => m.score >= 1).map(m => [m.date, m.score])))
const moodDots = computed(() => moodDays.value
  .map((d, i) => ({ d, x: i / (MOOD_DAYS - 1) * 300, y: moodMap.value[d] ? 88 - (moodMap.value[d] - 1) / 4 * 68 : null }))
  .filter(p => p.y !== null))
const moodPoints = computed(() => moodDots.value.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
const moodAvg7 = computed(() => {
  const arr = moodDays.value.slice(-7).map(d => moodMap.value[d]).filter(Boolean)
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
})

const checkinRows = computed(() => (checkins.value || []).map(c => ({
  ...c,
  cur: c.record?.value || 0,
  done: c.type === 'bool' ? (c.record?.value || 0) >= 1 : (c.record?.value || 0) >= c.target,
  pct: c.type === 'bool' ? ((c.record?.value || 0) >= 1 ? 100 : 0)
    : Math.min(100, Math.round((c.record?.value || 0) / Math.max(1, c.target) * 100)),
})))

const goalList = computed(() => {
  const t = today()
  return (longTasks.value || [])
    .filter(x => x.status !== 'done' && !x.deletedAt)
    .sort((a, b) => (a.deadline || '9').localeCompare(b.deadline || '9'))
    .slice(0, 5)
    .map(x => ({ ...x, days: x.deadline ? Math.ceil((new Date(x.deadline) - new Date(t)) / 86400000) : null }))
})

const weekFocus = computed(() => {
  const s = fmt(weekRange.start), e = fmt(weekRange.end)
  return (allInstances.value || []).filter(i => i.date >= s && i.date <= e)
    .reduce((sum, i) => sum + (i.durationMin || 0), 0)
})
const weekFocusMax = computed(() => Math.max(60, weekFocus.value))

// ---------- 可视化：近 7 天完成柱状图 ----------
// 七日轨迹：科研待办不进生活侧统计
const allInstances = useLiveQuery(async () => {
  const rIds = await researchCatIds()
  const taskMap = Object.fromEntries((await db.tasks.toArray()).map(t => [t.id, t]))
  return (await db.taskInstances.toArray()).filter(i => {
    const t = taskMap[i.taskId]
    return !(t && rIds.has(t.categoryId))
  })
})
const weekBars = computed(() => {
  const arr = []
  for (let i = 6; i >= 0; i--) {
    const d = fmt(dayjsSub(i))
    const list = (allInstances.value || []).filter(x => x.date === d)
    arr.push({
      date: d,
      label: i === 0 ? '今天' : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(d + 'T00:00:00').getDay()],
      done: list.filter(x => x.status === 'done').length,
      total: list.length,
    })
  }
  return arr
})
import dayjs from 'dayjs'
const dayjsSub = n => dayjs().subtract(n, 'day')
const barMax = computed(() => Math.max(1, ...weekBars.value.map(b => b.total)))

// ---------- 可视化：当前正在做的任务（粉卡 hero） ----------
const nowTick = ref(0)
let timer = null
onMounted(() => { timer = setInterval(() => nowTick.value++, 1000) })
onUnmounted(() => clearInterval(timer))
const timingTask = computed(() => (instances.value || []).find(i => i.timerStart && i.status !== 'done'))
const timingElapsed = computed(() => {
  void nowTick.value
  if (!timingTask.value) return ''
  const start = new Date(timingTask.value.timerStart).getTime()
  const min = Math.floor((Date.now() - start) / 60000) + (timingTask.value.durationMin || 0)
  const s = Math.floor((Date.now() - start) / 1000) % 60
  const m = min % 60, h = Math.floor(min / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

async function toggle(i) {
  if (i.status === 'done') {
    await db.taskInstances.update(i.id, { status: 'todo', completedAt: null, durationMin: 0 })
  } else {
    await db.taskInstances.update(i.id, { status: 'done', completedAt: new Date().toISOString() })
  }
}

// ---------- 今日 AI 见闻：一天只抓一次，AI 挑重点也按天缓存 ----------
const news = ref([])
const newsBriefText = ref('')
const newsZh = ref({})
const newsErr = ref('')
const newsLoading = ref(false)
const newsBriefing = ref(false)
const newsTranslating = ref(false)
const newsPartial = ref(false)
// 规划要求主页只列 3~5 条，这里取 6 条并留「换一批」
const newsShown = computed(() => news.value.slice(0, 6))

async function loadNews(force = false) {
  const d = today()
  const cached = loadNewsCache(d)
  if (cached?.items?.length && !force) {
    news.value = cached.items
    newsBriefText.value = cached.brief || ''
    newsZh.value = cached.zh || {}
    return
  }
  newsLoading.value = true
  newsErr.value = ''
  try {
    // 先看每日自动化有没有预抓好（更快、也省掉浏览器的两次外链）
    const prebuilt = await fetchCloudNews(d)
    const r = prebuilt || await fetchAiNews()
    news.value = r.items
    newsPartial.value = !prebuilt && r.partial
    newsBriefText.value = ''
    newsZh.value = {}
    saveNewsCache(d, { items: r.items })
  } catch (e) {
    newsErr.value = e?.message || '取不到今天的见闻'
  } finally {
    newsLoading.value = false
  }
}

async function askNewsBrief() {
  if (!news.value.length) return
  newsBriefing.value = true
  newsBriefText.value = ''
  try {
    const t = await newsBrief(news.value)
    newsBriefText.value = t
    saveNewsCache(today(), { items: news.value, brief: t })
  } catch (e) {
    newsBriefText.value = e?.message || 'AI 这边没接上，稍后再试'
  } finally {
    newsBriefing.value = false
  }
}

async function translateNews() {
  if (!newsShown.value.length) return
  newsTranslating.value = true
  try {
    const map = await translateTitles(newsShown.value)
    newsZh.value = { ...newsZh.value, ...map }
    saveNewsCache(today(), { items: news.value, zh: newsZh.value })
  } catch (e) {
    newsErr.value = e?.message || '翻译没接上，稍后再试'
  } finally {
    newsTranslating.value = false
  }
}

onMounted(() => loadNews())

const newTask = ref('')
const addInputEl = ref(null)
async function addTodayTask() {
  if (!newTask.value.trim()) return
  const id = await db.tasks.add({
    title: newTask.value.trim(), type: 'short', categoryId: null,
    rrule: null, status: 'active', createdAt: Date.now()
  })
  await db.taskInstances.add({ taskId: id, date: today(), status: 'todo', completedAt: null, durationMin: 0, timerStart: null })
  newTask.value = ''
}
function focusAdd() { addInputEl.value?.focus?.() }
</script>

<template>
  <div v-if="profile">
    <!-- 页头：日期 + 超大标题 + 黑药丸新任务按钮（参考图同款） -->
    <div class="page-head">
      <div class="grow">
        <div class="date">{{ fullDateCN() }}</div>
        <div class="page-title">{{ greeting() }}，{{ profile.name }}</div>
      </div>
      <button class="btn-dark" @click="focusAdd"><span class="plus">＋</span>新任务</button>
    </div>

    <div class="two-col">
    <div class="col-main">
    <!-- Hero 网格：粉色"现在正在做"大卡 + 进度环 -->
    <div class="hero-grid">
      <div class="hero">
        <div class="hero-top">
          <span class="hero-eyebrow">此刻 · 正在做</span>
          <span class="hero-timer" v-if="timingTask">{{ timingElapsed }}</span>
        </div>
        <div class="hero-title">{{ timingTask ? timingTask.task.title : '此刻，尚未开始' }}</div>
        <div class="hero-sub">
          {{ timingTask ? `已沉浸 ${fmtDuration((timingTask.durationMin || 0) + Math.floor((Date.now() - new Date(timingTask.timerStart).getTime()) / 60000))}，别让节奏断在这里。` : '挑一件事开始，让今天留下痕迹。' }}
        </div>
        <button class="btn-dark" @click="emit('goto', 'todos')">{{ timingTask ? '前往计划' : '开始一件事' }}</button>
      </div>
      <div class="hero-ring">
        <CircleProgress :percent="pctToday" :size="124" :border-width="13"
          fill-color="#2b2320" empty-color="#efe4d6" show-percent />
        <div style="margin-top:10px; font-weight:700">
          <span class="num-xl" style="font-size:30px">{{ doneToday }}</span><span class="sub">/{{ totalToday }} 今日完成</span>
        </div>
        <div class="muted">打卡 {{ checkinDone }}/{{ (checkins||[]).length }} 项 · 专注 {{ focusMinToday ? fmtDuration(focusMinToday) : '0m' }}</div>
      </div>
    </div>

    <!-- 统计卡行：label 左 + 超大数字右 -->
    <div class="stat-row">
      <div class="stat-card"><span class="lb">今日之计</span><span class="num">{{ totalToday }}</span></div>
      <div class="stat-card"><span class="lb">今日已成</span><span class="num">{{ doneToday }}</span></div>
      <div class="stat-card"><span class="lb">七日将至</span><span class="num">{{ dueSoonCount }}</span></div>
      <div class="stat-card hl" v-if="streak >= 1"><span class="lb">连绵不断</span><span class="num">{{ streak }}</span></div>
    </div>

    <!-- 每日名句 -->
    <div class="card" style="padding: 18px 24px">
      <p style="font-size: 16px; color: var(--text-2); font-style: italic; text-align: center; font-weight: 600">
        「 {{ quote || '…' }} 」
      </p>
    </div>

    <!-- TODAY 今日重点 -->
    <div class="card">
      <div class="eyebrow">TODAY</div>
      <h3>此刻要做的事<span class="cnt">共 {{ totalToday }} 件 · 已成 {{ doneToday }} 件</span></h3>
      <div v-if="!(instances||[]).length" class="empty-box">今天尚是一片空白。<br />先放进一件真正重要的事吧。</div>
      <div v-for="i in instances" :key="i.id" class="task-row">
        <div class="circle" :class="{ done: i.status === 'done' }" @click="toggle(i)">✓</div>
        <div class="task-main">
          <div class="task-title" :class="{ done: i.status === 'done' }">{{ i.task.title }}</div>
          <div class="task-meta">
            <n-tag v-if="i.task.categoryId && catMap[i.task.categoryId]" size="small" round
              :color="{ color: catMap[i.task.categoryId].color, textColor: '#fff' }">
              {{ catMap[i.task.categoryId].name }}
            </n-tag>
            <span v-if="i.task.defaultTime">⏰ {{ i.task.defaultTime }}</span>
            <span v-if="fmtDuration(i.durationMin)">⏱ {{ fmtDuration(i.durationMin) }}</span>
            <span v-if="i.timerStart" class="timer-on">● 计时中</span>
          </div>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <n-input ref="addInputEl" v-model:value="newTask" size="large" placeholder="此刻想做什么？回车即可记下" @keyup.enter="addTodayTask" round />
        <n-button type="primary" size="large" @click="addTodayTask" round>＋ 记下</n-button>
      </div>
      <div class="muted" style="margin-top:10px">重复的、遥远的、需要归类的，都在「计划」里</div>
    </div>

    <!-- UPCOMING 临近截止：彩色大卡（参考图项目卡同款） -->
    <div class="card" v-if="sortedLong.length">
      <div class="eyebrow teal">UPCOMING</div>
      <h3>将至的期限<span class="cnt">共 {{ sortedLong.length }} 件</span></h3>
      <div class="long-grid">
        <div v-for="x in sortedLong" :key="x.id" class="long-card" :style="{ background: x.color }">
          <div class="t">{{ x.title }}</div>
          <div class="foot">
            <span>截止 {{ x.deadline.slice(5).replace('-', ' 月 ') }} 日</span>
            <span class="hot" v-if="x.overdue">已逾期 {{ -x.days }} 天</span>
            <span class="hot" v-else-if="x.urgent">仅剩 {{ x.days }} 天</span>
            <span v-else>还有 {{ x.days }} 天</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 可视化：近 7 天完成柱状图 -->
    <div class="card">
      <div class="eyebrow purple">WEEKLY</div>
      <h3>七日轨迹<span class="cnt">灰柱为计划 · 粉柱为完成</span></h3>
      <div class="bars">
        <div v-for="b in weekBars" :key="b.date" class="bar-col">
          <div class="bar-track">
            <div class="bar" :style="{ height: (b.total / barMax * 100) + '%' }">
              <div class="bar-done" :style="{ height: (b.total ? b.done / b.total * 100 : 0) + '%' }" />
            </div>
          </div>
          <div class="bar-lb">{{ b.label }}</div>
          <div class="bar-num">{{ b.done }}/{{ b.total }}</div>
        </div>
      </div>
    </div>

    <!-- 今日 AI 见闻：默认只给标题与原文链接，摘要要点由人手动触发 -->
    <div class="card">
      <div class="eyebrow gold">AI NEWS</div>
      <h3>AI 潮汐</h3>
      <div v-if="newsErr" class="muted">{{ newsErr }}</div>
      <div v-else-if="!news.length" class="muted">{{ newsLoading ? '正在取今天的见闻…' : '今天还没有取到见闻' }}</div>
      <div v-else class="news-list">
        <div v-for="n in newsShown" :key="n.id" class="news-row">
          <a class="news-t" :href="n.url" target="_blank" rel="noopener">
            <span v-if="newsZh[n.id]">{{ newsZh[n.id] }}</span>
            <span v-else>{{ n.title }}</span>
          </a>
          <div v-if="newsZh[n.id]" class="news-orig">{{ n.title }}</div>
          <div class="news-m">
            <span class="news-src">{{ n.source }}</span>
            <span>{{ n.heatLabel }}</span>
          </div>
        </div>
      </div>
      <div class="row" style="margin-top:12px">
        <n-button size="small" secondary type="primary" :loading="newsBriefing"
          :disabled="!news.length" @click="askNewsBrief">让 AI 挑重点</n-button>
        <n-button size="small" secondary :loading="newsTranslating"
          :disabled="!newsShown.length" @click="translateNews">标题译成中文</n-button>
        <n-button size="small" quaternary :loading="newsLoading" @click="loadNews(true)">换一批</n-button>
        <span class="muted" v-if="newsPartial">一个源没响应，先看了另一个</span>
      </div>
      <div v-if="newsBriefText" class="ai-box">
        <div class="ai-head"><span>AI 挑的重点</span></div>
        <div class="ai-text">{{ newsBriefText }}</div>
      </div>
    </div>
    </div>

    <aside class="col-side">
      <!-- 今日印记 -->
      <div class="side-card">
        <div class="eyebrow teal">TODAY</div>
        <h3>今日印记</h3>
        <div v-for="c in checkinRows" :key="c.id" class="mini-row">
          <div class="mini-top">
            <span>{{ c.name }}</span>
            <span class="mini-num" :class="{ ok: c.done }">{{ c.type === 'bool' ? (c.done ? '已成' : '待办') : `${c.cur}/${c.target}` }}</span>
          </div>
          <div class="mini-track"><div class="mini-fill" :class="{ ok: c.done }" :style="{ width: c.pct + '%' }" /></div>
        </div>
        <div class="muted" v-if="!checkinRows.length">还没有想坚持的小事，去「设置」添一件</div>
      </div>

      <!-- 今日练了哪儿（快捷多选） -->
      <div class="side-card">
        <div class="eyebrow lime">BODY</div>
        <h3>今天练了哪儿</h3>
        <div v-if="(todayFit||[]).length" class="word-row">
          <div v-for="f in todayFit" :key="f.id" class="word-row" style="border-bottom:none; padding:3px 0">
            <div class="row" style="flex-wrap:wrap; gap:6px">
              <span v-for="p in f.parts" :key="p" class="skill-chip">{{ p }}</span>
            </div>
            <div class="word-d" v-if="f.note">{{ f.note }}</div>
          </div>
        </div>
        <div class="row chip-wrap">
          <button v-for="p in PARTS" :key="p" class="pill sm" :class="{ on: fitPicked.includes(p) }"
            @click="togglePart(fitPicked, p)">{{ p }}</button>
        </div>
        <input v-model="fitNote" placeholder="记一笔：重量、组数、身体的感受" @keyup.enter="saveFitnessQuick" />
        <div class="row" style="margin-top:8px">
          <n-button type="primary" size="small" :disabled="!fitPicked.length" @click="saveFitnessQuick">记下这一次</n-button>
          <span class="muted">{{ (todayFit||[]).length ? '今天已留下痕迹' : '还没动过' }}</span>
        </div>
      </div>

      <!-- 本周专注 -->
      <div class="side-card">
        <div class="eyebrow purple">FOCUS</div>
        <h3>本周专注</h3>
        <div class="focus-num">{{ weekFocus ? fmtDuration(weekFocus) : '0m' }}</div>
        <div class="mini-track" style="margin-top:10px">
          <div class="mini-fill" :style="{ width: Math.round(weekFocus / weekFocusMax * 100) + '%', background: 'var(--purple)' }" />
        </div>
        <div class="muted" style="margin-top:8px">{{ weekStat.start }} 起 · 累计投入</div>
      </div>

      <!-- 遥远的目标 -->
      <div class="side-card">
        <div class="eyebrow">GOALS</div>
        <h3>遥远的目标</h3>
        <div v-for="x in goalList" :key="x.id" class="goal-row">
          <span class="goal-t">{{ x.title }}</span>
          <span class="goal-d" :class="{ hot: x.days !== null && x.days <= 3 }">
            {{ x.days === null ? '未定期限' : x.days < 0 ? `逾期 ${-x.days} 天` : `还有 ${x.days} 天` }}
          </span>
        </div>
        <div class="muted" v-if="!goalList.length">还没有立下遥远的目标</div>
      </div>

      <!-- 最近的心声 -->
      <div class="side-card">
        <div class="eyebrow teal">WORDS</div>
        <h3>最近的心声</h3>
        <div v-for="j in recentJournals" :key="j.id" class="word-row">
          <div class="word-t">{{ j.text }}</div>
          <div class="word-d">{{ j.date }}</div>
        </div>
        <div class="muted" v-if="!recentJournals.length">还没有写下第一句</div>
      </div>

      <!-- 心绪曲线 -->
      <div class="side-card">
        <div class="eyebrow">MOOD</div>
        <h3>心绪曲线</h3>
        <div class="focus-num">
          {{ moodAvg7 ? moodAvg7.toFixed(1) : '—' }}<span class="num-xl" style="font-size:16px; font-weight:600; color:var(--text-2)"> /5 · 近七天</span>
        </div>
        <svg v-if="moodDots.length" class="mood-chart" viewBox="0 0 300 96">
          <line x1="0" y1="88" x2="300" y2="88" stroke="var(--line)" stroke-width="1.5" />
          <polyline :points="moodPoints" fill="none" stroke="var(--pink)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
          <circle v-for="p in moodDots" :key="p.d" :cx="p.x" :cy="p.y" r="3" fill="var(--pink)" />
        </svg>
        <div class="muted" style="margin-top:6px">
          {{ moodDots.length ? `近 ${MOOD_DAYS} 天 · ${moodDots.length} 天有记录` : '去「手帐 → 心绪随笔」给今天打个分，线就长出来了' }}
        </div>
      </div>

      <!-- 在练的技艺 -->
      <div class="side-card">
        <div class="eyebrow gold">SKILLS</div>
        <h3>在练的技艺</h3>
        <div class="row" style="flex-wrap:wrap; gap:8px">
          <span v-for="s in skills" :key="s.id" class="skill-chip">{{ s.name }}</span>
        </div>
        <div class="muted" v-if="!(skills||[]).length">还没有在打磨的技艺</div>
      </div>
    </aside>
    </div>

    <div class="muted" style="text-align:center; padding: 4px 0 10px">此刻所在的一周 · {{ weekStat.start }} ~ {{ weekStat.end }}</div>
  </div>
</template>

<style scoped>
.chip-wrap { flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.pill.sm { font-size: 13px; padding: 4px 11px; }
.hero-grid { display: grid; grid-template-columns: 1fr; gap: 14px; margin-bottom: 18px; }
@media (min-width: 640px) { .hero-grid { grid-template-columns: 1.6fr 1fr; } }
.hero {
  background: var(--pink); border-radius: var(--radius); padding: 26px;
  color: var(--text); display: flex; flex-direction: column; gap: 10px;
  box-shadow: var(--shadow); transition: transform .2s ease, box-shadow .2s ease;
}
.hero:hover { transform: translateY(-3px); box-shadow: var(--shadow-hover); }
.hero-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.hero-eyebrow { font-size: 13px; font-weight: 800; letter-spacing: 2px; opacity: .75; }
.hero-timer { font-size: 30px; font-weight: 800; letter-spacing: 1px; font-variant-numeric: tabular-nums; }
.hero-title { font-size: 27px; font-weight: 900; letter-spacing: -.5px; line-height: 1.3; }
.hero-sub { font-size: 15px; opacity: .8; margin-bottom: 8px; }
.hero .btn-dark { align-self: flex-start; }
.hero-ring {
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; box-shadow: var(--shadow);
}
.bars { display: flex; gap: 12px; align-items: stretch; padding-top: 6px; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.bar-track { height: 130px; width: 100%; max-width: 44px; display: flex; align-items: flex-end; background: var(--bg-sunken); border-radius: 10px; overflow: hidden; }
.bar { width: 100%; background: var(--line); border-radius: 10px; display: flex; flex-direction: column; justify-content: flex-end; transition: height .4s ease; }
.bar-done { width: 100%; background: var(--pink); border-radius: 10px; transition: height .4s ease; }
.bar-lb { font-size: 13px; font-weight: 600; color: var(--text-2); }
.bar-num { font-size: 12.5px; font-weight: 800; color: var(--text); }

/* 今日 AI 见闻 */
.news-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0 26px; }
.news-row { padding: 10px 0; border-bottom: 1px solid var(--line); }
.news-row:last-child { border-bottom: none; }
.news-t {
  display: block; font-size: 15px; font-weight: 600; line-height: 1.45; color: var(--text);
  text-decoration: none; transition: color .18s ease;
}
.news-t:hover { color: var(--text-accent); }
.news-m {
  display: flex; align-items: center; gap: 10px; margin-top: 5px;
  font-size: 12.5px; font-weight: 700; color: var(--text-2);
}
.news-orig { font-size: 12.5px; color: var(--text-3); margin-top: 3px; }
.news-src {
  padding: 1px 8px; border-radius: 999px;
  background: var(--accent-soft); color: var(--text-accent);
}
</style>
