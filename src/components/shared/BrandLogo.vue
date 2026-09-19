<script setup lang="ts">
/* 品牌标：全站唯一一份。
 *
 * 两处细节值得说明：
 * 1. 渐变色只能写在 style 里（stop-color: var(--brand-g1)）。作为 SVG 呈现属性
 *    用 var() 不生效，改主题颜色不会跟着动。
 * 2. 渐变 id 必须每个实例唯一。同屏出现两个 logo 时（侧栏 + 对话框），
 *    重复的 id 会让第二个静默套用第一个的渐变——不报错，只是颜色不对。
 */
import { getCurrentInstance } from 'vue'

const gid = `desko-brand-${getCurrentInstance()!.uid}`
</script>

<template>
  <svg class="brand-logo" viewBox="0 0 124 124" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient :id="gid" x1="32" y1="24" x2="95" y2="108" gradientUnits="userSpaceOnUse">
        <stop offset="0" style="stop-color: var(--brand-g1)" />
        <stop offset="0.48" style="stop-color: var(--brand-g2)" />
        <stop offset="1" style="stop-color: var(--brand-g3)" />
      </linearGradient>
    </defs>
    <path
      d="M94 35 L51 49 C47.8 50.1 46 52.4 46 56 L46 98 C33.7 91.0 26 77.9 26 63 C26 40.9 43.9 23 66 23 C73.5 23 80.2 24.8 85.9 28.1 L94 35 Z"
      :fill="`url(#${gid})`"
    />
    <path
      d="M97 40 L65 51.8 C63 52.5 62 54.0 62 56.2 L62 105.5 C62 107.8 63.8 109.2 66 108.4 L95 98 C97.0 97.3 98 95.8 98 93.6 L98 42.5 C98 41.2 97.7 40.5 97 40 Z"
      :fill="`url(#${gid})`"
    />
    <circle cx="75" cy="79" r="5" style="fill: var(--brand-knob)" />
  </svg>
</template>

<style scoped>
.brand-logo { display: block; width: 100%; height: 100%; }
</style>
