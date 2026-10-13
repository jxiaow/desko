<template>
  <div class="unlock-bg material-decoration" aria-hidden="true"></div>
  <div class="lock-aura material-decoration" aria-hidden="true">
    <i class="lock-aura-blob material-motion a"></i>
    <i class="lock-aura-blob material-motion b"></i>
    <i class="lock-aura-blob material-motion c"></i>
  </div>
  <div class="lock-grain material-decoration" aria-hidden="true"></div>
</template>

<style scoped>
/* ---------- 画布：中心偏上漫反射微光 ---------- */
.unlock-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: var(--bg-lock-wash);
}

/* ---------- 光场：三团超慢漂移的软斑，重绘圈在 contain 里 ---------- */
.lock-aura {
  position: absolute;
  inset: -18%;
  width: 136%;
  height: 136%;
  z-index: 1;
  overflow: hidden;
  contain: strict;
  pointer-events: none;
}

.lock-aura-blob {
  position: absolute;
  border-radius: 50%;
  will-change: transform;
  transform: translate3d(0, 0, 0);
}

/* 两团吃 accent 槽反推的透明度：切色盘锁页跟着换色相，深浅两档共用一条公式；
   第三团只做中性提亮，不抢 accent 的色相 */
.lock-aura-blob.a {
  width: min(50vw, 520px);
  height: min(50vw, 520px);
  top: 6%;
  left: 10%;
  background: var(--bg-lock-aura-primary);
  filter: blur(68px);
  animation: aura-a 28s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate;
}

.lock-aura-blob.b {
  width: min(44vw, 440px);
  height: min(44vw, 440px);
  right: 8%;
  bottom: 4%;
  background: var(--bg-lock-aura-secondary);
  filter: blur(60px);
  animation: aura-b 32s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate;
}

.lock-aura-blob.c {
  width: min(36vw, 360px);
  height: min(36vw, 360px);
  top: 38%;
  left: 44%;
  background: var(--bg-lock-aura-neutral);
  filter: blur(44px);
  animation: aura-c 24s cubic-bezier(0.4, 0, 0.2, 1) infinite alternate;
}

@keyframes aura-a {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to   { transform: translate3d(7%, 9%, 0) scale(1.08); }
}

@keyframes aura-b {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to   { transform: translate3d(-8%, -6%, 0) scale(1.06); }
}

@keyframes aura-c {
  from { transform: translate3d(0, 0, 0) scale(0.96); }
  to   { transform: translate3d(5%, -7%, 0) scale(1.04); }
}

/* ---------- 乳胶微噪波：一张静态贴图，不参与任何补间 ---------- */
.lock-grain {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background-image: var(--material-grain-image);
}

</style>
