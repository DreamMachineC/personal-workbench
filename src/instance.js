import dayjs from 'dayjs'
import { db } from './db'
import { today, taskOccursOn, isWorkday, loadHolidays } from './date'

// 打开页面时按需补算当日实例（幂等）：多次执行不产生重复数据
export async function ensureTodayInstances() {
  await loadHolidays(dayjs().year()).catch(() => {})
  await loadHolidays(dayjs().add(1, 'year').year()).catch(() => {})
  const t = today()
  const activeTasks = (await db.tasks.where('status').notEqual('archived').toArray()).filter(t => !t.deletedAt)
  const scheduled = activeTasks.filter(task => task.rrule)
  if (!scheduled.length) return
  const workday = await isWorkday(t) // 同一天只判一次，别在循环里反复读库
  for (const task of scheduled) {
    if (!taskOccursOn(task, t, workday)) continue
    const exist = await db.taskInstances.where('[taskId+date]').equals([task.id, t]).count()
    if (exist === 0) {
      await db.taskInstances.add({ taskId: task.id, date: t, status: 'todo', completedAt: null, durationMin: 0 })
    }
  }
}
