// @ts-expect-error The app tsconfig excludes Node types; Vitest runs on Node.
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createDraftCipherKey, sealDraft, openDraft } from './draftCipher'

afterEach(() => vi.unstubAllGlobals())

it('desktop keeps authenticated AES-GCM roundtrip with a nonexportable local key', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const key = await createDraftCipherKey()
  expect(key).not.toBe('web')
  if (key === 'web') throw new Error('desktop must use a native CryptoKey')
  expect(key.extractable).toBe(false)
  const plaintext = '<p>未发布草稿</p>'.repeat(8000)
  const sealed = await sealDraft(key, plaintext)
  expect(typeof sealed.iv).toBe('string')
  expect(typeof sealed.ciphertext).toBe('string')
  expect(sealed.ciphertext).not.toContain('未发布草稿')
  expect(await openDraft(key, sealed)).toBe(plaintext)
  const other = await createDraftCipherKey()
  await expect(openDraft(other, sealed)).rejects.toThrow()
})
