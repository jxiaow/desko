import { getBackend } from './backend'

/** 图片保存沿用原生文件选择器；测试仅记录写入内容，不触碰真实文件。 */
export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  getBackend().logInvocation('fs:writeFile', { path, bytes: Array.from(data) })
}
