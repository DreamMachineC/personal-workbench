import Dexie from 'dexie'

// schema_version 思想：每次结构变更新增 db.version(n)，只做增量迁移
export const db = new Dexie('LifeWorkbench')

db.version(1).stores({
  profile: '++id',
  categories: '++id, name',
  tasks: '++id, title, type, categoryId, status, createdAt',
  taskInstances: '++id, taskId, date, status, [taskId+date], [date+status]',
  checkinItems: '++id, name',
  checkins: '++id, itemId, date, [itemId+date]',
  journals: '++id, date, createdAt',
  events: '++id, date, title',
  holidays: 'date, year',
  quotes: '++id, date'
})

// v2：软删除（deletedAt 索引）——回收站 30 天自动清理（Phase 1 收尾项）
db.version(2).stores({
  profile: '++id',
  categories: '++id, name',
  tasks: '++id, title, type, categoryId, status, createdAt, deletedAt',
  taskInstances: '++id, taskId, date, status, [taskId+date], [date+status]',
  checkinItems: '++id, name',
  checkins: '++id, itemId, date, [itemId+date]',
  journals: '++id, date, createdAt, deletedAt',
  events: '++id, date, title',
  holidays: 'date, year',
  quotes: '++id, date'
})

// v3：Phase 2 —— 复盘 / 健身打卡 / 正在学习的技能
db.version(3).stores({
  profile: '++id',
  categories: '++id, name',
  tasks: '++id, title, type, categoryId, status, createdAt, deletedAt',
  taskInstances: '++id, taskId, date, status, [taskId+date], [date+status]',
  checkinItems: '++id, name',
  checkins: '++id, itemId, date, [itemId+date]',
  journals: '++id, date, createdAt, deletedAt',
  events: '++id, date, title',
  holidays: 'date, year',
  quotes: '++id, date',
  reviews: '++id, weekStart',
  fitness: '++id, date, [date+parts]',
  skills: '++id, name'
})

// v4：心情与能量（每日一条，date 唯一）
db.version(4).stores({
  profile: '++id',
  categories: '++id, name',
  tasks: '++id, title, type, categoryId, status, createdAt, deletedAt',
  taskInstances: '++id, taskId, date, status, [taskId+date], [date+status]',
  checkinItems: '++id, name',
  checkins: '++id, itemId, date, [itemId+date]',
  journals: '++id, date, createdAt, deletedAt',
  events: '++id, date, title',
  holidays: 'date, year',
  quotes: '++id, date',
  reviews: '++id, weekStart',
  fitness: '++id, date, [date+parts]',
  skills: '++id, name',
  moods: '++id, &date'
})

// v5：科研专区（项目 / 方向 / 笔记；待办复用 task 表打「科研」分类，日程复用 events 表打 source）
db.version(5).stores({
  profile: '++id',
  categories: '++id, name',
  tasks: '++id, title, type, categoryId, status, createdAt, deletedAt',
  taskInstances: '++id, taskId, date, status, [taskId+date], [date+status]',
  checkinItems: '++id, name',
  checkins: '++id, itemId, date, [itemId+date]',
  journals: '++id, date, createdAt, deletedAt',
  events: '++id, date, title, source',
  holidays: 'date, year',
  quotes: '++id, date',
  reviews: '++id, weekStart',
  fitness: '++id, date, [date+parts]',
  skills: '++id, name',
  moods: '++id, &date',
  researchProjects: '++id, name, status, directionId, createdAt, deletedAt',
  researchDirections: '++id, name, archivedAt',
  researchNotes: '++id, projectId, createdAt, deletedAt'
})

// v6：成就殿堂 + 长期资产库（归档的复盘/报告/技艺/成就/文档；不含科研）
db.version(6).stores({
  profile: '++id',
  categories: '++id, name',
  tasks: '++id, title, type, categoryId, status, createdAt, deletedAt',
  taskInstances: '++id, taskId, date, status, [taskId+date], [date+status]',
  checkinItems: '++id, name',
  checkins: '++id, itemId, date, [itemId+date]',
  journals: '++id, date, createdAt, deletedAt',
  events: '++id, date, title, source',
  holidays: 'date, year',
  quotes: '++id, date',
  reviews: '++id, weekStart',
  fitness: '++id, date, [date+parts]',
  skills: '++id, name',
  moods: '++id, &date',
  researchProjects: '++id, name, status, directionId, createdAt, deletedAt',
  researchDirections: '++id, name, archivedAt',
  researchNotes: '++id, projectId, createdAt, deletedAt',
  achievements: '++id, date, category, archivedAt',
  assets: '++id, type, module, createdAt, deletedAt'
})

// v7：本地快照（每周自动存一份，保留最近 4 份，可回到某一天）
db.version(7).stores({
  profile: '++id',
  categories: '++id, name',
  tasks: '++id, title, type, categoryId, status, createdAt, deletedAt',
  taskInstances: '++id, taskId, date, status, [taskId+date], [date+status]',
  checkinItems: '++id, name',
  checkins: '++id, itemId, date, [itemId+date]',
  journals: '++id, date, createdAt, deletedAt',
  events: '++id, date, title, source',
  holidays: 'date, year',
  quotes: '++id, date',
  reviews: '++id, weekStart',
  fitness: '++id, date, [date+parts]',
  skills: '++id, name',
  moods: '++id, &date',
  researchProjects: '++id, name, status, directionId, createdAt, deletedAt',
  researchDirections: '++id, name, archivedAt',
  researchNotes: '++id, projectId, createdAt, deletedAt',
  achievements: '++id, date, category, archivedAt',
  assets: '++id, type, module, createdAt, deletedAt',
  backups: '++id, createdAt'
})

// v8：模块注册表（侧栏模块的显隐与排序）
db.version(8).stores({
  profile: '++id',
  categories: '++id, name',
  tasks: '++id, title, type, categoryId, status, createdAt, deletedAt',
  taskInstances: '++id, taskId, date, status, [taskId+date], [date+status]',
  checkinItems: '++id, name',
  checkins: '++id, itemId, date, [itemId+date]',
  journals: '++id, date, createdAt, deletedAt',
  events: '++id, date, title, source',
  holidays: 'date, year',
  quotes: '++id, date',
  reviews: '++id, weekStart',
  fitness: '++id, date, [date+parts]',
  skills: '++id, name',
  moods: '++id, &date',
  researchProjects: '++id, name, status, directionId, createdAt, deletedAt',
  researchDirections: '++id, name, archivedAt',
  researchNotes: '++id, projectId, createdAt, deletedAt',
  achievements: '++id, date, category, archivedAt',
  assets: '++id, type, module, createdAt, deletedAt',
  backups: '++id, createdAt',
  moduleConfig: '++id, &key, order'
})

// v9：日报 / 周报草稿（打开页面按需生成，可编辑留存；key = daily:日期 / weekly:周起始日）
db.version(9).stores({
  profile: '++id',
  categories: '++id, name',
  tasks: '++id, title, type, categoryId, status, createdAt, deletedAt',
  taskInstances: '++id, taskId, date, status, [taskId+date], [date+status]',
  checkinItems: '++id, name',
  checkins: '++id, itemId, date, [itemId+date]',
  journals: '++id, date, createdAt, deletedAt',
  events: '++id, date, title, source',
  holidays: 'date, year',
  quotes: '++id, date',
  reviews: '++id, weekStart',
  fitness: '++id, date, [date+parts]',
  skills: '++id, name',
  moods: '++id, &date',
  researchProjects: '++id, name, status, directionId, createdAt, deletedAt',
  researchDirections: '++id, name, archivedAt',
  researchNotes: '++id, projectId, createdAt, deletedAt',
  achievements: '++id, date, category, archivedAt',
  assets: '++id, type, module, createdAt, deletedAt',
  backups: '++id, createdAt',
  moduleConfig: '++id, &key, order',
  reports: '++id, &key, updatedAt'
})
// v10：分类默认色由冷色系改为暖色系（只改仍是旧默认值的记录，用户自选的颜色不动）
db.version(10).stores({
  profile: '++id',
  categories: '++id, name',
  tasks: '++id, title, type, categoryId, status, createdAt, deletedAt',
  taskInstances: '++id, taskId, date, status, [taskId+date], [date+status]',
  checkinItems: '++id, name',
  checkins: '++id, itemId, date, [itemId+date]',
  journals: '++id, date, createdAt, deletedAt',
  events: '++id, date, title, source',
  holidays: 'date, year',
  quotes: '++id, date',
  reviews: '++id, weekStart',
  fitness: '++id, date, [date+parts]',
  skills: '++id, name',
  moods: '++id, &date',
  researchProjects: '++id, name, status, directionId, createdAt, deletedAt',
  researchDirections: '++id, name, archivedAt',
  researchNotes: '++id, projectId, createdAt, deletedAt',
  achievements: '++id, date, category, archivedAt',
  assets: '++id, type, module, createdAt, deletedAt',
  backups: '++id, createdAt',
  moduleConfig: '++id, &key, order',
  reports: '++id, &key, updatedAt'
}).upgrade(async tx => {
  const MAP = { '#0ea5a4': '#4f8a7d', '#f59e0b': '#cf8f1f', '#6366f1': '#a4653f', '#8b5cf6': '#a8799c' }
  await tx.table('categories').toCollection().modify(c => { if (MAP[c.color]) c.color = MAP[c.color] })
})

// v11：番茄钟专注记录（每段专注 / 休息记一行；focus 模式结束会把时长累加到对应任务实例）
db.version(11).stores({
  profile: '++id',
  categories: '++id, name',
  tasks: '++id, title, type, categoryId, status, createdAt, deletedAt',
  taskInstances: '++id, taskId, date, status, [taskId+date], [date+status]',
  checkinItems: '++id, name',
  checkins: '++id, itemId, date, [itemId+date]',
  journals: '++id, date, createdAt, deletedAt',
  events: '++id, date, title, source',
  holidays: 'date, year',
  quotes: '++id, date',
  reviews: '++id, weekStart',
  fitness: '++id, date, [date+parts]',
  skills: '++id, name',
  moods: '++id, &date',
  researchProjects: '++id, name, status, directionId, createdAt, deletedAt',
  researchDirections: '++id, name, archivedAt',
  researchNotes: '++id, projectId, createdAt, deletedAt',
  achievements: '++id, date, category, archivedAt',
  assets: '++id, type, module, createdAt, deletedAt',
  backups: '++id, createdAt',
  moduleConfig: '++id, &key, order',
  reports: '++id, &key, updatedAt',
  focusSessions: '++id, startedAt, mode, taskId'
})

// v12：分类配色对齐新的浅灰 + 单色蓝体系（只映射旧默认色，用户自己调过的颜色不动）
db.version(12).stores({
  profile: '++id',
  categories: '++id, name',
  tasks: '++id, title, type, categoryId, status, createdAt, deletedAt',
  taskInstances: '++id, taskId, date, status, [taskId+date], [date+status]',
  checkinItems: '++id, name',
  checkins: '++id, itemId, date, [itemId+date]',
  journals: '++id, date, createdAt, deletedAt',
  events: '++id, date, title, source',
  holidays: 'date, year',
  quotes: '++id, date',
  reviews: '++id, weekStart',
  fitness: '++id, date, [date+parts]',
  skills: '++id, name',
  moods: '++id, &date',
  researchProjects: '++id, name, status, directionId, createdAt, deletedAt',
  researchDirections: '++id, name, archivedAt',
  researchNotes: '++id, projectId, createdAt, deletedAt',
  achievements: '++id, date, category, archivedAt',
  assets: '++id, type, module, createdAt, deletedAt',
  backups: '++id, createdAt',
  moduleConfig: '++id, &key, order',
  reports: '++id, &key, updatedAt',
  focusSessions: '++id, startedAt, mode, taskId'
}).upgrade(async tx => {
  const MAP = { '#4f8a7d': '#409eff', '#cf8f1f': '#67c23a', '#a4653f': '#e6a23c', '#a8799c': '#909399' }
  await tx.table('categories').toCollection().modify(c => { if (MAP[c.color]) c.color = MAP[c.color] })
})



// 侧栏模块的默认清单（新增模块只需在此登记一行）
export const DEFAULT_MODULES = [
  { key: 'home', label: '今日' },
  { key: 'todos', label: '计划' },
  { key: 'calendar', label: '日历' },
  { key: 'records', label: '手帐' },
  { key: 'growth', label: '成长' },
  { key: 'research', label: '科研' },
  { key: 'settings', label: '设置' },
]

// ---------- 回收站 ----------
// 支持软删除的表：回收站展示与 30 天自动清理都以这份清单为准（新增软删除表时记得在这里登记）
export const SOFT_DELETE_TABLES = [
  'tasks', 'journals', 'checkinItems', 'researchProjects', 'researchNotes', 'assets',
]

// 清理删除超过 30 天的内容。用 filter 而不是 where，避免依赖每张表是否建了 deletedAt 索引
// （checkinItems 就没有），也不会因为索引里查不到就漏掉清理
export async function purgeDeleted() {
  const cutoff = Date.now() - 30 * 86400000
  for (const t of SOFT_DELETE_TABLES) {
    const rows = await db[t].filter(r => !!r.deletedAt && r.deletedAt < cutoff).toArray()
    if (!rows.length) continue
    if (t === 'tasks') { // 计划的实例一并没意义，跟着一起清，免得留下孤儿实例污染统计
      for (const r of rows) await db.taskInstances.where('taskId').equals(r.id).delete()
    }
    await db[t].bulkDelete(rows.map(r => r.id))
  }
}

// ---------- 默认数据初始化 ----------
export async function initDefaults() {
  const count = await db.profile.count()
  if (count === 0) {
    await db.profile.add({ id: 1, name: '我', signature: '把日子过成自己喜欢的样子', avatar: '🦊' })
  }
  const catCount = await db.categories.count()
  if (catCount === 0) {
    await db.categories.bulkAdd([
      { name: '学习', color: '#409eff', system: false },
      { name: '生活', color: '#67c23a', system: false },
      { name: '工作', color: '#e6a23c', system: false },
      { name: '科研', color: '#909399', system: true, key: 'research' } // 系统保留分类，不可删除
    ])
  }
  // 科研分类的稳定标识（改名后仍认得出）：补 key
  const rc = await db.categories.filter(c => c.name === '科研' || c.key === 'research').first()
  if (rc && rc.key !== 'research') await db.categories.update(rc.id, { key: 'research' })
  const p = await db.profile.get(1)
  if (p && p.reviewDay === undefined) {
    await db.profile.update(1, { reviewDay: 6 }) // 复盘日：0=周日…6=周六，默认周六（可改）
  }
  // 侧栏模块注册表：补登记新模块，已有排序不动
  const modCount = await db.moduleConfig.count()
  if (modCount === 0) {
    await db.moduleConfig.bulkAdd(DEFAULT_MODULES.map((m, i) => ({ ...m, order: i, enabled: 1 })))
  } else {
    for (const m of DEFAULT_MODULES) {
      const has = await db.moduleConfig.where('key').equals(m.key).first()
      if (!has) {
        const max = (await db.moduleConfig.orderBy('order').last())?.order ?? 0
        await db.moduleConfig.add({ ...m, order: max + 1, enabled: 1 })
      }
    }
  }
  const ciCount = await db.checkinItems.count()
  if (ciCount === 0) {
    await db.checkinItems.bulkAdd([
      { name: '早睡', type: 'bool', target: 1 },
      { name: '早起', type: 'bool', target: 1 },
      { name: '喝 1.5L 水', type: 'count', target: 3, unit: '杯' }
    ])
  } else {
    // 一次性修正：水目标 6 杯 → 3 杯（用户 2026-09-26 指定；此后可在设置页自由调整）
    const water = await db.checkinItems.where('name').equals('喝 1.5L 水').first()
    if (water && water.target === 6) await db.checkinItems.update(water.id, { target: 3 })
  }
}
