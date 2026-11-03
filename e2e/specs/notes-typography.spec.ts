import { test, expect, Page } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { bootUnlocked, openNoteRead } from '../helpers'

/** 阅读列、编辑列与底栏共用一条 680 的行长轴（docs/design/notes/11-editor-typography.md） */
const MEASURE = 680

const READ_HTML =
  '<h2>设计稿评审</h2>' +
  '<p>正文第一段，用来量字号与行距。</p>' +
  '<h2>第二节</h2>' +
  '<p>带 <code>npm test</code> 的行内码</p>' +
  '<pre><code>const a = 1</code></pre>'

const SEED = { notes: [{ title: '设计稿评审', content_html: READ_HTML }] }

const RHYTHM_HTML =
  '<p>第一段。</p>' +
  '<p></p>' +
  '<p>第二段。</p>' +
  '<p></p>' +
  '<p>1. 第一条手写列表项，写长一点让它回行，用来量同组距离与悬挂缩进是否真的生效。</p>' +
  '<p></p>' +
  '<p>2. 第二条。</p>' +
  '<p></p>' +
  '<p>收尾段。</p>'

const RHYTHM_SEED = { notes: [{ title: '节奏', content_html: RHYTHM_HTML }] }

async function openRead(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height })
  await bootUnlocked(page, SEED, '/notes')
  await openNoteRead(page.locator('.memo').first())
  await expect(page.locator('.fs-title')).toHaveText('设计稿评审')
}

/** 正文列左缘 vs 底栏工具列左缘：书写面上两者必须落在同一条竖直线上 */
function columnGeometry(page: Page) {
  return page.evaluate(() => {
    const doc = document.querySelector('.fs .note-editor.v-full .ProseMirror') as HTMLElement
    const toolbar = document.querySelector('.fs-foot .note-toolbar') as HTMLElement
    const button = toolbar.querySelector('button') as HTMLElement
    const scroll = document.querySelector('.fs-scroll') as HTMLElement
    const d = doc.getBoundingClientRect()
    const t = toolbar.getBoundingClientRect()
    return {
      docLeft: d.left,
      docWidth: d.width,
      toolbarLeft: t.left,
      buttonHeight: button.getBoundingClientRect().height,
      overflowX: scroll.scrollWidth - scroll.clientWidth,
    }
  })
}

test.describe('Notes 排版尺度', () => {
  test('阅读层：14/24 正文、680 列、24 标题、12 元信息', async ({ page }) => {
    await openRead(page)
    const view = page.locator('.fs-view')
    await expect(view).toHaveCSS('font-size', '14px')
    await expect(view).toHaveCSS('line-height', '24px')
    await expect(page.locator('.fs-title')).toHaveCSS('font-size', '24px')
    await expect(page.locator('.fs-title')).toHaveCSS('line-height', '34px')
    await expect(page.locator('.fs-meta')).toHaveCSS('font-size', '12px')
    await expect(page.locator('.fs-meta')).toHaveCSS('line-height', '18px')

    // 首块被提升为阅读标题并藏掉，正文里的第二个标题按次级尺度排
    await expect(view.locator('h2').first()).toBeHidden()
    await expect(view.locator('h2').nth(1)).toHaveCSS('font-size', '18px')
    await expect(view.locator('h2').nth(1)).toHaveCSS('line-height', '28px')
    await expect(view.locator('pre')).toHaveCSS('font-size', '13.5px')
    await expect(view.locator('pre')).toHaveCSS('line-height', '22px')

    const wide = await page.locator('.fs-doc').evaluate(el => el.getBoundingClientRect().width)
    expect(Math.abs(wide - MEASURE)).toBeLessThanOrEqual(1)

    // 阅读列不能顶到浮片上缘：36px 的上下留白由 .fs-inner 提供，列宽只负责水平方向
    const topInset = await page.evaluate(() => {
      const scroll = document.querySelector('.fs-scroll')!.getBoundingClientRect()
      const title = document.querySelector('.fs-title')!.getBoundingClientRect()
      return title.top - scroll.top
    })
    expect(Math.abs(topInset - 36)).toBeLessThanOrEqual(1)

    // 窄窗里列宽跟着内容盒收缩，不出现横向滚动
    await page.setViewportSize({ width: 800, height: 900 })
    const narrow = await page.evaluate(() => {
      const scroll = document.querySelector('.fs-scroll') as HTMLElement
      return {
        width: document.querySelector('.fs-doc')!.getBoundingClientRect().width,
        overflowX: scroll.scrollWidth - scroll.clientWidth,
      }
    })
    expect(narrow.width).toBeLessThan(MEASURE)
    expect(narrow.overflowX).toBe(0)
  })

  test('选中条：B/I/S 落在选区上，按态可读', async ({ page }) => {
    await bootUnlocked(page, SEED, '/notes')
    const pm = page.locator('.composer .ProseMirror')
    await pm.click()
    await pm.fill('加粗斜体删除')

    const bar = page.locator('.fmt-bar')
    await pm.evaluate(el => {
      const editor = (el as HTMLElement & { editor: Editor }).editor
      editor.commands.setTextSelection({ from: 1, to: 7 })
    })
    await expect(bar).toBeVisible()
    await expect(bar.locator('.fmt-btn')).toHaveCount(5)
    await expect(bar.locator('.fmt-divider')).toHaveCount(1)
    expect(await bar.evaluate(el => el.getBoundingClientRect().height)).toBe(36)

    const bold = bar.getByRole('button', { name: '加粗' })
    const italic = bar.getByRole('button', { name: '斜体' })
    const strike = bar.getByRole('button', { name: '删除线' })
    await expect(bold).toHaveAttribute('aria-pressed', 'false')

    await bold.click()
    await expect(pm.locator('strong')).toHaveText('加粗斜体删除')
    await expect(bold).toHaveAttribute('aria-pressed', 'true')

    await italic.click()
    await expect(pm.locator('em')).toHaveText('加粗斜体删除')
    await strike.click()
    await expect(pm.locator('s')).toHaveText('加粗斜体删除')
    await expect(strike).toHaveAttribute('aria-pressed', 'true')

    // 再点一次只摘掉加粗，斜体与删除线还在
    await bold.click()
    await expect(pm.locator('strong')).toHaveCount(0)
    await expect(pm.locator('em')).toHaveCount(1)
    await expect(pm.locator('s')).toHaveCount(1)
  })

  test('全屏书写：首块标题与阅读同尺度，底栏与正文列同左缘', async ({ page }) => {
    await openRead(page)
    await page
      .locator('#note-fullscreen-toolbar')
      .getByRole('button', { name: '编辑', exact: true })
      .click()
    const pm = page.locator('.fs .ProseMirror')
    await expect(pm).toBeVisible()

    const first = pm.locator('> h2').first()
    await expect(first).toHaveCSS('font-size', '24px')
    await expect(first).toHaveCSS('line-height', '34px')
    // 书写面与阅读面共用同一条上下留白
    const topInset = await page.evaluate(() => {
      const scroll = document.querySelector('.fs-scroll')!.getBoundingClientRect()
      const block = document.querySelector('.fs .ProseMirror > h2')!.getBoundingClientRect()
      return block.top - scroll.top
    })
    expect(Math.abs(topInset - 36)).toBeLessThanOrEqual(1)

    // 1440 列宽顶满 680；1040 与 800 让列宽跟着收缩，底栏仍要贴住同一条左缘
    for (const width of [1440, 1040, 800]) {
      await page.setViewportSize({ width, height: 900 })
      await expect
        .poll(async () => {
          const g = await columnGeometry(page)
          return {
            aligned: Math.abs(g.docLeft - g.toolbarLeft) <= 1,
            overflowX: g.overflowX,
          }
        })
        .toEqual({ aligned: true, overflowX: 0 })
      const g = await columnGeometry(page)
      expect(g.buttonHeight).toBe(28)
    }
  })

  test('排版结构：阅读收起空段、手写列表悬挂，书写空段折一行', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await bootUnlocked(page, RHYTHM_SEED, '/notes')
    await openNoteRead(page.locator('.memo').first())
    const view = page.locator('.fs-view')
    await expect(view).toBeVisible()

    const blanks = view.locator(':scope > p.tp-blank')
    await expect(blanks).toHaveCount(4)
    await expect(blanks.first()).toHaveCSS('display', 'none')

    const hangs = view.locator(':scope > p.tp-hang')
    await expect(hangs).toHaveCount(2)
    await expect(hangs.first()).toHaveCSS('padding-left', '24.5px')
    await expect(hangs.first()).toHaveCSS('text-indent', '-24.5px')

    // 段距 12；手写列表同组 6、组后回正文 20
    const ps = view.locator(':scope > p')
    await expect(ps.nth(2)).toHaveCSS('margin-top', '12px')
    await expect(hangs.nth(1)).toHaveCSS('margin-top', '6px')
    await expect(ps.last()).toHaveCSS('margin-top', '20px')

    await page
      .locator('#note-fullscreen-toolbar')
      .getByRole('button', { name: '编辑', exact: true })
      .click()
    const pm = page.locator('.fs .ProseMirror')
    await expect(pm).toBeVisible()
    const folded = pm.locator(':scope > p.tp-blank').first()
    await expect(folded).toHaveCSS('margin-top', '0px')
    await expect(folded).toHaveCSS('min-height', '24px')
    expect(await folded.evaluate(el => getComputedStyle(el.nextElementSibling!).marginTop)).toBe('0px')
    await expect(pm.locator(':scope > p.tp-hang').first()).toHaveCSS('padding-left', '24.5px')
  })
})
