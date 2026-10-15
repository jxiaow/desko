<template>
  <div class="unlock-bg material-decoration" aria-hidden="true"></div>
</template>

<style scoped>
/* 与工作画布同源的静态柔光；不使用循环动画、滤镜或预留 GPU 图层。 */
.unlock-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: var(--material-field);
}
</style>
