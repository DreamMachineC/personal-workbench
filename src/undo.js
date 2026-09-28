import { ref } from 'vue'

// 删除后的撤销条：一行文案 + 一个可撤销的动作，6 秒后自动消失
export const undoState = ref(null)
let timer = null

export function showUndo(text, action) {
  if (timer) clearTimeout(timer)
  undoState.value = { text, action }
  timer = setTimeout(() => { undoState.value = null; timer = null }, 6000)
}

export function runUndo() {
  const u = undoState.value
  if (!u) return
  undoState.value = null
  if (timer) clearTimeout(timer)
  timer = null
  u.action()
}

export function hideUndo() {
  undoState.value = null
  if (timer) clearTimeout(timer)
  timer = null
}
