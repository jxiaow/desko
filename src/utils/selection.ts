/**
 * 批量选择的口径计算。三页（收藏 / 小记 / Codex 账号）共用同一套集合语义，
 * 但可见集来源和动作集不同，所以这里只放纯函数，不带文案、不引 store。
 *
 * 记号：S = 选中集合，V = 当前筛选可见集合，K = 选了但此刻不在屏幕上的条数。
 */

/** K = |S \ V| */
export const hiddenCount = (selected: ReadonlySet<string>, visible: readonly string[]): number => {
  if (!selected.size) return 0
  const show = new Set(visible)
  let n = 0
  selected.forEach(id => {
    if (!show.has(id)) n += 1
  })
  return n
}

/** |S ∩ V|：dock 计数里「本屏」那一段，等于点了「全选」之后能看见的部分 */
export const visibleCount = (selected: ReadonlySet<string>, visible: readonly string[]): number =>
  selected.size - hiddenCount(selected, visible)

/** 「全选」＝把本屏并入 S，先前跨筛选攒的选中一条不丢 */
export const unionVisible = (selected: ReadonlySet<string>, visible: readonly string[]): Set<string> => {
  const next = new Set(selected)
  visible.forEach(id => next.add(id))
  return next
}

/** 「取消本屏」＝只把 V 从 S 里摘掉；隐藏的那些留给「完成」或下一次批量处理 */
export const minusVisible = (selected: ReadonlySet<string>, visible: readonly string[]): Set<string> => {
  const hide = new Set(visible)
  return new Set([...selected].filter(id => !hide.has(id)))
}

/**
 * 条目从数据源消失后才剪枝（单条删除、合并吞源、外部同步）。
 * 没变化时返回原引用，省掉一次 Set 重建和不必要的重渲染。
 */
export const prune = (selected: Set<string>, existing: readonly string[]): Set<string> => {
  const live = new Set(existing)
  if ([...selected].every(id => live.has(id))) return selected
  return new Set([...selected].filter(id => live.has(id)))
}
