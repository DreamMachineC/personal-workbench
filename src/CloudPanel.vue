<script setup>
// 云端同步面板：邮箱登录（密码 / 验证码 / 重设密码）+ 全量快照上传与恢复
// 设计约束：数据以本机为准，云端只是另一个落脚点；未登录时本机功能完全不受影响。
import { ref, onMounted, onUnmounted } from 'vue'
import { NInput, NButton, NPopconfirm } from 'naive-ui'
import {
  currentUser, onAuthChange, signInWithPassword, sendEmailCode, verifyEmailCode,
  signOut, startPasswordReset, finishPasswordReset,
  pushSnapshot, pullSnapshot, cloudSnapshotInfo, friendlyAuthError,
} from './cloud'
import { CLOUD_READY } from './cloudConfig'

const user = ref(null)
const booted = ref(false)
const busy = ref(false)
const err = ref('')
const ok = ref('')

// ---------- 登录表单 ----------
const mode = ref('password') // password | code | reset
const email = ref('')
const password = ref('')
const code = ref('')
const newPassword = ref('')
const codeSent = ref(false)
const cooldown = ref(0)
let pending = null // { email, verificationId, isExistingUser } 或重设用的 challenge
let timer = null
let unsub = null

function resetMessages() { err.value = ''; ok.value = '' }
function startCooldown() {
  cooldown.value = 60
  clearInterval(timer)
  timer = setInterval(() => { if (--cooldown.value <= 0) clearInterval(timer) }, 1000)
}

async function withBusy(fn) {
  resetMessages()
  busy.value = true
  try { await fn() } catch (e) { err.value = friendlyAuthError(e) } finally { busy.value = false }
}

// 「获取验证码」：只负责发，之后的提交一律复用这次的结果，不重复发码
function getCode() {
  return withBusy(async () => {
    const mail = email.value.trim()
    if (!mail) { err.value = '先填邮箱'; return }
    const { data, error } = await sendEmailCode(mail)
    if (error) throw error
    pending = { email: mail, verificationId: data.verificationId, isExistingUser: data.isExistingUser }
    codeSent.value = true
    startCooldown()
    ok.value = '验证码已发出，去邮箱看看'
  })
}

function submitCode() {
  return withBusy(async () => {
    const mail = email.value.trim()
    if (!pending || pending.email !== mail) { err.value = '请先点「获取验证码」'; return }
    if (!code.value.trim()) { err.value = '填一下收到的验证码'; return }
    if (!pending.isExistingUser && !newPassword.value) { err.value = '新邮箱第一次来，顺便设个密码'; return }
    const { error } = await verifyEmailCode({
      email: pending.email,
      verificationId: pending.verificationId,
      isExistingUser: pending.isExistingUser,
      token: code.value.trim(),
      password: pending.isExistingUser ? undefined : newPassword.value,
    })
    if (error) throw error
    pending = null; code.value = ''; newPassword.value = ''; codeSent.value = false
    await refreshUser()
    ok.value = '登录好了'
  })
}

function submitPassword() {
  return withBusy(async () => {
    if (!email.value.trim() || !password.value) { err.value = '邮箱和密码都要填'; return }
    const { error } = await signInWithPassword(email.value.trim(), password.value)
    if (error) throw error
    password.value = ''
    await refreshUser()
    ok.value = '登录好了'
  })
}

function sendResetCode() {
  return withBusy(async () => {
    const mail = email.value.trim()
    if (!mail) { err.value = '先填邮箱'; return }
    const { data, error } = await startPasswordReset(mail)
    if (error) throw error
    pending = data // 重设用的 challenge，稍后 updateUser 要用同一份
    codeSent.value = true
    startCooldown()
    ok.value = '重设验证码已发出'
  })
}

function submitReset() {
  return withBusy(async () => {
    if (!pending) { err.value = '请先点「发送重设验证码」'; return }
    if (!code.value.trim() || !newPassword.value) { err.value = '验证码和新密码都要填'; return }
    const { error } = await finishPasswordReset(pending, code.value.trim(), newPassword.value)
    if (error) throw error
    pending = null; code.value = ''; newPassword.value = ''; codeSent.value = false
    await refreshUser()
    ok.value = '密码已重设，也帮你登录好了'
  })
}

// ---------- 同步 ----------
const remote = ref(null)
const syncMsg = ref('')

async function refreshUser() {
  try { user.value = await currentUser() } catch { user.value = null }
  booted.value = true
  if (user.value) await refreshRemote()
}
async function refreshRemote() {
  try { remote.value = await cloudSnapshotInfo() } catch (e) { syncMsg.value = friendlyAuthError(e) }
}
function upload() {
  return withBusy(async () => {
    const r = await pushSnapshot()
    await refreshRemote()
    syncMsg.value = `已上传 ${r.rows} 条记录 · ${new Date(r.at).toLocaleString('zh-CN')}`
  })
}
function download() {
  return withBusy(async () => {
    const r = await pullSnapshot()
    await refreshRemote()
    syncMsg.value = `已从云端并回 ${r.rows} 条记录（覆盖前的本机数据已存进「备份与快照」）`
  })
}
function logout() {
  return withBusy(async () => {
    await signOut()
    user.value = null; remote.value = null; syncMsg.value = ''
    ok.value = '已退出，本机数据不受影响'
  })
}

const fmt = s => (s ? new Date(s).toLocaleString('zh-CN') : '—')

onMounted(async () => {
  await refreshUser()
  try { unsub = onAuthChange(() => refreshUser()) } catch { /* 事件订阅失败不影响表单使用 */ }
})
onUnmounted(() => { clearInterval(timer); unsub && unsub() })
</script>

<template>
  <div v-if="!CLOUD_READY" class="muted">
    还没配置云服务。把 <code>.env.example</code> 复制成 <code>.env.local</code>，填入自己的 endpoint 与
    publishableKey，重新构建即可启用云同步与 AI；不填也不影响其余全部功能。
  </div>

  <div v-else-if="!booted" class="muted">正在看云端的登录状态…</div>

  <!-- 已登录：同步操作 -->
  <div v-else-if="user">
    <div class="row" style="flex-wrap:wrap; margin-bottom:10px">
      <span class="muted">已登录</span>
      <b>{{ user.email }}</b>
      <n-button size="tiny" quaternary @click="logout">退出</n-button>
    </div>
    <div class="muted" style="margin-bottom:10px">
      云端那份：{{ remote ? `${remote.rows_count} 条 · ${fmt(remote.updated_at)} · 来自 ${remote.device || '未知设备'}` : '还没有，先上传一次' }}
    </div>
    <div class="row" style="flex-wrap:wrap">
      <n-button size="small" type="primary" :loading="busy" @click="upload">把本机传上云端</n-button>
      <n-popconfirm @positive-click="download">
        <template #trigger><n-button size="small" secondary :disabled="!remote">从云端并回本机</n-button></template>
        用云端那份覆盖本机？覆盖前会先在本机留一份快照，可以「回到那天」。
      </n-popconfirm>
    </div>
    <p v-if="syncMsg" class="muted" style="margin-top:10px">{{ syncMsg }}</p>
    <p v-if="err" class="muted" style="margin-top:6px; color:var(--danger)">{{ err }}</p>
    <p v-if="ok" class="muted" style="margin-top:6px">{{ ok }}</p>
  </div>

  <!-- 未登录：邮箱登录 / 注册 / 重设密码 -->
  <div v-else>
    <div class="row" style="flex-wrap:wrap; margin-bottom:12px">
      <button class="pill" :class="{ on: mode === 'password' }" @click="mode = 'password'; resetMessages()">邮箱密码</button>
      <button class="pill" :class="{ on: mode === 'code' }" @click="mode = 'code'; resetMessages()">邮箱验证码</button>
      <button class="pill" :class="{ on: mode === 'reset' }" @click="mode = 'reset'; resetMessages()">忘记密码</button>
    </div>

    <div class="row" style="flex-wrap:wrap">
      <n-input v-model:value="email" placeholder="邮箱" style="width:240px" :disabled="busy" />
      <n-input v-if="mode === 'password'" v-model:value="password" type="password" show-password-on="click"
        placeholder="密码" style="width:200px" :disabled="busy" @keyup.enter="submitPassword" />
    </div>

    <template v-if="mode === 'code' || mode === 'reset'">
      <div class="row" style="flex-wrap:wrap; margin-top:10px">
        <n-button size="small" secondary :loading="busy" :disabled="cooldown > 0"
          @click="mode === 'code' ? getCode() : sendResetCode()">
          {{ cooldown > 0 ? `${cooldown}s 后可重发` : '发送验证码' }}
        </n-button>
        <n-input v-model:value="code" placeholder="邮箱里收到的验证码" style="width:200px" :disabled="busy" />
      </div>
      <div class="row" style="flex-wrap:wrap; margin-top:10px">
        <n-input v-model:value="newPassword" type="password" show-password-on="click"
          :placeholder="mode === 'reset' ? '新密码' : '新邮箱第一次来，顺手设个密码'"
          style="width:260px" :disabled="busy" @keyup.enter="mode === 'code' ? submitCode() : submitReset()" />
      </div>
    </template>

    <div class="row" style="margin-top:12px">
      <n-button size="small" type="primary" :loading="busy"
        @click="mode === 'password' ? submitPassword() : mode === 'code' ? submitCode() : submitReset()">
        {{ mode === 'password' ? '登录' : mode === 'code' ? '登录 / 注册' : '重设密码' }}
      </n-button>
      <span class="muted">换台设备登录同一个邮箱，就能把这份数据并过去</span>
    </div>

    <p v-if="err" class="muted" style="margin-top:10px; color:var(--danger)">{{ err }}</p>
    <p v-if="ok" class="muted" style="margin-top:10px">{{ ok }}</p>
  </div>
</template>
