import { defineConfig } from '@playwright/test'

// 复用本机已安装的 Chrome，避免下载 playwright 自带浏览器（cdn.playwright.dev 不可达）
export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 冷启动时 vite 依赖预构建（tiptap/lowlight）可能拖慢首个页面加载
  timeout: 120_000,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:1430',
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
    command: 'npm run dev -- --mode e2e --port 1430 --strictPort',
    url: 'http://127.0.0.1:1430',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
