/* 时区公共逻辑：被时间戳转换工具使用。
   独立成纯函数文件，便于用 Node 直接做单元测试（node scripts/test_tz.js）。 */
'use strict';

const pad = n => String(n).padStart(2, '0');

const LOCAL_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch (e) { return 'UTC'; }
})();

/* 内置常用时区（IANA 名称 + 中文名），下拉列表用 */
const COMMON_ZONES = [
  ['Asia/Shanghai', '北京'],
  ['Asia/Hong_Kong', '香港'],
  ['Asia/Taipei', '台北'],
  ['Asia/Tokyo', '东京'],
  ['Asia/Seoul', '首尔'],
  ['Asia/Singapore', '新加坡'],
  ['Asia/Kolkata', '孟买'],
  ['Asia/Dubai', '迪拜'],
  ['Europe/Moscow', '莫斯科'],
  ['Europe/London', '伦敦'],
  ['Europe/Paris', '巴黎'],
  ['Europe/Berlin', '柏林'],
  ['America/New_York', '纽约'],
  ['America/Chicago', '芝加哥'],
  ['America/Denver', '丹佛'],
  ['America/Los_Angeles', '洛杉矶'],
  ['America/Sao_Paulo', '圣保罗'],
  ['Australia/Sydney', '悉尼'],
  ['Pacific/Auckland', '奥克兰'],
  ['UTC', 'UTC'],
];

function isValidZone(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; }
  catch (e) { return false; }
}

/* 时区显示名：本机标「本机」，内置时区标中文名 */
function zoneLabel(tz) {
  if (tz === LOCAL_TZ) return `本机 · ${tz}`;
  const hit = COMMON_ZONES.find(z => z[0] === tz);
  return hit ? `${hit[1]} · ${tz}` : tz;
}

/* 某时刻在指定时区的墙上时间分量（year/month/day/hour/minute/second，均为数字） */
function zoneParts(d, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const o = {};
  for (const p of dtf.formatToParts(d)) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}

/* 格式化为 YYYY-MM-DD HH:mm:ss（在该时区视角下） */
function fmtInZone(d, tz) {
  const p = zoneParts(d, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/* 该时区相对 UTC 的偏移（分钟，东正西负） */
function offsetMinutes(d, tz) {
  const p = zoneParts(d, tz);
  const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUTC - d.getTime()) / 60000);
}

/* 偏移显示，如 UTC+08:00 / UTC-04:00 */
function offsetLabel(d, tz) {
  const m = offsetMinutes(d, tz);
  const sign = m < 0 ? '-' : '+';
  const abs = Math.abs(m);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/* 核心：把「墙上时间 + 所属时区」换算成 UTC 毫秒时间戳。
   JS 没有原生 API，先按 UTC 试解，再用该时区在相应时刻的实际偏移修正，
   修正两次以覆盖夏令时切换边界。 */
function wallToMs(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = offsetMinutes(new Date(guess), tz);
  let ms = guess - off1 * 60000;
  const off2 = offsetMinutes(new Date(ms), tz);
  if (off2 !== off1) ms = guess - off2 * 60000;
  return ms;
}

/* 解析自由格式时间字符串 → 墙上时间分量。
   支持 2026-09-24、2026/9/4 9:5、2026-09-24T09:30:00、2026.09.24 09:30 等；
   拒绝 2 月 30 日这类不存在的日期。失败返回 null。 */
function parseWallTime(str) {
  const m = String(str).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const h = m[4] !== undefined ? +m[4] : 0;
  const mi = m[5] !== undefined ? +m[5] : 0;
  const s = m[6] !== undefined ? +m[6] : 0;
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCDate() !== d || check.getUTCMonth() + 1 !== mo) return null;
  return { y, mo, d, h, mi, s };
}
