import { isWebRuntime } from './runtime'
import { invoke } from './transport'

/** Portable ciphertext only; the browser never receives the server's draft key. */
export interface SealedDraft { iv: string; ciphertext: string }
export type DraftCipherKey = CryptoKey | 'web'

export async function createDraftCipherKey(): Promise<DraftCipherKey> {
  if (isWebRuntime()) return 'web'
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}
const unbase64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))

export async function sealDraft(key: DraftCipherKey, plaintext: string): Promise<SealedDraft> {
  if (key === 'web') return invoke('web_seal_draft', { plaintext })
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const bytes = new TextEncoder().encode(plaintext)
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)
    return { iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) }
  } finally { bytes.fill(0) }
}

export async function openDraft(key: DraftCipherKey, sealed: SealedDraft): Promise<string> {
  if (key === 'web') return invoke('web_open_draft', { sealed })
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(sealed.iv) }, key, unbase64(sealed.ciphertext))
  const bytes = new Uint8Array(plaintext)
  try { return new TextDecoder().decode(bytes) } finally { bytes.fill(0) }
}
