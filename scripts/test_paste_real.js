/* 真实粘贴链路验证：
   1. 启动 Notepad++ 并置前台，隐藏工具箱
   2. 启动第二实例（单实例机制唤起工具箱，此时记录“之前的窗口”= Notepad++）
   3. 通过 CDP 真实调用 paste_to_previous
   4. 检查 Notepad++ 标题是否出现修改标记 *（内容已进入编辑器）
   用法：node scripts/test_paste_real.js */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ps = (m) => execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/paste_helper.ps1 -mode ${m}`, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || detail === undefined ? '' : '  ' + detail}`);
}

async function main() {
  // 1. 干净启动 Notepad++
  try { execSync('taskkill /IM notepad++.exe /F >nul 2>&1', { shell: 'cmd.exe' }); } catch (e) {}
  execSync('start "" "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Notepad++.lnk"', { shell: 'cmd.exe' });
  await sleep(2500);
  console.log('notepad++ title:', ps('title'));

  // 2. Notepad++ 置前台，隐藏工具箱
  console.log('fg:', ps('fg-notepad'));
  await sleep(300);
  console.log('hide:', ps('hide-toolbox'));
  await sleep(300);

  // 3. 第二实例唤起（single-instance 回调记录 prev=Notepad++ 并显示窗口）
  execSync('start "" "' + path.join(ROOT, 'src-tauri', 'target', 'release', 'toolbox.exe') + '"', { shell: 'cmd.exe' });
  await sleep(3000);

  // 4. CDP 真实调用 paste_to_previous
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = list.find(t => t.type === 'page');
  if (!page) throw new Error('no CDP page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async ex => (await send('Runtime.evaluate', { expression: ex, returnByValue: true, awaitPromise: true })).result.result.value;

  const r = await evalJs(`(async () => { try { await window.__TAURI__.core.invoke('paste_to_previous', { text: 'PASTE-TEST-123' }); return 'ok'; } catch (e) { return 'err:' + (e.message || e); } })()`);
  console.log('paste result:', r);
  await sleep(1500);

  // 5. Notepad++ 标题应带修改标记 *
  const title = ps('title');
  check('Notepad++ 标题出现修改标记（内容已粘贴）', title.includes('*'), title);

  // 清理
  try { execSync('taskkill /IM notepad++.exe /F >nul 2>&1', { shell: 'cmd.exe' }); } catch (e) {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
