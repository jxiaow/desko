import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CodexHudSprite from './CodexHudSprite.vue'
import { HUD_MOVE_MS, type CodexHudMove, type CodexHudSkin, type CodexHudState } from '../../../utils/codexHud'

const state = (patch: Partial<CodexHudState> = {}): CodexHudState => ({
  skin: 'bunny',
  theme: { theme: 'paper', base: 'light', accent: 'ink', atmosphere: false },
  primary: { label: '5h', percentage: 68 },
  secondary: { label: 'w', percentage: 42 },
  placeholder: null,
  severe: false,
  stale: false,
  placeholderAlert: false,
  today: { tokens: 1_942_000, costUsd: 12.34 },
  updatedAt: 1_800_000_000,
  ...patch,
})

const mountSkin = (skin: CodexHudSkin, patch: Partial<CodexHudState> = {}) =>
  mount(CodexHudSprite, { props: { state: state({ skin, ...patch }) } })

const mountExpanded = (skin: CodexHudSkin, patch: Partial<CodexHudState> = {}) =>
  mount(CodexHudSprite, { props: { state: state({ skin, ...patch }), expanded: true } })

describe('挂件三皮肤', () => {
  it('兔子用双耳画额度，右耳的次额度比左耳浅', () => {
    const wrapper = mountSkin('bunny')
    expect(wrapper.findAll('.ear')).toHaveLength(2)
    expect(wrapper.findAll('.ear-inner')).toHaveLength(2)
    expect(wrapper.findAll('.ear-fill.primary')).toHaveLength(1)
    expect(wrapper.findAll('.ear-fill.week')).toHaveLength(1)
    expect(wrapper.find('.head').exists()).toBe(true)
  })

  it('没有次额度时右耳不填色，只留轮廓', () => {
    const wrapper = mountExpanded('bunny', { secondary: null })
    expect(wrapper.findAll('.ear-fill.primary')).toHaveLength(1)
    expect(wrapper.findAll('.ear-fill.week')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('42%')
  })

  it('企鹅把主额度画在肚皮上', () => {
    const wrapper = mountSkin('penguin')
    expect(wrapper.find('.belly').exists()).toBe(true)
    expect(wrapper.find('.belly-fill').exists()).toBe(true)
    expect(wrapper.find('.cap').exists()).toBe(true)
    expect(wrapper.find('.beak').exists()).toBe(true)
  })

  it('蜗牛把主额度画在螺壳上，螺旋保持固定', () => {
    const wrapper = mountSkin('snail')
    expect(wrapper.find('.shell').exists()).toBe(true)
    expect(wrapper.find('.shell-fill').exists()).toBe(true)
    expect(wrapper.find('.spiral').exists()).toBe(true)
    expect(wrapper.findAll('.stalk')).toHaveLength(2)
  })

  it('填色高度随百分比变化，0% 不溢出、100% 填满', () => {
    const low = mountSkin('penguin', { primary: { label: '5h', percentage: 10 } })
    const full = mountSkin('penguin', { primary: { label: '5h', percentage: 100 } })
    expect(low.get('.belly-fill').attributes('d')).not.toBe(full.get('.belly-fill').attributes('d'))
    const zero = mountSkin('snail', { primary: { label: '5h', percentage: 0 } })
    expect(zero.get('.shell-fill').attributes('d')).toContain('M 28,46.40')
  })

  it('角色画在 112×66 上，分层给出呼吸 / 触发 / 动作 / 眼睛几层 transform', () => {
    for (const skin of ['bunny', 'penguin', 'snail'] as CodexHudSkin[]) {
      const wrapper = mountSkin(skin)
      expect(wrapper.get('.char').html()).toContain('viewBox="0 0 112 66"')
      // 同一元素挂两条 transform 动画会互相覆盖，所以一层一个 <g>
      expect(wrapper.findAll('.figure')).toHaveLength(1)
      expect(wrapper.findAll('.act')).toHaveLength(1)
      expect(wrapper.get('.figure').find('.act').exists()).toBe(true)
      // 步子与六个招牌动作都只挂在 .mv-* 这些空档上，不碰常驻层
      expect(wrapper.findAll('.mv-fig, .mv-body')).toHaveLength(1)
    }
    expect(mountSkin('bunny').findAll('.eyes')).toHaveLength(1)
    expect(mountSkin('penguin').findAll('.eyes')).toHaveLength(1)
    // 蜗牛两只眼睛分住两根触角，反相摆动时不能共一个缩放框
    expect(mountSkin('snail').findAll('.eyes')).toHaveLength(2)
    const bunny = mountSkin('bunny')
    expect(bunny.findAll('.ear-l, .ear-r')).toHaveLength(2)
    expect(bunny.findAll('.ear-flick')).toHaveLength(2)
    expect(bunny.get('.ear-l').find('.mv-ear-l').find('.ear-flick').exists()).toBe(true)
    expect(bunny.findAll('.mv-head')).toHaveLength(1)
    expect(bunny.get('.mv-head').find('.mug').exists()).toBe(true)
    expect(bunny.get('.ear-fill.primary').attributes('y')).toBe('12.32')
    const snail = mountSkin('snail')
    expect(snail.findAll('.antennae')).toHaveLength(1)
    expect(snail.findAll('.stalk-l, .stalk-r')).toHaveLength(2)
    expect(snail.get('.mv-body').find('.antennae').exists()).toBe(true)
    // 壳是刚体：缩壳时身体在壳下面退，壳自己只压一点
    expect(snail.get('.figure').find('.mv-shell').exists()).toBe(true)
    expect(mountSkin('penguin').findAll('.flip-l, .flip-r')).toHaveLength(2)
  })

  it('hop 把双爪一起带走，waddle 连趾线一起换脚', () => {
    const bunny = mount(CodexHudSprite, { props: { state: state(), idle: true, move: 'hop' } })
    // 起跳是整个身子离地：爪子留在身子外面就会画出一条脱节的腿
    expect(bunny.get('.mv-fig').find('.paw-a').exists()).toBe(true)
    expect(bunny.get('.mv-fig').find('.paw-b').exists()).toBe(true)
    const penguin = mount(CodexHudSprite, { props: { state: state({ skin: 'penguin' }), idle: true, move: 'waddle' } })
    expect(penguin.get('.foot-a').findAll('.foot, .toe')).toHaveLength(2)
    expect(penguin.get('.foot-b').findAll('.foot, .toe')).toHaveLength(2)
    // peek 要从右边探头，遮眼的那只翅得和眼睛在同一张画里
    const peek = mount(CodexHudSprite, { props: { state: state({ skin: 'penguin' }), idle: true, move: 'peek' } })
    expect(peek.findAll('.eyes')).toHaveLength(1)
    expect(peek.findAll('.flip-r')).toHaveLength(1)
    // 打盹蜗牛身子要退得进壳：壳与身子各有自己一层，一个压一个缩
    expect(mountSkin('snail').findAll('.mv-body, .mv-shell')).toHaveLength(2)
  })

  it('招牌动作只交出一个 class，时长由动作名从同一张表里取', () => {
    for (const mv of ['bow', 'fold', 'flap', 'stretch', 'tangle', 'tuck', 'hop', 'waddle', 'peek', 'doze'] as CodexHudMove[]) {
      const wrapper = mount(CodexHudSprite, { props: { state: state(), idle: true, move: mv } })
      expect(wrapper.get('.sprite').classes()).toContain(`mv-${mv}`)
      expect(wrapper.get('.sprite').attributes('style')).toContain(`--mv-dur: ${HUD_MOVE_MS[mv]}ms`)
    }
    const still = mount(CodexHudSprite, { props: { state: state(), idle: true } })
    expect(still.get('.sprite').attributes('style')).toContain('--mv-dur: 0ms')
    expect(still.get('.sprite').classes().some((c) => c.startsWith('mv-'))).toBe(false)
  })

  it('待机微动看 idle，交互触发看 react，两个闸门各自独立', () => {
    const preview = mount(CodexHudSprite, { props: { state: state(), expanded: true, idle: true } })
    expect(preview.get('.sprite').classes()).toContain('idle')
    expect(preview.get('.sprite').classes()).not.toContain('react')
    const desktop = mount(CodexHudSprite, {
      props: { state: state(), expanded: true, idle: true, react: true },
    })
    expect(desktop.get('.sprite').classes()).toEqual(expect.arrayContaining(['idle', 'react', 'expanded']))
  })
})

describe('挂件状态', () => {
  it('默认收起：只画角色，额度签点击后才出现', () => {
    const wrapper = mountSkin('bunny')
    expect(wrapper.get('.sprite').classes()).not.toContain('expanded')
    expect(wrapper.find('.tag').exists()).toBe(false)
    expect(wrapper.find('.hud-row1').exists()).toBe(false)
    expect(wrapper.find('.char').exists()).toBe(true)
    expect(wrapper.text()).toBe('')
  })

  it('展开后签显示主次额度与用量汇总，不写「今日」', () => {
    const wrapper = mountExpanded('bunny')
    expect(wrapper.get('.sprite').classes()).toContain('expanded')
    expect(wrapper.get('.hud-row1').text()).toBe('5h68%w42%')
    expect(wrapper.get('.hud-row2').text()).toBe('194.2万tok')
    expect(wrapper.get('.est').text()).toBe('≈$12.34')
    expect(wrapper.find('.prompt').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('今日')
    expect(wrapper.text()).not.toContain('Codex')
  })

  it('低额度只换主载体与提示符，次额度照常显示', () => {
    const wrapper = mountExpanded('bunny', {
      primary: { label: '5h', percentage: 9 },
      severe: true,
    })
    expect(wrapper.get('.sprite').classes()).toContain('low')
    expect(wrapper.get('.prompt').text()).toBe('!')
    expect(wrapper.get('.prompt').classes()).toContain('danger')
    expect(wrapper.findAll('.ear-fill.week')).toHaveLength(1)
  })

  it('刷新失败有缓存时保留数据，用 warning 提示符', () => {
    const wrapper = mountExpanded('bunny', { stale: true })
    expect(wrapper.get('.prompt').text()).toBe('!')
    expect(wrapper.get('.prompt').classes()).toContain('warn')
    expect(wrapper.get('.v').text()).toBe('68%')
    expect(wrapper.get('.status-text').text()).toBe('刷新失败 · 缓存')
    expect(wrapper.get('.status-text').attributes('title')).toContain('≈$12.34')
  })

  it('额度耗尽时收起态仍有告警，展开后直接说明原因', async () => {
    const wrapper = mountSkin('snail', {
      primary: { label: '5h', percentage: 0 }, severe: true,
    })
    expect(wrapper.get('.status-mark').attributes('title')).toBe('额度已用尽')
    expect(wrapper.get('.status-mark').classes()).toContain('danger')
    await wrapper.setProps({ expanded: true })
    expect(wrapper.find('.status-mark').exists()).toBe(false)
    expect(wrapper.get('.status-text').text()).toBe('额度已用尽')
    expect(wrapper.get('.v').text()).toBe('0%')
  })

  it('刷新恢复后撤掉异常提示并恢复金额；固定角标独立保留', async () => {
    const wrapper = mount(CodexHudSprite, {
      props: { state: state({ stale: true }), pinned: true, expanded: true },
    })
    expect(wrapper.find('.pin-mark').exists()).toBe(true)
    expect(wrapper.get('.status-text').text()).toBe('刷新失败 · 缓存')
    await wrapper.setProps({ state: state() })
    expect(wrapper.find('.status-text').exists()).toBe(false)
    expect(wrapper.find('.prompt').exists()).toBe(false)
    expect(wrapper.get('.est').text()).toBe('≈$12.34')
    expect(wrapper.find('.pin-mark').exists()).toBe(true)
  })

  it('周额度用尽造成不可用时不把仍有余额的主额度写成耗尽', () => {
    const wrapper = mountExpanded('bunny', { severe: true })
    expect(wrapper.get('.v').text()).toBe('68%')
    expect(wrapper.get('.status-text').text()).toBe('额度暂不可用')
  })

  it('空态画虚线剪影并显示占位文案，今日用量照常保留', () => {
    const wrapper = mountExpanded('snail', {
      primary: null,
      secondary: null,
      placeholder: '暂无额度',
    })
    expect(wrapper.get('.sprite').classes()).toContain('empty')
    expect(wrapper.get('.placeholder').text()).toBe('暂无额度')
    expect(wrapper.get('.hud-row2').text()).toContain('194.2万')
  })

  it('获取失败提示符用 warning，低额度仍优先 danger', () => {
    const failed = mountExpanded('penguin', {
      primary: null,
      placeholder: '额度获取失败',
      placeholderAlert: true,
    })
    expect(failed.get('.prompt').text()).toBe('!')
    expect(failed.get('.prompt').classes()).toContain('warn')

    const both = mountExpanded('penguin', {
      primary: { label: '5h', percentage: 4 },
      severe: true,
      stale: true,
    })
    expect(both.get('.prompt').classes()).toContain('danger')
  })

  it('未扫描用量只留 —，但仍带 tok 单位；金额未定价写明', () => {
    expect(mountExpanded('bunny', { today: null }).get('.hud-row2').text()).toBe('—tok')
    const unpriced = mountExpanded('bunny', { today: { tokens: 0, costUsd: null } })
    expect(unpriced.get('.est').text()).toBe('未定价')
    expect(mountExpanded('bunny', { today: null }).get('.est').text()).toBe('未定价')
  })

  it('Credits 不限额显示 ∞', () => {
    const wrapper = mountExpanded('snail', {
      primary: { label: 'Credits', percentage: 100, unlimited: true },
      secondary: null,
    })
    expect(wrapper.get('.v').text()).toBe('∞')
  })
})
