import { defineConfig } from '@playwright/test'

// 复用本机已安装的 Chrome，避免下载 playwright 自带浏览器（cdn.playwright.dev 不可达）
// 端口可被 PW_PORT 覆盖：`reuseExistingServer` 会把本机残留的旧 dev server 当成自己的，
// 那个进程服务的是另一份代码（改过的选择器、`__E2E__` 都没有），症状是全量用例在解锁那一步超时。
const PORT = Number(process.env.PW_PORT ?? 1430)

export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 冷启动时 vite 依赖预构建（tiptap/lowlight）可能拖慢首个页面加载
  timeout: 120_000,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    {
      name: 'chromium',
      use: { channel: process.env.PW_CHANNEL || 'chrome' },
    },
  ],
  webServer: {
    command: `npm run dev -- --mode e2e --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
