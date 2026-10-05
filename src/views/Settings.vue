<script setup>
import { ref, computed, watch, watchEffect } from 'vue'
import dayjs from 'dayjs'
import { VueDraggable } from 'vue-draggable-plus'
import { NInput, NSelect, NButton, NPopconfirm, NEmpty, NTag, NSwitch } from 'naive-ui'
import { db } from '../db'
import { setAiAllowDetail, loadScope, saveScope } from '../ai'
import { useProfile, useCategories, useCheckinsToday, useRecycleBin, useSkills, useLiveQuery, useModuleConfig } from '../composables'
import { exportBackupFile, takeSnapshot, restoreSnapshot, fmtSize } from '../backup'
import CloudPanel from '../CloudPanel.vue'

const profile = useProfile()
const categories = useCategories()
const checkins = useCheckinsToday()

// ---------- AI 授权：是否允许 AI 读到正文细节 ----------
const aiDetail = ref(false)
watch(() => profile.value?.aiAllowDetail, v => { aiDetail.value = !!v }, { immediate: true })
const scope = ref(loadScope())
const SCOPE_LABELS = {
  today: '今天的任务', week: '本周的统计', mood: '心情打分',
  journal: '随笔原文', skills: '在练的技艺', body: '健身记录',
}
async function toggleAiDetail(v) {
  aiDetail.value = v // 先给反馈，库里的结果由 liveQuery 随后对齐
  try { await setAiAllowDetail(v) } catch (e) { console.error('写 AI 授权失败', e) }
}
function toggleScope(k, v) { scope.value[k] = v; scope.value = saveScope({ ...scope.value, [k]: v }) }

const bin = useRecycleBin()
const skills = useSkills()

// ---------- 正在学习的技能 ----------
const newSkill = ref('')
async function addSkill() {
  if (!newSkill.value.trim()) return
  await db.skills.add({ name: newSkill.value.trim(), note: '', createdAt: Date.now(), archivedAt: undefined })
  newSkill.value = ''
}
async function delSkill(s) { await db.skills.update(s.id, { archivedAt: Date.now() }) } // 归档不物理删除

const form = ref(null)
function edit() {
  form.value = { ...profile.value }
}
async function saveProfile() {
  await db.profile.update(1, { name: form.value.name, signature: form.value.signature, avatar: form.value.avatar, avatarData: form.value.avatarData || undefined })
  form.value = null
}

// ---------- 头像上传：本地压缩为 256px dataURL 存 IndexedDB ----------
const avatarInput = ref(null)
function pickAvatar() { avatarInput.value?.click() }
function onAvatarFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || !file.type.startsWith('image/')) return
  const img = new Image()
  const url = URL.createObjectURL(file)
  img.onload = () => {
    const S = 256
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = S
    const ctx = canvas.getContext('2d')
    // cover 裁剪：取中心方形
    const side = Math.min(img.width, img.height)
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S)
    URL.revokeObjectURL(url)
    form.value.avatarData = canvas.toDataURL('image/jpeg', 0.85)
  }
  img.src = url
}
function clearAvatar() { form.value.avatarData = undefined }

const newCat = ref('')
async function addCat() {
  if (!newCat.value.trim()) return
  const colors = ['var(--r-body)', 'var(--r-craft)', 'var(--r-focus)', 'var(--r-goal)', 'var(--r-today)', 'var(--lime)']
  await db.categories.add({ name: newCat.value.trim(), color: colors[Math.floor(Math.random() * colors.length)], system: false })
  newCat.value = ''
}
async function delCat(c) {
  if (c.system) return // 系统保留分类（科研）不可删除
  await db.categories.delete(c.id)
}

const newItem = ref('')
async function addCheckin() {
  if (!newItem.value.trim()) return
  await db.checkinItems.add({ name: newItem.value.trim(), type: 'bool', target: 1 })
  newItem.value = ''
}
async function updCheckin(c, patch) {
  await db.checkinItems.update(c.id, patch) // 名称/类型/目标杯数即时保存
}
async function delCheckin(c) {
  await db.checkinItems.update(c.id, { deletedAt: Date.now() }) // 软删除 → 回收站
}

// ---------- 回收站 ----------
const binRows = computed(() => bin.value || [])
const binCount = computed(() => binRows.value.length)

async function restoreBin(r) { await db[r.table].update(r.id, { deletedAt: undefined }) }
async function purgeBin(r) {
  if (r.table === 'tasks') await db.taskInstances.where('taskId').equals(r.id).delete()
  await db[r.table].delete(r.id)
}

// ---------- 备份与每周快照 ----------
const snaps = useLiveQuery(() => db.backups.orderBy('createdAt').reverse().toArray())
const snapRows = computed(() => (snaps.value || []).map(s => ({
  id: s.id,
  time: dayjs(s.createdAt).format('YYYY-MM-DD HH:mm'),
  size: fmtSize(new Blob([s.json]).size),
})))
async function newSnap() { await takeSnapshot() }
async function restoreSnap(id) {
  await restoreSnapshot(id)
  alert('已并回那份快照（本机比它新的内容不会被覆盖），刷新页面后即可看到')
}
async function delSnap(id) { await db.backups.delete(id) }

// ---------- 模块的取舍：侧栏模块的显隐与排序 ----------
const modCfg = useModuleConfig()
const modRows = ref([])
watch(() => modCfg.value, v => { modRows.value = (v || []).map(m => ({ ...m })) }, { immediate: true, deep: true })
async function persistOrder() {
  for (let i = 0; i < modRows.value.length; i++) {
    await db.moduleConfig.update(modRows.value[i].id, { order: i })
  }
}
async function toggleModule(m, v) {
  await db.moduleConfig.update(m.id, { enabled: v ? 1 : 0 })
  m.enabled = v ? 1 : 0
}
async function resetModules() {
  for (let i = 0; i < modRows.value.length; i++) {
    await db.moduleConfig.update(modRows.value[i].id, { order: i, enabled: 1 })
  }
}
</script>

<template>
  <div>
    <div class="card">
      <h3>关于你</h3>
      <template v-if="form">
        <div class="row" style="margin-bottom:10px">
          <img v-if="form.avatarData" :src="form.avatarData" class="avatar-img" style="width:52px;height:52px" />
          <div v-else class="avatar-emoji" style="width:40px;height:40px;font-size:20px">{{ form.avatar }}</div>
          <div class="grow">
            <div class="row" style="flex-wrap:wrap">
              <n-button size="small" type="primary" secondary @click="pickAvatar">换一张头像</n-button>
              <n-button v-if="form.avatarData" size="small" quaternary @click="clearAvatar">换回表情</n-button>
            </div>
            <input ref="avatarInput" type="file" accept="image/*" style="display:none" @change="onAvatarFile" />
          </div>
        </div>
        <div class="row" style="margin-bottom:8px; flex-wrap:wrap">
          <span class="muted">或者挑个表情：</span>
          <button v-for="e in ['🦊','🐼','🐸','🦉','🐙','🌱','⭐']" :key="e" class="pill"
            :class="{ on: !form.avatarData && form.avatar === e }" @click="form.avatar = e; form.avatarData = undefined">{{ e }}</button>
        </div>
        <div class="row" style="margin-bottom:8px">
          <n-input v-model:value="form.name" placeholder="你的名字" style="width:150px" />
          <n-input v-model:value="form.signature" placeholder="一句写给自己的话" class="grow" />
        </div>
        <div class="row">
          <n-button type="primary" @click="saveProfile">保存</n-button>
          <n-button quaternary @click="form = null">取消</n-button>
        </div>
      </template>
      <template v-else>
        <div class="row">
          <img v-if="profile?.avatarData" :src="profile.avatarData" class="avatar-img" style="width:52px;height:52px" />
          <div v-else class="avatar-emoji" style="width:40px;height:40px;font-size:20px">{{ profile?.avatar }}</div>
          <div class="grow">
            <b>{{ profile?.name }}</b>
            <div class="muted">{{ profile?.signature }}</div>
          </div>
          <n-button quaternary size="small" @click="edit">编辑</n-button>
        </div>
      </template>
    </div>

    <div class="card">
      <h3>AI 的分寸<span class="cnt">随时可改</span></h3>
      <div class="row" style="align-items:flex-start; margin-bottom:12px">
        <div class="grow">
          <div style="font-weight:600">允许 AI 读取正文内容</div>
          <div class="muted">关着的时候，AI 只看得到汇总的数字，读不到你的原句与备注</div>
        </div>
        <n-switch :value="aiDetail" @update:value="toggleAiDetail" />
      </div>
      <div class="muted" style="margin-bottom:8px">下面这些类别，决定哪些会进入 AI 的上下文</div>
      <div class="row" style="flex-wrap:wrap; gap:8px">
        <span v-for="(lb, k) in SCOPE_LABELS" :key="k" class="scope-chip">
          {{ lb }}<n-switch size="small" :value="scope[k]" @update:value="v => toggleScope(k, v)" />
        </span>
      </div>
    </div>

    <div class="card">
      <h3>计划的归属</h3>
      <div class="row" style="flex-wrap:wrap; margin-bottom:10px">
        <span v-for="c in categories" :key="c.id" class="tag" style="padding:6px 12px; font-size:13px"
          :style="{ background: c.color }">
          {{ c.name }}<template v-if="c.system">（内置不可删）</template>
          <button v-if="!c.system" style="border:none;background:none;color:#fff;cursor:pointer;margin-left:4px"
            @click="delCat(c)">×</button>
        </span>
      </div>
      <div class="row">
        <n-input v-model:value="newCat" placeholder="再添一个分类，比如「阅读」「家事」" @keyup.enter="addCat" class="grow" />
        <n-button type="primary" @click="addCat">添加</n-button>
      </div>
    </div>

    <div class="card">
      <h3>日常印记（改名、换类型、调目标，即刻生效）</h3>
      <div v-for="c in checkins" :key="c.id" class="row" style="margin-bottom:8px">
        <n-input :value="c.name" style="width:140px" @update:value="v => updCheckin(c, { name: v })" size="small" />
        <n-select :value="c.type" style="width:96px" size="small" @update:value="v => updCheckin(c, { type: v })"
          :options="[{label:'点一下',value:'bool'},{label:'记次数',value:'count'}]" />
        <input v-if="c.type === 'count'" type="number" min="1" :value="c.target" style="width:70px"
          @change="updCheckin(c, { target: Math.max(1, Number($event.target.value) || 1) })" />
        <span class="muted" v-if="c.type === 'count'">次 / 杯</span>
        <n-popconfirm @positive-click="delCheckin(c)">
          <template #trigger><n-button quaternary size="tiny" type="error">移除</n-button></template>
          先收进回收站，想留还能取回
        </n-popconfirm>
      </div>
      <div class="row">
        <n-input v-model:value="newItem" placeholder="添一件想坚持的小事（默认点一下就算，也可改成记次数）"
          @keyup.enter="addCheckin" class="grow" />
        <n-button type="primary" @click="addCheckin">添加</n-button>
      </div>
    </div>

    <!-- 正在学习的技能 -->
    <div class="card">
      <h3>正在打磨的技艺</h3>
      <div v-for="s in skills" :key="s.id" class="row" style="margin-bottom:8px">
        <span class="grow">{{ s.name }}</span>
        <n-popconfirm @positive-click="delSkill(s)">
          <template #trigger><n-button quaternary size="tiny">暂告一段落</n-button></template>
          先归档，练过的痕迹都留着
        </n-popconfirm>
      </div>
      <div class="row">
        <n-input v-model:value="newSkill" placeholder="想打磨的技艺（比如：英语口语）" @keyup.enter="addSkill" class="grow" />
        <n-button type="primary" @click="addSkill">添加</n-button>
      </div>
    </div>

    <!-- 回收站：软删除内容 30 天自动清理 -->
    <div class="card">
      <h3>回收站{{ binCount ? `（${binCount}）` : '' }}</h3>
      <div class="muted" style="margin-bottom:8px">删掉的东西先在这里躺 30 天，随时可以接回来</div>
      <n-empty v-if="!binCount" description="这里空空的，挺好" size="small" />
      <div v-for="r in binRows" :key="r.table + '-' + r.id" class="task-row">
        <div class="task-main">
          <div class="task-title">{{ r.label }} · {{ r.text }}</div>
        </div>
        <n-button size="tiny" type="primary" secondary @click="restoreBin(r)">接回来</n-button>
        <n-popconfirm @positive-click="purgeBin(r)">
          <template #trigger><n-button quaternary size="tiny" type="error">彻底抹去</n-button></template>
          抹去之后就找不回了{{ r.table === 'tasks' ? '（连同它的打卡记录）' : '' }}
        </n-popconfirm>
      </div>
    </div>

    <div class="card">
      <h3>模块的取舍</h3>
      <div class="muted" style="margin-bottom:10px">拖着排序，右侧开关决定它在不在侧栏。设置永远留着，免得回不来。</div>
      <VueDraggable v-model="modRows" handle=".mod-grip" :animation="160" class="mod-list" @end="persistOrder">
        <div v-for="m in modRows" :key="m.key" class="task-row mod-row">
          <span class="mod-grip" aria-hidden="true">⋮⋮</span>
          <div class="task-main">
            <div class="task-title">{{ m.label }}</div>
            <div class="task-meta">{{ m.enabled ? '在侧栏' : '已收起' }}</div>
          </div>
          <n-switch :value="m.enabled !== 0" :disabled="m.key === 'settings'" @update:value="v => toggleModule(m, v)" />
        </div>
      </VueDraggable>
      <n-button size="small" quaternary style="margin-top:10px" @click="resetModules">恢复默认顺序</n-button>
    </div>

    <div class="card">
      <h3>备份与快照</h3>
      <div class="row" style="flex-wrap:wrap; margin-bottom:10px">
        <n-button size="small" type="primary" @click="exportBackupFile">导出一份 JSON</n-button>
        <n-button size="small" secondary @click="newSnap">此刻存一份</n-button>
        <span class="muted">每周自动留一份，只留最近 4 份；数据仍只在本机</span>
      </div>
      <n-empty v-if="!snapRows.length" description="还没有快照，打开应用时会自动留第一份" size="small" />
      <div v-for="s in snapRows" :key="s.id" class="task-row">
        <div class="task-main">
          <div class="task-title">{{ s.time }}</div>
          <div class="task-meta">{{ s.size }}</div>
        </div>
        <n-button size="tiny" secondary type="primary" @click="restoreSnap(s.id)">回到那天</n-button>
        <n-popconfirm @positive-click="delSnap(s.id)">
          <template #trigger><n-button quaternary size="tiny" type="error">删</n-button></template>
          删掉这份快照？删了就回不去了
        </n-popconfirm>
      </div>
    </div>

    <div class="card">
      <h3>云端同步<span class="cnt">可选</span></h3>
      <div class="muted" style="margin-bottom:12px">
        数据始终以本机为准；登录后可以把整份数据传上云端，在另一台设备上并回来。
      </div>
      <CloudPanel />
    </div>

    <div class="card">
      <h3>关于这座工作台</h3>
      <div class="muted">
        Life Workbench · 第一版<br />
        数据默认只存在你自己的浏览器里（Dexie / IndexedDB）；登录后可选同步到云端，AI 能力走 WorkBuddy 免密钥通道。<br />
        由 Naive UI · FullCalendar · vue3-circle-progress · vue3-calendar-heatmap · Dexie.js 搭成
      </div>
    </div>
  </div>
</template>
<style scoped>
.mod-list { display: flex; flex-direction: column; gap: 8px; }
.mod-row { align-items: center; }
.mod-grip { cursor: grab; color: var(--text-3); font-size: 13px; letter-spacing: -1px; padding-right: 4px; user-select: none; }
.mod-row:active .mod-grip { cursor: grabbing; }
</style>
