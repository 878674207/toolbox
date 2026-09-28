/* 顶栏全局搜索：统一入口，按输入内容智能分发
   - 便签名称/内容 → 复制内容到剪贴板
   - 纯数字（10-13 位）→ 跳转时间戳转换并填入
   - JSON 文本 → 跳转 JSON 格式化并填入
   - 工具名 → 打开对应工具
   - 其他文字 → 搜索并启动本机应用（开始菜单索引，Rust 提供） */
(function () {
  'use strict';

  window.addEventListener('DOMContentLoaded', () => {
    const input = document.querySelector('.js-globalsearch');
    const panel = document.querySelector('.js-gs-panel');
    if (!input || !panel) return;

    let items = [];
    let selected = 0;
    let appTimer = null;
    let fbTimer = null;

    function el(tag, cls, text) {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    /* 打开第 i 个注册工具（其点击回调会同时收起设置面板） */
    function openTool(i) {
      const nav = document.querySelectorAll('#tool-nav .nav-item');
      if (nav[i]) nav[i].click();
    }

    /* 跳转到工具并把内容填进其输入框（触发 input 事件驱动实时逻辑） */
    function gotoTool(i, selector, value) {
      openTool(i);
      const target = document.querySelectorAll('#tool-main .tool-panel')[i];
      if (!target) return;
      const field = target.querySelector(selector);
      if (!field) return;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function feedback(msg) {
      panel.textContent = '';
      panel.appendChild(el('div', 'gs-feedback', '✓ ' + msg));
      panel.hidden = false;
      clearTimeout(fbTimer);
      fbTimer = setTimeout(hide, 1400);
    }

    function hide() {
      panel.hidden = true;
      items = [];
      selected = 0;
    }

    function paint() {
      panel.textContent = '';
      if (!items.length) { hide(); return; }
      items.forEach((it, i) => {
        const row = el('div', 'gs-item' + (i === selected ? ' selected' : ''));
        row.append(el('span', 'gs-icon gs-icon-' + it.type, it.icon));
        const main = el('div', 'gs-main');
        main.append(el('div', 'gs-title', it.title));
        if (it.subtitle) main.append(el('div', 'gs-sub', it.subtitle));
        row.append(main, el('span', 'gs-type', it.typeLabel));
        row.addEventListener('click', () => run(i));
        row.addEventListener('mousemove', () => {
          if (selected !== i) { selected = i; repaintSelection(); }
        });
        panel.appendChild(row);
      });
      panel.hidden = false;
      const sel = panel.children[selected];
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    }

    function repaintSelection() {
      Array.from(panel.children).forEach((c, i) => c.classList.toggle('selected', i === selected));
    }

    function run(i) {
      const it = items[i];
      if (!it) return;
      it.action();
    }

    /* ---- 本地候选构建 ---- */
    function buildItems(q) {
      const raw = q.trim();
      const ql = raw.toLowerCase();
      const out = [];

      // 便签：名称或内容包含关键词
      let notes = [];
      try { notes = JSON.parse(localStorage.getItem('toolbox.notes')) || []; } catch (e) { /* ignore */ }
      notes.forEach(n => {
        if (!ql || n.name.toLowerCase().includes(ql) || n.content.toLowerCase().includes(ql)) {
          out.push({
            type: 'note', icon: '📝', typeLabel: '便签 · 回车粘贴',
            title: n.name, subtitle: n.content,
            action: () => {
              tauriInvoke('paste_to_previous', { text: n.content })
                .then(() => feedback(`已把「${n.name}」粘贴到之前的窗口`))
                .catch(err => feedback('粘贴失败：' + (err.message || err) + '，内容已在剪贴板'));
            },
          });
        }
      });

      // 时间戳：纯数字 10-13 位
      if (/^\d{10,13}$/.test(raw)) {
        out.push({
          type: 'ts', icon: '⏱', typeLabel: '时间戳',
          title: `转换时间戳 ${raw}`, subtitle: '打开时间戳转换并自动填入',
          action: () => gotoTool(1, '.js-ts-in', raw),
        });
      }

      // JSON：以 { 或 [ 开头且可解析
      if (/^\s*[\[{]/.test(q)) {
        let ok = false;
        try { parseLenient(q); ok = true; } catch (e) { /* ignore */ }
        if (ok) {
          out.push({
            type: 'json', icon: '{}', typeLabel: 'JSON',
            title: '格式化这段 JSON', subtitle: q.trim().slice(0, 80),
            action: () => gotoTool(2, '.js-input', q),
          });
        }
      }

      // 工具名
      __registry.forEach((t, i) => {
        if (t.name.toLowerCase().includes(ql)) {
          out.push({
            type: 'tool', icon: t.icon, typeLabel: '工具',
            title: t.name, subtitle: '打开该工具',
            action: () => openTool(i),
          });
        }
      });

      return out;
    }

    /* ---- 应用搜索（Rust 提供开始菜单索引，250ms 防抖异步追加） ---- */
    function loadApps(q) {
      clearTimeout(appTimer);
      appTimer = setTimeout(() => {
        tauriInvoke('search_apps', { query: q })
          .then(apps => {
            if (q.trim() !== input.value.trim()) return; // 输入已变化，丢弃过期结果
            const before = items.length;
            items = items.filter(it => it.type !== 'app');
            (apps || []).forEach(a => {
              const initials = a.name.trim().slice(0, 2);
              items.push({
                type: 'app', icon: initials, typeLabel: '应用 · 回车启动',
                title: a.name, subtitle: '启动本机应用',
                action: () => {
                  tauriInvoke('launch_app', { path: a.path })
                    .then(() => feedback(`已启动「${a.name}」`))
                    .catch(err => feedback('启动失败：' + (err.message || err)));
                },
              });
            });
            if (items.length !== before) { selected = Math.min(selected, items.length - 1); paint(); }
          })
          .catch(() => {});
      }, 250);
    }

    input.addEventListener('input', () => {
      const q = input.value;
      const ql = q.trim();
      selected = 0;
      if (!ql) { hide(); return; }
      items = buildItems(q);
      paint();
      if (ql.length >= 2) loadApps(q);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (panel.hidden) return; if (items.length) { selected = (selected + 1) % items.length; repaintSelection(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (panel.hidden) return; if (items.length) { selected = (selected - 1 + items.length) % items.length; repaintSelection(); } }
      else if (e.key === 'Enter') {
        e.preventDefault();
        // 面板被收起时（如窗口重新唤起后残留输入），按当前输入重建结果再执行
        if (panel.hidden) {
          const q = input.value;
          if (!q.trim()) return;
          items = buildItems(q);
          selected = 0;
        }
        run(selected);
      }
      else if (e.key === 'Escape') { hide(); input.blur(); }
    });

    document.addEventListener('click', e => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== input) hide();
    });

    /* 全局 Ctrl+K 聚焦搜索框 */
    window.addEventListener('keydown', e => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });

    /* 快捷键唤起窗口时：清空上次输入、收起旧结果、聚焦搜索框（每次唤起都是新搜索） */
    window.__resetGlobalSearch = function () {
      input.value = '';
      hide();
      input.focus();
    };
    try {
      if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {
        window.__TAURI__.event.listen('focus-search', () => window.__resetGlobalSearch());
      }
    } catch (err) { /* 非 Tauri 环境忽略 */ }
  });
})();
