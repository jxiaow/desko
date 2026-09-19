/**
 * 头像取色：按**分类**落到六档色板，同一分类永远同一档。
 *
 * 之前是按条目 id 哈希——同类的两张卡片颜色各异，那层颜色读不出任何信息，
 * 只是让界面看起来更花。改成按分类后，色块成了分组的可见线索。
 * 具体六个色号是什么由当前主题给（global.css 的 --cat-1..6）。
 */
const BUCKETS = 6
const UNGROUPED = '未分类'

export const avatarClass = (category?: string | null): string => {
  const key = category?.trim() || UNGROUPED
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (key.charCodeAt(i) + ((hash << 5) - hash)) | 0
  }
  return `c${Math.abs(hash) % BUCKETS}`
}
