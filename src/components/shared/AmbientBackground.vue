<template>
  <div class="unlock-bg material-decoration" aria-hidden="true"></div>
</template>

<style scoped>
/* 锁屏与工作画布共享光斑位置和尺寸，仅提高柔光强度。 */
.unlock-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: var(--material-lock-field);
  background-attachment: fixed;
}
</style>
