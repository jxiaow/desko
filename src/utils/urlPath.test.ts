import { describe, it, expect } from 'vitest'
import { normalizeSubPath, joinEntryUrl } from './urlPath'

describe('normalizeSubPath', () => {
  it('补齐前导斜杠', () => {
    expect(normalizeSubPath('dashboard')).toBe('/dashboard')
    expect(normalizeSubPath('/dashboard')).toBe('/dashboard')
    expect(normalizeSubPath('  //a/b  ')).toBe('/a/b')
  })

  it('粘进完整地址时只留路径段', () => {
    expect(normalizeSubPath('http://10.0.0.65/builds/private/linux_app_x86_64/'))
      .toBe('/builds/private/linux_app_x86_64/')
    expect(normalizeSubPath('https://oa.example.com/settings?tab=1'))
      .toBe('/settings?tab=1')
  })

  it('纯主机名或非法输入返回 null', () => {
    expect(normalizeSubPath('http://10.0.0.65')).toBeNull()
    expect(normalizeSubPath('https://oa.example.com/')).toBeNull()
    expect(normalizeSubPath('http://')).toBeNull()
    expect(normalizeSubPath('   ')).toBeNull()
  })
})

describe('joinEntryUrl', () => {
  it('子路径拼在主机地址之后', () => {
    expect(joinEntryUrl('http://10.0.0.65/builds/', 'private')).toBe('http://10.0.0.65/builds/private')
    expect(joinEntryUrl('http://10.0.0.65/builds', '/private')).toBe('http://10.0.0.65/builds/private')
  })

  it('历史整条地址直接用作目标', () => {
    expect(joinEntryUrl('http://10.0.0.65/builds/', 'http://other.host/x')).toBe('http://other.host/x')
  })

  it('无主机地址时退回原值', () => {
    expect(joinEntryUrl(null, '/dashboard')).toBe('/dashboard')
  })
})
