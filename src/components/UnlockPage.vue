<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useAuth } from '../composables/useAuth'

const emit = defineEmits<{ unlockComplete: [] }>()
const { unlock } = useAuth()

const unlockPwd = ref('')
const unlockErr = ref('')

const onUnlockSuccess = () => {
  emit('unlockComplete')
}

const quotes = [
  '生活不止眼前的苟且，还有诗和远方',
  '愿你出走半生，归来仍是少年',
  '人生没有白走的路，每一步都算数',
  '做你害怕做的事，恐惧就会消失',
  '慢慢来，比较快',
  '星光不问赶路人，时光不负有心人',
  '所有的努力，都是为了遇见更好的自己',
  '你若盛开，蝴蝶自来',
  '不积跬步，无以至千里',
  '心若向阳，无畏悲伤',
  '越努力，越幸运',
  '人生如逆旅，我亦是行人',
  '愿你被这个世界温柔以待',
  '每一个不曾起舞的日子，都是对生命的辜负',
  '且将新火试新茶，诗酒趁年华',
  '山重水复疑无路，柳暗花明又一村',
  '长风破浪会有时，直挂云帆济沧海',
  '路漫漫其修远兮，吾将上下而求索',
  '莫愁前路无知己，天下谁人不识君',
  '落红不是无情物，化作春泥更护花',
  '沉舟侧畔千帆过，病树前头万木春',
  '会当凌绝顶，一览众山小',
  '海内存知己，天涯若比邻',
  '采菊东篱下，悠然见南山',
  '人生得意须尽欢，莫使金樽空对月',
  '天生我材必有用，千金散尽还复来',
  '春蚕到死丝方尽，蜡炬成灰泪始干',
  '纸上得来终觉浅，绝知此事要躬行',
  '问渠那得清如许，为有源头活水来',
  '不识庐山真面目，只缘身在此山中',
  '竹外桃花三两枝，春江水暖鸭先知',
  '等闲识得东风面，万紫千红总是春',
  '接天莲叶无穷碧，映日荷花别样红',
  '欲穷千里目，更上一层楼',
  '野火烧不尽，春风吹又生',
  '随风潜入夜，润物细无声',
  '两个黄鹂鸣翠柳，一行白鹭上青天',
  '日出江花红胜火，春来江水绿如蓝',
  '春风得意马蹄疾，一日看尽长安花',
  '劝君更尽一杯酒，西出阳关无故人',
  '独在异乡为异客，每逢佳节倍思亲',
  '此情可待成追忆，只是当时已惘然',
  '身无彩凤双飞翼，心有灵犀一点通',
  '衣带渐宽终不悔，为伊消得人憔悴',
  '众里寻他千百度，蓦然回首，那人却在灯火阑珊处',
  '人生若只如初见，何事秋风悲画扇',
  '曾经沧海难为水，除却巫山不是云',
  '同是天涯沦落人，相逢何必曾相识',
  '出师未捷身先死，长使英雄泪满襟',
  '先天下之忧而忧，后天下之乐而乐',
  '老骥伏枥，志在千里',
  '少壮不努力，老大徒伤悲',
  '黑发不知勤学早，白首方悔读书迟',
  '宝剑锋从磨砺出，梅花香自苦寒来',
  '千磨万击还坚劲，任尔东西南北风',
  '粉骨碎身浑不怕，要留清白在人间',
  '不要人夸好颜色，只留清气满乾坤',
  '横看成岭侧成峰，远近高低各不同',
  '疏影横斜水清浅，暗香浮动月黄昏',
  '无可奈何花落去，似曾相识燕归来',
]

const quoteIndex = ref(Math.floor(Math.random() * quotes.length))
const currentQuote = ref(quotes[quoteIndex.value])
let quoteTimer: number | null = null

const rotateQuote = () => {
  quoteIndex.value = (quoteIndex.value + 1) % quotes.length
  currentQuote.value = quotes[quoteIndex.value]
}

const doUnlock = async () => {
  unlockErr.value = ''
  try {
    await unlock(unlockPwd.value, onUnlockSuccess)
  } catch (e: any) {
    unlockErr.value = '主密码错误，请重试'
  }
}

onMounted(() => {
  quoteTimer = window.setInterval(rotateQuote, 10000)
})

onUnmounted(() => {
  if (quoteTimer) clearInterval(quoteTimer)
})
</script>

<template>
  <div class="unlock-page">
    <div class="unlock-bg-orbs">
      <div class="unlock-orb unlock-orb-1"></div>
      <div class="unlock-orb unlock-orb-2"></div>
      <div class="unlock-orb unlock-orb-3"></div>
    </div>
    <div class="unlock-content">
      <div class="unlock-logo">
        <span class="unlock-logo-text">Desko</span>
      </div>
      <div class="unlock-quote-area">
        <span class="unlock-quote-mark">&ldquo;</span>
        <p class="unlock-quote-text" :key="quoteIndex">{{ currentQuote }}</p>
      </div>
      <div class="unlock-divider"></div>
      <div class="unlock-input-area">
        <div class="unlock-field">
          <svg class="unlock-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2.5"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <input
            class="unlock-input"
            type="password"
            v-model="unlockPwd"
            placeholder="输入密码解锁"
            @keyup.enter="doUnlock"
            autofocus
          />
        </div>
        <p v-if="unlockErr" class="unlock-error">{{ unlockErr }}</p>
        <button class="unlock-btn" @click="doUnlock">解锁</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.unlock-page {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  background: transparent;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

.unlock-bg-orbs {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.unlock-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  will-change: transform;
}

.unlock-orb-1 {
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(79,70,229,0.08) 0%, transparent 70%);
  top: -15%;
  right: -10%;
  animation: unlock-drift-1 18s ease-in-out infinite;
}

.unlock-orb-2 {
  width: 450px;
  height: 450px;
  background: radial-gradient(circle, rgba(129,140,248,0.06) 0%, transparent 70%);
  bottom: -15%;
  left: -10%;
  animation: unlock-drift-2 22s ease-in-out infinite;
}

.unlock-orb-3 {
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, rgba(79,70,229,0.05) 0%, transparent 70%);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  animation: unlock-drift-3 15s ease-in-out infinite;
}

@keyframes unlock-drift-1 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(-30px, 20px) scale(1.05); }
}

@keyframes unlock-drift-2 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(20px, -15px) scale(1.03); }
}

@keyframes unlock-drift-3 {
  0%, 100% { transform: translate(-50%, -50%) scale(1); }
  50% { transform: translate(-50%, -50%) translate(-15px, -15px) scale(0.95); }
}

.unlock-content {
  position: relative;
  z-index: 1;
  width: 300px;
  animation: unlock-content-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes unlock-content-in {
  from { opacity: 0; transform: translateY(16px); }
}

.unlock-logo {
  margin-bottom: 20px;
  display: flex;
  justify-content: center;
}

.unlock-logo-text {
  font-size: 32px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: -0.02em;
}

.unlock-quote-area {
  position: relative;
  padding: 0 20px;
  margin-bottom: 24px;
  min-height: 60px;
}

.unlock-quote-mark {
  position: absolute;
  top: -8px;
  left: 0;
  font-size: 48px;
  font-weight: 300;
  color: rgba(79,70,229,0.15);
  line-height: 1;
  font-family: Georgia, 'Times New Roman', serif;
}

.unlock-quote-text {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.6;
  letter-spacing: 0.01em;
  color: var(--text);
  margin: 0;
  text-align: center;
  animation: quote-fade-in 0.5s ease both;
}

@keyframes quote-fade-in {
  from { opacity: 0; transform: translateY(6px); }
}

.unlock-divider {
  width: 48px;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  margin: 0 auto 24px;
  border-radius: 1px;
}

.unlock-input-area {
  animation: unlock-stagger 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both;
}

.unlock-field {
  position: relative;
  width: 100%;
  margin-bottom: 12px;
}

.unlock-field-icon {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  pointer-events: none;
  transition: color 0.2s;
}

.unlock-field:focus-within .unlock-field-icon {
  color: var(--accent);
}

.unlock-input {
  width: 100%;
  padding: 12px 14px 12px 40px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 14px;
  font-weight: 400;
  outline: none;
  transition: all 0.15s;
  background: #fff;
  color: var(--text);
  font-family: inherit;
  -webkit-font-smoothing: antialiased;
}

.unlock-input::placeholder {
  color: var(--text-muted);
  font-weight: 400;
}

.unlock-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.unlock-btn {
  width: 100%;
  padding: 12px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  letter-spacing: 0.02em;
}

.unlock-btn:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(79,70,229,0.2);
}

.unlock-btn:active {
  transform: translateY(0);
}

.unlock-error {
  color: var(--danger);
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 12px;
  animation: unlock-shake 0.4s ease;
}

@keyframes unlock-stagger {
  from { opacity: 0; transform: translateY(10px); }
}

@keyframes unlock-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-5px); }
  40% { transform: translateX(5px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
}
</style>
