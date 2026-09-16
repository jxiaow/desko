import re

with open('src/App.vue', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the style block
style_start = content.find('<style>')
style_end = content.find('</style>')

if style_start == -1 or style_end == -1:
    print("Style block not found")
    exit(1)

new_css = """<style>
:root {
  --sidebar-w: 220px;

  /* Surfaces — refined neutral */
  --bg: #f5f5f4;
  --panel-bg: #ffffff;
  --chrome-bg: #ffffff;

  /* Lines — subtle */
  --border: #e7e5e4;
  --border-strong: #d6d3d1;
  --hover: #f5f5f4;

  /* Text — warm dark */
  --text: #1c1917;
  --text-secondary: #57534e;
  --text-muted: #a8a29e;

  /* Accent — refined indigo */
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-soft: #eef2ff;
  --accent-light: #eef2ff;
  --accent-ring: rgba(79,70,229,0.15);

  /* Radii — modern */
  --radius: 8px;
  --radius-sm: 6px;
  --radius-lg: 10px;

  /* Shadows — refined */
  --shadow-xs: 0 0 0 1px rgba(0,0,0,0.03);
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-hover: 0 4px 16px rgba(0,0,0,0.1);
  --shadow-pop: 0 12px 40px rgba(0,0,0,0.12);

  /* Semantic */
  --danger: #ef4444;
  --danger-soft: #fef2f2;
  --success: #22c55e;

  /* Sidebar */
  --sidebar-bg: #fafaf9;
  --sidebar-border: var(--border);
  --sidebar-hover: #f0f0ee;
  --sidebar-active: var(--accent-soft);
  --sidebar-text: var(--text-secondary);
  --sidebar-text-active: var(--accent);
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', sans-serif;
  font-size: 13px;
  line-height: 1.5;
  letter-spacing: -0.01em;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
  height: 100vh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-feature-settings: 'kern' 1, 'liga' 1;
}

/* ─ Auth / Setup page ── */
.auth-page {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  background: var(--bg);
}

.auth-card {
  background: var(--panel-bg);
  border-radius: var(--radius-lg);
  padding: 40px 36px;
  width: 380px;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border);
}

.auth-logo {
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, var(--accent), #818cf8);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  margin: 0 auto 18px;
  box-shadow: 0 4px 12px rgba(79,70,229,0.2);
}

.auth-logo svg {
  width: 24px;
  height: 24px;
}

.auth-title {
  text-align: center;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-bottom: 4px;
}

.auth-subtitle {
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 24px;
}

.auth-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  outline: none;
  transition: all 0.15s;
  background: var(--bg);
  font-family: inherit;
}

.auth-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
  background: #fff;
}

.auth-btn {
  width: 100%;
  padding: 10px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  margin-top: 14px;
  transition: all 0.15s;
  font-family: inherit;
}

.auth-btn:hover { background: var(--accent-hover); }

.auth-error {
  color: var(--danger);
  font-size: 12px;
  margin-top: 10px;
  text-align: center;
}

.auth-tip {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 12px;
  text-align: center;
  line-height: 1.5;
}

/* ── Unlock page ── */
.unlock-page {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  background: linear-gradient(160deg, #fafaf9 0%, #f5f5f4 40%, #f0f0ee 100%);
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
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, rgba(79,70,229,0.06) 0%, transparent 70%);
  top: -10%;
  right: -5%;
  animation: unlock-drift-1 18s ease-in-out infinite;
}

.unlock-orb-2 {
  width: 350px;
  height: 350px;
  background: radial-gradient(circle, rgba(129,140,248,0.05) 0%, transparent 70%);
  bottom: -10%;
  left: -5%;
  animation: unlock-drift-2 22s ease-in-out infinite;
}

.unlock-orb-3 {
  width: 250px;
  height: 250px;
  background: radial-gradient(circle, rgba(79,70,229,0.04) 0%, transparent 70%);
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
  width: 380px;
  text-align: center;
  animation: unlock-content-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes unlock-content-in {
  from { opacity: 0; transform: translateY(16px); }
}

.unlock-logo {
  margin-bottom: 16px;
}

.unlock-logo-svg {
  width: 24px;
  height: 24px;
  color: var(--accent);
  opacity: 0.5;
}

.unlock-quote-area {
  position: relative;
  padding: 0 16px;
  margin-bottom: 20px;
}

.unlock-quote-mark {
  position: absolute;
  top: -8px;
  left: 0;
  font-size: 40px;
  font-weight: 300;
  color: rgba(79,70,229,0.12);
  line-height: 1;
  font-family: Georgia, 'Times New Roman', serif;
}

.unlock-quote-text {
  font-size: 19px;
  font-weight: 500;
  line-height: 1.6;
  letter-spacing: 0.01em;
  color: var(--text);
  margin: 0;
  animation: quote-fade-in 0.5s ease both;
}

@keyframes quote-fade-in {
  from { opacity: 0; transform: translateY(6px); }
}

.unlock-quote-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--panel-bg);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 20px;
}

.unlock-quote-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
  transform: rotate(180deg);
}

.unlock-quote-btn:active {
  transform: rotate(180deg) scale(0.9);
}

.unlock-divider {
  width: 32px;
  height: 1px;
  background: var(--border);
  margin: 0 auto 20px;
}

.unlock-input-area {
  animation: unlock-stagger 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.15s both;
}

.unlock-field {
  position: relative;
  width: 100%;
  margin-bottom: 10px;
}

.unlock-field-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  pointer-events: none;
  transition: color 0.2s;
}

.unlock-field:focus-within .unlock-field-icon {
  color: var(--accent);
}

.unlock-input {
  width: 100%;
  padding: 10px 12px 10px 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 400;
  outline: none;
  transition: all 0.15s;
  background: rgba(255,255,255,0.8);
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
  background: #fff;
}

.unlock-btn {
  width: 100%;
  padding: 10px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.unlock-btn:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(79,70,229,0.15);
}

.unlock-btn:active {
  transform: translateY(0);
}

.unlock-error {
  color: var(--danger);
  font-size: 12px;
  font-weight: 400;
  margin-bottom: 10px;
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

/* App layout */
.app-layout { display: flex; flex: 1; overflow: hidden; }

/* Sidebar */
.sidebar {
  width: var(--sidebar-w);
  background: var(--sidebar-bg);
  border-right: 1px solid var(--sidebar-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
  transition: width 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.sidebar.collapsed {
  width: 48px;
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

.nav-item {
  display: flex;
  align-items: center;
  padding: 7px 12px;
  margin: 1px 6px;
  border-radius: var(--radius-sm);
  color: var(--sidebar-text);
  cursor: pointer;
  transition: all 0.12s;
  font-size: 13px;
  font-weight: 500;
  gap: 10px;
  white-space: nowrap;
}

.nav-item:hover {
  background: var(--sidebar-hover);
  color: var(--text);
}

.nav-item.active {
  background: var(--sidebar-active);
  color: var(--sidebar-text-active);
  font-weight: 600;
}

.sidebar.collapsed .nav-item {
  margin: 1px 4px;
  padding: 9px 0;
  justify-content: center;
}

.nav-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  flex-shrink: 0;
}

.nav-icon svg {
  width: 16px;
  height: 16px;
}

.nav-text {
  overflow: hidden;
  transition: opacity 0.15s;
}

.sidebar.collapsed .nav-text {
  display: none;
}

.sidebar-footer {
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: center;
}

.version-tag {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.7;
}

.sidebar.collapsed .version-tag {
  display: none;
}

.sidebar.collapsed .sidebar-footer {
  padding: 4px 0;
}

/* Main area */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

.main-header {
  height: 44px;
  background: var(--chrome-bg);
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.header-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}

.header-actions {
  display: flex;
  gap: 4px;
}

/* Content */
.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.content-inner {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

/* Toolbar */
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  align-items: center;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.search-box {
  flex: 1;
  max-width: 440px;
  min-width: 160px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0 10px;
  height: 34px;
  transition: all 0.15s;
}

.search-box:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.search-box input {
  flex: 1;
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  outline: none;
  font-family: inherit;
  color: var(--text);
  height: 100%;
}

.search-box input::placeholder {
  color: var(--text-muted);
}

.search-icon {
  color: var(--text-muted);
  font-size: 14px;
}

.search-icon svg {
  width: 14px;
  height: 14px;
}

.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 50%;
  padding: 0;
  flex-shrink: 0;
  transition: all 0.12s;
}

.search-clear:hover {
  background: var(--hover);
  color: var(--text-secondary);
}

.btn-primary {
  padding: 0 14px;
  height: 34px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: inherit;
  white-space: nowrap;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-primary:active {
  transform: scale(0.97);
}

/* Tabs */
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-bottom: 14px;
  max-height: 36px;
  overflow: hidden;
  transition: max-height 0.2s ease;
  align-items: center;
}

.tabs.expanded {
  max-height: 200px;
}

.tab {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 4px;
  white-space: nowrap;
}

.tab:hover {
  color: var(--text-secondary);
  background: var(--hover);
}

.tab:active {
  transform: scale(0.97);
}

.tab.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.tab-count {
  display: inline-block;
  background: var(--hover);
  color: var(--text-muted);
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  margin-left: 3px;
  font-weight: 600;
  line-height: 14px;
}

.tab.active .tab-count {
  background: rgba(79,70,229,0.1);
  color: var(--accent);
}

.tabs-toggle {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s;
  font-family: inherit;
}

.tabs-toggle:hover {
  color: var(--text-secondary);
  border-color: var(--border-strong);
  background: var(--hover);
}

/* Entry cards */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.entry-card {
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: all 0.15s ease;
  overflow: hidden;
  position: relative;
  box-shadow: var(--shadow-xs);
}

.entry-card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow);
  transform: translateY(-1px);
}

.entry-card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-ring);
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px 12px 8px;
  gap: 8px;
  border-bottom: 1px solid var(--border);
}

.card-header-main {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.card-header-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s;
}

.entry-card:hover .card-header-actions {
  opacity: 1;
}

.card-icon-btn {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
  color: var(--text-muted);
}

.card-icon-btn:hover {
  background: var(--hover);
  color: var(--text-secondary);
}

.card-icon-btn:active {
  transform: scale(0.9);
}

.card-icon-btn.danger:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

.card-avatar {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 12px;
  flex-shrink: 0;
}

.card-avatar.c0 { background: #eef2ff; color: #4f46e5; }
.card-avatar.c1 { background: #f0fdf4; color: #16a34a; }
.card-avatar.c2 { background: #4f46e5; color: #ffffff; }
.card-avatar.c3 { background: #fff7ed; color: #ea580c; }
.card-avatar.c4 { background: #fef2f2; color: #dc2626; }
.card-avatar.c5 { background: #eff6ff; color: #2563eb; }

.card-title-area {
  flex: 1;
  min-width: 0;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 2px;
}

.card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-category {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--hover);
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}

.card-url {
  font-size: 11px;
  color: var(--accent);
  text-decoration: none;
  cursor: pointer;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}

.card-url:hover {
  text-decoration: underline;
}

.card-body {
  padding: 0 12px 12px;
  cursor: pointer;
}

.card-info-row {
  display: flex;
  align-items: center;
  padding: 3px 0;
  gap: 5px;
}

.card-info-row + .card-info-row {
  border-top: 1px solid var(--border);
}

.card-info-label {
  font-size: 11px;
  color: var(--text-muted);
  width: 32px;
  flex-shrink: 0;
}

.card-action-spacer {
  width: 20px;
  flex-shrink: 0;
}

.card-info-value {
  font-size: 12px;
  color: var(--text);
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-info-value.masked {
  letter-spacing: 2px;
  color: var(--text-muted);
}

.card-action-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.card-action-btn:hover {
  background: var(--hover);
  color: var(--text-secondary);
}

.card-action-btn:active {
  transform: scale(0.9);
}

.card-action-btn.toggle {
  color: var(--accent);
}

.card-action-btn.toggle:hover {
  background: var(--accent-soft);
}

.card-notes {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin-top: 3px;
  padding-top: 5px;
  border-top: 1px solid var(--border);
}

.card-notes-icon::before {
  content: '';
  display: block;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-muted);
  margin-top: 5px;
  flex-shrink: 0;
}

.card-notes-text {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* Detail dialog */
.detail-dialog {
  width: 460px;
}

.detail-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail-header-left h3 {
  margin: 0 0 3px 0;
  font-size: 16px;
}

.detail-section {
  margin-bottom: 4px;
}

.detail-section + .detail-section {
  border-top: 1px solid var(--border);
  padding-top: 6px;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
}

.notes-row {
  align-items: flex-start;
}

.detail-icon {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.detail-label {
  font-size: 11px;
  color: var(--text-muted);
  width: 36px;
  flex-shrink: 0;
}

.detail-action-spacer {
  width: 24px;
  flex-shrink: 0;
}

.detail-value {
  flex: 1;
  font-size: 12px;
  color: var(--text);
  word-break: break-all;
  min-width: 0;
}

.detail-value.masked {
  letter-spacing: 2px;
  color: var(--text-muted);
}

.detail-link {
  color: var(--accent);
  cursor: pointer;
  text-decoration: none;
}

.detail-link:hover {
  text-decoration: underline;
}

.detail-notes-full {
  white-space: pre-wrap;
  line-height: 1.5;
}

.detail-action-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.detail-action-btn:hover {
  background: var(--hover);
  color: var(--text-secondary);
}

.detail-action-btn.toggle {
  color: var(--accent);
}

.detail-action-btn.toggle:hover {
  background: var(--accent-soft);
}

/* Empty state */
.empty-state {
  text-align: center;
  padding: 48px 20px;
  color: var(--text-muted);
}

.empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
  opacity: 0.4;
  margin-bottom: 14px;
}

.empty-icon svg {
  width: 24px;
  height: 24px;
}

.empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 3px;
}

.empty-desc {
  font-size: 12px;
  color: var(--text-muted);
}

/* Loading - Skeleton */
.loading {
  padding: 16px 0;
}

.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}

.skeleton-card {
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-header {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.skeleton-avatar {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  background: var(--hover);
  flex-shrink: 0;
}

.skeleton-title-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.skeleton-line {
  height: 8px;
  background: var(--hover);
  border-radius: 4px;
  width: 100%;
}

.skeleton-line.short { width: 55%; }
.skeleton-line.shorter { width: 35%; }

.skeleton-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Module placeholder */
.module-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}

.placeholder-icon {
  width: 64px;
  height: 64px;
  background: var(--panel-bg);
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  margin-bottom: 16px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border);
}

.placeholder-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}

.placeholder-desc {
  font-size: 12px;
  color: var(--text-muted);
}

/* Dialog transitions */
.dialog-enter-active,
.dialog-leave-active {
  transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-from .dialog,
.dialog-leave-to .dialog {
  transform: scale(0.96) translateY(8px);
}

/* Dialog */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.3);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: var(--panel-bg);
  border-radius: var(--radius);
  width: 500px;
  max-height: 85vh;
  overflow: hidden;
  box-shadow: var(--shadow-pop);
  display: flex;
  flex-direction: column;
  animation: dialog-in 0.15s ease both;
}

@keyframes dialog-in {
  from { opacity: 0; transform: scale(0.97) translateY(6px); }
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.dialog-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dialog-header-left svg {
  color: var(--text-secondary);
}

.dialog-logo {
  width: 22px;
  height: 22px;
  background: linear-gradient(135deg, var(--accent), #818cf8);
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.dialog-logo svg {
  width: 12px;
  height: 12px;
  color: #fff;
}

.dialog-header h3 {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  margin: 0;
}

.dialog-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 5px;
  cursor: pointer;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex-shrink: 0;
  transition: all 0.12s;
}

.dialog-close:hover {
  background: var(--hover);
  color: var(--text-secondary);
}

.dialog-close:active {
  transform: scale(0.9);
}

.dialog-body {
  padding: 16px 18px;
  overflow-y: auto;
  flex: 1;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.form-group {
  margin-bottom: 12px;
}

.form-group label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  outline: none;
  transition: all 0.15s;
  font-family: inherit;
  background: var(--bg);
}

.form-group input:focus,
.form-group textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
  background: #fff;
}

.form-group textarea {
  resize: vertical;
  min-height: 56px;
  font-family: inherit;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.form-row .form-group {
  margin-bottom: 0;
}

@media (max-width: 600px) {
  .form-row {
    grid-template-columns: 1fr;
  }
  .form-row .form-group {
    margin-bottom: 16px;
  }
}

/* Scrollbar styles */
::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 3px;
  transition: background 0.15s;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}

.dialog-body::-webkit-scrollbar {
  width: 4px;
}

.dialog-body::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 3px;
}

.dialog-body::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

.main-content::-webkit-scrollbar {
  width: 5px;
}

.main-content::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 3px;
}

.main-content::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}

.btn-secondary {
  padding: 0 12px;
  height: 34px;
  background: var(--panel-bg);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.btn-secondary:hover {
  background: var(--hover);
  border-color: var(--border-strong);
  color: var(--text);
}

.btn-secondary:active {
  transform: scale(0.97);
}

.btn-secondary.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: rgba(79,70,229,0.15);
}

/* Batch mode */
.batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--accent-soft);
  border: 1px solid rgba(79,70,229,0.12);
  border-radius: var(--radius-sm);
  margin-bottom: 14px;
}

.batch-info {
  font-size: 12px;
  color: var(--accent);
  font-weight: 600;
}

.batch-actions {
  display: flex;
  gap: 6px;
}

.batch-btn {
  padding: 5px 12px;
  border: 1px solid rgba(79,70,229,0.2);
  background: var(--panel-bg);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--accent);
  cursor: pointer;
  transition: all 0.12s;
  font-family: inherit;
  font-weight: 500;
}

.batch-btn:hover {
  background: var(--accent-soft);
  border-color: rgba(79,70,229,0.3);
}

.batch-btn:active {
  transform: scale(0.95);
}

.batch-btn.danger {
  color: var(--danger);
  border-color: rgba(239,68,68,0.2);
}

.batch-btn.danger:hover {
  background: var(--danger-soft);
  border-color: rgba(239,68,68,0.3);
}

.batch-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Card checkbox */
.card-checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 10;
}

.checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 2px solid var(--border);
  border-radius: 3px;
  background: var(--panel-bg);
  font-size: 9px;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
  transition: all 0.12s;
}

.checkbox.checked {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.entry-card.selected {
  border-color: var(--accent);
  background: var(--accent-light);
}

/* Settings */
.settings-section {
  margin-bottom: 14px;
}

.settings-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text);
}

.settings-title svg {
  width: 12px;
  height: 12px;
  color: var(--accent);
  flex-shrink: 0;
}

.settings-path {
  background: var(--hover);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: 11px;
  color: var(--text-secondary);
  word-break: break-all;
  margin-bottom: 8px;
  line-height: 1.5;
}

.settings-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.settings-divider {
  height: 1px;
  background: var(--border);
  margin: 14px 0;
}

.settings-about {
  text-align: center;
  color: var(--text-muted);
  font-size: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  margin-top: 8px;
}

/* Toast notification */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  z-index: 2000;
  box-shadow: var(--shadow-md);
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 360px;
}

.toast.success {
  background: #1c1917;
  color: #4ade80;
}

.toast.error {
  background: #1c1917;
  color: #f87171;
}

.toast.info {
  background: #1c1917;
  color: #818cf8;
}

.toast-icon {
  flex-shrink: 0;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(16px) scale(0.95);
}

/* Confirm dialog */
.confirm-dialog {
  width: 360px;
}

.confirm-dialog p {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.btn-danger {
  padding: 8px 16px;
  background: var(--danger);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s;
  font-family: inherit;
}

.btn-danger:hover {
  background: #dc2626;
}

/* Notes Layout */
.notes-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
  background: var(--bg);
}

/* Note List Panel */
.notes-list-panel {
  width: 250px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  flex-shrink: 0;
}

.notes-list-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.notes-list-header .search-box {
  flex: 1;
  height: 28px;
}

.notes-list-header .btn-primary {
  height: 28px;
  width: 28px;
  padding: 0;
  border-radius: 6px;
}

.notes-tabs {
  display: flex;
  gap: 2px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}

.notes-tabs::-webkit-scrollbar { display: none; }

.notes-tabs .tab {
  padding: 3px 7px;
  font-size: 11px;
  border-radius: 4px;
  white-space: nowrap;
}

.notes-list {
  flex: 1;
  overflow-y: auto;
  padding: 3px 0;
}

.notes-list::-webkit-scrollbar { width: 3px; }
.notes-list::-webkit-scrollbar-track { background: transparent; }
.notes-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

.note-list-item {
  padding: 8px 10px;
  margin: 0 5px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.1s ease;
}

.note-list-item:hover {
  background: var(--hover);
}

.note-list-item.active {
  background: var(--accent-soft);
}

.note-list-item.active .note-list-title {
  color: var(--accent);
}

.note-list-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}

.note-list-preview {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.note-list-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: var(--text-muted);
}

.note-list-cat {
  background: var(--hover);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 500;
}

.notes-empty, .notes-loading {
  padding: 32px 16px;
  text-align: center;
}

.notes-loading .skeleton-note {
  padding: 8px 10px;
  margin: 0 5px;
}

.notes-loading .skeleton-line {
  height: 7px;
  background: var(--hover);
  border-radius: 3px;
  margin-bottom: 5px;
}

.notes-loading .skeleton-line.short { width: 60%; }
.notes-loading .skeleton-line.shorter { width: 30%; }

/* Notes Editor Panel */
.notes-editor-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
  min-width: 0;
}

.notes-editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.notes-editor-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px 6px;
  border-bottom: 1px solid var(--border);
}

.notes-title-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  outline: none;
  font-family: inherit;
  padding: 3px 0;
}

.notes-title-input::placeholder {
  color: var(--text-muted);
  font-weight: 400;
}

.note-delete-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 5px;
  cursor: pointer;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.1s;
  opacity: 0.5;
}

.note-delete-btn:hover {
  background: var(--danger-soft);
  color: var(--danger);
  opacity: 1;
}

.notes-editor-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.notes-editor-empty .empty-icon {
  margin-bottom: 10px;
  opacity: 0.25;
}

.notes-editor-empty .empty-title {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 3px;
  color: var(--text-secondary);
}

.notes-editor-empty .empty-desc {
  font-size: 11px;
  color: var(--text-muted);
}
</style>"""

content = content[:style_start] + new_css + content[style_end + len('</style>'):]

with open('src/App.vue', 'w', encoding='utf-8') as f:
    f.write(content)

print("CSS redesign complete")
