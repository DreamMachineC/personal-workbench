import { db } from './db'
import { today } from './date'

const TABLES = [
  'profile', 'categories', 'tasks', 'taskInstances', 'checkinItems', 'checkins',
  'journals', 'events', 'holidays', 'quotes', 'reviews', 'fitness', 'skills', 'moods',
  'researchProjects', 'researchDirections', 'researchNotes', 'achievements', 'assets'
]

export async function collectBackup() {
  const dump = { _exportedAt: new Date().toISOString(), data: {} }
  for (const t of TABLES) dump.data[t] = await db[t].toArray()
  return dump
}

export async function exportBackupFile() {
  const dump = await collectBackup()
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `life-workbench-backup-${today()}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

const WEEK = 7 * 86400000
const KEEP = 4

// 打开应用时检查：距上一份快照超过 7 天就留一份（幂等，失败不影响启动）
export async function maybeWeeklySnapshot() {
  const last = await db.backups.orderBy('createdAt').last()
  if (last && Date.now() - last.createdAt < WEEK) return false
  await takeSnapshot()
  return true
}

export async function takeSnapshot() {
  const dump = await collectBackup()
  await db.backups.add({ createdAt: Date.now(), json: JSON.stringify(dump) })
  const all = await db.backups.orderBy('createdAt').toArray()
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) await db.backups.delete(old.id)
}

export async function restoreSnapshot(id) {
  const snap = await db.backups.get(id)
  if (!snap) throw new Error('这份快照已不在了')
  const dump = JSON.parse(snap.json)
  for (const [t, rows] of Object.entries(dump.data || {})) {
    if (db[t]) await db[t].bulkPut(rows)
  }
}

export async function importBackupFile(file) {
  const dump = JSON.parse(await file.text())
  for (const [t, rows] of Object.entries(dump.data || {})) {
    if (db[t]) await db[t].bulkPut(rows)
  }
}

export const fmtSize = n => n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`
