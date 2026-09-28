/* 工具：JSON 格式化（宽松解析 + 可折叠树形视图 + 格式化/压缩/去注释） */
(function () {
  'use strict';

  const TYPE_CLASS = { string: 'jt-str', number: 'jt-num', boolean: 'jt-bool' };

  const DEMO = `{
  // 当前应用（行注释）
  "name": "toolbox",
  "version": "0.1.0",
  /* 功能列表（块注释） */
  "features": ["JSON 格式化", "压缩一行", "去注释", "树形视图",],
  "detail": {
    "runtime": "tauri",
    "ports": [8080, 9222,],
    "maintainer": null,
    "stars": 42,
  },
}`;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* 从错误信息中提取出错位置，换算为行列号 */
  function errInfo(err, text) {
    const msg = String((err && err.message) || err);
    const m = msg.match(/position (\d+)/i);
    if (m) {
      const lines = text.slice(0, +m[1]).split('\n');
      return `${msg}（第 ${lines.length} 行第 ${lines[lines.length - 1].length + 1} 列附近）`;
    }
    return msg;
  }

  registerTool({
    id: 'json',
    name: 'JSON 格式化',
    icon: '{}',
    mount(panel) {
      panel.innerHTML = `
        <div class="tool-header">
          <h2>JSON 格式化</h2>
          <p class="tool-desc">宽松解析：支持 // 与块注释、尾随逗号；树形视图可折叠并显示元素个数，悬停任意节点可 ✂ 从结果中移除（不影响输入的原始 JSON），「还原」可撤销全部裁剪。</p>
        </div>

        <div class="io-block">
          <div class="io-head">
            <span class="io-label">输入</span>
            <span class="io-meta js-status"></span>
            <button type="button" class="btn btn-ghost js-example">示例</button>
            <button type="button" class="btn btn-ghost js-clear">清空</button>
          </div>
          <textarea class="io-area mono js-input" rows="8" spellcheck="false"
            placeholder='粘贴 JSON 或带注释的 JSONC，如 { "a": 1 } // 注释'></textarea>
          <div class="action-row">
            <button type="button" class="btn js-pretty" title="格式化并写入输出">格式化</button>
            <button type="button" class="btn js-min" title="压缩为单行并写入输出">压缩一行</button>
            <button type="button" class="btn js-strip" title="仅去掉注释，保留原排版">去注释</button>
          </div>
        </div>

        <div class="io-block">
          <div class="io-head">
            <span class="io-label">输出</span>
            <span class="io-meta js-stat"></span>
            <button type="button" class="btn btn-ghost js-restore" title="放弃所有裁剪，还原为输入的原始 JSON">还原</button>
            <div class="seg">
              <button type="button" class="seg-btn active js-tab-tree">树形</button>
              <button type="button" class="seg-btn js-tab-text">文本</button>
            </div>
            <button type="button" class="btn btn-copy js-copy">复制</button>
          </div>
          <div class="json-tree js-tree" hidden></div>
          <textarea class="io-area mono js-output" rows="12" readonly hidden
            placeholder="格式化 / 压缩 / 去注释的结果…"></textarea>
        </div>`;

      const input = panel.querySelector('.js-input');
      const output = panel.querySelector('.js-output');
      const tree = panel.querySelector('.js-tree');
      const status = panel.querySelector('.js-status');
      const stat = panel.querySelector('.js-stat');
      const tabTree = panel.querySelector('.js-tab-tree');
      const tabText = panel.querySelector('.js-tab-text');

      let parsed = null;     // 最近一次成功解析的原始值（保持不变）
      let workValue = null;  // 裁剪工作副本（树与结果基于它）
      let resultText = '';   // 当前结果的格式化文本

      function setStatus(text, isErr) {
        status.textContent = text;
        status.classList.toggle('err', !!isErr);
      }

      function showTab(which) {
        const isTree = which === 'tree';
        tabTree.classList.toggle('active', isTree);
        tabText.classList.toggle('active', !isTree);
        tree.hidden = !isTree;
        output.hidden = isTree;
      }
      tabTree.addEventListener('click', () => showTab('tree'));
      tabText.addEventListener('click', () => showTab('text'));
      showTab('tree'); // 与默认激活的「树形」页签保持一致
      showEmpty('粘贴 JSON 后，此处显示树形结构');

      /* ---- 树形渲染：数组元素键名显示 [i]，对象显示 "key"；容器行可折叠并常显计数徽标 ---- */

      /* 深拷贝受影响链并从结果中移除 path 定位的节点（不影响输入的原始 JSON） */
      function removeAt(path) {
        if (workValue === null || path.length === 0) return;
        const copy = v => (Array.isArray(v) ? v.slice() : { ...v });
        workValue = copy(workValue);
        let cur = workValue;
        for (let i = 0; i < path.length - 1; i++) {
          const next = cur[path[i]];
          cur[path[i]] = copy(next);
          cur = cur[path[i]];
        }
        const last = path[path.length - 1];
        if (Array.isArray(cur)) cur.splice(last, 1); // 数组元素删除后索引自动前移
        else delete cur[last];
        afterWorkChange();
      }

      /* 行尾移除操作（hover 显示）：一键把该节点从结果中删掉 */
      function appendRemoveAction(line, path) {
        if (path.length === 0) return; // 根节点不可移除
        const actions = el('span', 'jt-actions');
        const btn = el('button', 'jt-trim', '✂ 移除');
        btn.type = 'button';
        btn.title = '从结果中移除该节点（不影响输入的原始 JSON）';
        btn.addEventListener('click', e => {
          e.stopPropagation();
          removeAt(path);
        });
        actions.appendChild(btn);
        line.appendChild(actions);
      }

      function afterWorkChange() {
        resultText = JSON.stringify(workValue, null, 2);
        output.value = resultText;
        renderTree(workValue);
        updateStat(workValue);
      }

      function updateStat(value) {
        const s = jsonStats(value);
        const root = Array.isArray(value)
          ? `数组（${value.length} 项）`
          : (value !== null && typeof value === 'object' ? `对象（${Object.keys(value).length} 键）` : typeof value);
        stat.textContent = `根: ${root} · 节点 ${s.nodes}（对象 ${s.objects} · 数组 ${s.arrays}）· 深度 ${s.depth + 1}`;
      }

      function buildNode(keyLabel, value, isIndex, path) {
        const node = el('div', 'jt-node');
        const line = el('div', 'jt-line');

        if (value !== null && typeof value === 'object') {
          const isArr = Array.isArray(value);
          const entries = isArr ? value.map((v, i) => [String(i), v]) : Object.entries(value);
          if (keyLabel !== null) {
            line.append(el('span', 'jt-arrow'), fmtKey(keyLabel, isIndex), el('span', 'jt-colon', ': '));
          } else {
            line.append(el('span', 'jt-arrow'));
          }
          line.append(el('span', 'jt-bracket', isArr ? '[' : '{'));
          if (entries.length === 0) {
            line.append(el('span', 'jt-bracket', isArr ? ']' : '}'));
            node.appendChild(line);
            return node;
          }
          line.append(
            el('span', 'jt-badge', isArr ? `${entries.length} 项` : `${entries.length} 键`),
            el('span', 'jt-bracket', isArr ? ']' : '}')
          );

          appendRemoveAction(line, path);

          const kids = el('div', 'jt-children');
          for (const [k, v] of entries) kids.appendChild(buildNode(k, v, isArr, path.concat(isArr ? +k : k)));
          node.append(line, kids);
          node.classList.add('jt-parent');
          line.addEventListener('click', () => node.classList.toggle('collapsed'));
          return node;
        }

        if (keyLabel !== null) {
          line.append(fmtKey(keyLabel, isIndex), el('span', 'jt-colon', ': '));
          appendRemoveAction(line, path);
        }
        const cls = value === null ? 'jt-null' : (TYPE_CLASS[typeof value] || 'jt-str');
        line.append(el('span', cls, JSON.stringify(value)));
        node.appendChild(line);
        return node;
      }

      function fmtKey(keyLabel, isIndex) {
        return isIndex ? el('span', 'jt-index', `[${keyLabel}]`) : el('span', 'jt-key', `"${keyLabel}"`);
      }

      /* 空态 / 失败态占位提示（容器保持与文本框一致的完整高度） */
      function showEmpty(msg) {
        tree.textContent = '';
        tree.appendChild(el('div', 'jt-empty', msg));
      }

      function renderTree(value) {
        tree.textContent = '';
        tree.appendChild(buildNode(null, value, false, []));
      }

      function parseAndUpdate() {
        const text = input.value;
        parsed = null;
        workValue = null;
        resultText = '';
        tree.textContent = '';
        output.value = '';
        stat.textContent = '';
        if (!text.trim()) { setStatus('', false); showEmpty('粘贴 JSON 后，此处显示树形结构'); return; }
        try {
          parsed = parseLenient(text);
        } catch (err) {
          setStatus(`✕ 解析失败：${errInfo(err, text)}`, true);
          showEmpty('无法解析，请检查输入');
          return;
        }
        workValue = parsed;
        setStatus('✓ 解析成功', false);
        afterWorkChange();
      }

      /* 输入防抖自动解析 */
      let timer = null;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(parseAndUpdate, 400);
      });

      /* 动作按钮 */
      function requireParsed() {
        if (!input.value.trim()) { setStatus('请先输入 JSON', false); return false; }
        if (parsed === null) { setStatus('✕ 当前输入无法解析，请先修正', true); return false; }
        return true;
      }
      panel.querySelector('.js-pretty').addEventListener('click', () => {
        if (!requireParsed()) return;
        output.value = JSON.stringify(parsed, null, 2);
        showTab('text');
      });
      panel.querySelector('.js-min').addEventListener('click', () => {
        if (!requireParsed()) return;
        output.value = JSON.stringify(parsed);
        showTab('text');
      });
      panel.querySelector('.js-strip').addEventListener('click', () => {
        if (!input.value.trim()) { setStatus('请先输入 JSON', false); return; }
        output.value = stripJsonComments(input.value);
        showTab('text');
      });

      panel.querySelector('.js-copy').addEventListener('click', e => {
        copyText(resultText, e.currentTarget);
      });
      panel.querySelector('.js-restore').addEventListener('click', () => {
        if (parsed === null) return;
        workValue = parsed;
        afterWorkChange();
      });
      panel.querySelector('.js-example').addEventListener('click', () => { input.value = DEMO; parseAndUpdate(); });
      panel.querySelector('.js-clear').addEventListener('click', () => { input.value = ''; parseAndUpdate(); input.focus(); });
    }
  });
})();
