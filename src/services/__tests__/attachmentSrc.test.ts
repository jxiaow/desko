import { describe, it, expect } from 'vitest'
import {
  attachmentNameFromSrc,
  collectAttachmentNames,
  nameOf,
  normalizeAssetHtml,
  resolveAssetHtml,
  srcOf,
  unreferencedAttachments,
} from '../attachmentSrc'

const abs = 'C:\\Users\\jiang\\AppData\\Roaming\\desko\\attachments\\u9__a.png'
/** 老数据：整条绝对路径被 convertFileSrc encode 成 URL 最后一段 */
const legacySrc = `http://asset.localhost/${encodeURIComponent(abs)}`

describe('附件路径编解码（库里只存相对形态）', () => {
  it('nameOf 只取最后一段', () => {
    expect(nameOf(abs)).toBe('u9__a.png')
    expect(nameOf('attachments/u9__a.png')).toBe('u9__a.png')
    expect(nameOf('u9__a.png')).toBe('u9__a.png')
  })

  it('认规范形态和历史 asset URL，外链不算我们的', () => {
    expect(attachmentNameFromSrc('attachments/u9__a.png')).toBe('u9__a.png')
    expect(attachmentNameFromSrc(legacySrc)).toBe('u9__a.png')
    expect(attachmentNameFromSrc('asset://localhost/u9__a.png')).toBe('u9__a.png')
    expect(attachmentNameFromSrc('https://example.com/a.png')).toBeNull()
    expect(attachmentNameFromSrc('data:image/png;base64,AA')).toBeNull()
    expect(attachmentNameFromSrc(undefined)).toBeNull()
  })

  it('normalize 把 asset URL 洗成 attachments/<名>，外链原样，且幂等', () => {
    const html = `<p>看</p><img src="${legacySrc}"><img src="attachments/keep__k.png">` +
      `<img src="https://e.com/x.png">`
    const once = normalizeAssetHtml(html)
    expect(once).toBe(
      '<p>看</p><img src="attachments/u9__a.png"><img src="attachments/keep__k.png">' +
      '<img src="https://e.com/x.png">',
    )
    expect(normalizeAssetHtml(once)).toBe(once)
  })

  it('resolve 在没有本机目录时不会把相对形态弄坏', () => {
    // baseDir 取不到（纯浏览器测试）时退回原值，不该抛错也不该改数据
    expect(resolveAssetHtml('<img src="attachments/u9__a.png">'))
      .toBe('<img src="attachments/u9__a.png">')
  })

  it('collectAttachmentNames 按名字去重', () => {
    const html = `<img src="attachments/u9__a.png"><img src="${legacySrc}">` +
      `<img src="attachments/b__2.png">`
    expect(collectAttachmentNames(html).sort()).toEqual(['b__2.png', 'u9__a.png'])
  })

  it('正文引用过的图不再进附件条，按名字对得上', () => {
    const atts = [
      { file_path: 'u9__a.png' },
      { file_path: abs, }, // 库里还没归一的行也要认出来
      { file_path: 'other__z.png' },
    ]
    const left = unreferencedAttachments('<img src="attachments/u9__a.png">', atts)
    expect(left.map(a => nameOf(a.file_path))).toEqual(['other__z.png'])
  })

  it('srcOf 出的形态和 normalize 落库的一致', () => {
    expect(srcOf(abs)).toBe('attachments/u9__a.png')
    expect(normalizeAssetHtml(`<img src="${srcOf('u9__a.png')}">`)).toBe(`<img src="${srcOf('u9__a.png')}">`)
  })
})
