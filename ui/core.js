/* 框架核心：必须先于所有工具模块加载（工具模块在加载时就会调用 registerTool） */

const __registry = [];

function registerTool(tool) {
  __registry.push(tool);
}

/* ---- 公共复制能力：优先 Clipboard API，失败回退 execCommand ---- */
function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
  return ok;
}

function copyText(text, btn) {
  if (!text) return;
  const done = () => flashCopied(btn);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => { if (legacyCopy(text)) done(); });
  } else if (legacyCopy(text)) {
    done();
  }
}

function flashCopied(btn) {
  if (!btn) return;
  if (!btn.__label) btn.__label = btn.textContent;
  btn.textContent = '✓ 已复制';
  btn.classList.add('copied');
  clearTimeout(btn.__timer);
  btn.__timer = setTimeout(() => {
    btn.textContent = btn.__label;
    btn.classList.remove('copied');
  }, 1200);
}

/* 创建一个复制按钮，getText 在点击时取值（适合内容会变化的场景） */
function copyButton(getText) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-copy';
  btn.textContent = '复制';
  btn.addEventListener('click', () => copyText(getText(), btn));
  return btn;
}

/* ---- Tauri IPC：非 Tauri 环境（如直接浏览器打开）下静默降级 ---- */
function tauriInvoke(cmd, args) {
  return new Promise((resolve, reject) => {
    try {
      const invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
      if (!invoke) return reject(new Error('tauri api unavailable'));
      invoke(cmd, args || {}).then(resolve, reject);
    } catch (e) { reject(e); }
  });
}

/* ---- 主题：默认跟随系统，手动切换后记忆选择（localStorage） ---- */
const THEME_KEY = 'toolbox.theme';

function applyTheme(theme) {
  if (theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
}

function activeTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function currentSystemTheme() {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch (e) { return 'dark'; }
}

function updateThemeButton() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.textContent = activeTheme() === 'light' ? '🌙 深色模式' : '☀️ 浅色模式';
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'light' || saved === 'dark' ? saved : currentSystemTheme());
  updateThemeButton();

  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      const next = activeTheme() === 'light' ? 'dark' : 'light';
      applyTheme(next);
      localStorage.setItem(THEME_KEY, next);
      updateThemeButton();
    });
  }

  /* 用户未手动选择时，跟随系统主题实时变化 */
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', e => {
      if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? 'light' : 'dark');
    });
  }
}

initTheme();

/* ---- 启动时把持久化的设置同步到 Rust 侧 ---- */
(function syncSettings() {
  try {
    const sc = localStorage.getItem('toolbox.shortcut');
    if (sc) tauriInvoke('set_shortcut', { shortcut: sc }).catch(() => {});
    if (localStorage.getItem('toolbox.alwaysTop') === '1') {
      tauriInvoke('set_always_on_top', { enabled: true }).catch(() => {});
    }
    if (localStorage.getItem('toolbox.closeToTray') === '0') {
      tauriInvoke('set_close_to_tray', { enabled: false }).catch(() => {});
    }
  } catch (e) { /* localStorage 不可用时忽略 */ }
})();
