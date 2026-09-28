// AI 通道 · 真实接入 WorkBuddy 云端大模型
// 规则来自 cloud-service skill 的 llm/code-generation.md：
//   - 只用 @tencent-ai/workbuddy-cloud-sdk，禁止手写 fetch 打 /.cloud/**
//   - 只用 publicConfig 的 endpoint + publishableKey 初始化（可安全放前端，服务端校验 Origin）
//   - 所有 create() 必须 stream: true（非流式会被 SDK 直接拒绝）
//   - 每个 create() 的 messages[0] 必须是 system
//   - 模型 id 来自 models.list()，不得硬编码
import { db } from './db'
import { cloud } from './cloud'
import { CLOUD_READY } from './cloudConfig'

// 没配 endpoint / publishableKey 时，AI 相关的按钮自动藏起来，界面不出现点了必错的入口
export const AI_WIRED = CLOUD_READY

// 云端客户端只在 cloud.js 里建一次，AI / 登录 / 同步共用同一个实例
const getCloud = cloud

// ---------- 模型：从列表元数据里挑，缓存 5 分钟 ----------
// 实测：onlyReasoning 的「重思考」模型（auto / hy3 / kimi）单次 60s+，
// 而这里的活都是短问答与短改写，用不上长链推理。所以先排除强制推理的，再按积分倍率取便宜的。
const creditOf = m => {
  const n = parseFloat(String(m.credits || '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 1
}
let cachedModel = null
let modelAt = 0
export async function ensureModel() {
  if (cachedModel && Date.now() - modelAt < 5 * 60 * 1000) return cachedModel
  const models = await getCloud().llm.models.list()
  const usable = (models || []).filter(m => m.enabled !== false && m.disabled !== true)
  if (!usable.length) throw friendlyError({ error: { code: 'model_empty' } })
  // 带推理字段的模型往往要求一并传推理参数，光靠 messages 会「请求参数无效」；
  // 所以先挑纯对话的，其次挑能关思考的，最后才退到全部。
  const plain = usable.filter(m => !m.supportsReasoning && !/image/i.test(m.id || ''))
  const light = usable.filter(m => m.reasoning?.canDisableThinking)
  const pool = plain.length ? plain : light.length ? light : usable
  cachedModel = [...pool].sort((a, b) => creditOf(a) - creditOf(b))[0]
  modelAt = Date.now()
  return cachedModel
}
export async function listModels() {
  try { return (await getCloud().llm.models.list()) || [] } catch { return [] }
}

// ---------- 错误：按 code 前缀翻成人话 ----------
function friendlyError(e) {
  const code = e?.error?.code || ''
  const raw = String(e?.error?.message || e?.message || '')
  const map = [
    ['model_empty', '暂时没有可用的模型'],
    ['auth_', 'AI 通道没对上凭据，通常是页面域名不在允许列表里'],
    ['quota_', '这一会儿额度用完了，稍等片刻再来'],
    ['request_', '这次的请求不合规范'],
    ['gateway_', '模型服务临时不在，可以再试一次'],
    ['model_', '模型服务临时不在，可以再试一次'],
    ['internal_', 'AI 这边出了点岔子，稍后再试'],
  ]
  const hit = map.find(([p]) => code.startsWith(p))
  const err = new Error(hit ? hit[1] : 'AI 这边出了点岔子，稍后再试')
  err.code = code
  err.raw = raw
  return err
}

// 用户输入不能直接拼进 system；这里做一层收敛，避免重写指令
const wrap = (label, text) => `<<${label}>>\n${String(text ?? '').slice(0, 4000)}\n<<END>>`

// ---------- 核心：流式对话 ----------
export async function chat({ system, user, onDelta, signal, temperature }) {
  const model = await ensureModel()
  let text = ''
  try {
    for await (const chunk of getCloud().llm.chat.completions.create({
      model: model.id,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: true,
      ...(temperature != null ? { temperature } : {}),
      ...(signal ? { signal } : {}),
    })) {
      const d = chunk?.choices?.[0]?.delta
      if (d?.content) {
        text += d.content
        onDelta?.(d.content)
      }
    }
  } catch (e) {
    // 已渲染的部分交给调用方保留，这里只抛出可读错误
    if (e?.name === 'AbortError') throw e
    throw friendlyError(e)
  }
  return text
}

// ---------- 隐私开关：是否允许 AI 读到正文细节 ----------
export async function aiAllowDetail() {
  const p = await db.profile.get(1)
  return !!p?.aiAllowDetail
}
export async function setAiAllowDetail(v) {
  const p = (await db.profile.get(1)) || {}
  await db.profile.put({ ...p, id: 1, aiAllowDetail: !!v })
}

// ---------- 1. 碎碎念润色：出两版，由人选 ----------
const POLISH_SYS = '你是一位克制的中文随笔编辑。用户给一句随手写下的心里话，你重写出两个版本：一个更克制、一个更舒展。都不超过 60 字，都不加解释、不加引号、不改原意。只输出 JSON，格式固定为 {"a":{"tone":"克制的一版","text":"..."},"b":{"tone":"舒展的一版","text":"..."}}。'

function extractJSON(s) {
  const t = String(s || '').replace(/```json|```/g, '').trim()
  const i = t.indexOf('{')
  const j = t.lastIndexOf('}')
  if (i < 0 || j < 0) return null
  try { return JSON.parse(t.slice(i, j + 1)) } catch { return null }
}

export async function polishJournal(text) {
  const raw = String(text || '').trim()
  if (!raw) return []
  const allow = await aiAllowDetail()
  if (!allow) return [{ blocked: 'privacy' }]
  const out = await chat({
    system: POLISH_SYS,
    user: `请润色这句话：\n${wrap('心绪原文', raw)}`,
    temperature: 0.9,
  })
  const data = extractJSON(out)
  if (!data?.a?.text || !data?.b?.text) return []
  return [
    { key: 'a', tone: data.a.tone || '克制的一版', text: data.a.text.trim() },
    { key: 'b', tone: data.b.tone || '舒展的一版', text: data.b.text.trim() },
  ]
}

// ---------- 2. 随身小助手：流式问答 ----------
export const ASKS = [
  '今天先做哪一件？',
  '这一周我做得怎么样？',
  '帮我拆一个长期目标',
  '我最近是不是太累了',
]
const CHAT_SYS = '你是一位沉稳的个人助理，服务一个把日常记在本地工作台里的人。回答用中文，语气平实，不堆砌排比，不客套，不使用表情符号。给建议时落到具体动作：说得出先做什么、花多久。不超过 120 字。用纯文本，不要 Markdown 标记。用户的数据会以片段形式给出，未提及的就当作不知道，不要编造。'

// 列举类别受 localStorage 里的授权范围约束；某类没勾选，就根本不进上下文
export function buildContext(ctx = {}, scope = null) {
  const s = scope || loadScope()
  const bits = [ctx.date ? `今天是 ${ctx.date}` : ''].filter(Boolean)
  if (s.today) {
    bits.push(`今日安排：完成 ${ctx.todayDone || 0}/${ctx.todayTotal || 0} 件`)
    if (ctx.todayLeft?.length) bits.push(`今日未完成：${ctx.todayLeft.join('、')}`)
  }
  if (s.week) {
    bits.push(`本周：完成 ${ctx.weekDone || 0}/${ctx.weekTotal || 0} 件，累计专注 ${ctx.focus || 0} 分钟`)
  }
  if (s.mood && ctx.mood != null) bits.push(`心情均值 ${ctx.mood}/5`)
  if (s.skills && ctx.topSkill) bits.push(`在练的技艺：${ctx.topSkill}`)
  if (s.body && ctx.body) bits.push(`本周练了 ${ctx.body} 次`)
  if (ctx.goals?.length) bits.push(`远期目标：${ctx.goals.join('、')}`)
  if (s.journal && ctx.journal) bits.push(`最近写下的心声：${ctx.journal}`)
  return bits.join('\n')
}

export async function chatReply(question, ctx = {}, { onDelta, signal } = {}) {
  const allow = await aiAllowDetail()
  const context = allow ? buildContext(ctx) : '（用户已关闭「AI 读取正文」授权，只依据下方问题回答，不要索要更多个人信息。）'
  return chat({
    system: CHAT_SYS,
    user: `${context}\n\n我的问题：${wrap('问题', question)}`,
    onDelta,
    signal,
  })
}

// ---------- 3. 说出来 → 任务：模型拆解，本地规则兜底 ----------
const TASK_SYS = '你把一段口语化的中文口述拆成待办清单。输出 JSON，格式固定为 {"items":[{"title":"动词开头的短句，不超过 20 字","date":"today|tomorrow|d2","time":"HH:mm 或空字符串","category":"学习|科研|生活|工作|其他"}]}。只输出 JSON，不要解释，不要省略条目。'

// 时间/日期已经单独落在字段里，标题里就不必再留一份
function trimTitle(s) {
  const raw = s.trim()
  const out = raw
    .replace(/^(今天|明天|后天)/, '')
    .replace(/^(早上|上午|中午|下午|傍晚|晚上|睡前)/, '')
    .replace(/^[〇零一二两三四五六七八九十\d]{1,3}\s*[点:：时]\s*(半|\d{1,2}\s*分?)?/, '')
    .replace(/^(记得|要去|记得去|我|要|去)/, '')
    .trim()
  return out || raw
}

export async function aiSplitTasks(spoken, cats = []) {
  const raw = String(spoken || '').trim()
  if (!raw) return []
  // 拆分标题不需要读私人正文，只要这句话本身，所以不受隐私开关限制
  const out = await chat({
    system: TASK_SYS,
    user: `可选的日期只有 today（今天）/ tomorrow（明天）/ d2（后天）三种。\n可选分类：${cats.length ? cats.join('、') : '学习、科研、生活、工作、其他'}。\n\n请拆解这段话：\n${wrap('口述内容', raw)}`,
    temperature: 0.2,
  })
  const data = extractJSON(out)
  const items = Array.isArray(data?.items) ? data.items : []
  return items
    .map(i => ({
      title: trimTitle(String(i.title || '')).slice(0, 40),
      date: ['today', 'tomorrow', 'd2'].includes(i.date) ? i.date : 'today',
      time: /^\d{2}:\d{2}$/.test(i.time || '') ? i.time : '',
      catName: String(i.category || '其他'),
      on: true,
    }))
    .filter(i => i.title)
}

// ---------- 4. 每周 AI 建议 ----------
const WEEK_SYS = '你为一个人写每周小结。依据给出的真实数据，只说三件事：这一周做成了什么、什么拖住了、下一周具体改哪一件事。中文，平实，不用小标题，不用表情符号，不用 Markdown 标记，不超过 180 字。不要复述数据全部数字，挑关键的讲。'

export async function weeklyDigest(ctx = {}, { onDelta } = {}) {
  const allow = await aiAllowDetail()
  const lines = []
  lines.push(`${ctx.range || '这一周'}：完成 ${ctx.weekDone || 0}/${ctx.weekTotal || 0} 件，累计专注 ${ctx.focus || 0} 分钟。`)
  if (ctx.topSkill) lines.push(`投入最多的技艺：${ctx.topSkill}。`)
  if (ctx.body) lines.push(`身体：练了 ${ctx.body} 次。`)
  if (ctx.mood != null) lines.push(`心情均值 ${ctx.mood}/5。`)
  if (allow && ctx.review) lines.push(`这一周自己写下的复盘：${ctx.review}`)
  if (allow && ctx.journal) lines.push(`最近的一句心声：${ctx.journal}`)
  return chat({ system: WEEK_SYS, user: lines.join('\n'), onDelta })
}

// ---------- 5. 说出来 → 任务的本地兜底（模型不可用时依然能用） ----------
const TIME_WORDS = [
  ['早上', '08:00'], ['上午', '10:00'], ['中午', '12:30'], ['下午', '15:00'],
  ['傍晚', '18:00'], ['晚上', '20:00'], ['睡前', '22:30'],
]
const CAT_WORDS = {
  学习: ['看书', '复习', '背单词', '英语', '课程', '阅读', '学习'],
  科研: ['实验', '组会', '文献', '数据', '科研'],
  生活: ['买', '缴费', '打扫', '洗衣', '做饭', '取快递', '家里'],
  工作: ['汇报', '开会', '邮件', '方案', '对接', '周报'],
}

export function parseSpoken(text) {
  const raw = String(text || '').trim()
  if (!raw) return []
  return raw
    .split(/[，,。;；、\n]|还有|然后|接着|另外|再/)
    .map(s => s.trim())
    .filter(s => s.length >= 2)
    .map(s => {
      let time = ''
      for (const [w, t] of TIME_WORDS) if (s.includes(w)) { time = t; break }
      const m = s.match(/(\d{1,2})\s*(点|时|:|：)/)
      if (m) time = `${String(m[1]).padStart(2, '0')}:00`
      let catName = ''
      for (const [name, words] of Object.entries(CAT_WORDS)) {
        if (words.some(w => s.includes(w))) { catName = name; break }
      }
      let date = 'today'
      if (/明天/.test(s)) date = 'tomorrow'
      if (/后天/.test(s)) date = 'd2'
      return { title: s.replace(/^(我|要|记得|去|得|然后|还有)/, ''), time, catName, date, on: true }
    })
}

// ---------- 浏览器原生转写 ----------
export function dictationSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}
export function startDictation({ onResult, onEnd, onError, lang = 'zh-CN' }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) { onError?.('这台浏览器暂不支持直接转写，先手动敲也行'); return null }
  const rec = new SR()
  rec.lang = lang
  rec.continuous = true
  rec.interimResults = true
  let finalText = ''
  rec.onresult = e => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) finalText += t
      else interim += t
    }
    onResult?.(finalText, interim)
  }
  rec.onerror = e => onError?.(e.error === 'not-allowed' ? '麦克风没被允许，去浏览器地址栏放行一下' : '听不清，再说一次试试')
  rec.onend = () => onEnd?.(finalText)
  try { rec.start() } catch { onError?.('没能开始录音') }
  return rec
}

// ---------- 6. 授权范围：允许 AI 看到哪些类别的数据 ----------
const SCOPE_KEY = 'ai.scope'
const DEFAULT_SCOPE = { today: true, week: true, mood: true, journal: true, skills: true, body: true }
export function loadScope() {
  try { return { ...DEFAULT_SCOPE, ...JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}') } }
  catch { return { ...DEFAULT_SCOPE } }
}
export function saveScope(s) {
  localStorage.setItem(SCOPE_KEY, JSON.stringify(s))
  return s
}

// ---------- 7. 每日 AI 见闻：从候选条目里挑重点 ----------
// 条目是公开资讯，不含私人数据，所以不受隐私开关约束。
const NEWS_SYS = '你是一位关注 AI 的中文编辑。用户给你今天抓取到的一批候选条目（标题、来源、热度、日期）。挑出其中最值得看的 3 条，每条用一句话说清「是什么、为什么值得看」。用纯文本，不要 Markdown 标记、不要小标题、不要表情符号，总共不超过 150 字。只依据给出的条目，不要补充条目之外的信息，也不要编造条目里没有的细节。'

export async function newsBrief(items = [], { onDelta } = {}) {
  const list = (items || []).slice(0, 12)
  if (!list.length) return ''
  const lines = list.map((i, n) =>
    `${n + 1}. [${i.source} ${i.heatLabel}] ${i.title}${i.desc ? ` — ${i.desc}` : ''}（${i.date}）`)
  return chat({
    system: NEWS_SYS,
    user: `今天的候选条目：\n${wrap('候选条目', lines.join('\n'))}`,
    onDelta,
    temperature: 0.3,
  })
}

// 英文源的标题按规划要译成中文展示；产品名、公司名、模型名保留原文
const TR_SYS = '你把给出的英文标题逐条译成简洁中文，产品名、公司名、模型名、人名保留英文原文，不加解释、不做评论。只输出 JSON，格式固定为 {"items":[{"id":"原样抄回","zh":"中文标题"}]}，条数与输入完全一致，不要增删。'

export async function translateTitles(items = []) {
  const list = (items || []).slice(0, 8)
  if (!list.length) return {}
  const out = await chat({
    system: TR_SYS,
    user: wrap('标题', list.map(i => `${i.id}\t${i.title}`).join('\n')),
    temperature: 0.2,
  })
  const data = extractJSON(out)
  const map = {}
  for (const it of data?.items || []) {
    if (it?.id && it?.zh) map[String(it.id)] = String(it.zh).trim()
  }
  return map
}
