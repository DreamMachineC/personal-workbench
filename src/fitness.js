// 训练部位：首页快捷记录与「成长 → 体魄」共用同一份清单
export const PARTS = ['胸', '肩', '背', '腿', '二头', '三头', '有氧']

export function togglePart(list, p) {
  const i = list.indexOf(p)
  if (i >= 0) list.splice(i, 1)
  else list.push(p)
}
