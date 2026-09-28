/* CDP 自动化验证：连接 WebView2 远程调试端口(9222)，在真实页面里输入、点击、断言并截图。
   用法：node scripts/cdp_shot.js  （需先以 --remote-debugging-port=9222 启动应用） */
'use strict';
const fs = require('fs');
const path = require('path');

const OUTDIR = path.join(__dirname, '..');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || detail === undefined ? '' : `  ${detail}`}`);
}

async function main() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = list.find(t => t.type === 'page');
  if (!page) throw new Error('no page target on :9222');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const send = (method, params = {}) => new Promise(res => {
    const id = ++seq;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  async function evalJs(expression) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  }
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUTDIR, name), Buffer.from(r.result.data, 'base64'));
    console.log(`shot: ${name}`);
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* 刷新页面，保证从干净的初始状态开始（脚本可重复运行） */
  await send('Page.reload');
  await sleep(1000);

  console.log('hash:', await evalJs('location.hash'));

  /* 0. 主题切换：翻转、持久化、按钮文案、切回 */
  await evalJs(`(() => { localStorage.removeItem('toolbox.theme'); applyTheme(currentSystemTheme()); updateThemeButton(); return 'ok'; })()`);
  const themeBefore = await evalJs(`activeTheme()`);
  console.log('system theme:', themeBefore);
  await evalJs(`document.getElementById('theme-toggle').click()`);
  const themeAfter = await evalJs(`activeTheme()`);
  check('点击切换按钮后主题翻转', themeBefore !== themeAfter, `${themeBefore} -> ${themeAfter}`);
  const stored = await evalJs(`localStorage.getItem('toolbox.theme')`);
  check('手动选择已写入 localStorage', stored === themeAfter, String(stored));
  const btnText = await evalJs(`document.getElementById('theme-toggle').textContent`);
  check('按钮文案随主题更新', (themeAfter === 'light' && btnText.includes('深色')) || (themeAfter === 'dark' && btnText.includes('浅色')), btnText);
  await shot(themeAfter === 'light' ? 'shot-theme-light.png' : 'shot-theme-dark.png');
  await evalJs(`document.getElementById('theme-toggle').click()`);
  check('再点一次切回原主题', await evalJs(`activeTheme()`) === themeBefore, '');
  await evalJs(`(() => { localStorage.removeItem('toolbox.theme'); return 'ok'; })()`);

  /* 1. 切到时间戳工具（DOM 点击导航），输入时间戳，检查多时区对比行 */
  await evalJs(`document.querySelectorAll('.nav-item')[1].click()`);
  await sleep(200);
  await evalJs(`
    (() => {
      const tsIn = document.querySelector('.js-ts-in');
      tsIn.value = '1790215770';
      tsIn.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  const tzRows = await evalJs(`Array.from(document.querySelectorAll('.js-tz-rows .tz-row')).map(r => r.querySelector('.tz-row-val').textContent + ' | ' + r.querySelector('.tz-row-name').textContent)`);
  check('初始无时区对比行', Array.isArray(tzRows) && tzRows.length === 0, JSON.stringify(tzRows));

  /* 通过下拉依次添加东京、纽约（真实用户路径） */
  const addZone = async match => {
    await evalJs(`document.querySelector('.js-tz-add .zone-picker-btn').click()`);
    await sleep(150);
    await evalJs(`Array.from(document.querySelectorAll('.js-tz-add .zone-opt')).find(o => o.textContent.includes('${match}')).click()`);
    await sleep(150);
  };
  await addZone('Asia/Tokyo');
  await addZone('America/New_York');
  const tzRows2 = await evalJs(`Array.from(document.querySelectorAll('.js-tz-rows .tz-row')).map(r => r.querySelector('.tz-row-val').textContent + ' | ' + r.querySelector('.tz-row-name').textContent)`);
  check('下拉添加东京、纽约后为 2 行', Array.isArray(tzRows2) && tzRows2.length === 2, JSON.stringify(tzRows2));
  check('东京行为 2026-09-24 11:09:30（UTC+09:00）', tzRows2?.some(t => t.includes('2026-09-24 11:09:30') && t.includes('UTC+09:00')), tzRows2?.join(' ;; '));
  check('纽约行为 2026-09-23 22:09:30（UTC-04:00）', tzRows2?.some(t => t.includes('2026-09-23 22:09:30') && t.includes('UTC-04:00')), tzRows2?.join(' ;; '));

  /* 2. 点开「添加时区对比」下拉：就近展开、不越出窗口、每项带偏移 */
  await evalJs(`document.querySelector('.js-tz-add .zone-picker-btn').click()`);
  await sleep(200);
  const popState = await evalJs(`
    (() => {
      const root = document.querySelector('.js-tz-add .zone-picker');
      const pop = root.querySelector('.zone-picker-pop');
      const br = root.getBoundingClientRect();
      const pr = pop.getBoundingClientRect();
      return {
        visible: !pop.hidden,
        opensDown: pr.top >= br.bottom - 2,
        popUp: root.classList.contains('pop-up'),
        inWindow: pr.top >= 0 && pr.bottom <= window.innerHeight,
        maxHeight: parseFloat(pop.style.maxHeight) || 0,
        count: pop.querySelectorAll('.zone-opt').length,
        firstOffsets: Array.from(pop.querySelectorAll('.zone-opt')).slice(0, 3).map(o => o.querySelector('.zone-opt-off').textContent),
      };
    })()
  `);
  check('下拉列表可见', popState?.visible === true, JSON.stringify(popState));
  check('始终向下展开', popState?.opensDown === true && popState?.popUp === false, JSON.stringify(popState));
  check('弹出层完整位于窗口内', popState?.inWindow === true, JSON.stringify(popState));
  check('限高不超过可用空间', popState.maxHeight > 0 && popState.maxHeight <= 300, JSON.stringify(popState?.maxHeight));
  check('选项共 20 项（本机+常用去重）', popState?.count === 20, JSON.stringify(popState?.count));
  check('选项带偏移列', Array.isArray(popState?.firstOffsets) && popState.firstOffsets.every(s => /^UTC[+-]\d{2}:\d{2}$/.test(s)), JSON.stringify(popState?.firstOffsets));
  await shot('shot-picker-open.png');

  /* 3. 点选「伦敦」，时区行应变为 3 行且数值正确 */
  await evalJs(`
    Array.from(document.querySelectorAll('.js-tz-add .zone-opt'))
      .find(o => o.textContent.includes('Europe/London'))
      .click();
  `);
  await sleep(150);
  const rowsAfter = await evalJs(`document.querySelectorAll('.js-tz-rows .tz-row').length`);
  const londonRow = await evalJs(`
    (Array.from(document.querySelectorAll('.js-tz-rows .tz-row'))
      .map(r => r.textContent).find(t => t.includes('Europe/London')) || '')
  `);  check('点击后添加成功（3 行）', rowsAfter === 3, String(rowsAfter));
  check('伦敦行为 2026-09-24 03:09:30（UTC+01:00）', londonRow.includes('2026-09-24 03:09:30') && londonRow.includes('UTC+01:00'), londonRow);

  /* 4. 右卡片：输入墙上时间，切换「按此时区解释」为东京，检查换算 */
  await evalJs(`
    (() => {
      const dtText = document.querySelector('.js-dt-text');
      dtText.value = '2026-09-24 09:00:00';
      dtText.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await evalJs(`document.querySelector('.tz-pick-row .zone-picker-btn').click()`);
  await sleep(150);
  await evalJs(`
    Array.from(document.querySelectorAll('.tz-pick-row .zone-opt'))
      .find(o => o.textContent.includes('Asia/Tokyo'))
      .click();
  `);
  await sleep(150);
  const sec = await evalJs(`document.querySelector('.js-dt-rows .result-value').textContent`);
  const wantSec = String(Date.UTC(2026, 8, 24, 0, 0, 0) / 1000); // 东京 09:00 = UTC 00:00
  check('东京解释 2026-09-24 09:00:00 → 秒级 ' + wantSec, sec === wantSec, 'got=' + sec);
  const dtHint = await evalJs(`document.querySelector('.js-dt-hint').textContent`);
  check('提示显示按东京解释', dtHint.includes('东京 · Asia/Tokyo') && dtHint.includes('UTC+09:00'), dtHint);
  const pickerVal = await evalJs(`document.querySelector('.js-dt-picker').value`);
  check('日历控件同步为该墙上时间', pickerVal === '2026-09-24T09:00' || pickerVal === '2026-09-24T09:00:00', pickerVal);
  await shot('shot-tz-final.png');

  /* 5. 重置按钮：左卡片清空输入与时区行，右卡片恢复此刻 + 本机时区 */
  await evalJs(`document.querySelector('.js-reset-ts').click()`);
  check('左卡片重置后时间戳输入为空', await evalJs(`document.querySelector('.js-ts-in').value`) === '');
  check('左卡片重置后时区行清空', await evalJs(`document.querySelectorAll('.js-tz-rows .tz-row').length`) === 0);
  check('左卡片重置后结果恢复为 —', await evalJs(`document.querySelector('.js-ts-rows .result-value').textContent`) === '—');
  await evalJs(`document.querySelector('.js-reset-dt').click()`);
  const resetTz = await evalJs(`document.querySelector('.tz-pick-row .zone-btn-label').textContent`);
  check('右卡片重置后时区回到本机', resetTz.includes('本机'), resetTz);
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dtVal = await evalJs(`document.querySelector('.js-dt-text').value`);
  check('右卡片重置后填入当前时刻', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dtVal) && dtVal.startsWith(ymd), dtVal);
  const resetHint = await evalJs(`document.querySelector('.js-dt-hint').textContent`);
  check('右卡片重置后提示本机解释', resetHint.includes('本机') && resetHint.includes('UTC+08:00'), resetHint);
  await shot('shot-reset.png');

  /* 6. JSON 工具：宽松解析、树徽标、折叠、三个动作、错误处理 */
  await evalJs(`document.querySelectorAll('.nav-item')[2].click()`);
  await sleep(200);
  check('JSON 工具面板激活', await evalJs(`!document.querySelectorAll('.tool-panel')[2].hidden`));
  const emptyState = await evalJs(`
    (() => {
      const t = document.querySelectorAll('.tool-panel')[2].querySelector('.json-tree');
      return { h: Math.round(t.getBoundingClientRect().height), ph: (t.querySelector('.jt-empty') || {}).textContent || '' };
    })()
  `);
  check('空态树容器有完整高度与占位提示', emptyState.h >= 280 && emptyState.ph.includes('树形结构'), JSON.stringify(emptyState));

  const demoSrc = '{\n  // line comment\n  "name": "demo", /* block */\n  "features": ["a", "b", {"n": 1},],\n  "url": "http://example.com/a//b",\n}';
  const demoObj = { name: 'demo', features: ['a', 'b', { n: 1 }], url: 'http://example.com/a//b' };
  await evalJs(`
    (() => {
      const panel = document.querySelectorAll('.tool-panel')[2];
      const inp = panel.querySelector('.js-input');
      inp.value = ${JSON.stringify(demoSrc)};
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await sleep(700);
  const jStatus = await evalJs(`document.querySelectorAll('.tool-panel')[2].querySelector('.js-status').textContent`);
  check('JSONC（注释+尾逗号）解析成功', jStatus.includes('解析成功'), jStatus);
  const jBadges = await evalJs(`Array.from(document.querySelectorAll('.tool-panel')[2].querySelectorAll('.jt-badge')).map(b => b.textContent)`);
  check('树中容器显示计数徽标', JSON.stringify(jBadges) === JSON.stringify(['3 键', '3 项', '1 键']), JSON.stringify(jBadges));

  await evalJs(`document.querySelectorAll('.tool-panel')[2].querySelector('.json-tree > .jt-parent > .jt-line').click()`);
  const folded = await evalJs(`
    (() => {
      const n = document.querySelectorAll('.tool-panel')[2].querySelector('.json-tree > .jt-parent');
      return {
        c: n.classList.contains('collapsed'),
        h: getComputedStyle(n.querySelector(':scope > .jt-children')).display === 'none',
        badge: n.querySelector(':scope > .jt-line .jt-badge').textContent,
      };
    })()
  `);
  check('折叠后子节点隐藏且徽标保留个数', folded.c && folded.h && folded.badge === '3 键', JSON.stringify(folded));
  await evalJs(`document.querySelectorAll('.tool-panel')[2].querySelector('.json-tree > .jt-parent > .jt-line').click()`);
  await shot('shot-json.png');

  await evalJs(`document.querySelectorAll('.tool-panel')[2].querySelector('.js-pretty').click()`);
  const pretty = await evalJs(`document.querySelectorAll('.tool-panel')[2].querySelector('.js-output').value`);
  check('格式化输出 = stringify(obj, null, 2)', pretty === JSON.stringify(demoObj, null, 2), pretty.slice(0, 60));
  await evalJs(`document.querySelectorAll('.tool-panel')[2].querySelector('.js-min').click()`);
  const minified = await evalJs(`document.querySelectorAll('.tool-panel')[2].querySelector('.js-output').value`);
  check('压缩一行输出正确', minified === JSON.stringify(demoObj), minified);
  await evalJs(`document.querySelectorAll('.tool-panel')[2].querySelector('.js-strip').click()`);
  const stripped = await evalJs(`document.querySelectorAll('.tool-panel')[2].querySelector('.js-output').value`);
  check('去注释后注释文本已移除', !stripped.includes('line comment') && !stripped.includes('block'), stripped.slice(0, 60));
  check('字符串内的 // 原样保留', stripped.includes('http://example.com/a//b'));

  await evalJs(`
    (() => {
      const panel = document.querySelectorAll('.tool-panel')[2];
      const inp = panel.querySelector('.js-input');
      inp.value = '{ "a": 1, "b": ';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await sleep(700);
  const errStatus = await evalJs(`document.querySelectorAll('.tool-panel')[2].querySelector('.js-status').textContent`);
  check('非法输入显示解析失败', errStatus.includes('解析失败'), errStatus);

  /* 7. JSON 树裁剪：树上 ✂ 直接移除节点；输入保持原始；还原可撤销全部 */
  await evalJs(`
    (() => {
      const panel = document.querySelectorAll('.tool-panel')[2];
      const inp = panel.querySelector('.js-input');
      inp.value = ${JSON.stringify(demoSrc)};
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await sleep(700);

  /* 点 ✂ 移除 "features" 容器 */
  await evalJs(`
    (() => {
      const panel = document.querySelectorAll('.tool-panel')[2];
      const node = Array.from(panel.querySelectorAll('.jt-parent'))
        .find(n => (n.querySelector(':scope > .jt-line .jt-key') || {}).textContent === '"features"');
      node.querySelector(':scope > .jt-line .jt-trim').click();
    })()
  `);
  await sleep(150);
  const afterFeat = await evalJs(`
    (() => {
      const panel = document.querySelectorAll('.tool-panel')[2];
      return {
        badges: Array.from(panel.querySelectorAll('.jt-badge')).map(b => b.textContent),
        inputLen: panel.querySelector('.js-input').value.length,
        gone: !Array.from(panel.querySelectorAll('.jt-key')).some(k => k.textContent === '"features"'),
      };
    })()
  `);
  check('移除 features 后根徽标为 2 键', JSON.stringify(afterFeat.badges) === JSON.stringify(['2 键']), JSON.stringify(afterFeat.badges));
  check('输入框原始 JSON 未受影响', afterFeat.inputLen === demoSrc.length, String(afterFeat.inputLen) + ' vs ' + demoSrc.length);
  check('树中 features 已消失', afterFeat.gone);

  /* 点 ✂ 移除叶子 "name" */
  await evalJs(`
    (() => {
      const panel = document.querySelectorAll('.tool-panel')[2];
      const line = Array.from(panel.querySelectorAll('.jt-line'))
        .find(l => (l.querySelector('.jt-key') || {}).textContent === '"name"');
      line.querySelector('.jt-trim').click();
    })()
  `);
  await sleep(150);
  const afterName = await evalJs(`Array.from(document.querySelectorAll('.tool-panel')[2].querySelectorAll('.jt-badge')).map(b => b.textContent)`);
  check('再移除叶子 name 后根徽标为 1 键', JSON.stringify(afterName) === JSON.stringify(['1 键']), JSON.stringify(afterName));
  const jResult = await evalJs(`document.querySelectorAll('.tool-panel')[2].querySelector('.js-output').value`);
  check('结果文本为仅剩 url 的裁剪结果', jResult === JSON.stringify({ url: 'http://example.com/a//b' }, null, 2), jResult.slice(0, 60));

  /* 还原：撤销全部裁剪 */
  await evalJs(`document.querySelectorAll('.tool-panel')[2].querySelector('.js-restore').click()`);
  const restored = await evalJs(`Array.from(document.querySelectorAll('.tool-panel')[2].querySelectorAll('.jt-badge')).map(b => b.textContent)`);
  check('还原后徽标恢复 3 键/3 项/1 键', JSON.stringify(restored) === JSON.stringify(['3 键', '3 项', '1 键']), JSON.stringify(restored));
  await shot('shot-json-trim.png');

  /* 8. 设置页：快捷键录制（合成按键）、置顶、自启、关闭行为 */
  await evalJs(`document.getElementById('settings-toggle').click()`);
  await sleep(200);
  check('设置面板激活', await evalJs(`!document.getElementById('settings-panel').hidden`));

  // 录制新快捷键 Alt+I：点击「修改」后向 window 派发 keydown
  await evalJs(`document.getElementById('settings-panel').querySelector('.js-record').click()`);
  await sleep(100);
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', key: 'i', altKey: true, bubbles: true }))`);
  await sleep(400);
  const scState = await evalJs(`
    (() => {
      const panel = document.getElementById('settings-panel');
      return {
        display: panel.querySelector('.js-sc-display').textContent,
        saved: localStorage.getItem('toolbox.shortcut'),
        hint: panel.querySelector('.js-sc-hint').textContent,
      };
    })()
  `);
  check('录制 Alt+I 成功并展示', scState.display === 'Alt+I' && scState.saved === 'Alt+KeyI', JSON.stringify(scState));
  check('提示快捷键已生效', scState.hint.includes('Alt+I'), scState.hint);

  // 置顶开关
  await evalJs(`document.getElementById('settings-panel').querySelector('.js-topmost').click()`);
  await sleep(150);
  check('置顶开关已记忆', await evalJs(`localStorage.getItem('toolbox.alwaysTop')`) === '1');

  // 关闭行为往返
  await evalJs(`document.getElementById('settings-panel').querySelector('.js-closetray').click()`);
  await sleep(150);
  check('关闭行为切到直接退出已记忆', await evalJs(`localStorage.getItem('toolbox.closeToTray')`) === '0');
  await evalJs(`document.getElementById('settings-panel').querySelector('.js-closetray').click()`);
  await sleep(150);
  check('关闭行为恢复为隐藏到托盘', await evalJs(`localStorage.getItem('toolbox.closeToTray')`) === '1');

  // 开机自启：checkbox 触发后用插件真实状态（注册表）断言
  await evalJs(`(async () => { try { await window.__TAURI__.core.invoke('set_autostart', { enabled: false }); } catch (e) {} return 'ok'; })()`);
  await sleep(600);
  const autoBefore = await evalJs(`window.__TAURI__.core.invoke('get_autostart')`);
  await evalJs(`document.getElementById('settings-panel').querySelector('.js-autostart').click()`);
  await sleep(900);
  const autoOn = await evalJs(`window.__TAURI__.core.invoke('get_autostart')`);
  check('开启自启后系统状态为已启用', autoOn === true && autoBefore === false, `before=${autoBefore} on=${autoOn}`);
  await evalJs(`document.getElementById('settings-panel').querySelector('.js-autostart').click()`);
  await sleep(900);
  const autoOff = await evalJs(`window.__TAURI__.core.invoke('get_autostart')`);
  check('关闭自启后系统状态为已禁用', autoOff === false);

  await shot('shot-settings.png');

  /* 9. 便签：新增、回车复制、删除 */
  await evalJs(`document.querySelectorAll('.nav-item')[3].click()`);
  await sleep(200);
  check('便签面板激活', await evalJs(`!document.querySelectorAll('.tool-panel')[3].hidden`));

  // 新增便签 aa -> Aa123456789
  await evalJs(`
    (() => {
      const panel = document.querySelectorAll('.tool-panel')[3];
      panel.querySelector('.js-name').value = 'aa';
      panel.querySelector('.js-content').value = 'Aa123456789';
      panel.querySelector('.js-save').click();
    })()
  `);
  await sleep(150);
  const noteNames = await evalJs(`Array.from(document.querySelectorAll('.tool-panel')[3].querySelectorAll('.note-name')).map(n => n.textContent)`);
  check('新增后列表出现 aa', noteNames.includes('aa'), JSON.stringify(noteNames));

  // 装 spy：拦截全局 tauriInvoke 的 paste_to_previous（__TAURI__.core 被冻结不可替换），其余转发
  await evalJs(`
    (() => {
      window.__spy = [];
      const orig = window.tauriInvoke;
      window.__origInvoke = orig;
      window.tauriInvoke = (cmd, args) => {
        if (cmd === 'paste_to_previous') { window.__spy.push([cmd, args]); return Promise.resolve(null); }
        window.__spy.push([cmd, args]);
        return orig(cmd, args);
      };
      return 'spied';
    })()
  `);
  // 回车粘贴（被 spy 拦截）
  await evalJs(`
    (() => {
      const q = document.querySelectorAll('.tool-panel')[3].querySelector('.js-quick');
      q.value = 'aa';
      q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()
  `);
  await sleep(150);
  const noteStatus = await evalJs(`document.querySelectorAll('.tool-panel')[3].querySelector('.js-status').textContent`);
  check('回车后提示已粘贴到之前的窗口', noteStatus.includes('已将'), noteStatus);
  const spyHit = await evalJs(`JSON.stringify(window.__spy.filter(s => s[0] === 'paste_to_previous').map(s => s[1]))`);
  check('粘贴命令携带正确内容', spyHit.includes('"text":"Aa123456789"'), spyHit);

  // 无匹配提示
  await evalJs(`
    (() => {
      const q = document.querySelectorAll('.tool-panel')[3].querySelector('.js-quick');
      q.value = 'bbb';
      q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()
  `);
  await sleep(150);
  const missStatus = await evalJs(`document.querySelectorAll('.tool-panel')[3].querySelector('.js-status').textContent`);
  check('无匹配时提示未找到', missStatus.includes('没有匹配'), missStatus);

  // 删除清理
  await evalJs(`
    (() => {
      const panel = document.querySelectorAll('.tool-panel')[3];
      const row = Array.from(panel.querySelectorAll('.note-row'))
        .find(r => r.querySelector('.note-name').textContent === 'aa');
      row.querySelectorAll('button')[2].click();
    })()
  `);
  await sleep(150);
  check('删除后列表为空', await evalJs(`document.querySelectorAll('.tool-panel')[3].querySelectorAll('.note-row').length`) === 0);
  await shot('shot-notes.png');

  /* 10. 全局搜索：便签复制 / 时间戳跳转 / JSON 跳转 / 应用搜索 */
  await evalJs(`
    (() => {
      document.querySelectorAll('.nav-item')[3].click();
      const panel = document.querySelectorAll('.tool-panel')[3];
      panel.querySelector('.js-name').value = 'gsdemo';
      panel.querySelector('.js-content').value = 'GS-CONTENT-123';
      panel.querySelector('.js-save').click();
    })()
  `);
  await sleep(150);

  // 便签分发：输入 gsdemo → 回车复制
  await evalJs(`
    (() => {
      const q = document.querySelector('.js-globalsearch');
      q.value = 'gsdemo';
      q.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await sleep(200);
  const gs1 = await evalJs(`
    (() => {
      const panel = document.querySelector('.js-gs-panel');
      const titles = Array.from(panel.querySelectorAll('.gs-title')).map(t => t.textContent);
      const sel = panel.querySelector('.gs-item.selected .gs-title');
      return { titles, selected: sel ? sel.textContent : '' };
    })()
  `);
  check('全局搜索匹配到便签', gs1.titles.includes('gsdemo'), JSON.stringify(gs1));
  check('便签项默认选中', gs1.selected === 'gsdemo', gs1.selected);
  await evalJs(`document.querySelector('.js-globalsearch').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await sleep(150);
  const gsFb = await evalJs(`document.querySelector('.js-gs-panel').textContent`);
  check('回车后反馈已粘贴到之前的窗口', gsFb.includes('粘贴到之前的窗口'), gsFb);
  const gsSpy = await evalJs(`JSON.stringify(window.__spy.filter(s => s[0] === 'paste_to_previous').map(s => s[1]))`);
  check('全局搜索粘贴命令携带便签内容', gsSpy.includes('GS-CONTENT-123'), gsSpy);

  // 时间戳分发
  await evalJs(`
    (() => {
      const q = document.querySelector('.js-globalsearch');
      q.value = '1770000000';
      q.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await sleep(150);
  const gs2Titles = await evalJs(`Array.from(document.querySelector('.js-gs-panel').querySelectorAll('.gs-title')).map(t => t.textContent)`);
  check('纯数字匹配到时间戳转换', gs2Titles.some(t => t.includes('1770000000')), JSON.stringify(gs2Titles));
  await evalJs(`document.querySelector('.js-globalsearch').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await sleep(200);
  const tsVal = await evalJs(`document.querySelectorAll('#tool-main .tool-panel')[1].querySelector('.js-ts-in').value`);
  check('时间戳已自动填入时间戳工具', tsVal === '1770000000', tsVal);

  // JSON 分发
  await evalJs(`
    (() => {
      const q = document.querySelector('.js-globalsearch');
      q.value = '{"k": 1}';
      q.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await sleep(150);
  const gs3Titles = await evalJs(`Array.from(document.querySelector('.js-gs-panel').querySelectorAll('.gs-title')).map(t => t.textContent)`);
  check('JSON 文本匹配到格式化', gs3Titles.some(t => t.includes('JSON')), JSON.stringify(gs3Titles));
  await evalJs(`document.querySelector('.js-globalsearch').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await sleep(400);
  const jsonVal = await evalJs(`document.querySelectorAll('#tool-main .tool-panel')[2].querySelector('.js-input').value`);
  check('JSON 已自动填入格式化工具', jsonVal === '{"k": 1}', jsonVal);

  // 应用搜索（notepad 在 Windows 上必然存在）
  await evalJs(`
    (() => {
      const q = document.querySelector('.js-globalsearch');
      q.value = 'notepad';
      q.dispatchEvent(new Event('input', { bubbles: true }));
    })()
  `);
  await sleep(700);
  const gsApps = await evalJs(`Array.from(document.querySelector('.js-gs-panel').querySelectorAll('.gs-item')).filter(i => i.querySelector('.gs-type').textContent.includes('应用')).map(i => i.querySelector('.gs-title').textContent)`);
  check('应用搜索返回本机应用', gsApps.length >= 1, JSON.stringify(gsApps));
  // 若面板被反馈定时器收起，重新触发一次输入使列表显示（模拟用户看到列表后再回车）
  await evalJs(`
    (() => {
      const panel = document.querySelector('.js-gs-panel');
      if (panel.hidden) {
        document.querySelector('.js-globalsearch').dispatchEvent(new Event('input', { bubbles: true }));
      }
      return panel.hidden;
    })()
  `);
  await sleep(900);
  await evalJs(`document.querySelector('.js-globalsearch').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await sleep(5000);
  let np = false;
  try { np = require('child_process').execSync('tasklist /NH', { shell: 'cmd.exe' }).toString().toLowerCase().includes('notepad'); } catch (e) {}
  check('回车已真实启动应用（notepad 进程存在）', np);
  try { require('child_process').execSync('taskkill /IM notepad.exe /F >nul 2>&1', { shell: 'cmd.exe' }); } catch (e) {}
  try { require('child_process').execSync('taskkill /IM notepad++.exe /F >nul 2>&1', { shell: 'cmd.exe' }); } catch (e) {}
  await shot('shot-globalsearch.png');
  await evalJs(`document.querySelector('.js-globalsearch').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  /* 再次唤起场景：重置搜索框（模拟 Alt+Q 唤起时的自动清空） */
  await evalJs(`window.__resetGlobalSearch(); 'ok'`);
  await sleep(100);
  check('唤起重置后输入框为空', await evalJs(`document.querySelector('.js-globalsearch').value`) === '');

  /* 残留输入 + 面板收起时回车的兜底：重建结果并执行粘贴 */
  await evalJs(`
    (() => {
      const q = document.querySelector('.js-globalsearch');
      q.value = 'gsdemo';
      q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()
  `);
  await sleep(200);
  const againSpy = await evalJs(`JSON.stringify(window.__spy.filter(s => s[0] === 'paste_to_previous').map(s => s[1]))`);
  check('面板收起时回车仍执行粘贴', againSpy.includes('"text":"GS-CONTENT-123"'), againSpy);

  // 清理测试便签
  await evalJs(`
    (() => {
      localStorage.setItem('toolbox.notes', JSON.stringify((JSON.parse(localStorage.getItem('toolbox.notes')) || []).filter(n => n.name !== 'gsdemo')));
      if (window.__origInvoke) window.tauriInvoke = window.__origInvoke;
      const q = document.querySelector('.js-globalsearch');
      q.value = '';
      q.dispatchEvent(new Event('input', { bubbles: true }));
      return 'cleaned';
    })()
  `);

  /* 清理测试残留：恢复默认快捷键与系统状态 */
  await evalJs(`
    (() => {
      localStorage.removeItem('toolbox.shortcut');
      localStorage.removeItem('toolbox.alwaysTop');
      localStorage.removeItem('toolbox.closeToTray');
      const inv = window.__TAURI__.core.invoke;
      inv('set_shortcut', { shortcut: 'Control+KeyQ' });
      inv('set_always_on_top', { enabled: false });
      return 'cleaned';
    })()
  `);
  await sleep(300);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
