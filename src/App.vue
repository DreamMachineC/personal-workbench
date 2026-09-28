<script setup>
import { ref, computed, watchEffect, onMounted, onUnmounted, defineAsyncComponent } from 'vue'
import Fuse from 'fuse.js'
import { NConfigProvider, NInput, NButton, NTag, NEmpty, zhCN, dateZhCN } from 'naive-ui'
import Home from './views/Home.vue'
import Todos from './views/Todos.vue'
// 日历拖着 FullCalendar 这个大块，拆出去按需加载，首屏不用等它
const CalendarView = defineAsyncComponent(() => import('./views/CalendarView.vue'))
import Records from './views/Records.vue'
import Growth from './views/Growth.vue'
import Research from './views/Research.vue'
import SettingsView from './views/Settings.vue'
import Assistant from './Assistant.vue'
import { db } from './db'
import { useReviewStatus, useProfile } from './composables'
import { today } from './date'
import { undoState, runUndo, hideUndo } from './undo'
import { exportBackupFile, importBackupFile } from './backup'
import { useModuleConfig, growthSub } from './composables'

const reviewStatus = useReviewStatus()
const profile = useProfile()

const tab = ref('home')
// 线性图标（24 网格，描边随文字色），不用 emoji
const ICONS = {
  home: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  plan: '<path d="M3.5 7l2 2 3.5-3.5"/><path d="M12 7h8.5"/><path d="M3.5 16.5l2 2 3.5-3.5"/><path d="M12 17.5h8.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  journal: '<path d="M6 3h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v6h6"/><path d="M8.5 13.5h7"/><path d="M8.5 17.5h5"/>',
  growth: '<path d="M3.5 16.5l5.5-5.5 4 3.5 7-8"/><path d="M15 6.5h5.5V12"/>',
  settings: '<path d="M4 8h16"/><path d="M4 16h16"/><circle cx="9" cy="8" r="2.6"/><circle cx="15.5" cy="16" r="2.6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/>',
  research: '<path d="M9 3h6"/><path d="M10 3v6l-4.4 8.2a3 3 0 0 0 2.6 4.3h7.6a3 3 0 0 0 2.6-4.3L14 9V3"/><path d="M7.9 14.5h8.2"/>',
}
const tabs = [
  { key: 'home', icon: 'home', label: '今日' },
  { key: 'todos', icon: 'plan', label: '计划' },
  { key: 'calendar', icon: 'calendar', label: '日历' },
  { key: 'records', icon: 'journal', label: '手帐' },
  { key: 'growth', icon: 'growth', label: '成长' },
  { key: 'research', icon: 'research', label: '科研' },
  { key: 'settings', icon: 'settings', label: '设置' },
]
const REVIEW_DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 侧栏模块：按用户配置过滤与排序（设置页可拖拽 / 开关）
const modCfg = useModuleConfig()
const navTabs = computed(() => {
  const cfg = Object.fromEntries((modCfg.value || []).map(m => [m.key, m]))
  return tabs
    .map((t, i) => ({ ...t, order: cfg[t.key]?.order ?? i, off: cfg[t.key]?.enabled === 0 && t.key !== 'settings' }))
    .filter(t => !t.off)
    .sort((a, b) => a.order - b.order)
})

// 复盘公告弹窗：强提醒（复盘日当天 / 周末兜底）打开页面即弹出，点「稍后」本次会话不再弹
const reviewDismissed = ref(false)
const showReviewModal = ref(false)
function checkReviewModal(v) {
  if (v?.strong && !reviewDismissed.value) showReviewModal.value = true
}
watchEffect(() => {
  if (!navTabs.value.some(t => t.key === tab.value)) tab.value = navTabs.value[0]?.key || 'settings'
})

function goReview() {
  showReviewModal.value = false
  reviewDismissed.value = true
  tab.value = 'growth'
}
function laterReview() {
  showReviewModal.value = false
  reviewDismissed.value = true
}

// Naive UI 主题：暖可可主按钮；输入框统一加大
const themeOverrides = {
  common: {
    primaryColor: '#4a3426',
    primaryColorHover: '#5e4331',
    primaryColorPressed: '#3a281c',
    primaryColorSuppl: '#5e4331',
    borderRadius: '12px',
    heightMedium: '46px',
    heightLarge: '52px',
    fontSizeMedium: '16px',
    fontSizeLarge: '17px',
  },
}

// ---------- 命令面板（Cmd+K）：可执行动作 + 任务 + 碎碎念 ----------
const showSearch = ref(false)
const kw = ref('')
const EMPTY_HITS = { tasks: [], journals: [], reviews: [], notes: [], achievements: [], assets: [] }
const hits = ref({ ...EMPTY_HITS })
let searchTimer = null

const MOD_HINT = {
  home: '一屏看完今天', todos: '日常、重复、搁浅', calendar: '节假日与安排',
  records: '印记与随笔', growth: '复盘、体魄、技艺', research: '课题、方向、待办、心得',
  settings: '资料、分类、回收站',
}
const COMMANDS = computed(() => [
  ...navTabs.value.map(t => ({
    title: t.key === 'home' ? '回到今日' : `打开${t.label}`,
    hint: MOD_HINT[t.key] || '',
    run: () => { tab.value = t.key },
  })),
  { title: '导出备份', hint: '存一份 JSON 到本地', run: exportBackupFile },
  { title: '导入备份', hint: '从 JSON 恢复', run: pickImport },
])
const fuse = computed(() => new Fuse(COMMANDS, {
  keys: [{ name: 'title', weight: 2 }, 'hint'],
  threshold: 0.4,
}))
const cmdHits = computed(() => {
  const k = kw.value.trim()
  if (!k) return COMMANDS.value.slice(0, 5)
  return fuse.value.search(k).slice(0, 5).map(r => r.item)
})
// 输入了内容才出现的即时动作：直接建任务 / 记一句
const quickActions = computed(() => {
  const k = kw.value.trim()
  if (!k) return []
  return [
    { title: `记一件事：${k}`, hint: '放进今天的清单', run: async () => {
        const id = await db.tasks.add({ title: k, type: 'short', categoryId: null, rrule: null, status: 'active', createdAt: Date.now() })
        await db.taskInstances.add({ taskId: id, date: today(), status: 'todo', completedAt: null, durationMin: 0, timerStart: null })
        tab.value = 'todos'
      } },
    { title: `记一句：${k}`, hint: '存进手帐', run: async () => {
        await db.journals.add({ date: today(), text: k, createdAt: Date.now(), deletedAt: undefined })
        tab.value = 'records'
      } },
  ]
})
function runCmd(c) { showSearch.value = false; kw.value = ''; Promise.resolve(c.run()) }

// 移动端：从屏幕左右边缘横滑，切到相邻模块（起手点不在边缘不触发，避免误伤日历/甘特的横向滚动）
const edgeTouch = ref(null)
function onTouchStart(e) {
  if (window.innerWidth > 768) return
  const t = e.touches?.[0]
  if (!t) return
  if (t.clientX > 28 && t.clientX < window.innerWidth - 28) return
  edgeTouch.value = { x: t.clientX, y: t.clientY }
}
function onTouchEnd(e) {
  if (!edgeTouch.value) return
  const t = e.changedTouches?.[0]
  const dx = t ? t.clientX - edgeTouch.value.x : 0
  const dy = t ? t.clientY - edgeTouch.value.y : 0
  edgeTouch.value = null
  if (Math.abs(dx) < 60 || Math.abs(dy) > 40) return
  const keys = navTabs.value.map(x => x.key)
  const i = keys.indexOf(tab.value)
  const next = dx < 0 ? i + 1 : i - 1
  if (next >= 0 && next < keys.length) tab.value = keys[next]
}

function openSearch() { showSearch.value = true }
function onKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); showSearch.value = true }
  if (e.key === 'Escape' && showSearch.value) showSearch.value = false
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
function onInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(doSearch, 200)
}
async function doSearch() {
  const k = kw.value.trim()
  if (!k) { hits.value = { ...EMPTY_HITS }; return }
  const has = s => (s || '').includes(k)
  const [tasks, journals, reviews, notes, achievements, assets] = await Promise.all([
    db.tasks.filter(t => !t.deletedAt && has(t.title)).limit(8).toArray(),
    db.journals.filter(j => !j.deletedAt && has(j.text)).limit(8).toArray(),
    db.reviews.filter(r => [r.text?.good, r.text?.bad, r.text?.next].some(has)).limit(6).toArray(),
    db.researchNotes.filter(n => !n.deletedAt && (has(n.title) || has(n.text))).limit(6).toArray(),
    db.achievements.filter(a => !a.archivedAt && (has(a.title) || has(a.desc))).limit(6).toArray(),
    db.assets.filter(a => !a.deletedAt && (has(a.title) || has(a.summary) || has(a.text))).limit(6).toArray(),
  ])
  hits.value = { tasks, journals, reviews, notes, achievements, assets }
}
// 命中后跳到对应模块；成长页的子页（殿堂/库房/回望）直接定位
function gotoHit(tabKey, subKey) {
  showSearch.value = false
  kw.value = ''
  if (subKey) growthSub.value = subKey
  tab.value = tabKey
}
const anyHit = computed(() => Object.values(hits.value).some(a => a.length))

// ---------- 备份导出 / 导入（侧栏按钮） ----------
const fileEl = ref(null)
function pickImport() { fileEl.value?.click() }
async function onImportFile(e) {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    await importBackupFile(file)
    alert('导入完成，数据已合并')
  } catch (err) {
    alert('导入失败：' + err.message)
  }
  e.target.value = ''
}
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides" :locale="zhCN" :date-locale="dateZhCN">
    <!-- 复盘轻提示：非强提醒日的横幅 + 导航角标（不推送，仅页面内） -->
    <div v-if="reviewStatus?.light" class="review-banner light" @click="tab = 'growth'">
      有未完成的复盘周次（{{ reviewStatus.missedWeekStart?.slice(5).replace('-', '/') }} 周）· 点击补写
    </div>

    <nav class="tabbar">
      <!-- 侧栏独有：logo + 寄语气泡 + 备份（仅桌面显示） -->
      <div class="side-only side-logo">
        <div class="mark"><img v-if="profile?.avatarData" :src="profile.avatarData" /><template v-else>{{ profile?.avatar || '✦' }}</template></div>
        <div class="name">{{ profile?.name || '我的' }}的工作台</div>
      </div>
      <button v-for="t in navTabs" :key="t.key" :class="{ active: tab === t.key }" @click="tab = t.key">
        <svg class="ico" viewBox="0 0 24 24" v-html="ICONS[t.icon]" aria-hidden="true"></svg>{{ t.label }}<span v-if="t.key === 'growth' && reviewStatus?.light" class="dot" />
      </button>
      <button @click="openSearch"><svg class="ico" viewBox="0 0 24 24" v-html="ICONS.search" aria-hidden="true"></svg>搜索</button>
      <div class="side-only side-bubble">
        {{ profile?.signature || '今天留下痕迹，未来才看得见自己。' }}
      </div>
      <div class="side-only" style="margin-top:auto">
        <button class="side-btn" @click="exportBackupFile">导出备份</button>
        <button class="side-btn" @click="pickImport">导入备份</button>
        <input ref="fileEl" type="file" accept="application/json" style="display:none" @change="onImportFile" />
      </div>
    </nav>
    <main @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd" @touchcancel.passive="edgeTouch.value = null">
      <Home v-if="tab === 'home'" @goto="tab = $event" />
      <Todos v-else-if="tab === 'todos'" />
      <CalendarView v-else-if="tab === 'calendar'" />
      <Records v-else-if="tab === 'records'" />
      <Growth v-else-if="tab === 'growth'" />
      <Research v-else-if="tab === 'research'" />
      <SettingsView v-else />
    </main>

    <Assistant />

    <teleport to="body">
      <div v-if="undoState" class="undo-bar">
        <span>{{ undoState.text }}</span>
        <button class="undo-btn" @click="runUndo">撤销</button>
        <button class="undo-close" @click="hideUndo">×</button>
      </div>

      <!-- 复盘公告弹窗：打开页面即弹出（复盘日当天 / 周末兜底） -->
      <div v-if="reviewStatus?.strong && showReviewModal" class="review-modal-mask" @click.self="laterReview">
        <div class="review-modal">
          <template v-if="reviewStatus.isReviewDay">
            <h2>今天是复盘日</h2>
            <p>每周{{ REVIEW_DAY_LABELS[reviewStatus.reviewDay] }}是你的复盘时间<br />回顾这一周，想想下周怎么过得更好</p>
          </template>
          <template v-else>
            <h2>本周复盘还没写</h2>
            <p>{{ reviewStatus.weekStart?.slice(5).replace('-', '/') }} 起的这一周还没有复盘<br />周末是兜底复盘时间，趁记得补写一下吧</p>
          </template>
          <div class="actions">
            <button class="btn plain" @click="laterReview">稍后再说</button>
            <button class="btn" @click="goReview">去复盘</button>
          </div>
        </div>
      </div>

      <div v-if="showSearch" class="search-mask" @click.self="showSearch = false">
        <div class="search-panel">
          <n-input v-model:value="kw" size="large" placeholder="搜点什么，或直接做一件事…" @input="onInput" autofocus
            @keyup.enter="cmdHits.length ? runCmd(cmdHits[0]) : (quickActions.length ? runCmd(quickActions[0]) : null)" />
          <div class="sec">
            <h4>{{ kw.trim() ? '去做' : '快捷去处' }}</h4>
            <div v-for="(c, i) in [...quickActions, ...cmdHits]" :key="i" class="search-hit"
              @click="runCmd(c)">
              <b>{{ c.title }}</b> <span class="muted">{{ c.hint }}</span>
            </div>
          </div>
          <div class="sec" v-if="kw.trim()">
            <template v-if="hits.tasks.length">
              <h4>任务</h4>
              <div v-for="t in hits.tasks" :key="t.id" class="search-hit" @click="gotoHit('todos')">
                <b>{{ t.title }}</b> <span class="muted">{{ t.type === 'long' ? '长期' : '短期' }}</span>
              </div>
            </template>
            <template v-if="hits.journals.length">
              <h4>碎碎念</h4>
              <div v-for="j in hits.journals" :key="j.id" class="search-hit" @click="gotoHit('records')">
                {{ j.text.slice(0, 60) }}<span v-if="j.text.length > 60">…</span>
                <span class="muted">{{ j.date.slice(5) }}</span>
              </div>
            </template>
            <template v-if="hits.reviews.length">
              <h4>回望</h4>
              <div v-for="r in hits.reviews" :key="r.id" class="search-hit" @click="gotoHit('growth', 'review')">
                <b>{{ r.weekStart.slice(5) }} 那一周</b>
                <span class="muted">{{ [r.text?.good, r.text?.bad, r.text?.next].filter(Boolean).join(' / ').slice(0, 40) }}</span>
              </div>
            </template>
            <template v-if="hits.notes.length">
              <h4>科研心得</h4>
              <div v-for="n in hits.notes" :key="n.id" class="search-hit" @click="gotoHit('research')">
                <b>{{ n.title || '（无题）' }}</b>
                <span class="muted">{{ (n.text || '').slice(0, 40) }}</span>
              </div>
            </template>
            <template v-if="hits.achievements.length">
              <h4>殿堂</h4>
              <div v-for="a in hits.achievements" :key="a.id" class="search-hit" @click="gotoHit('growth', 'hall')">
                <b>{{ a.title }}</b> <span class="muted">{{ a.date }} · {{ a.category }}</span>
              </div>
            </template>
            <template v-if="hits.assets.length">
              <h4>库房</h4>
              <div v-for="a in hits.assets" :key="a.id" class="search-hit" @click="gotoHit('growth', 'vault')">
                <b>{{ a.title }}</b>
                <span class="muted">{{ (a.summary || a.text || '').slice(0, 40) }}</span>
              </div>
            </template>
            <n-empty v-if="!anyHit" description="没有找到相关内容" size="small" style="margin: 18px 0" />
          </div>
          <div class="sec muted" v-else>回车执行第一条 · Esc 关闭 · 可搜任务、碎碎念、回望、科研心得、殿堂与库房</div>
        </div>
      </div>
    </teleport>
  </n-config-provider>
</template>
