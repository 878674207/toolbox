/* 启动：渲染侧边栏与工具面板（工具注册见 ui/core.js 与 ui/tools/*） */

window.addEventListener('DOMContentLoaded', () => {
  const nav = document.getElementById('tool-nav');
  const main = document.getElementById('tool-main');
  const panels = [];

  __registry.forEach((tool, i) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'nav-item';
    const icon = document.createElement('span');
    icon.className = 'nav-icon';
    icon.textContent = tool.icon;
    const name = document.createElement('span');
    name.textContent = tool.name;
    item.append(icon, name);
    item.addEventListener('click', () => {
      if (window.__hideSettings) window.__hideSettings();
      activate(i);
    });
    nav.appendChild(item);

    const panel = document.createElement('section');
    panel.className = 'tool-panel';
    panel.hidden = true;
    main.appendChild(panel);
    panels.push({ panel, tool, mounted: false });
  });

  /* 解析 hash：#工具id[@参数]，参数透传给工具的 mount */
  const rawHash = window.location.hash.slice(1);
  const at = rawHash.indexOf('@');
  const hashId = at >= 0 ? rawHash.slice(0, at) : rawHash;
  const hashParam = at >= 0 ? rawHash.slice(at + 1) : '';

  function activate(i) {
    nav.querySelectorAll('.nav-item').forEach((el, j) => el.classList.toggle('active', i === j));
    panels.forEach((p, j) => { p.panel.hidden = j !== i; });
    if (!panels[i].mounted) {
      panels[i].tool.mount(panels[i].panel, panels[i].tool.id === hashId ? hashParam : undefined);
      panels[i].mounted = true;
    }
  }

  /* 设置入口固定在侧边栏底部，面板由 ui/tools/settings.js 创建 */
  if (window.__initSettingsEntry) {
    window.__initSettingsEntry(main, () => {
      nav.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      panels.forEach(p => { p.panel.hidden = true; });
    });
  }

  /* 支持 hash 深链定位工具，如 index.html#timestamp 或 #timestamp@Asia/Tokyo */
  const initial = __registry.findIndex(t => t.id === hashId);
  activate(initial >= 0 ? initial : 0);
});
