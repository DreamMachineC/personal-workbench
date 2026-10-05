<template>
  <div class="two-col">
    <div class="card">
      <h3>殿堂 · {{ (achievements || []).length }} 件值得留着的事</h3>

      <div class="row" style="margin-bottom:10px; flex-wrap:wrap">
        <n-input v-model:value="form.title" placeholder="做成了一件什么" class="grow" @keyup.enter="add" />
        <input type="date" v-model="form.date" style="width:160px" />
        <n-select v-model:value="form.category" size="small" style="width:120px" :options="CATS.map(c => ({ label: c, value: c }))" />
      </div>
      <div class="row" style="margin-bottom:10px">
        <n-input v-model:value="form.desc" placeholder="一句话记下当时的情形（可留空）" class="grow" />
        <n-button type="primary" @click="add">收进殿堂</n-button>
      </div>
      <div class="subnav">
        <n-button size="small" secondary @click="pickImage">{{ form.imageData ? '换一张图' : '附一张图' }}</n-button>
        <span v-if="form.imageData" class="ach-thumb"><img :src="form.imageData" alt="" /></span>
        <n-button v-if="form.imageData" size="small" quaternary @click="form.imageData = undefined">去掉图</n-button>
        <input ref="fileEl" type="file" accept="image/*" style="display:none" @change="onFile" />
      </div>

      <div class="row" style="margin-bottom:12px; flex-wrap:wrap">
        <button class="pill" :class="{ on: filter === '全部' }" @click="filter = '全部'">全部</button>
        <button v-for="c in CATS" :key="c" class="pill" :class="{ on: filter === c }" @click="filter = c">{{ c }}</button>
      </div>

      <n-empty v-if="!shown.length" description="还没有收进来的事" size="small" />
      <div class="ach-grid">
        <div v-for="a in shown" :key="a.id" class="ach-card">
          <img v-if="a.imageData" class="ach-img" :src="a.imageData" alt="" />
          <div class="ach-body">
            <div class="ach-title">{{ a.title }}</div>
            <div class="ach-meta">{{ a.date }} · {{ a.category }}</div>
            <div class="ach-desc" v-if="a.desc">{{ a.desc }}</div>
          </div>
          <n-popconfirm @positive-click="del(a)">
            <template #trigger><n-button quaternary size="tiny" type="error">删除</n-button></template>
            从殿堂里去掉这一件？
          </n-popconfirm>
        </div>
      </div>
    </div>

    <div class="col-side">
      <div class="side-card">
        <h3>攒下的分量</h3>
        <div class="focus-num">{{ (achievements || []).length }}</div>
        <div class="muted">件 · 今年 {{ thisYear }} 件</div>
        <div class="muted" style="margin-top:8px" v-if="latest">最近一件：{{ latest.title }}（{{ latest.date }}）</div>
      </div>
      <div class="side-card">
        <h3>都落在哪儿</h3>
        <div v-for="[c, n] in byCat" :key="c" class="mini-row">
          <div class="mini-top"><span>{{ c }}</span><span class="mini-num">{{ n }} 件</span></div>
          <div class="mini-track">
            <div class="mini-fill" :style="{ width: Math.round(n / Math.max(1, (achievements || []).length) * 100) + '%' }" />
          </div>
        </div>
        <n-empty v-if="!byCat.length" description="还没有可统计的" size="small" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { NInput, NButton, NSelect, NEmpty, NPopconfirm } from 'naive-ui'
import { db } from '../db'
import { useAchievements } from '../composables'

const achievements = useAchievements()
const CATS = ['学习', '生活', '工作', '科研', '其他']
const filter = ref('全部')
const fileEl = ref(null)
const empty = () => ({ title: '', date: new Date().toISOString().slice(0, 10), category: '其他', desc: '', imageData: undefined })
const form = ref(empty())

const shown = computed(() => (achievements.value || []).filter(a => filter.value === '全部' || a.category === filter.value))
const thisYear = computed(() => (achievements.value || []).filter(a => a.date.startsWith(String(new Date().getFullYear()))).length)
const latest = computed(() => (achievements.value || [])[0] || null)
const byCat = computed(() => {
  const m = {}
  for (const a of achievements.value || []) m[a.category] = (m[a.category] || 0) + 1
  return Object.entries(m).sort((x, y) => y[1] - x[1])
})

async function add() {
  const title = form.value.title.trim()
  if (!title) return
  await db.achievements.add({
    title, date: form.value.date, category: form.value.category,
    desc: form.value.desc.trim(), imageData: form.value.imageData,
    createdAt: Date.now(), archivedAt: undefined,
  })
  form.value = empty()
}
// 用 archivedAt 归档而不是物理删除：列表与搜索都按 archivedAt 过滤，删错了还能从库房找回
async function del(a) { await db.achievements.update(a.id, { archivedAt: Date.now() }) }

function pickImage() { fileEl.value?.click() }
function onFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || !file.type.startsWith('image/')) return
  const img = new Image()
  const url = URL.createObjectURL(file)
  img.onload = () => {
    const max = 640
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    form.value.imageData = canvas.toDataURL('image/jpeg', 0.85)
  }
  img.src = url
}
</script>

<style scoped>
.ach-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
@media (min-width: 720px) { .ach-grid { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); } }
.ach-card {
  border: 1px solid var(--line); border-radius: var(--radius); background: #fff;
  overflow: hidden; padding-bottom: 8px;
}
.ach-img { width: 100%; height: 110px; object-fit: cover; display: block; }
.ach-body { padding: 10px 12px 4px; }
.ach-title { font-size: 14px; font-weight: 600; line-height: 1.4; }
.ach-meta { font-size: 12px; color: var(--text-3); margin-top: 3px; }
.ach-desc { font-size: 12.5px; color: var(--text-2); margin-top: 4px; line-height: 1.55; }
.ach-card :deep(.n-button) { margin-left: 12px; }
.ach-thumb img { width: 36px; height: 36px; border-radius: var(--r-box); object-fit: cover; display: block; }
</style>
