import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import { setupGlobalTips } from './utils/tooltip'
import { initializeAppearance } from './services/theme'
import { installModules } from './modules/runtime'
import './styles/global.css'
import './styles/workspace-themes.css'
import './styles/web.css'
import App from './App.vue'

async function bootstrap() {
  // 三端共用最新工作区骨架，手机由响应式样式切换为触控布局。
  document.documentElement.setAttribute('data-layout', 'workspace')
  // 先把主题挂上再挂载：否则墨色主题会先闪一屏纸色
  await initializeAppearance({ workspaceLayout: true })
  // 模块开关同理：挂载后才读到，侧栏和路由会闪一帧不该存在的东西
  await installModules()

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  // 首次导航就绪后再挂载，避免加载中的旧页面覆盖用户刚做的模块切换。
  await router.isReady()
  setupGlobalTips()
  app.mount('#app')
}

void bootstrap()
