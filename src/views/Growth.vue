<script setup>
import { ref, computed, watchEffect } from 'vue'
import dayjs from 'dayjs'
import {
  NInput, NButton, NSelect, NDatePicker, NTag, NEmpty, NPopconfirm
} from 'naive-ui'
import { db } from '../db'
import { today, getWeekRange, fmtDuration } from '../date'
import {
  useLiveQuery, useReviews, useSkills, useFitnessWeek, useReviewStatus, useMoods,
  researchCatIds, archiveReview, growthSub
} from '../composables'
import { PARTS, togglePart } from '../fitness'
import { weeklyDigest } from '../ai'
import Vault from './Vault.vue'

const sub = growthSub // review | fitness | skill | hall | vault | report（全局搜索可跨页定位）
const reviewStatus = useReviewStatus()
const reviews = useReviews()
const skills = useSkills()
const fitness = useFitnessWeek()

// ---------- 复盘 ----------
const RD_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WDAY = ['日', '一', '二', '三', '四', '五', '六']
const reviewForm = ref({ good: '', bad: '', next: '' })

// 编辑目标周次：默认本周；可补写历史周
const targetWeekStart = ref(getWeekRange().start.format('YYYY-MM-DD'))
const editingReview = computed(() => (reviews.value || []).find(r => r.weekStart === targetWeekStart.value))
watchEffect(() => {
  const r = (reviews.value || []).find(r => r.weekStart === targetWeekStart.value)
  if (r) reviewForm.value = { good: r.text.good || '', bad: r.text.bad || '', next: r.text.next || '' }
})
function onSwitchWeek() {
  const r = editingReview.value
  reviewForm.value = r ? { good: r.text.good || '', bad: r.text.bad || '', next: r.text.next || '' } : { good: '', bad: '', next: '' }
}

async function saveReview() {
  const exist = await db.reviews.where('weekStart').equals(targetWeekStart.value).first()
  const text = { ...reviewForm.value }
  let id = exist?.id
  if (exist) await db.reviews.update(exist.id, { text, updatedAt: Date.now() })
  else id = await db.reviews.add({ weekStart: targetWeekStart.value, text, updatedAt: Date.now() })
  await archiveReview(id, targetWeekStart.value, text) // 自动归档进库房
}
async function setReviewDay(v) {
  await db.profile.update(1, { reviewDay: v })
}

// ---------- 健身 ----------
const customPart = ref('')
const picked = ref([])
const fitnessNote = ref('')
function pickPart(p) { togglePart(picked.value, p) }
function addCustomPart() {
  const p = customPart.value.trim()
  if (!p) return
  pickPart(p)
  customPart.value = ''
}
async function saveFitness() {
  if (!picked.value.length) return
  await db.fitness.add({ date: today(), parts: [...picked.value], note: fitnessNote.value.trim(), createdAt: Date.now() })
  picked.value = []
  fitnessNote.value = ''
}
async function delFitness(id) { await db.fitness.delete(id) }

// 这一周练过的部位分布
const partStats = computed(() => {
  const m = {}
  for (const f of fitness.value || []) for (const p of f.parts) m[p] = (m[p] || 0) + 1
  return Object.entries(m).sort((a, b) => b[1] - a[1])
})

// ---------- 报告：单一 liveQuery 数据源 + computed 按日期过滤（切日期自动刷新） ----------
const reportDate = ref(Date.now())
const reportD = computed(() => dayjs(reportDate.value).format('YYYY-MM-DD'))
const repData = useLiveQuery(async () => {
  const rIds = await researchCatIds()
  const taskMap = Object.fromEntries((await db.tasks.toArray()).map(t => [t.id, t]))
  return {
    // 科研待办不进生活侧统计，只算在科研页
    instances: (await db.taskInstances.toArray()).filter(i => {
      const t = taskMap[i.taskId]
      return !(t && rIds.has(t.categoryId))
    }),
    items: (await db.checkinItems.toArray()).filter(i => !i.deletedAt),
    checks: await db.checkins.toArray(),
    fits: await db.fitness.toArray(),
    journals: (await db.journals.toArray()).filter(j => !j.deletedAt),
  }
})

function statOf(d) {
  const rd = repData.value
  if (!rd) return { plan: 0, done: 0, focus: 0, ck: 0, ckTotal: rd ? rd.items.length : 0, fit: [] }
  const inst = rd.instances.filter(i => i.date === d && i.status !== 'archived')
  const map = Object.fromEntries(rd.checks.filter(r => r.date === d).map(r => [r.itemId, r]))
  const ck = rd.items.filter(i => i.type === 'bool' ? map[i.id]?.value >= 1 : (map[i.id]?.value || 0) >= i.target).length
  return {
    plan: inst.length,
    done: inst.filter(i => i.status === 'done').length,
    focus: inst.reduce((s, i) => s + (i.durationMin || 0), 0),
    ck, ckTotal: rd.items.length,
    fit: rd.fits.filter(f => f.date === d).flatMap(f => f.parts),
  }
}
const dayRep = computed(() => statOf(reportD.value))
const journalsRep = computed(() => (repData.value?.journals || []).filter(j => j.date === reportD.value))

// 周报：7 天汇总 + 复盘摘录
const weekRangeRep = computed(() => {
  const r = getWeekRange(dayjs(reportDate.value))
  return { start: r.start, end: r.end, key: r.start.format('YYYY-MM-DD') }
})
const weekDays = computed(() => {
  const { start } = weekRangeRep.value
  return Array.from({ length: 7 }, (_, i) => {
    const d = start.add(i, 'day').format('YYYY-MM-DD')
    return { d, dow: WDAY[new Date(d + 'T00:00:00').getDay()] }
  })
})
const weekStat7 = computed(() => Object.fromEntries(weekDays.value.map(({ d }) => [d, statOf(d)])))

// 技艺页右列：这一周实际投入
const thisWeekDays = computed(() => {
  const s = getWeekRange().start
  return Array.from({ length: 7 }, (_, i) => s.add(i, 'day').format('YYYY-MM-DD'))
})
const weekInst = computed(() => (repData.value?.instances || []).filter(i =>
  thisWeekDays.value.includes(i.date) && i.status !== 'archived'))
const weekFocus = computed(() => weekInst.value.reduce((s, i) => s + (i.durationMin || 0), 0))
const weekDone = computed(() => weekInst.value.filter(i => i.status === 'done').length)
// 周报里的心情均值：这一周打过分的那几天的平均
const moods = useMoods(30)
const moodMapW = computed(() => Object.fromEntries((moods.value || []).filter(m => m.score >= 1).map(m => [m.date, m.score])))
const weekMood = computed(() => {
  const arr = weekDays.value.map(({ d }) => moodMapW.value[d]).filter(Boolean)
  return arr.length ? { avg: arr.reduce((a, b) => a + b, 0) / arr.length, n: arr.length } : null
})

const weekReviewText = computed(() => {
  const r = (reviews.value || []).find(r => r.weekStart === weekRangeRep.value.key)
  return r ? r.text : null
})

const reportText = computed(() => {
  const s = dayRep.value
  const lines = [
    `日报 · ${reportD.value}`,
    `任务：${s.done}/${s.plan} 完成，专注 ${fmtDuration(s.focus) || '0m'}`,
    `打卡：${s.ck}/${s.ckTotal} 项`,
    s.fit.length ? `健身：${s.fit.join('、')}` : '健身：未记录',
  ]
  for (const j of journalsRep.value) lines.push(`· ${j.text}`)
  return lines.join('\n')
})
async function copyReport() {
  try { await navigator.clipboard.writeText(reportText.value) } catch { /* 剪贴板不可用时静默 */ }
}

const copied = ref(false)
const weekText = computed(() => {
  const lines = [`周报 · ${weekRangeRep.value.key.slice(5)} 那周`]
  let tp = 0, td = 0, tf = 0
  for (const { d, dow } of weekDays.value) {
    const r = weekStat7.value[d]
    tp += r.plan; td += r.done; tf += r.focus
    lines.push(`${dow}：${r.done}/${r.plan} 完成${r.focus ? `，专注 ${fmtDuration(r.focus)}` : ''}${r.fit.length ? `，健身 ${r.fit.join('/')}` : ''}`)
  }
  lines.push(`合计：${td}/${tp} 完成，专注 ${fmtDuration(tf) || '0m'}`)
  lines.push(weekMood.value ? `心情：${weekMood.value.avg.toFixed(1)}/5（${weekMood.value.n} 天打分）` : '心情：这一周还没打分')
  if (weekReviewText.value) {
    lines.push('', `复盘：做得好：${weekReviewText.value.good || '—'}；不足：${weekReviewText.value.bad || '—'}；下周：${weekReviewText.value.next || '—'}`)
  }
  return lines.join('\n')
})
async function copyWeek() {
  try { await navigator.clipboard.writeText(weekDraft.value); copied.value = true; setTimeout(() => copied.value = false, 1500) } catch {}
}

// ---------- 草稿：打开页面按需生成一次，之后跟随手写的版本；可随时按数据重生成 ----------
const reports = useLiveQuery(() => db.reports.toArray())
const dailyKey = computed(() => 'daily:' + reportD.value)
const weeklyKey = computed(() => 'weekly:' + weekRangeRep.value.key)
const dailyDraft = ref('')
const weekDraft = ref('')
const dailyLoaded = ref('')
const weekLoaded = ref('')

async function upsertReport(key, text) {
  const r = await db.reports.where('key').equals(key).first()
  if (r) await db.reports.update(r.id, { text, updatedAt: Date.now() })
  else await db.reports.add({ key, text, updatedAt: Date.now() })
}

// key 变了（换日期/换周）才重新对齐一次；同一天内手写的改动不会被覆盖
watchEffect(() => {
  const k = dailyKey.value
  if (dailyLoaded.value === k || reports.value === undefined || !reportText.value) return
  const saved = (reports.value || []).find(r => r.key === k)
  dailyDraft.value = saved ? saved.text : reportText.value
  dailyLoaded.value = k
  if (!saved) upsertReport(k, dailyDraft.value)
})
watchEffect(() => {
  const k = weeklyKey.value
  if (weekLoaded.value === k || reports.value === undefined || !weekText.value) return
  const saved = (reports.value || []).find(r => r.key === k)
  weekDraft.value = saved ? saved.text : weekText.value
  weekLoaded.value = k
  if (!saved) upsertReport(k, weekDraft.value)
})

let dailyTimer, weekTimer
function onDailyInput(e) {
  dailyDraft.value = e.target.value
  clearTimeout(dailyTimer)
  dailyTimer = setTimeout(() => upsertReport(dailyKey.value, dailyDraft.value), 600)
}
function onWeekInput(e) {
  weekDraft.value = e.target.value
  clearTimeout(weekTimer)
  weekTimer = setTimeout(() => upsertReport(weeklyKey.value, weekDraft.value), 600)
}
function regenDaily() { dailyDraft.value = reportText.value; upsertReport(dailyKey.value, dailyDraft.value) }
function regenWeek() { weekDraft.value = weekText.value; upsertReport(weeklyKey.value, weekDraft.value) }

// ---------- 每周 AI 建议 ----------
const aiWeek = ref('')
const aiWeekBusy = ref(false)
const aiWeekErr = ref('')
async function askWeek() {
  aiWeekBusy.value = true; aiWeekErr.value = ''; aiWeek.value = ''
  try {
    const rv = weekReviewText.value
    aiWeek.value = await weeklyDigest({
      range: `${weekRangeRep.value.key.slice(5)} 那周`,
      weekDone: weekDone.value,
      weekTotal: weekInst.value.length,
      focus: weekFocus.value,
      mood: weekMood.value?.avg != null ? Number(weekMood.value.avg.toFixed(1)) : null,
      body: (fitness.value || []).length,
      review: rv ? `做得好：${rv.good || '—'}；不足：${rv.bad || '—'}；下周：${rv.next || '—'}` : '',
    })
  } catch (e) { aiWeekErr.value = e.message || 'AI 这边没接上' }
  finally { aiWeekBusy.value = false }
}
function adoptWeek() {
  if (!aiWeek.value) return
  weekDraft.value = weekDraft.value.trim() ? `${weekDraft.value.trim()}\n\n— AI 的一句 —\n${aiWeek.value}` : aiWeek.value
  upsertReport(weeklyKey.value, weekDraft.value)
  aiWeek.value = ''
}
</script>

<template>
  <div>
    <div class="subnav">
      <button class="pill" :class="{ on: sub === 'review' }" @click="sub = 'review'">回望</button>
      <button class="pill" :class="{ on: sub === 'fitness' }" @click="sub = 'fitness'">体魄</button>
      <button class="pill" :class="{ on: sub === 'skill' }" @click="sub = 'skill'">技艺</button>
      <button class="pill" :class="{ on: sub === 'hall' }" @click="sub = 'hall'">殿堂</button>
      <button class="pill" :class="{ on: sub === 'vault' }" @click="sub = 'vault'">库房</button>
      <button class="pill" :class="{ on: sub === 'report' }" @click="sub = 'report'">日与周</button>
    </div>

    <!-- 复盘 -->
    <div v-if="sub === 'review'" class="two-col">
      <div class="card">
        <h3>回望 · {{ targetWeekStart.slice(5) }} 那一周</h3>
        <div class="row" style="margin-bottom:10px; flex-wrap:wrap">
          <span class="muted">回望之日 · 每周</span>
          <n-select :value="reviewStatus?.reviewDay ?? 6" @update:value="setReviewDay" style="width:100px" size="small"
            :options="RD_LABELS.map((l, i) => ({ label: l, value: i }))" />
          <n-select v-model:value="targetWeekStart" size="small" style="width:160px"
            :options="Array.from({ length: 8 }, (_, i) => {
              const ws = getWeekRange().start.subtract(i, 'week').format('YYYY-MM-DD')
              return { label: (i === 0 ? '本周' : `${ws.slice(5).replace('-', '/')} 周`), value: ws }
            })" @update:value="onSwitchWeek" />
          <n-tag v-if="editingReview" type="success" size="small">已写过，可再改</n-tag>
          <n-tag v-else-if="targetWeekStart < today()" type="warning" size="small">补写旧的一周</n-tag>
        </div>
        <n-input v-model:value="reviewForm.good" type="textarea" rows="2" placeholder="这一周，值得留存的" style="margin-bottom:8px" />
        <n-input v-model:value="reviewForm.bad" type="textarea" rows="2" placeholder="不尽如人意的地方" style="margin-bottom:8px" />
        <n-input v-model:value="reviewForm.next" type="textarea" rows="2" placeholder="下一周，想成为的样子" style="margin-bottom:10px" />
        <n-button type="primary" @click="saveReview">收下这篇回望</n-button>
      </div>
      <aside class="col-side">
        <div class="side-card">
          <div class="eyebrow teal">ARCHIVE</div>
          <h3>过往的回望<span class="cnt" v-if="(reviews||[]).length">已写 {{ (reviews||[]).length }} 篇</span></h3>
          <div v-for="r in [...(reviews||[])].sort((a,b)=>b.weekStart.localeCompare(a.weekStart)).slice(0, 6)" :key="r.id" class="word-row">
            <div class="word-d">{{ r.weekStart }} 那一周</div>
            <div class="word-t" v-if="r.text.good">值得留存：{{ r.text.good }}</div>
            <div class="word-t" v-if="r.text.bad">尚不足：{{ r.text.bad }}</div>
            <div class="word-t" v-if="r.text.next">下一周：{{ r.text.next }}</div>
          </div>
          <div class="muted" v-if="!(reviews||[]).length">写下第一篇，往后每一周都留个脚印</div>
        </div>
      </aside>
    </div>

    <!-- 健身 -->
    <div v-if="sub === 'fitness'" class="two-col">
      <div class="card">
        <h3>今日体魄 · {{ today() }}</h3>
        <div class="row" style="flex-wrap:wrap; margin-bottom:10px">
          <button v-for="p in PARTS" :key="p" class="pill" :class="{ on: picked.includes(p) }" @click="pickPart(p)">{{ p }}</button>
          <input v-model="customPart" placeholder="其他部位" style="width:110px" @keyup.enter="addCustomPart" />
          <button v-if="customPart.trim()" class="pill" @click="addCustomPart">＋</button>
        </div>
        <n-input v-model:value="fitnessNote" placeholder="备注（重量、组数、身体的感受…）" style="margin-bottom:10px" />
        <n-button type="primary" :disabled="!picked.length" @click="saveFitness">记下这一次</n-button>
      </div>
      <aside class="col-side">
        <div class="side-card">
          <div class="eyebrow">WEEK</div>
          <h3>这一周 · {{ (fitness||[]).length }} 次练习</h3>
          <div v-for="f in fitness" :key="f.id" class="word-row">
            <div class="word-t">
              <n-tag v-for="p in f.parts" :key="p" size="small" round type="success" style="margin-right:6px">{{ p }}</n-tag>
            </div>
            <div class="word-d">{{ f.date }}<template v-if="f.note"> · {{ f.note }}</template></div>
            <n-popconfirm @positive-click="delFitness(f.id)">
              <template #trigger><n-button quaternary size="tiny" type="error">删</n-button></template>
              删掉这一条训练记录？
            </n-popconfirm>
          </div>
          <div class="muted" v-if="!(fitness||[]).length">这一周还没有流汗的痕迹</div>
        </div>
        <div class="side-card">
          <div class="eyebrow purple">PARTS</div>
          <h3>练得最多</h3>
          <div v-for="[p, n] in partStats" :key="p" class="mini-row">
            <div class="mini-top"><span>{{ p }}</span><span class="mini-num">{{ n }} 次</span></div>
            <div class="mini-track"><div class="mini-fill" :style="{ width: n / (partStats[0]?.[1] || 1) * 100 + '%' }" /></div>
          </div>
          <div class="muted" v-if="!partStats.length">还没有部位的记录</div>
        </div>
      </aside>
    </div>

    <!-- 技能 -->
    <div v-if="sub === 'skill'" class="two-col">
      <div class="card">
        <h3>正在生长的技艺<span class="cnt">{{ (skills||[]).length }} 项</span></h3>
        <n-empty v-if="!(skills||[]).length" description="还没有在生长的技艺，去「设置」播下一颗" size="small" />
        <div v-for="s in skills" :key="s.id" class="task-row">
          <div class="task-main">
            <div class="task-title">{{ s.name }}</div>
            <div class="task-meta" v-if="s.note">{{ s.note }}</div>
          </div>
        </div>
      </div>
      <aside class="col-side">
        <div class="side-card">
          <div class="eyebrow purple">FOCUS</div>
          <h3>这一周的投入</h3>
          <div class="focus-num">{{ fmtDuration(weekFocus) || '0m' }}</div>
          <div class="goal-row" style="margin-top:14px"><span class="goal-t">完成的事</span><span class="goal-d">{{ weekDone }}/{{ weekInst.length }}</span></div>
          <div class="mini-row" style="margin-top:12px">
            <div class="mini-track">
              <div class="mini-fill" :style="{ width: (weekInst.length ? weekDone / weekInst.length * 100 : 0) + '%' }" />
            </div>
          </div>
          <div class="muted">技艺没有计时器，投入的时间就是它的刻度</div>
        </div>
      </aside>
    </div>

    <!-- 日报 / 周报 -->
    <div v-if="sub === 'report'" class="two-col">
      <div class="card">
        <h3>一日之记</h3>
        <n-date-picker v-model:value="reportDate" type="date" style="margin-bottom:10px; width:170px" size="small" />
        <textarea class="report-box edit" rows="14" :value="dailyDraft" @input="onDailyInput"></textarea>
        <div class="row">
          <n-button size="small" secondary type="primary" @click="copyReport">复制这一日</n-button>
          <n-button size="small" quaternary @click="regenDaily">按数据重来一遍</n-button>
        </div>
        <div class="muted" style="margin-top:6px">改动自动留成草稿；此刻是纯粹的统计，不经 AI</div>
      </div>
      <aside class="col-side">
        <div class="side-card">
          <h3>一周之记 · {{ weekRangeRep.key.slice(5) }} 那周</h3>
          <n-date-picker v-model:value="reportDate" type="week" style="margin-bottom:10px; width:180px" size="small" />
          <textarea class="report-box edit" rows="16" :value="weekDraft" @input="onWeekInput"></textarea>
          <div class="row">
            <n-button size="small" secondary type="primary" @click="copyWeek">{{ copied ? '已复制 ✓' : '复制这一周' }}</n-button>
            <n-button size="small" quaternary @click="regenWeek">按数据重来一遍</n-button>
          </div>
          <div class="row" style="margin-top:8px">
            <n-button size="small" secondary :loading="aiWeekBusy" :disabled="aiWeekBusy" @click="askWeek">
              {{ aiWeekBusy ? '想着…' : '让 AI 说说这一周' }}
            </n-button>
            <span v-if="aiWeekErr" class="muted">{{ aiWeekErr }}</span>
          </div>
          <div v-if="aiWeek" class="ai-box">
            <div class="ai-head"><span>AI 的一句</span><button class="ai-close" @click="aiWeek = ''">收起</button></div>
            <div class="ai-text">{{ aiWeek }}</div>
            <n-button size="tiny" quaternary style="margin-top:8px" @click="adoptWeek">放进周报</n-button>
          </div>
          <div class="muted" style="margin-top:6px">含回望摘录；AI 是否读得到你的原句，由设置里的开关说了算</div>
        </div>
      </aside>
    </div>

    <!-- 成就殿堂 / 长期资产库 -->
    <Achievement v-if="sub === 'hall'" />
    <Vault v-else-if="sub === 'vault'" />
  </div>
</template>

<style scoped>
.report-box {
  background: var(--card-alt);
  border: 1px solid var(--line);
  border-radius: 16px; padding: 16px 18px;
  font-size: 14.5px; line-height: 1.8; white-space: pre-wrap;
  font-family: inherit; margin-bottom: 12px;
}
.report-box.edit { width: 100%; resize: vertical; outline: none; }
.report-box.edit:focus { border-color: var(--primary-hover); }
</style>
