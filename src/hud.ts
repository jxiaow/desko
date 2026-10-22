import { createApp } from 'vue'
import './styles/global.css'
import './styles/workspace-themes.css'
import './styles/hud.css'
import CodexHudApp from './components/codex/hud/CodexHudApp.vue'

document.documentElement.setAttribute('data-layout', 'workspace')
createApp(CodexHudApp).mount('#app')
