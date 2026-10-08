/**
 * 档位字母：条目身份档（.grid-slot）在 favicon 到货前/抓不到时的兜底字面。
 *
 * 取**分类**首字，不是条目名首字——同一分类的卡片字母一致，这层字母就成了分组的可见线索；
 * 之前按条目名首字母 + 按分类哈希取纯色底，等于让一块读不出信息的颜色占着身份位。
 * 色彩已交还给 favicon / 扩展名，档面本身只吃字色淡染（见 global.css .grid-slot）。
 */
const UNGROUPED = '#'

export const avatarLetter = (category?: string | null): string => {
  const c = (category || '').trim()
  return c ? c[0].toUpperCase() : UNGROUPED
}
