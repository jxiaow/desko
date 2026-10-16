<template>
  <div class="unlock-bg material-decoration" aria-hidden="true"></div>
</template>

<style scoped>
/* 锁屏使用更舒展的静态柔光，与工作画布共享色相。 */
.unlock-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: var(--material-lock-field);
}
</style>
