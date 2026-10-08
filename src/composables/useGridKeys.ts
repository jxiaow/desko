/** 浮岛网格的键盘游走：↑↓ 跨行、←→ 同行相邻、C 复制当前卡。
 *
 * 步进里的「一行几列」按容器实测，不写死——窗口收窄到 2 列时写死的 ±3 会跳错行。
 * Enter/Space 的开启动作留在卡片自己的 keydown 上（那里已有 role/aria 与 prevent）；
 * 输入框、编辑器、弹层里的焦点一律不劫持。
 */
type Options = {
  cardSelector: string
  onCopy: (id: string) => void
}

const STEP: Record<string, (cols: number) => number> = {
  ArrowLeft: () => -1,
  ArrowRight: () => 1,
  ArrowUp: (cols) => -cols,
  ArrowDown: (cols) => cols,
}

export function useGridKeys({ cardSelector, onCopy }: Options) {
  const columnsOf = (grid: HTMLElement) =>
    getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1

  const onGridKeydown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target instanceof HTMLElement ? event.target : null
    if (!target || target.closest('input, textarea, [contenteditable="true"]')) return
    const grid = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
    if (!grid) return
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(cardSelector))
    const current = target.closest<HTMLElement>(cardSelector)
    const at = current ? cards.indexOf(current) : -1
    if (at < 0) return

    const step = STEP[event.key]
    if (step) {
      event.preventDefault()
      cards[at + step(columnsOf(grid))]?.focus()
      return
    }
    if (event.key.toLowerCase() === 'c') {
      const id = cards[at].dataset.id
      if (!id) return
      event.preventDefault()
      onCopy(id)
    }
  }

  return { onGridKeydown }
}
