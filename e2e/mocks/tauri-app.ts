// vite alias: '@tauri-apps/api/app' -> 本文件（仅 E2E 模式）
// app.js 真实实现走包内相对 ./core.js，绕过了 @tauri-apps/api/core 的 e2e alias，
// 所以这里整模块桩掉，保证关于页版本号在 e2e/shots 里能渲染、可断言。
export async function getVersion(): Promise<string> {
  return '1.0.0'
}

export async function getName(): Promise<string> {
  return 'desko'
}

export async function getTauriVersion(): Promise<string> {
  return '2.12.2'
}

export async function getIdentifier(): Promise<string> {
  return 'com.desko.app'
}
