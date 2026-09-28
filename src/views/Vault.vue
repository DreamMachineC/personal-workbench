<template>
  <div class="two-col">
    <div class="card">
      <h3>库房 · {{ (assets || []).length }} 件存着的东西</h3>

      <div class="row" style="margin-bottom:10px; flex-wrap:wrap">
        <n-input v-model:value="form.title" placeholder="存个标题" style="width:240px" />
        <n-input v-model:value="form.text" placeholder="正文或摘要（可留空）" class="grow" @keyup.enter="addDoc" />
        <n-button type="primary" @click="addDoc">收进库房</n-button>
      </div>
      <div class="subnav">
        <n-button size="small" secondary @click="pickFile">存一个文件</n-button>
        <n-button size="small" secondary @click="backfill">把没收录的补齐</n-button>
        <input ref="fileEl" type="file" style="display:none" @change="onFile" />
        <span class="muted">文件存进本机浏览器，单个不超过 2 MB</span>
      </div>

      <div class="row" style="margin-bottom:10px; flex-wrap:wrap">
        <button class="pill" :class="{ on: filter === '全部' }" @click="filter = '全部'">全部</button>
        <button v-for="[k, label] in TYPES" :key="k" class="pill" :class="{ on: filter === k }" @click="filter = k">{{ label }}</button>
        <n-input v-model:value="kw" placeholder="找一找" style="width:160px" size="small" />
      </div>

      <n-empty v-if="!shown.length" description="库房还空着" size="small" />
      <div v-for="a in shown" :key="a.id" class="word-row">
        <div class="row spread">
          <div>
            <span class="vault-tag">{{ labelOf(a.type) }}</span>
            <span class="word-t"><b>{{ a.title }}</b></span>
          </div>
          <div class="row">
            <a v-if="a.fileData" :href="a.fileData" :download="a.fileName" class="pill">取回</a>
            <n-popconfirm @positive-click="del(a)">
              <template #trigger><n-button quaternary size="tiny" type="error">删除</n-button></template>
              从库房里清掉这一件？
            </n-popconfirm>
          </div>
        </div>
        <div class="word-t" v-if="a.summary || a.text">{{ a.summary || a.text }}</div>
        <div class="word-d">
          {{ dayjs(a.createdAt).format('YYYY-MM-DD HH:mm') }}
          <span v-if="a.fileName"> · {{ a.fileName }}{{ a.fileSize ? ` · ${(a.fileSize / 1024).toFixed(0)} KB` : '' }}</span>
        </div>
      </div>
    </div>

    <div class="col-side">
      <div class="side-card">
        <h3>库房清点</h3>
        <div class="focus-num">{{ (assets || []).length }}</div>
        <div class="muted">件 · 文件 {{ fileCount }} 个，约 {{ (fileBytes / 1024 / 1024).toFixed(2) }} MB</div>
        <div class="muted" style="margin-top:8px">复盘写好后会自动进来一件；技艺与成就可点「补齐」收进来</div>
      </div>
      <div class="side-card">
        <h3>都存了些什么</h3>
        <div v-for="[k, label] in TYPES" :key="k" class="goal-row">
          <span class="goal-t">{{ label }}</span>
          <span class="goal-d">{{ countOf(k) }} 件</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { NInput, NButton, NEmpty, NPopconfirm } from 'naive-ui'
import dayjs from 'dayjs'
import { db } from '../db'
import { useAssets } from '../composables'

const assets = useAssets()
const TYPES = [['review', '回望'], ['report', '报告'], ['skill', '技艺'], ['achievement', '成就'], ['doc', '文档'], ['file', '文件']]
const labelOf = t => (TYPES.find(([k]) => k === t) || ['doc', '文档'])[1]

const filter = ref('全部')
const kw = ref('')
const fileEl = ref(null)
const form = ref({ title: '', text: '' })

const shown = computed(() => (assets.value || []).filter(a => {
  if (filter.value !== '全部' && a.type !== filter.value) return false
  const k = kw.value.trim()
  if (!k) return true
  return (a.title + (a.summary || '') + (a.text || '') + (a.fileName || '')).includes(k)
}))
const countOf = t => (assets.value || []).filter(a => a.type === t).length
const fileCount = computed(() => (assets.value || []).filter(a => a.fileData).length)
const fileBytes = computed(() => (assets.value || []).reduce((s, a) => s + (a.fileSize || 0), 0))

async function addDoc() {
  const title = form.value.title.trim()
  if (!title && !form.value.text.trim()) return
  await db.assets.add({
    type: 'doc', module: 'vault', refId: null, title: title || form.value.text.trim().slice(0, 20),
    text: form.value.text.trim(), summary: '', fileName: null, fileData: null, fileSize: null,
    createdAt: Date.now(), deletedAt: undefined,
  })
  form.value = { title: '', text: '' }
}

function pickFile() { fileEl.value?.click() }
function onFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (file.size > 2 * 1024 * 1024) { alert('这个文件超过 2 MB，先压一压再存'); return }
  const reader = new FileReader()
  reader.onload = async () => {
    await db.assets.add({
      type: 'file', module: 'vault', refId: null, title: file.name,
      text: '', summary: '', fileName: file.name, fileData: reader.result, fileSize: file.size,
      createdAt: Date.now(), deletedAt: undefined,
    })
  }
  reader.readAsDataURL(file)
}

// 把还没进库房的复盘 / 学成的技艺 / 成就补录进来（自动归档的兜底入口）
async function backfill() {
  let n = 0
  const rows = assets.value || []
  const reviews = await db.reviews.toArray()
  for (const r of reviews) {
    if (rows.some(a => a.type === 'review' && a.refId === r.id)) continue
    await db.assets.add({
      type: 'review', module: 'growth', refId: r.id, title: `${r.weekStart.slice(5)} 那一周的回望`,
      summary: [r.text?.good, r.text?.bad, r.text?.next].filter(Boolean).join(' / '), text: '',
      fileName: null, fileData: null, fileSize: null, createdAt: Date.now(), deletedAt: undefined,
    })
    n++
  }
  const skills = (await db.skills.toArray()).filter(s => s.archivedAt)
  for (const s of skills) {
    if (rows.some(a => a.type === 'skill' && a.refId === s.id)) continue
    await db.assets.add({
      type: 'skill', module: 'growth', refId: s.id, title: s.name,
      summary: s.note || '学成，已归档', text: '',
      fileName: null, fileData: null, fileSize: null, createdAt: Date.now(), deletedAt: undefined,
    })
    n++
  }
  const achs = await db.achievements.toArray()
  for (const a of achs) {
    if (rows.some(x => x.type === 'achievement' && x.refId === a.id)) continue
    await db.assets.add({
      type: 'achievement', module: 'growth', refId: a.id, title: a.title,
      summary: `${a.date} · ${a.category}${a.desc ? ' · ' + a.desc : ''}`, text: '',
      fileName: null, fileData: null, fileSize: null, createdAt: Date.now(), deletedAt: undefined,
    })
    n++
  }
  alert(n ? `补进来 ${n} 件` : '没有要补的')
}

async function del(a) { await db.assets.update(a.id, { deletedAt: Date.now() }) }
</script>

<style scoped>
.vault-tag {
  display: inline-block; margin-right: 8px; font-size: 12px; font-weight: 700;
  color: var(--success); background: var(--success-soft); border-radius: 999px; padding: 2px 9px; vertical-align: 2px;
}
a.pill { text-decoration: none; }
</style>
