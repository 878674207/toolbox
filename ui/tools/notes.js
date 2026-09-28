/* 工具：便签（快速文本片段：录入名称 + 内容，输入名称回车即复制内容到剪贴板） */
(function () {
  'use strict';

  const KEY = 'toolbox.notes';

  function loadNotes() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function saveNotes(notes) {
    localStorage.setItem(KEY, JSON.stringify(notes));
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  registerTool({
    id: 'notes',
    name: '便签',
    icon: '📝',
    mount(panel) {
      panel.innerHTML = `
        <div class="tool-header">
          <h2>便签</h2>
          <p class="tool-desc">提前存好常用文本（账号密码、常用回复等）。在任意应用中唤起工具箱，输入名称回车即直接粘贴进之前的输入位置。数据仅保存在本机。</p>
        </div>

        <div class="io-block">
          <div class="io-head">
            <span class="io-label">快速复制</span>
            <span class="io-meta js-status"></span>
          </div>
          <input class="text-input mono js-quick" placeholder="输入便签名称后回车，直接粘贴到之前的窗口" spellcheck="false" />
        </div>

        <div class="io-block">
          <div class="io-head">
            <span class="io-label js-form-title">新增便签</span>
            <button type="button" class="btn btn-ghost js-cancel-edit" hidden>取消编辑</button>
          </div>
          <div class="note-form-row">
            <input class="text-input js-name" placeholder="名称，如 aa" spellcheck="false" />
          </div>
          <textarea class="io-area js-content" rows="3" placeholder="内容，如 Aa123456789" spellcheck="false"></textarea>
          <div class="action-row">
            <button type="button" class="btn js-save">保存</button>
          </div>
        </div>

        <div class="io-block">
          <div class="io-head">
            <span class="io-label">全部便签</span>
            <span class="io-meta js-count"></span>
            <button type="button" class="btn btn-ghost js-clearall">清空全部</button>
          </div>
          <div class="js-list"></div>
        </div>`;

      const quick = panel.querySelector('.js-quick');
      const status = panel.querySelector('.js-status');
      const formTitle = panel.querySelector('.js-form-title');
      const cancelEditBtn = panel.querySelector('.js-cancel-edit');
      const nameInput = panel.querySelector('.js-name');
      const contentInput = panel.querySelector('.js-content');
      const saveBtn = panel.querySelector('.js-save');
      const clearAllBtn = panel.querySelector('.js-clearall');
      const count = panel.querySelector('.js-count');
      const list = panel.querySelector('.js-list');

      let editingIndex = -1;

      function setStatus(text, isErr) {
        status.textContent = text;
        status.classList.toggle('err', !!isErr);
      }

      /* 匹配优先级：名称精确 > 名称前缀 > 名称/内容包含 */
      function findBest(query) {
        const f = query.toLowerCase();
        const notes = loadNotes();
        return notes.find(n => n.name.toLowerCase() === f)
          || notes.find(n => n.name.toLowerCase().startsWith(f))
          || notes.find(n => n.name.toLowerCase().includes(f) || n.content.toLowerCase().includes(f))
          || null;
      }

      function renderList(filter) {
        const notes = loadNotes();
        const f = (filter || '').trim().toLowerCase();
        const shown = notes
          .map((n, i) => ({ name: n.name, content: n.content, i }))
          .filter(n => !f || n.name.toLowerCase().includes(f) || n.content.toLowerCase().includes(f));

        list.textContent = '';
        if (!shown.length) {
          list.appendChild(el('div', 'note-empty', notes.length ? '没有匹配的便签' : '还没有便签，先在上方新增一个'));
          count.textContent = '0 条';
          return;
        }
        shown.forEach(n => {
          const row = el('div', 'note-row');
          const main = el('div', 'note-main');
          const name = el('div', 'note-name');
          name.textContent = n.name;
          const preview = el('div', 'note-preview');
          preview.textContent = n.content;
          preview.title = n.content;
          main.append(name, preview);

          const copyBtn = el('button', 'btn btn-sm', '复制');
          copyBtn.addEventListener('click', () => copyText(n.content, copyBtn));
          const editBtn = el('button', 'btn btn-ghost btn-sm', '编辑');
          editBtn.addEventListener('click', () => startEdit(n.i));
          const delBtn = el('button', 'btn btn-ghost btn-sm', '删除');
          delBtn.addEventListener('click', () => {
            const arr = loadNotes();
            arr.splice(n.i, 1);
            saveNotes(arr);
            if (editingIndex === n.i) resetForm();
            renderList(quick.value);
          });

          row.append(main, copyBtn, editBtn, delBtn);
          list.appendChild(row);
        });
        count.textContent = `${shown.length}/${notes.length} 条`;
      }

      function resetForm() {
        editingIndex = -1;
        nameInput.value = '';
        contentInput.value = '';
        formTitle.textContent = '新增便签';
        cancelEditBtn.hidden = true;
      }

      function startEdit(i) {
        const n = loadNotes()[i];
        if (!n) return;
        editingIndex = i;
        nameInput.value = n.name;
        contentInput.value = n.content;
        formTitle.textContent = '编辑便签';
        cancelEditBtn.hidden = false;
        setStatus('', false);
        nameInput.focus();
      }

      saveBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        const content = contentInput.value;
        if (!name || !content) { setStatus('✕ 名称和内容都不能为空', true); return; }
        const arr = loadNotes();
        if (editingIndex >= 0) arr[editingIndex] = { name, content };
        else arr.push({ name, content });
        saveNotes(arr);
        const wasEditing = editingIndex >= 0;
        resetForm();
        renderList(quick.value);
        setStatus(`✓ 已${wasEditing ? '更新' : '保存'}「${name}」`, false);
      });
      cancelEditBtn.addEventListener('click', () => { resetForm(); renderList(quick.value); });

      /* 快速粘贴：回车取最佳匹配，把内容直接粘贴到唤起前的窗口 */
      quick.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        const q = quick.value.trim();
        if (!q) return;
        const best = findBest(q);
        if (!best) { setStatus(`✕ 没有匹配「${q}」的便签`, true); return; }
        tauriInvoke('paste_to_previous', { text: best.content })
          .then(() => setStatus(`✓ 已将「${best.name}」粘贴到之前的窗口`, false))
          .catch(() => {
            copyText(best.content, null);
            setStatus(`✕ 粘贴失败，已复制「${best.name}」到剪贴板，可手动粘贴`, true);
          });
      });

      let clearArmed = false;
      clearAllBtn.addEventListener('click', () => {
        if (!clearArmed) {
          clearArmed = true;
          clearAllBtn.textContent = '再点一次确认清空';
          setTimeout(() => { clearArmed = false; clearAllBtn.textContent = '清空全部'; }, 2500);
          return;
        }
        clearArmed = false;
        clearAllBtn.textContent = '清空全部';
        saveNotes([]);
        resetForm();
        renderList(quick.value);
      });

      renderList('');
    }
  });
})();
