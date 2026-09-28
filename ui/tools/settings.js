/* 工具：设置（全局快捷键、开机自启、窗口置顶、关闭行为） */
(function () {
  'use strict';

  const SC_KEY = 'toolbox.shortcut';
  const DEFAULT_SHORTCUT = 'Ctrl+Q'; // 与 Rust 侧 setup 注册的默认值保持一致

  /* e.code → 全局快捷键插件可解析的主键名（KeyX / DigitX / Space / F1 / Backquote …） */
  function codeToMain(code) {
    if (/^Key[A-Z]$/.test(code)) return code;          // KeyQ
    if (/^Digit\d$/.test(code)) return code;           // Digit1
    if (/^F\d{1,2}$/.test(code)) return code;          // F1..F24
    if (/^Numpad/.test(code)) return code;             // Numpad0..
    const named = ['Space', 'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight',
      'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'Backslash'];
    return named.includes(code) ? code : null;
  }

  /* 存储名（Alt+KeyQ）→ 展示名（Alt+Q） */
  function prettyShortcut(stored) {
    return stored
      .split('+')
      .map(part => {
        if (/^Key[A-Z]$/.test(part)) return part.slice(3);
        if (/^Digit(\d)$/.test(part)) return part.slice(5);
        if (part === 'Control') return 'Ctrl';
        return part;
      })
      .join('+');
  }

/* 设置：入口固定在侧边栏底部（不占用工具列表），面板挂在主区域末尾 */

/* 注册时机：由 app.js 启动时调用，传入主区域容器与「隐藏所有工具面板」的回调 */
window.__initSettingsEntry = function (mainEl, onHideAllTools) {
  const panel = document.createElement('section');
  panel.id = 'settings-panel';
  panel.className = 'tool-panel';
  panel.hidden = true;
  mainEl.appendChild(panel);
  const btn = document.getElementById('settings-toggle');

  function show() {
    if (onHideAllTools) onHideAllTools();
    panel.hidden = false;
    btn.classList.add('active');
  }
  window.__hideSettings = function () {
    panel.hidden = true;
    btn.classList.remove('active');
  };
  btn.addEventListener('click', show);

  buildSettingsUI(panel);
};

function buildSettingsUI(panel) {
      panel.innerHTML = `
        <div class="tool-header">
          <h2>设置</h2>
          <p class="tool-desc">配置全局快捷键与启动、窗口行为。所有设置立即生效并自动保存。</p>
        </div>

        <div class="card">
          <h3>全局快捷键</h3>
          <div class="setting-row">
            <span class="setting-label">唤起 / 隐藏窗口</span>
            <span class="sc-display js-sc-display">Alt+Q</span>
            <button type="button" class="btn js-record">修改</button>
          </div>
          <div class="hint js-sc-hint">按下组合键即可在任意界面唤起 / 隐藏工具箱（需包含 Ctrl / Alt / Shift 其中之一）</div>
        </div>

        <div class="card">
          <h3>启动与窗口</h3>
          <label class="setting-row">
            <span class="setting-label">开机自动启动</span>
            <input type="checkbox" class="js-autostart" />
          </label>
          <label class="setting-row">
            <span class="setting-label">窗口置顶（始终保持在其他窗口之上）</span>
            <input type="checkbox" class="js-topmost" />
          </label>
          <label class="setting-row">
            <span class="setting-label">点 × 隐藏到托盘（取消后点 × 直接退出）</span>
            <input type="checkbox" class="js-closetray" />
          </label>
        </div>`;

      const scDisplay = panel.querySelector('.js-sc-display');
      const scHint = panel.querySelector('.js-sc-hint');
      const recordBtn = panel.querySelector('.js-record');
      const autostartChk = panel.querySelector('.js-autostart');
      const topmostChk = panel.querySelector('.js-topmost');
      const closeTrayChk = panel.querySelector('.js-closetray');

      let recording = false;

      function storedShortcut() {
        return localStorage.getItem(SC_KEY) || DEFAULT_SHORTCUT;
      }

      function refreshShortcut() {
        scDisplay.textContent = prettyShortcut(storedShortcut());
      }

      function setHint(text, isErr) {
        scHint.textContent = text;
        scHint.classList.toggle('err', !!isErr);
      }

      function setRecording(on) {
        recording = on;
        recordBtn.textContent = on ? '取消 (Esc)' : '修改';
        if (on) {
          scDisplay.textContent = '请按下组合键…';
          scDisplay.classList.add('recording');
          setHint('按下想使用的新组合键（需包含 Ctrl / Alt / Shift 其中之一），Esc 取消', false);
        } else {
          scDisplay.classList.remove('recording');
          refreshShortcut();
          setHint('按下组合键即可在任意界面唤起 / 隐藏工具箱（需包含 Ctrl / Alt / Shift 其中之一）', false);
        }
      }

      recordBtn.addEventListener('click', () => setRecording(!recording));

      function onKeyDown(e) {
        if (!recording) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') { setRecording(false); return; }

        const mods = [];
        if (e.ctrlKey) mods.push('Control');
        if (e.altKey) mods.push('Alt');
        if (e.shiftKey) mods.push('Shift');
        if (e.metaKey) mods.push('Super');

        const main = codeToMain(e.code);
        if (!main) return; // 纯修饰键，等待主键
        if (mods.length === 0) {
          setHint('✕ 全局快捷键需要至少一个修饰键（Ctrl / Alt / Shift）', true);
          return;
        }

        const stored = [...mods, main].join('+');
        setHint('正在应用…', false);
        tauriInvoke('set_shortcut', { shortcut: stored })
          .then(() => {
            localStorage.setItem(SC_KEY, stored);
            setRecording(false);
            setHint(`✓ 已生效：${prettyShortcut(stored)}`, false);
          })
          .catch(err => {
            setRecording(false);
            setHint(`✕ 注册失败（可能与其他程序冲突）：${err && err.message || err}`, true);
          });
      }
      window.addEventListener('keydown', onKeyDown, true);

      /* ---- 开机自启 ---- */
      tauriInvoke('get_autostart').then(v => { autostartChk.checked = !!v; }).catch(() => {});
      autostartChk.addEventListener('change', () => {
        tauriInvoke('set_autostart', { enabled: autostartChk.checked })
          .catch(() => {
            autostartChk.checked = !autostartChk.checked; // 失败回滚
            setHint('✕ 开机自启设置失败', true);
          });
      });

      /* ---- 窗口置顶 ---- */
      topmostChk.checked = localStorage.getItem('toolbox.alwaysTop') === '1';
      topmostChk.addEventListener('change', () => {
        localStorage.setItem('toolbox.alwaysTop', topmostChk.checked ? '1' : '0');
        tauriInvoke('set_always_on_top', { enabled: topmostChk.checked });
      });

      /* ---- 关闭行为 ---- */
      closeTrayChk.checked = localStorage.getItem('toolbox.closeToTray') !== '0'; // 默认隐藏到托盘
      closeTrayChk.addEventListener('change', () => {
        localStorage.setItem('toolbox.closeToTray', closeTrayChk.checked ? '1' : '0');
        tauriInvoke('set_close_to_tray', { enabled: closeTrayChk.checked });
      });

      refreshShortcut();
    }
})();

