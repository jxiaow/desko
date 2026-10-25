import { describe, expect, it } from 'vitest'
import { hiddenCount, minusVisible, prune, unionVisible, visibleCount } from './selection'

const S = (...ids: string[]) => new Set(ids)

describe('selection scope', () => {
  describe('hiddenCount / visibleCount', () => {
    it('splits the selection into on-screen and off-screen parts', () => {
      const selected = S('a', 'b', 'c')
      expect(hiddenCount(selected, ['a'])).toBe(2)
      expect(visibleCount(selected, ['a'])).toBe(1)
    })
    it('counts everything as hidden when the filter shows nothing', () => {
      const selected = S('a', 'b')
      expect(hiddenCount(selected, [])).toBe(2)
      expect(visibleCount(selected, [])).toBe(0)
    })
    it('has nothing hidden when the selection is a subset of the visible rows', () => {
      const selected = S('a', 'b')
      expect(hiddenCount(selected, ['a', 'b', 'c'])).toBe(0)
      expect(visibleCount(selected, ['a', 'b', 'c'])).toBe(2)
    })
    it('is empty-safe and ignores visible rows that are not selected', () => {
      expect(hiddenCount(S(), ['a', 'b'])).toBe(0)
      expect(visibleCount(S(), ['a', 'b'])).toBe(0)
      expect(hiddenCount(S('a'), ['a', 'x', 'y'])).toBe(0)
    })
    it('never double-counts a repeated visible id', () => {
      expect(visibleCount(S('a'), ['a', 'a'])).toBe(1)
    })
  })

  describe('unionVisible', () => {
    it('keeps the selection accumulated under another filter', () => {
      const merged = unionVisible(S('old1', 'old2'), ['new1', 'new2'])
      expect([...merged].sort()).toEqual(['new1', 'new2', 'old1', 'old2'])
    })
    it('is idempotent so a second 全选 does not grow the count', () => {
      const once = unionVisible(S('a'), ['a', 'b'])
      expect(unionVisible(once, ['a', 'b'])).toEqual(S('a', 'b'))
    })
    it('adds nothing when the filter shows no rows', () => {
      expect(unionVisible(S('a'), [])).toEqual(S('a'))
    })
    it('does not mutate the source set', () => {
      const source = S('a')
      unionVisible(source, ['b'])
      expect(source).toEqual(S('a'))
    })
  })

  describe('minusVisible', () => {
    it('drops only the on-screen part and leaves the off-screen selection alone', () => {
      const next = minusVisible(S('a', 'b', 'hidden'), ['a', 'b'])
      expect([...next]).toEqual(['hidden'])
    })
    it('is the exact inverse of unionVisible on the same rows', () => {
      const before = S('a')
      expect(minusVisible(unionVisible(before, ['a', 'b']), ['a', 'b'])).toEqual(S())
    })
    it('keeps everything when the filter shows nothing', () => {
      expect(minusVisible(S('a', 'b'), [])).toEqual(S('a', 'b'))
    })
  })

  describe('prune', () => {
    it('drops ids that no longer exist in the data source', () => {
      expect([...prune(S('a', 'gone'), ['a', 'b'])]).toEqual(['a'])
    })
    it('returns the same reference when nothing changed', () => {
      const selected = S('a', 'b')
      expect(prune(selected, ['a', 'b', 'c'])).toBe(selected)
    })
    it('empties the selection when every row is gone', () => {
      expect(prune(S('a'), [])).toEqual(S())
    })
    it('keeps an empty selection untouched', () => {
      const selected = S()
      expect(prune(selected, ['a'])).toBe(selected)
    })
  })
})
