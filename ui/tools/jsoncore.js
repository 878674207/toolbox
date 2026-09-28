/* JSON 宽松解析纯函数：注释剥离（可选清理尾随逗号）与结构统计。
   独立成纯函数文件，便于用 Node 直接做单元测试（node scripts/test_jsoncore.js）。 */
'use strict';

/* 去掉 JSONC 注释。
   - 字符串字面量（含转义）内部的 / 与注释记号原样保留；
   - 行注释删除至行首（保留换行符）；
   - 块注释以一个空格占位，避免前后 token 粘连；
   - removeTrailingCommas 为 true 时同时删除 } / ] 前的尾随逗号。 */
function stripJsonComments(text, removeTrailingCommas) {
  const src = String(text);
  let out = '';
  let i = 0;
  let inString = false;
  let commaPos = -1; // out 中最近一个悬空逗号的位置（仅统计字符串外的逗号）
  const isSpace = ch => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

  while (i < src.length) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < src.length) { out += src[i + 1]; i += 2; continue; }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      commaPos = -1; // 逗号后跟字符串是合法分隔，取消悬空标记
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue; // 换行符由主循环输出
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    if (ch === ',') {
      commaPos = out.length;
      out += ch;
      i++;
      continue;
    }
    if (removeTrailingCommas && (ch === '}' || ch === ']') && commaPos >= 0) {
      if (/^[\s]*$/.test(out.slice(commaPos + 1))) { // 逗号与括号之间只有空白才算尾随逗号
        out = out.slice(0, commaPos) + ch;
        commaPos = -1;
        i++;
        continue;
      }
    }
    if (!isSpace(ch)) commaPos = -1;
    out += ch;
    i++;
  }
  return out;
}

/* 宽松解析：依次尝试原文、去注释、去注释+去尾随逗号；全部失败抛出最后一次的错误 */
function parseLenient(text) {
  const src = String(text);
  const attempts = [src, stripJsonComments(src), stripJsonComments(src, true)];
  let lastErr;
  for (const s of attempts) {
    try { return JSON.parse(s); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* 结构统计：nodes 总节点数、objects/arrays 容器数、depth 最大容器嵌套（根为 0） */
function jsonStats(value) {
  let nodes = 0, objects = 0, arrays = 0, depth = 0;
  (function walk(v, d) {
    nodes++;
    if (v !== null && typeof v === 'object') {
      if (Array.isArray(v)) arrays++; else objects++;
      if (d > depth) depth = d;
      const vals = Array.isArray(v) ? v : Object.values(v);
      for (const c of vals) walk(c, d + 1);
    }
  })(value, 0);
  return { nodes, objects, arrays, depth };
}
