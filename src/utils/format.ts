export function stripHtml(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  const text = div.textContent || ''
  return text.length > 120 ? text.slice(0, 120) + '...' : text
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
