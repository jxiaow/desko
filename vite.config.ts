import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const mock = (name: string) =>
  fileURLToPath(new URL(`./e2e/mocks/${name}`, import.meta.url))

export default defineConfig(({ mode }) => {
  const isE2E = mode === 'e2e'
  return {
    plugins: [vue()],
    clearScreen: false,
    resolve: {
      alias: isE2E
        ? {
            '@tauri-apps/api/core': mock('tauri-core.ts'),
            '@tauri-apps/api/event': mock('tauri-event.ts'),
            '@tauri-apps/api/window': mock('tauri-window.ts'),
            '@tauri-apps/api/webview': mock('tauri-webview.ts'),
            '@tauri-apps/plugin-dialog': mock('tauri-dialog.ts'),
            '@tauri-apps/plugin-shell': mock('tauri-shell.ts'),
          }
        : {},
    },
    server: {
      host: '127.0.0.1',
      port: 1420,
      strictPort: true,
      watch: {
        // 否则 vite 会 watch 编译产物里的 desko.exe，运行中被占用直接 EBUSY 崩溃
        ignored: ['**/src-tauri/target/**'],
      },
      ...(isE2E
        ? {
            warmup: {
              clientFiles: ['./src/main.ts', './src/views/*.vue'],
            },
          }
        : {}),
    },
    envPrefix: ['VITE_', 'TAURI_'],
    build: {
      target: ['es2021', 'chrome100', 'safari13'],
      minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
      sourcemap: !!process.env.TAURI_DEBUG,
    },
  }
})
