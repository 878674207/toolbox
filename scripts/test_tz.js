/* tz.js 的单元测试：node scripts/test_tz.js
   直接从源文件加载真实代码（tz.js 只定义常量与纯函数，可在 Node 中直接求值）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'tools', 'tz.js'), 'utf8');
const ctx = {};
vm.createContext(ctx);
/* tz.js 顶层的 const 声明不会自动挂到 vm 全局对象，追加导出语句显式暴露 */
vm.runInContext(src + `
;Object.assign(globalThis, {
  pad, LOCAL_TZ, COMMON_ZONES, isValidZone, zoneLabel, zoneParts,
  fmtInZone, offsetMinutes, offsetLabel, wallToMs, parseWallTime,
});`, ctx);
const {
  pad, LOCAL_TZ, COMMON_ZONES, zoneParts, fmtInZone, offsetMinutes, offsetLabel,
  wallToMs, parseWallTime, isValidZone,
} = ctx;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}
function ok(name, cond) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

console.log(`本机时区: ${LOCAL_TZ}`);

/* ---- pad ---- */
eq('pad(3)', pad(3), '03');
eq('pad(17)', pad(17), '17');

/* ---- zoneParts / fmtInZone：同一时刻在不同时区的墙上时间 ---- */
const t = new Date('2026-09-24T01:51:44Z'); // UTC 2026-09-24 01:51:44
eq('东京视角', fmtInZone(t, 'Asia/Tokyo'), '2026-09-24 10:51:44');
eq('伦敦视角(夏令时)', fmtInZone(t, 'Europe/London'), '2026-09-24 02:51:44');
eq('纽约视角(夏令时)', fmtInZone(t, 'America/New_York'), '2026-09-23 21:51:44');
eq('UTC 视角', fmtInZone(t, 'UTC'), '2026-09-24 01:51:44');
eq('洛杉矶视角', fmtInZone(t, 'America/Los_Angeles'), '2026-09-23 18:51:44');

/* ---- offsetMinutes / offsetLabel：冬夏令时偏移 ---- */
eq('纽约夏令时偏移', offsetLabel(t, 'America/New_York'), 'UTC-04:00');
eq('纽约冬令时偏移', offsetLabel(new Date('2026-01-15T12:00:00Z'), 'America/New_York'), 'UTC-05:00');
eq('伦敦夏令时偏移', offsetLabel(t, 'Europe/London'), 'UTC+01:00');
eq('伦敦冬令时偏移', offsetLabel(new Date('2026-01-15T12:00:00Z'), 'Europe/London'), 'UTC+00:00');
eq('上海偏移', offsetLabel(t, 'Asia/Shanghai'), 'UTC+08:00');
eq('印度半时区偏移', offsetLabel(t, 'Asia/Kolkata'), 'UTC+05:30');

/* ---- wallToMs：墙上时间 + 时区 → 时间戳 ---- */
eq('上海 09:00 → UTC', new Date(wallToMs(2026, 9, 24, 9, 0, 0, 'Asia/Shanghai')).toISOString(), '2026-09-24T01:00:00.000Z');
eq('东京 09:00 → UTC', new Date(wallToMs(2026, 9, 24, 9, 0, 0, 'Asia/Tokyo')).toISOString(), '2026-09-24T00:00:00.000Z');
eq('纽约夏令时 09:00 → UTC', new Date(wallToMs(2026, 7, 1, 9, 0, 0, 'America/New_York')).toISOString(), '2026-07-01T13:00:00.000Z');
eq('纽约冬令时 09:00 → UTC', new Date(wallToMs(2026, 1, 15, 9, 0, 0, 'America/New_York')).toISOString(), '2026-01-15T14:00:00.000Z');

/* roundtrip：墙上时间 → 时间戳 → 该时区墙上时间，应恒等 */
for (const [tz, wall] of [['Asia/Shanghai', '2026-09-24 09:00:00'], ['America/New_York', '2026-07-01 09:00:00'], ['Pacific/Auckland', '2026-12-31 23:59:59']]) {
  const w = parseWallTime(wall);
  const d = new Date(wallToMs(w.y, w.mo, w.d, w.h, w.mi, w.s, tz));
  eq(`roundtrip ${tz}`, fmtInZone(d, tz), wall);
}

/* ---- parseWallTime：格式宽容度与非法输入 ---- */
eq('解析 ISO', JSON.stringify(parseWallTime('2026-09-24T09:30:00')), '{"y":2026,"mo":9,"d":24,"h":9,"mi":30,"s":0}');
eq('解析 空格分隔', JSON.stringify(parseWallTime('2026-09-24 09:30:05')), '{"y":2026,"mo":9,"d":24,"h":9,"mi":30,"s":5}');
eq('解析 斜杠+单位数', JSON.stringify(parseWallTime('2026/9/4 9:5')), '{"y":2026,"mo":9,"d":4,"h":9,"mi":5,"s":0}');
eq('解析 仅日期', JSON.stringify(parseWallTime('2026-12-31')), '{"y":2026,"mo":12,"d":31,"h":0,"mi":0,"s":0}');
eq('解析 点分隔', JSON.stringify(parseWallTime('2026.09.24 08:00')), '{"y":2026,"mo":9,"d":24,"h":8,"mi":0,"s":0}');
ok('拒绝 2 月 30 日', parseWallTime('2026-02-30') === null);
ok('拒绝 13 月', parseWallTime('2026-13-01') === null);
ok('拒绝 25 点', parseWallTime('2026-09-24 25:00') === null);
ok('拒绝 乱串', parseWallTime('明天下午') === null);
ok('拒绝 空串', parseWallTime('') === null);
ok('拒绝 带时区后缀(超出语义)', parseWallTime('2026-09-24 09:00:00+08:00') === null);

/* ---- 其他 ---- */
ok('合法时区', isValidZone('Asia/Tokyo'));
ok('非法时区', !isValidZone('Mars/Olympus_Mons'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
