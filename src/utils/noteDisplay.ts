const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

/** 传入已清理标签的展示 HTML；保留首块节点，任务勾选仍按原顺序对位。 */
export function noteDisplay(html: string) {
  const div = document.createElement('div')
  div.innerHTML = html
  const first = div.firstElementChild
  const firstText = (first?.textContent ?? '').trim()
  // 混排图片或任务的块仍是正文，不能为提升文字标题把其中的内容一并藏掉。
  const hasStructure = !!first?.querySelector('img, input, ul, ol, pre')
  const hideFirstBlock = !!first && HEADINGS.has(first.tagName) && !!firstText && !hasStructure
  return {
    title: hideFirstBlock ? firstText : '',
    hideFirstBlock,
  }
}
