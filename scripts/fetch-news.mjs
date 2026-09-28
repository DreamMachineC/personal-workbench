// 每日 AI 见闻的预抓脚本：给每日自动化用，结果写进云端 wb_news 表，前端首屏直接读。
// 与 src/news.js 用同一套源和同一套筛选口径，浏览器直连抓不到时它仍是兜底。
// 用法：node scripts/fetch-news.mjs > /tmp/news.json   （打印 { day, items }）

const HN_API = 'https://hn.algolia.com/api/v1/search'
const GH_API = 'https://api.github.com/search/repositories'
const DAY = 86400000

const isoDay = d => new Date(Date.now() - d * DAY).toISOString().slice(0, 10)
const unixSec = d => Math.floor((Date.now() - d * DAY) / 1000)
const kfmt = n => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

async function getJSON(url, headers) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

async function hn() {
  const since = unixSec(4)
  const out = []
  const seen = new Set()
  for (const q of ['AI', 'LLM']) {
    const d = await getJSON(`${HN_API}?query=${encodeURIComponent(q)}&tags=story` +
      `&numericFilters=created_at_i>${since},points>25&hitsPerPage=12`)
    for (const h of d?.hits || []) {
      if (seen.has(h.objectID)) continue
      seen.add(h.objectID)
      out.push({
        id: `hn-${h.objectID}`,
        title: (h.title || '').trim(),
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        source: 'HN',
        heat: h.points || 0,
        heatLabel: `▲ ${h.points || 0}`,
        date: (h.created_at || '').slice(0, 10),
      })
    }
  }
  return out.filter(i => i.title).sort((a, b) => b.heat - a.heat).slice(0, 6)
}

async function gh() {
  const d = await getJSON(
    `${GH_API}?q=${encodeURIComponent(`llm pushed:>${isoDay(7)} stars:>150`)}&sort=stars&order=desc&per_page=6`,
    { 'User-Agent': 'life-workbench', Accept: 'application/vnd.github+json' }
  )
  return (d?.items || []).map(r => ({
    id: `gh-${r.id}`,
    title: r.full_name,
    desc: (r.description || '').trim(),
    url: r.html_url,
    source: 'GitHub',
    heat: r.stargazers_count || 0,
    heatLabel: `★ ${kfmt(r.stargazers_count || 0)}`,
    date: (r.pushed_at || '').slice(0, 10),
  }))
}

// 两源交替：只取前几条时两边都能露脸
function interleave(a, b) {
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i])
    if (b[i]) out.push(b[i])
  }
  return out
}

const [hnr, ghr] = await Promise.allSettled([hn(), gh()])
const items = interleave(hnr.status === 'fulfilled' ? hnr.value : [], ghr.status === 'fulfilled' ? ghr.value : [])
if (!items.length) {
  const why = [hnr, ghr].find(r => r.status === 'rejected')?.reason?.message || '未知原因'
  console.error(`抓不到见闻：${why}`)
  process.exit(1)
}
// day 必须用本机当地日期：前端拿 today()（当地）来查，直接用 UTC 会在东八区差一天
const now = new Date()
const pad = n => String(n).padStart(2, '0')
const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
console.log(JSON.stringify({ day, items }))
