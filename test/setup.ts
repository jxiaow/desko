import { vi } from 'vitest'

/** jsdom 不提供这两件，缺一片就会让整文件的用例连锁炸（BypassModule 曾一次炸 20 条）。
    真机 WebView2 都有，所以这里只补最小可调用面，不模拟行为。 */
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(() => false),
}))

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
})
