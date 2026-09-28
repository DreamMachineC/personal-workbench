import { cloud } from './cloud'

// 每日 AI 见闻：只用两个公开、且实测支持跨域的源，不需要自己的服务端代理
//   - Hacker News（Algolia 搜索 API）：AI / LLM 话题近几天的热议
//   - GitHub Search：近期还在更新的 AI 类仓库
// 两者都回 access-control-allow-origin，浏览器可直连；任何一个挂了不影响另一个。
// 另有一条**更快也更稳的路**：每日自动化已把当天这批预抓进云端 wb_news（公开只读），
// 优先读它，读不到再自己抓，抓不到也不算失败。

const HN_API = 'https://hn.algolia.com/api/v1/search'
const GH_API = 'https://api.github.com/search/repositories'
const DAY = 86400000

const isoDay = daysAgo => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10)
const unixSec = daysAgo => Math.floor((Date.now() - daysAgo * DAY) / 1000)
const kfmt = n => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

async function getJSON(url, { timeout = 9000, headers } = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json', ...headers } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ---------- Hacker News ----------
export async function fetchHnStories({ days = 4, minPoints = 25, perQuery = 12 } = {}) {
  const since = unixSec(days)
  const queries = ['AI', 'LLM']
  const results = await Promise.allSettled(queries.map(q =>
    getJSON(`${HN_API}?query=${encodeURIComponent(q)}&tags=story` +
      `&numericFilters=created_at_i>${since},points>${minPoints}&hitsPerPage=${perQuery}`)
  ))
  const seen = new Set()
  const items = []
  for (const r of results) {
    for (const h of (r.status === 'fulfilled' ? r.value?.hits || [] : [])) {
      if (seen.has(h.objectID)) continue
      seen.add(h.objectID)
      items.push({
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
  return items.filter(i => i.title).sort((a, b) => b.heat - a.heat).slice(0, 6)
}

// ---------- GitHub ----------
export async function fetchGhRepos({ days = 7, perPage = 6 } = {}) {
  const pushed = isoDay(days)
  const q = encodeURIComponent(`llm pushed:>${pushed} stars:>150`)
  const d = await getJSON(`${GH_API}?q=${q}&sort=stars&order=desc&per_page=${perPage}`, {
    headers: { 'User-Agent': 'life-workbench', Accept: 'application/vnd.github+json' },
  })
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

// ---------- 汇总 ----------
// 两个源交替排列：只取前几条时，两边都能露脸，不会被 HN 的高热度全占
function interleave(a, b) {
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i])
    if (b[i]) out.push(b[i])
  }
  return out
}

export async function fetchAiNews(opts = {}) {
  const [hn, gh] = await Promise.allSettled([fetchHnStories(opts), fetchGhRepos(opts)])
  const hnItems = hn.status === 'fulfilled' ? hn.value : []
  const ghItems = gh.status === 'fulfilled' ? gh.value : []
  const items = interleave(hnItems, ghItems)
  if (!items.length) {
    const why = [hn, gh].find(r => r.status === 'rejected')?.reason?.message || '未知原因'
    throw new Error(`取不到见闻（${why}）`)
  }
  return {
    items,
    partial: hn.status === 'rejected' || gh.status === 'rejected',
  }
}

// ---------- 云端预抓的那份（每日自动化写入，公开只读） ----------
export async function fetchCloudNews(day) {
  try {
    const { data, error } = await cloud().database
      .from('wb_news').select('items, built_at').eq('day', day).maybeSingle()
    if (error || !data?.items?.length) return null
    return { items: data.items, builtAt: data.built_at }
  } catch {
    return null // 云端没通不该影响主页，交给浏览器直连兜底
  }
}

// ---------- 当日缓存：一天只取一次，别每次刷新都打接口 ----------
const CACHE_KEY = 'ai.news'
export function loadNewsCache(date) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
    return c.date === date ? c : null
  } catch { return null }
}
export function saveNewsCache(date, patch) {
  const prev = loadNewsCache(date) || { date }
  const next = { ...prev, date, ...patch }
  localStorage.setItem(CACHE_KEY, JSON.stringify(next))
  return next
}
