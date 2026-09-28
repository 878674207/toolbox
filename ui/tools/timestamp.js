/* 工具：时间戳转换（含多时区对比、按指定时区解释时间字符串） */
(function () {
  'use strict';

  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  function fmtLocal(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function fmtUtc(d) {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  function relTime(ms) {
    const diff = ms - Date.now();
    const abs = Math.abs(diff);
    const units = [[31536000000, '年'], [2592000000, '个月'], [604800000, '周'], [86400000, '天'], [3600000, '小时'], [60000, '分钟'], [1000, '秒']];
    for (const [unit, name] of units) {
      if (abs >= unit) {
        const v = Math.round(abs / unit);
        return diff > 0 ? `${v} ${name}后` : `${v} ${name}前`;
      }
    }
    return '刚刚';
  }

  /* 按位数识别：<=10 位秒、11-13 位毫秒、14-16 位微秒、>16 位纳秒 */
  function parseTimestamp(str) {
    const s = String(str).trim();
    if (!/^\d{1,18}$/.test(s)) return null;
    let ms, unit;
    if (s.length <= 10) { ms = Number(s) * 1000; unit = '已识别为秒级时间戳'; }
    else if (s.length <= 13) { ms = Number(s); unit = '已识别为毫秒级时间戳'; }
    else if (s.length <= 16) { ms = Math.round(Number(s) / 1000); unit = '已识别为微秒级，按毫秒换算'; }
    else { ms = Math.round(Number(s) / 1e6); unit = '已识别为纳秒级，按毫秒换算'; }
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return { date: d, unit };
  }

  /* 一行结果：标签 + 值 + 复制按钮，返回 set(value) 用于刷新 */
  function resultRow(label) {
    const row = document.createElement('div');
    row.className = 'result-row';
    const lab = document.createElement('span');
    lab.className = 'result-label';
    lab.textContent = label;
    const val = document.createElement('span');
    val.className = 'result-value';
    val.textContent = '—';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-copy btn-sm';
    btn.textContent = '复制';
    btn.addEventListener('click', () => { if (val.textContent !== '—') copyText(val.textContent, btn); });
    row.append(lab, val, btn);
    return { row, set(v) { val.textContent = v; } };
  }

  /* 时区下拉的数据源：本机时区在前，其后为内置常用时区（按 tz 去重） */
  function zoneChoices() {
    const seen = new Set([LOCAL_TZ]);
    const list = [{ tz: LOCAL_TZ, label: `本机 · ${LOCAL_TZ}` }];
    for (const [tz, name] of COMMON_ZONES) {
      if (seen.has(tz)) continue;
      seen.add(tz);
      list.push({ tz, label: `${name} · ${tz}` });
    }
    return list;
  }

  /* 自定义时区下拉，替代原生 <select>（原生弹出方向不可控、弹出列表为系统亮色样式）。
     每个选项右侧显示当前 UTC 偏移；默认向下展开，下方空间不足时改为向上。 */
  function makeZonePicker(opts) {
    const root = document.createElement('div');
    root.className = 'zone-picker';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'zone-picker-btn';
    const pop = document.createElement('div');
    pop.className = 'zone-picker-pop';
    pop.hidden = true;
    root.append(btn, pop);

    let value = opts.value || '';

    function renderBtn() {
      const hit = zoneChoices().find(c => c.tz === value);
      const text = hit ? hit.label : (opts.placeholder || '请选择…');
      const label = document.createElement('span');
      label.className = 'zone-btn-label';
      label.textContent = text;
      label.title = text;
      const arr = document.createElement('span');
      arr.className = 'arr';
      arr.textContent = '▾';
      btn.innerHTML = '';
      btn.append(label, arr);
    }

    function close() {
      pop.hidden = true;
      root.classList.remove('open', 'pop-up');
    }

    function open() {
      pop.innerHTML = '';
      const now = new Date();
      for (const c of zoneChoices()) {
        const item = document.createElement('div');
        item.className = 'zone-opt' + (c.tz === value ? ' active' : '');
        const main = document.createElement('span');
        main.className = 'zone-opt-main';
        main.textContent = c.label;
        const off = document.createElement('span');
        off.className = 'zone-opt-off';
        off.textContent = offsetLabel(now, c.tz);
        off.title = '当前 UTC 偏移';
        item.append(main, off);
        item.addEventListener('click', () => {
          value = c.tz;
          close();
          opts.onChange(c.tz);
          if (opts.action) value = '';
          renderBtn();
        });
        pop.appendChild(item);
      }
      pop.hidden = false;
      root.classList.add('open');
      /* 始终向下展开，按下方剩余空间限高（列表内部滚动） */
      const rect = root.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      pop.style.maxHeight = Math.max(28, Math.min(300, spaceBelow - 12)) + 'px';
    }

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (pop.hidden) open(); else close();
    });
    document.addEventListener('click', e => { if (!root.contains(e.target)) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    renderBtn();
    return {
      el: root,
      set(tz) { value = tz; renderBtn(); },
    };
  }

  registerTool({
    id: 'timestamp',
    name: '时间戳转换',
    icon: '⏱',
    /* presetZones：hash 深链传入的预置时区，如 "Asia/Tokyo,America/New_York" */
    mount(panel, presetZones) {
      panel.innerHTML = `
        <div class="tool-header">
          <h2>时间戳转换</h2>
          <p class="tool-desc">时间戳与日期时间双向转换，支持多时区对比与按时区解释，按本机时区默认显示。</p>
        </div>

        <div class="card now-card">
          <div class="now-row">
            <div class="now-item">
              <span class="now-label">当前秒级时间戳</span>
              <span class="now-value js-now-sec">—</span>
            </div>
            <button type="button" class="btn btn-copy js-copy-sec">复制</button>
          </div>
          <div class="now-row">
            <div class="now-item">
              <span class="now-label">当前毫秒级时间戳</span>
              <span class="now-value dim js-now-ms">—</span>
            </div>
            <button type="button" class="btn btn-copy js-copy-ms">复制</button>
          </div>
          <div class="now-date js-now-date"></div>
        </div>

        <div class="two-col">
          <div class="card">
            <div class="card-head">
              <h3>时间戳 → 日期时间</h3>
              <button type="button" class="btn btn-ghost btn-sm js-reset-ts" title="清空输入并移除添加的时区">重置</button>
            </div>
            <input class="text-input mono js-ts-in" placeholder="粘贴时间戳，如 1770000000 或 1770000000000" spellcheck="false" />
            <div class="hint js-ts-hint"></div>
            <div class="js-ts-rows"></div>
            <div class="js-tz-add" title="添加一个时区，对比同一时间戳在当地的时间"></div>
            <div class="js-tz-rows"></div>
          </div>
          <div class="card">
            <div class="card-head">
              <h3>日期时间 → 时间戳</h3>
              <button type="button" class="btn btn-ghost btn-sm js-reset-dt" title="恢复为此刻与本机时区">重置</button>
            </div>
            <div class="dt-row">
              <input class="text-input mono js-dt-text" placeholder="如 2026-09-24 09:00:00" spellcheck="false" />
              <button type="button" class="btn btn-ghost js-now-btn" title="填入当前时刻在该时区的时间">此刻</button>
            </div>
            <input type="datetime-local" step="1" class="text-input js-dt-picker" title="也可用日历控件选择日期时间" />
            <div class="tz-pick-row">
              <span class="tz-label">按此时区解释</span>
              <div class="js-dt-tz"></div>
            </div>
            <div class="hint js-dt-hint"></div>
            <div class="js-dt-rows"></div>
          </div>
        </div>`;

      /* ---- 当前时间实时显示 ---- */
      const nowSec = panel.querySelector('.js-now-sec');
      const nowMs = panel.querySelector('.js-now-ms');
      const nowDate = panel.querySelector('.js-now-date');
      function tick() {
        const d = new Date();
        nowSec.textContent = Math.floor(d.getTime() / 1000);
        nowMs.textContent = d.getTime();
        nowDate.textContent = `本地时间 ${fmtLocal(d)} · 本机时区 ${LOCAL_TZ}`;
      }
      tick();
      setInterval(tick, 250);
      panel.querySelector('.js-copy-sec').addEventListener('click', e => copyText(nowSec.textContent, e.currentTarget));
      panel.querySelector('.js-copy-ms').addEventListener('click', e => copyText(nowMs.textContent, e.currentTarget));

      /* ---- 时间戳 → 日期时间 ---- */
      const tsIn = panel.querySelector('.js-ts-in');
      const tsHint = panel.querySelector('.js-ts-hint');
      const tsRowsBox = panel.querySelector('.js-ts-rows');
      const tzAdd = panel.querySelector('.js-tz-add');
      const tzRowsBox = panel.querySelector('.js-tz-rows');
      const tsRows = {
        local: resultRow('本地时间'),
        utc: resultRow('UTC 时间'),
        week: resultRow('星期'),
        rel: resultRow('相对'),
      };
      Object.values(tsRows).forEach(r => tsRowsBox.appendChild(r.row));

      let addedZones = [];
      let lastDate = null;

      const tzAddPicker = makeZonePicker({
        placeholder: '＋ 添加时区对比…',
        action: true,
        onChange: tz => {
          if (!addedZones.includes(tz)) addedZones.push(tz);
          renderTzRows();
        },
      });
      tzAdd.appendChild(tzAddPicker.el);

      function renderTzRows() {
        tzRowsBox.innerHTML = '';
        addedZones.forEach(tz => {
          const row = document.createElement('div');
          row.className = 'result-row tz-row';
          /* 名称与时间分两行，避免长时区名 + 时间 + 偏移挤在一行折行 */
          const main = document.createElement('div');
          main.className = 'tz-row-main';
          const name = document.createElement('span');
          name.className = 'tz-row-name';
          name.textContent = zoneLabel(tz);
          name.title = tz;
          const val = document.createElement('span');
          val.className = 'tz-row-val';
          val.textContent = lastDate ? `${fmtInZone(lastDate, tz)}（${offsetLabel(lastDate, tz)}）` : '—';
          main.append(name, val);
          const rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'tz-remove';
          rm.textContent = '×';
          rm.title = '移除该时区';
          rm.addEventListener('click', () => {
            addedZones = addedZones.filter(z => z !== tz);
            renderTzRows();
          });
          row.append(main, rm);
          tzRowsBox.appendChild(row);
        });
      }

      function convertFromTs() {
        const parsed = parseTimestamp(tsIn.value);
        if (!parsed) {
          tsHint.textContent = tsIn.value.trim() ? '无法识别，请输入纯数字时间戳' : '';
          Object.values(tsRows).forEach(r => r.set('—'));
          lastDate = null;
        } else {
          const { date, unit } = parsed;
          tsHint.textContent = unit;
          tsRows.local.set(fmtLocal(date));
          tsRows.utc.set(fmtUtc(date));
          tsRows.week.set(`星期${WEEK[date.getDay()]}`);
          tsRows.rel.set(relTime(date.getTime()));
          lastDate = date;
        }
        renderTzRows();
      }
      tsIn.addEventListener('input', convertFromTs);
      panel.querySelector('.js-reset-ts').addEventListener('click', () => {
        tsIn.value = '';
        addedZones = [];
        convertFromTs();
      });

      /* ---- 日期时间 → 时间戳（可指定时区解释） ---- */
      const dtText = panel.querySelector('.js-dt-text');
      const dtPicker = panel.querySelector('.js-dt-picker');
      const dtTzSel = panel.querySelector('.js-dt-tz');
      const dtHint = panel.querySelector('.js-dt-hint');
      const dtRowsBox = panel.querySelector('.js-dt-rows');
      const dtRows = {
        sec: resultRow('秒级'),
        ms: resultRow('毫秒级'),
        iso: resultRow('ISO 8601'),
      };
      Object.values(dtRows).forEach(r => dtRowsBox.appendChild(r.row));

      let dtTz = LOCAL_TZ;
      const dtTzPicker = makeZonePicker({
        value: LOCAL_TZ,
        onChange: tz => { dtTz = tz; convertFromDt(); },
      });
      dtTzSel.appendChild(dtTzPicker.el);

      function convertFromDt() {
        const w = parseWallTime(dtText.value);
        if (!w) {
          dtHint.textContent = dtText.value.trim() ? '无法识别，格式如 2026-09-24 09:00:00' : '';
          Object.values(dtRows).forEach(r => r.set('—'));
          return;
        }
        dtPicker.value = `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}`;
        const ms = wallToMs(w.y, w.mo, w.d, w.h, w.mi, w.s, dtTz);
        const d = new Date(ms);
        dtRows.sec.set(String(Math.floor(ms / 1000)));
        dtRows.ms.set(String(ms));
        dtRows.iso.set(d.toISOString());
        dtHint.textContent = `按 ${zoneLabel(dtTz)}（${offsetLabel(d, dtTz)}）解释`;
      }
      dtText.addEventListener('input', convertFromDt);
      dtPicker.addEventListener('change', () => {
        if (!dtPicker.value) return;
        dtText.value = dtPicker.value.replace('T', ' ');
        convertFromDt();
      });

      function setNow() {
        const p = zoneParts(new Date(), dtTz);
        const t = `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
        dtText.value = t.replace('T', ' ');
        convertFromDt();
      }
      panel.querySelector('.js-now-btn').addEventListener('click', setNow);
      panel.querySelector('.js-reset-dt').addEventListener('click', () => {
        dtTz = LOCAL_TZ;
        dtTzPicker.set(LOCAL_TZ);
        setNow();
      });

      /* hash 深链预置时区，如 #timestamp@Asia/Tokyo,America/New_York */
      if (presetZones) {
        presetZones.split(',').map(s => s.trim())
          .filter(tz => tz && tz !== LOCAL_TZ && isValidZone(tz))
          .forEach(tz => { if (!addedZones.includes(tz)) addedZones.push(tz); });
      }

      setNow();
      renderTzRows();
    }
  });
})();
