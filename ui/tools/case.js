/* 工具：英文字母大小写转换 */
(function () {
  'use strict';

  function cap(w) { return w.charAt(0).toUpperCase() + w.slice(1); }

  /* 把混合命名（camel/Pascal/snake/kebab/空格）拆成单词数组 */
  function splitWords(s) {
    return s
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean);
  }

  const transforms = [
    { label: '全大写', sample: 'HELLO WORLD', fn: s => s.toUpperCase() },
    { label: '全小写', sample: 'hello world', fn: s => s.toLowerCase() },
    { label: '首字母大写', sample: 'Hello World', fn: s => s.replace(/[A-Za-z]+/g, w => cap(w.toLowerCase())) },
    { label: '句首大写', sample: 'Hello world. Hi there.', fn: s => s.toLowerCase().replace(/(^\s*[a-z])|([.!?]\s+[a-z])/g, m => m.toUpperCase()) },
    { label: '小驼峰 camelCase', sample: 'helloWorld', fn: s => splitWords(s).map((w, i) => i ? cap(w.toLowerCase()) : w.toLowerCase()).join('') },
    { label: '大驼峰 PascalCase', sample: 'HelloWorld', fn: s => splitWords(s).map(w => cap(w.toLowerCase())).join('') },
    { label: '下划线 snake_case', sample: 'hello_world', fn: s => splitWords(s).map(w => w.toLowerCase()).join('_') },
    { label: '中划线 kebab-case', sample: 'hello-world', fn: s => splitWords(s).map(w => w.toLowerCase()).join('-') },
    { label: '常量 CONSTANT_CASE', sample: 'HELLO_WORLD', fn: s => splitWords(s).map(w => w.toUpperCase()).join('_') },
  ];

  registerTool({
    id: 'case-convert',
    name: '大小写转换',
    icon: 'Aa',
    mount(panel) {
      panel.innerHTML = `
        <div class="tool-header">
          <h2>大小写转换</h2>
          <p class="tool-desc">输入文本，选择转换风格，结果实时生成。</p>
        </div>
        <div class="chip-row"></div>
        <div class="io-block">
          <div class="io-head">
            <span class="io-label">输入</span>
            <span class="io-meta js-count"></span>
            <button type="button" class="btn btn-ghost js-clear">清空</button>
          </div>
          <textarea class="io-area js-input" rows="7" placeholder="在此输入或粘贴文本…" spellcheck="false"></textarea>
        </div>
        <div class="io-block">
          <div class="io-head">
            <span class="io-label">输出</span>
            <span class="io-meta js-hint"></span>
            <button type="button" class="btn btn-ghost js-swap" title="把输出内容放回输入框继续处理">⇅ 结果作为输入</button>
            <button type="button" class="btn btn-copy js-copy">复制</button>
          </div>
          <textarea class="io-area js-output" rows="7" readonly placeholder="转换结果…"></textarea>
        </div>`;

      const input = panel.querySelector('.js-input');
      const output = panel.querySelector('.js-output');
      const count = panel.querySelector('.js-count');
      const hint = panel.querySelector('.js-hint');
      const chipRow = panel.querySelector('.chip-row');
      let mode = transforms[0];

      transforms.forEach(t => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = t.label;
        chip.title = '示例：' + t.sample;
        chip.addEventListener('click', () => {
          mode = t;
          chipRow.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
          run();
        });
        if (t === mode) chip.classList.add('active');
        chipRow.appendChild(chip);
      });

      function run() {
        const v = input.value;
        output.value = v ? mode.fn(v) : '';
        hint.textContent = `示例：${mode.sample}`;
        const words = v.trim() ? v.trim().split(/\s+/).length : 0;
        const lines = v ? v.split('\n').length : 0;
        count.textContent = `${v.length} 字符 · ${words} 词 · ${lines} 行`;
      }

      input.addEventListener('input', run);
      panel.querySelector('.js-clear').addEventListener('click', () => { input.value = ''; run(); input.focus(); });
      panel.querySelector('.js-swap').addEventListener('click', () => { input.value = output.value; run(); input.focus(); });
      panel.querySelector('.js-copy').addEventListener('click', e => copyText(output.value, e.currentTarget));

      run();
    }
  });
})();
