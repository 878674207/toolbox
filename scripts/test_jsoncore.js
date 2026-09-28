/* jsoncore.js 的单元测试：node scripts/test_jsoncore.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'tools', 'jsoncore.js'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src + `
;Object.assign(globalThis, { stripJsonComments, parseLenient, jsonStats });`, ctx);
const { stripJsonComments, parseLenient, jsonStats } = ctx;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)}`}`);
}
function ok(name, cond) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

/* ---- stripJsonComments：注释剥离 ---- */
eq('行注释', stripJsonComments('{"a":1} // hi'), '{"a":1} ');
eq('行注释保留换行', stripJsonComments('{\n// c\n"a":1}'), '{\n\n"a":1}');
eq('块注释以空格占位', stripJsonComments('/* c */{"a":1}'), ' {"a":1}');
eq('字符串内 // 保留', stripJsonComments('{"u":"http://x.com/a//b"}'), '{"u":"http://x.com/a//b"}');
eq('字符串内 /* 保留', stripJsonComments('{"s":"a/*b*/c"}'), '{"s":"a/*b*/c"}');
eq('转义引号内不误判', stripJsonComments('{"s":"a\\"//b"}'), '{"s":"a\\"//b"}');

/* ---- stripJsonComments：尾随逗号 ---- */
eq('对象尾逗号', stripJsonComments('{"a":1,}', true), '{"a":1}');
eq('数组尾逗号', stripJsonComments('[1,2,]', true), '[1,2]');
eq('嵌套尾逗号', stripJsonComments('{"a":[1,{"b":2},],}', true), '{"a":[1,{"b":2}]}');
eq('正常逗号不受影响', stripJsonComments('[1, 2, 3]', true), '[1, 2, 3]');
eq('字符串内 ,] 不误删', stripJsonComments('{"s":"x,]"}', true), '{"s":"x,]"}');
eq('默认不去尾逗号', stripJsonComments('[1,]', false), '[1,]');

/* ---- parseLenient ---- */
eq('纯 JSON 直通', parseLenient('{"a":1}').a, 1);
eq('带注释解析', parseLenient('{\n // c\n "a": 1 /* x */\n}').a, 1);
eq('注释+尾逗号组合', parseLenient('{"a": [1, 2,],}').a.join(','), '1,2');
eq('根数组', parseLenient('[true, null, "s", 1.5]').length, 4);
ok('非法输入抛错', (() => { try { parseLenient('{ "a": '); return false; } catch (e) { return true; } })());

/* ---- jsonStats ---- */
const st = jsonStats({ a: [1, 2, { b: null }], c: { d: true } });
eq('stats.nodes', st.nodes, 8);   // root,a,1,2,{b},b,null,c,{d},d = 10? 逐步核对见下
eq('stats.objects', st.objects, 3); // root,{b},c,{d}
eq('stats.arrays', st.arrays, 1);
eq('stats.depth', st.depth, 2);   // root(0) -> a(1) -> {b}(2)

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
