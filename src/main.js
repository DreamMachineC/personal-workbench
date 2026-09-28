import { createApp } from 'vue'
import App from './App.vue'
import { initDefaults, purgeDeleted } from './db'
import { ensureTodayInstances } from './instance'
import { maybeWeeklySnapshot } from './backup'
import { registerSW } from 'virtual:pwa-register'
import './style.css'

registerSW({ immediate: true })

createApp(App).mount('#app')

// 打开页面时按需补算当日实例（幂等，替代凌晨批处理的降级路径）+ 回收站过期清理 + 每周快照
initDefaults()
  .then(purgeDeleted)
  .then(() => ensureTodayInstances())
  .then(maybeWeeklySnapshot)
  .catch(console.error)
