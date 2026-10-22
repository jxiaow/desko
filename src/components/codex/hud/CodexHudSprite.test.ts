import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CodexHudSprite from './CodexHudSprite.vue'
import type { CodexHudSkin, CodexHudState } from '../../../utils/codexHud'

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

  it('角色画在 112×66 上，分层给出呼吸 / 触发 / 眼睛三层 transform', () => {
    for (const skin of ['bunny', 'penguin', 'snail'] as CodexHudSkin[]) {
      const wrapper = mountSkin(skin)
      expect(wrapper.get('.char').html()).toContain('viewBox="0 0 112 66"')
      expect(wrapper.findAll('.eyes')).toHaveLength(1)
      // 同一元素挂两条 transform 动画会互相覆盖，所以一层一个 <g>
      expect(wrapper.findAll('.figure')).toHaveLength(1)
      expect(wrapper.findAll('.act')).toHaveLength(1)
      expect(wrapper.get('.figure').find('.act').exists()).toBe(true)
    }
    const bunny = mountSkin('bunny')
    expect(bunny.findAll('.ear-l, .ear-r')).toHaveLength(2)
    expect(bunny.findAll('.ear-flick')).toHaveLength(2)
    expect(bunny.get('.ear-fill.primary').attributes('y')).toBe('12.32')
    expect(mountSkin('snail').findAll('.antennae')).toHaveLength(1)
  })

  it('巡游的落脚与张望各有自己一层，抬爪不把趾线留在原地', () => {
    const bunny = mount(CodexHudSprite, { props: { state: state(), idle: true, lift: 'a', looking: true } })
    expect(bunny.findAll('.paw-a, .paw-b')).toHaveLength(2)
    // 张望必须独立于摆耳那一层，否则两条 transform 互相覆盖
    expect(bunny.findAll('.ear-look')).toHaveLength(2)
    expect(bunny.get('.ear-l').find('.ear-look').exists()).toBe(true)
    expect(bunny.get('.sprite').classes()).toEqual(expect.arrayContaining(['lift-a', 'look']))
    const penguin = mount(CodexHudSprite, { props: { state: state({ skin: 'penguin' }), lift: 'b' } })
    expect(penguin.get('.foot-b').findAll('.foot, .toe')).toHaveLength(2)
    expect(penguin.get('.sprite').classes()).toContain('lift-b')
  })

  it('待机微动看 idle，交互触发看 react，两个闸门各自独立', () => {
    const preview = mount(CodexHudSprite, { props: { state: state(), expanded: true, idle: true } })
    expect(preview.get('.sprite').classes()).toContain('idle')
    expect(preview.get('.sprite').classes()).not.toContain('react')
    const desktop = mount(CodexHudSprite, {
      props: { state: state(), expanded: true, idle: true, react: true, poke: true },
    })
    expect(desktop.get('.sprite').classes()).toEqual(
      expect.arrayContaining(['idle', 'react', 'poke', 'expanded']),
    )
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
