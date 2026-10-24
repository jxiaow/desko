import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import CodexDialogMarkdown from './CodexDialogMarkdown.vue'
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }))

it('renders code and tables while stripping active markup and unsafe links', () => {
  const wrapper = mount(CodexDialogMarkdown, { props: { text: '**粗体**\n\n```js\nconst a = 1\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil.test"></iframe><a href="javascript:alert(1)">bad</a><form><input></form>' } })
  expect(wrapper.find('strong').text()).toBe('粗体')
  expect(wrapper.find('pre code').text()).toContain('const a = 1')
  expect(wrapper.find('table').exists()).toBe(true)
  expect(wrapper.find('script, img, iframe, input, form').exists()).toBe(false)
  expect(wrapper.find('a').attributes('href')).toBeUndefined()
})
