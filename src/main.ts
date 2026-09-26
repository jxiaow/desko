import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import { setupGlobalTips } from './utils/tooltip'
import { primeAppearance, readTheme } from './services/theme'
import './styles/global.css'
import App from './App.vue'

async function bootstrap() {
  // 先把主题挂上再挂载：否则墨色主题会先闪一屏纸色
  primeAppearance(await readTheme())

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  setupGlobalTips()
  app.mount('#app')
}

void bootstrap()
