import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invoke, webSessionGeneration } from './transport'
import { pickBrowserImage, uploadBrowserImage } from './browserImage'

vi.mock('./transport', () => ({ invoke: vi.fn(), webSessionGeneration: vi.fn(() => 1) }))
beforeEach(() => { vi.clearAllMocks(); vi.mocked(webSessionGeneration).mockReturnValue(1) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('a session change during file reading cannot upload into the next session', async () => {
  let reader!: { result: string; onload: () => void }
  vi.stubGlobal('FileReader', class {
    result = 'data:image/png;base64,c3ludGhldGlj'
    onload = () => {}
    readAsDataURL() { reader = this }
  })
  const upload = uploadBrowserImage(new File(['synthetic'], 'image.png', { type: 'image/png' }))
  vi.mocked(webSessionGeneration).mockReturnValue(2)
  reader.onload()
  await expect(upload).rejects.toThrow('会话已变更')
  expect(invoke).not.toHaveBeenCalled()
})

it('expired session closes the pending image chooser and removes its input', async () => {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
  const picked = pickBrowserImage()
  expect(document.querySelector('input[type=file]')).not.toBeNull()
  window.dispatchEvent(new Event('desko:web-session-expired'))
  expect(await picked).toBeNull()
  expect(document.querySelector('input[type=file]')).toBeNull()
})

it('empty image is rejected before any upload', async () => {
  await expect(uploadBrowserImage(new File([], 'empty.png'))).rejects.toThrow('图片应小于')
  expect(invoke).not.toHaveBeenCalled()
})


it('manual logout and relogin while selecting cannot carry an old selection into the new session', async () => {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
  const picked = pickBrowserImage()
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File(['old'], 'old.png')] })
  vi.mocked(webSessionGeneration).mockReturnValue(2)
  input.dispatchEvent(new Event('change'))
  expect(await picked).toBeNull()
})
