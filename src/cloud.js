// 云端同步 · 登录 + 全量快照
// 规则来自 cloud-service skill：
//   - 客户端只用 @tencent-ai/workbuddy-cloud-sdk，禁止手写 fetch 打 /.cloud/**
//   - 客户端实例只建一次，四个模块共用（ai.js 也复用它）
//   - 用户私有数据必须先有会话（不接受匿名登录、不接受 localStorage 假用户）
//   - 写入不带 owner_id，由表的 DEFAULT auth.uid() 填，RLS 兜底
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'
import { CLOUD_CONFIG, CLOUD_READY } from './cloudConfig'
import { db } from './db'
import { collectBackup, takeSnapshot } from './backup'

export const SYNC_TABLE = 'wb_snapshots'

let client = null
export const cloud = () => {
  if (!CLOUD_READY) throw new Error('还没配置云服务：把 .env.example 复制成 .env.local，填入自己的两个值')
  return (client ||= createWorkBuddyCloud(CLOUD_CONFIG))
}

// ---------- 会话 ----------
export async function currentUser() {
  if (!CLOUD_READY) return null
  const { data, error } = await cloud().auth.getSession()
  if (error) return null
  return data?.user || null
}
export const onAuthChange = cb => cloud().auth.onAuthStateChange(cb)

export const signInWithPassword = (email, password) =>
  cloud().auth.signInWithPassword({ email, password })

export const sendEmailCode = email => cloud().auth.sendOtp({ email })

// 新邮箱注册要带密码；老用户只凭验证码即可登录
export const verifyEmailCode = ({ email, verificationId, isExistingUser, token, password }) =>
  cloud().auth.verifyOtp({ email, verificationId, isExistingUser, token, password })

export const signOut = () => cloud().auth.signOut()

export const startPasswordReset = email => cloud().auth.resetPasswordForEmail(email)
export const finishPasswordReset = (challenge, nonce, password) =>
  challenge.updateUser({ nonce, password })

// ---------- 快照：上传 / 拉取 ----------
const deviceName = () => {
  const ua = navigator.userAgent
  const kind = /iPhone|iPad|iPod/.test(ua) ? 'iPhone/iPad'
    : /Android/.test(ua) ? 'Android'
      : /Macintosh/.test(ua) ? 'Mac'
        : /Windows/.test(ua) ? 'Windows' : '浏览器'
  return `${kind} · ${window.innerWidth}px`
}

async function requireSession() {
  const user = await currentUser()
  if (!user) throw new Error('还没登录，先在下面登录一次')
  return user
}

// 把本机全量数据推上去（每人一行，重复上传就地覆盖）
export async function pushSnapshot() {
  await requireSession()
  const dump = await collectBackup()
  const tables = Object.keys(dump.data).length
  const rows = Object.values(dump.data).reduce((n, list) => n + (list?.length || 0), 0)
  const { error } = await cloud().database.from(SYNC_TABLE).upsert(
    { payload: dump, tables_count: tables, rows_count: rows, device: deviceName(), updated_at: new Date().toISOString() },
    { onConflict: 'owner_id' },
  )
  if (error) throw new Error(error.message || '上传没成功')
  return { tables, rows, at: new Date().toISOString() }
}

// 云端那份现在长什么样（没登录返回 null，无数据也返回 null）
export async function cloudSnapshotInfo() {
  const user = await currentUser()
  if (!user) return null
  const { data, error } = await cloud().database
    .from(SYNC_TABLE).select('updated_at, rows_count, tables_count, device').maybeSingle()
  if (error) throw new Error(error.message || '读云端状态失败')
  return data || null
}

// 把云端那份并回本机（先自动留一份本地快照，可回退）
export async function pullSnapshot() {
  await requireSession()
  const { data, error } = await cloud().database
    .from(SYNC_TABLE).select('payload, updated_at').maybeSingle()
  if (error) throw new Error(error.message || '拉取失败')
  if (!data?.payload) throw new Error('云端还没有数据，先上传一次')
  await takeSnapshot() // 覆盖前兜底：本机留一份，设置页可「回到那天」
  let n = 0
  for (const [table, list] of Object.entries(data.payload.data || {})) {
    if (db[table] && Array.isArray(list) && list.length) { await db[table].bulkPut(list); n += list.length }
  }
  return { rows: n, at: data.updated_at }
}

// 面向界面的错误文案：不暴露 token / 邮箱 / 原始报文
export function friendlyAuthError(err) {
  const kind = err?.kind || err?.error?.code
  if (kind === 'unauthenticated' || kind === 'invalid_grant') return '登录已失效，重新登录一次'
  if (kind === 'network' || kind === 'backend-unavailable') return '网络没通，稍后再试'
  const msg = String(err?.message || '')
  if (/incorrect/i.test(msg)) return '邮箱或密码不对'
  if (/invalid|expired/i.test(msg) && /code|token|otp/i.test(msg)) return '验证码不对或过期了，重新发一次'
  if (/weak|too short/i.test(msg)) return '密码太简单，换一个长一点的'
  return msg || '没成功，再试一次'
}
