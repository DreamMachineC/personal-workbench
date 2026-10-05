import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// frappe-gantt 的 package exports 只暴露 "style" 条件，构建时无法直接 import 其 CSS，这里指到实际文件
const ganttCss = fileURLToPath(new URL('./node_modules/frappe-gantt/dist/frappe-gantt.css', import.meta.url))

export default defineConfig({
  resolve: { alias: { 'frappe-gantt-css': ganttCss } },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Life Workbench · 个人工作台',
        short_name: '工作台',
        description: '集任务、日历、打卡、碎碎念于一体的个人生活操作系统',
        theme_color: '#409eff',
        background_color: '#f5f7fa',
        display: 'standalone',
        lang: 'zh-CN',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ]
      },
      devOptions: { enabled: true }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        // 拆开几个大块：首屏只下核心，日历/甘特这类重库单独成块，改一处不会让用户重下全包
        manualChunks: {
          vue: ['vue'],
          naive: ['naive-ui'],
          calendar: ['@fullcalendar/vue3', '@fullcalendar/daygrid', '@fullcalendar/timegrid', '@fullcalendar/interaction'],
          gantt: ['frappe-gantt'],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  // 线上部署：服务在反向代理域名后面，必须监听 0.0.0.0 并放开 host 校验，否则 Vite 会拦掉请求
  server: { port: 5175, host: true, allowedHosts: true },
  preview: { host: true, allowedHosts: true }
})
