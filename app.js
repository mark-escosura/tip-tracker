/* Tip Tracker: private, offline tip log with an Apple-style scroll-driven 3D dashboard.
   Data: localStorage only (key tiptracker.shifts.v1). No network requests at runtime. */
(function () {
  'use strict';
  var LOGGING = true;                 // phase switch: false = motion preview only (demo data)
  var KEY = 'tiptracker.shifts.v1';
  var SHIFTS = ['breakfast', 'lunch', 'dinner', 'overnight'];
  var $ = function (s) { return document.querySelector(s); };
  var qs = new URLSearchParams(location.search);
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- helpers ---------------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromIso(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function monday(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function money(v) { v = r2(v); var neg = v < 0; v = Math.abs(v);
    var s = Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (neg ? '−$' : '$') + s; }
  function rate(v) { return v == null ? '—' : '$' + v.toFixed(2) + '/hr'; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function nice(s) { var d = fromIso(s); return DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate(); }
  function num(v) { if (v == null) return null; v = String(v).replace(/[$,\s]/g, ''); if (v === '') return null; var n = Number(v); return isFinite(n) ? n : NaN; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  var WAGE_KEY = 'tiptracker.wage', DEFAULT_WAGE = 16.90;
  function getWage() { var w = parseFloat(localStorage.getItem(WAGE_KEY)); return isFinite(w) && w >= 0 && w <= 200 ? w : DEFAULT_WAGE; }
  var wage = getWage();
  function wages(s) { return s.hours * wage; }
  function take(s) { return wages(s) + (s.tips || 0) - (s.tipout || 0); }          // take-home = wages + tips - tip-out
  function netTips(s) { return (s.tips || 0) - (s.tipout || 0); }

  /* ---------------- storage ---------------- */
  function valid(s) { return s && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && SHIFTS.indexOf(s.shift) >= 0 && s.hours > 0; }
  /* v1 entries had separate cash/card: sum them into tips (one-time migration) */
  function migrate(s) {
    if (s && s.tips == null && (s.cash != null || s.card != null)) { s.tips = r2((+s.cash || 0) + (+s.card || 0)); }
    if (s) { delete s.cash; delete s.card; if (s.tips == null) s.tips = 0; }
    return s;
  }
  function load() { try { var raw = localStorage.getItem(KEY) || '[]', a = JSON.parse(raw); if (!Array.isArray(a)) return [];
      var out = a.map(migrate).filter(valid); var nr = JSON.stringify(out); if (nr !== raw) localStorage.setItem(KEY, nr); return out; } catch (e) { return []; } }
  function save() { localStorage.setItem(KEY, JSON.stringify(shifts)); }
  var shifts = load();

  /* Demo shifts: in-memory only, never saved, always badged */
  function demoShifts() {
    var now = new Date(), m = monday(now), out = [];
    var plan = [ // dayOffset from Monday, shift, hours, tips (two parts), sales, tipout
      [0, 'lunch', 5, 38, 41, 420, 8], [1, 'dinner', 6, 52, 67, 610, 12], [2, 'breakfast', 5.5, 46, 29, 380, 7],
      [3, 'dinner', 6, 61, 74, 690, 14], [4, 'dinner', 7, 88, 96, 900, 18], [5, 'breakfast', 6, 71, 58, 640, 12], [6, 'overnight', 7, 34, 52, 410, 8],
      [-7, 'dinner', 6, 55, 60, 600, 11], [-6, 'lunch', 5, 35, 39, 400, 7], [-4, 'dinner', 6.5, 70, 81, 760, 15], [-3, 'dinner', 7, 79, 90, 850, 17],
      [-2, 'breakfast', 6, 64, 49, 560, 11], [-12, 'dinner', 6, 58, 66, 640, 12], [-10, 'lunch', 5, 31, 44, 390, 7], [-9, 'dinner', 7, 82, 85, 830, 16]];
    plan.forEach(function (p, i) { var d = addDays(m, p[0]); if (d > now) return;
      out.push({ id: 'demo' + i, date: iso(d), shift: p[1], hours: p[2], tips: p[3] + p[4], sales: p[5], tipout: p[6], note: '', demo: true }); });
    return out;
  }
  function isDemo() { return !LOGGING || shifts.length === 0; }
  function dataset() { return isDemo() ? demoShifts() : shifts; }

  /* ---------------- stats ---------------- */
  function agg(list) {
    var a = { n: list.length, tips: 0, tipout: 0, hours: 0, sales: 0, salesTips: 0 };
    list.forEach(function (s) { a.tips += s.tips || 0; a.tipout += s.tipout || 0; a.hours += s.hours;
      if (s.sales > 0) { a.sales += s.sales; a.salesTips += s.tips || 0; } });
    a.wages = a.hours * wage; a.take = a.wages + a.tips - a.tipout;
    a.rate = a.hours > 0 ? a.take / a.hours : null;                       // total $/hr
    a.tipRate = a.hours > 0 ? (a.tips - a.tipout) / a.hours : null;       // tips $/hr (after tip-out)
    a.tipPct = a.sales > 0 ? a.salesTips / a.sales : null; return a;
  }
  function stats(list) {
    var now = new Date(), m = monday(now), mIso = iso(m), sIso = iso(addDays(m, 6));
    var ym = iso(now).slice(0, 7), todayIdx = (now.getDay() + 6) % 7;
    var wk = list.filter(function (s) { return s.date >= mIso && s.date <= sIso; });
    var mo = list.filter(function (s) { return s.date.slice(0, 7) === ym; });
    var days = [0, 0, 0, 0, 0, 0, 0];
    wk.forEach(function (s) { days[(fromIso(s.date).getDay() + 6) % 7] += take(s); });
    var weeks = {}; list.forEach(function (s) { var k = iso(monday(fromIso(s.date))); weeks[k] = (weeks[k] || 0) + take(s); });
    var bestWeek = 0; Object.keys(weeks).forEach(function (k) { if (weeks[k] > bestWeek) bestWeek = weeks[k]; });
    var best = list.filter(function (s) { return s.hours > 0; }).map(function (s) { return { s: s, rate: take(s) / s.hours }; })
      .sort(function (a, b) { return b.rate - a.rate; }).slice(0, 5);
    var W = agg(wk);
    return { week: W, month: agg(mo), all: agg(list), days: days, today: todayIdx, best: best, weeks: weeks,
      bestWeek: bestWeek, fill: W.take > 0 ? Math.min(1, W.take / Math.max(bestWeek, W.take)) : 0 };
  }

  /* ---------------- quick text parser ---------------- */
  var WD = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
  function parseQuick(text) {
    var out = { date: null, shift: null, hours: null, tips: null, tipParts: [], sales: null, tipout: null, note: '', leftovers: [] };
    var raw = String(text || ''); var nm = raw.match(/\bnote[:\s-]+(.+)$/i);
    if (nm) { out.note = nm[1].trim(); raw = raw.slice(0, nm.index); }
    var t = ' ' + raw.toLowerCase() + ' ', today = new Date();
    var dm = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (dm) { var y = dm[3] ? (+dm[3] < 100 ? 2000 + +dm[3] : +dm[3]) : today.getFullYear(); var dd = new Date(y, +dm[1] - 1, +dm[2]);
      if (!dm[3] && dd > today) dd.setFullYear(y - 1); if (!isNaN(dd)) out.date = iso(dd); t = t.replace(dm[0], ' '); }
    else if (/\byesterday\b/.test(t)) { out.date = iso(addDays(today, -1)); }
    else if (/\b(today|tonight|this morning)\b/.test(t)) { out.date = iso(today); }
    else { var wm = t.match(/\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/);
      if (wm) { var back = (today.getDay() - WD[wm[1]] + 7) % 7; out.date = iso(addDays(today, -back)); t = t.replace(wm[0], ' '); } }
    t = t.replace(/\b(yesterday|today|tonight|this morning|last|on|and|plus)\b/g, ' ');
    var sm = t.match(/\b(breakfast|bfast|brekkie|morning|lunch|dinner|supper|overnight|graveyard|grave|overnite)\b/);
    if (sm) { var w = sm[1]; out.shift = /^(breakfast|bfast|brekkie|morning)$/.test(w) ? 'breakfast' : w === 'lunch' ? 'lunch' : /^(dinner|supper)$/.test(w) ? 'dinner' : 'overnight'; t = t.replace(sm[0], ' '); }
    var hm = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
    if (hm) { out.hours = +hm[1]; t = t.replace(hm[0], ' '); }
    // keywords: tip-out first (it contains "tip"), then anything that means tips (cash/card still accepted and summed)
    t = t.replace(/tipped\s*out|tip\s*-?\s*out|tipout|t\/o|tipping\s*out/g, ' tipout ')
         .replace(/\bcredit\s*cards?\b|\bcards?\b|\bcc\b|\bcredit\b|\bcash\b|\btips?\b|\bmade\b|\bgratuity\b|\bgrats?\b/g, ' tips ')
         .replace(/\bin\b|:/g, ' ').replace(/\bsale\b/g, 'sales');
    var toks = t.replace(/,/g, ' , ').replace(/\$/g, ' ').split(/\s+/).filter(Boolean);
    var isNum = function (x) { return /^\d+(?:\.\d+)?$/.test(x); }, used = {};
    function grab(i, preferBefore) {
      var order = preferBefore ? [i - 1, i + 1] : [i + 1, i - 1];
      for (var k = 0; k < 2; k++) { var j = order[k]; if (j >= 0 && j < toks.length && isNum(toks[j]) && !used[j]) { used[j] = 1; toks[i] = '_'; return +toks[j]; } }
      return null;
    }
    function kw(word, preferBefore) { var i = toks.indexOf(word); return i < 0 ? null : grab(i, preferBefore); }
    out.tipout = kw('tipout', false); out.sales = kw('sales', false);
    toks.forEach(function (x, i) { if (x === 'tips') { var v = grab(i, true); if (v != null) out.tipParts.push(v); } });
    var left = []; toks.forEach(function (x, i) { if (isNum(x) && !used[i]) left.push(+x); });
    if (out.tipParts.length) out.tips = r2(out.tipParts.reduce(function (a, b) { return a + b; }, 0));
    else if (left.length === 1) { out.tips = left[0]; out.tipParts = [left[0]]; left = []; }   // bare amount = tips
    out.leftovers = left;
    return out;
  }
  function quickReady(p) { return p.shift && p.hours > 0 && p.hours <= 24 && p.tips != null && !p.leftovers.length; }
  function fromParsed(p, date) { return { date: date || p.date || iso(new Date()), shift: p.shift, hours: p.hours, tips: p.tips || 0,
    sales: p.sales, tipout: p.tipout || 0, note: p.note || '' }; }
  function previewHTML(p, date) {
    var chip = function (label, val, miss) { return '<span class="chip' + (miss ? ' miss' : '') + '">' + label + (val != null ? ' ' + val : '') + '</span>'; };
    var h = '<div class="chips">' + chip(date ? nice(date) : p.date ? nice(p.date) : nice(iso(new Date())) + ' (today)') +
      (p.shift ? chip(cap(p.shift)) : chip('shift?', null, true)) + (p.hours ? chip(p.hours + 'h') : chip('hours?', null, true)) +
      (p.tips != null ? chip('Tips', money(p.tips) + (p.tipParts.length > 1 ? ' (' + p.tipParts.join(' + ') + ')' : '')) : chip('tips?', null, true)) +
      (p.tipout != null ? chip('Tip-out', money(p.tipout)) : '') + (p.sales != null ? chip('Sales', money(p.sales)) : '') +
      (p.note ? chip('Note: ' + esc(p.note)) : '') + '</div>';
    if (p.tips != null && p.hours > 0) { var w = p.hours * wage, tk = w + p.tips - (p.tipout || 0);
      h += '<div class="sum">Take-home <b>' + money(tk) + '</b> · ' + rate(tk / p.hours) + '<div class="muted small">Wages ' + money(w) + ' + tips ' + money(p.tips) + (p.tipout ? ' − tip-out ' + money(p.tipout) : '') + '</div></div>'; }
    if (p.leftovers.length) h += '<div class="warn">Not sure what ' + p.leftovers.map(function (x) { return '$' + x; }).join(', ') + ' is. Say tips, sales or tipped out.</div>';
    return h;
  }

  /* ---------------- CSV ---------------- */
  var COLS = ['id', 'date', 'shift', 'hours', 'tips', 'sales', 'tipout', 'note'];
  function csvCell(v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCSV(list) { return COLS.join(',') + '\n' + list.map(function (s) { return COLS.map(function (c) { return csvCell(s[c]); }).join(','); }).join('\n') + '\n'; }
  function parseCSV(text) {
    var rows = [], row = [], cell = '', q = false; text = text.replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) { var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c; }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ''; }); });
  }
  function importCSV(text) {
    var rows = parseCSV(text); if (!rows.length) return { added: 0, skipped: 0, bad: 0 };
    var head = rows[0].map(function (h) { return h.trim().toLowerCase().replace(/[^a-z]/g, ''); });
    var ix = {}; COLS.concat(['cash', 'card']).forEach(function (c) { ix[c] = head.indexOf(c); });
    if (ix.date < 0 || ix.shift < 0 || ix.hours < 0) return { error: 'CSV needs date, shift and hours columns' };
    var ids = {}, sig = {}; var sg = function (s) { return [s.date, s.shift, s.hours, s.tips, s.tipout].join('|'); };
    shifts.forEach(function (s) { ids[s.id] = 1; sig[sg(s)] = 1; });
    var res = { added: 0, skipped: 0, bad: 0 };
    rows.slice(1).forEach(function (r) {
      var g = function (c) { return ix[c] >= 0 ? (r[ix[c]] || '').trim() : ''; };
      var date = g('date'), md = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (md) date = (md[3].length === 2 ? '20' + md[3] : md[3]) + '-' + pad(+md[1]) + '-' + pad(+md[2]);
      // old CSVs (cash, card columns) are summed into tips
      var tips = g('tips') !== '' ? num(g('tips')) : r2((num(g('cash')) || 0) + (num(g('card')) || 0));
      var s = { id: g('id') || uid(), date: date, shift: g('shift').toLowerCase(), hours: num(g('hours')), tips: tips,
        sales: num(g('sales')), tipout: num(g('tipout')) || 0, note: g('note') };
      if (!valid(s) || [s.tips, s.tipout].some(isNaN) || (s.sales != null && isNaN(s.sales)) || isNaN(num(g('cash')) || 0) || isNaN(num(g('card')) || 0)) { res.bad++; return; }
      if (ids[s.id] || sig[sg(s)]) { res.skipped++; return; }
      ids[s.id] = 1; sig[sg(s)] = 1; shifts.push(s); res.added++;
    });
    if (res.added) save(); return res;
  }

  /* ---------------- UI render ---------------- */
  var S;  // current stats
  var scene = null, fallback = null;
  var calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1), calSel = null;
  function shiftRow(s) { var tk = take(s);
    return '<div class="shift" data-id="' + esc(s.id) + '"><div class="main"><div class="t">' + nice(s.date) + ' · ' + cap(s.shift) + (s.demo ? '<span class="demo-tag">DEMO</span>' : '') + '</div>' +
      '<div class="d">' + s.hours + 'h · ' + money(wages(s)) + ' wages · ' + money(s.tips) + ' tips' + (s.tipout ? ' · −' + money(s.tipout) + ' tip-out' : '') +
      (s.sales ? ' · ' + money(s.sales) + ' sales' : '') + (s.note ? ' · ' + esc(s.note) : '') + '</div></div>' +
      '<div class="amt"><b>' + money(tk) + '</b><span>' + rate(tk / s.hours) + '</span></div>' +
      (s.demo ? '' : '<button class="icon-btn" data-act="edit" aria-label="Edit shift">✎</button><button class="icon-btn del" data-act="del" aria-label="Delete shift">✕</button>') + '</div>';
  }
  function renderAll() {
    var list = dataset(), demo = isDemo(); S = stats(list);
    $('#demoBadge').hidden = !demo;
    var W = S.week, M = S.month, A = S.all;
    $('#c1Big').textContent = money(W.take);
    $('#c1Line').innerHTML = W.n ? '<b>' + rate(W.rate) + '</b> total · tips ' + rate(W.tipRate) + ' · ' + W.n + ' shift' + (W.n > 1 ? 's' : '') + ' · ' + r2(W.hours) + 'h' : 'No shifts yet this week. Log one below.';
    $('#c1Split').textContent = W.n ? 'Wages ' + money(W.wages) + ' · Tips ' + money(W.tips) + (W.tipout ? ' · Tip-out −' + money(W.tipout) : '') : '';
    $('#c2Big').textContent = W.take > 0 ? Math.round(S.fill * 100) + '% of your best week' : 'Empty jar';
    $('#c2Line').innerHTML = M.n ? 'This month: <b>' + money(M.take) + '</b> take-home · ' + rate(M.rate) : 'No shifts logged this month yet.';
    var bi = -1, bv = 0; S.days.forEach(function (v, i) { if (v > bv) { bv = v; bi = i; } });
    var DN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    $('#c3Big').textContent = bi >= 0 ? 'Best day: ' + DN[bi] + ' ' + money(bv) : 'No days yet';
    $('#c3Line').textContent = 'Mon–Sun take-home: wages + tips − tip-out.';
    var b = S.best[0];
    $('#c4Big').textContent = b ? '$' + b.rate.toFixed(2) + '/hr' : 'No shifts yet';
    $('#c4Line').innerHTML = b ? nice(b.s.date) + ' · ' + cap(b.s.shift) + ' · ' + b.s.hours + 'h · <b>' + money(take(b.s)) + '</b> · tips ' + rate(netTips(b.s) / b.s.hours) : '';
    $('#c4All').textContent = A.n ? 'All time: ' + money(A.take) + ' over ' + A.n + ' shift' + (A.n > 1 ? 's' : '') + ' · ' + rate(A.rate) : '';

    function tcard(k, a, emptyMsg) {
      if (!a.n) return '<div class="glass tcard reveal"><div class="k">' + k + '</div><div class="empty">' + emptyMsg + '</div></div>';
      return '<div class="glass tcard reveal"><div class="k">' + k + '</div><div class="v">' + money(a.take) + '</div>' +
        '<div class="r"><b>' + rate(a.rate) + '</b> total · tips ' + rate(a.tipRate) + '</div>' +
        '<div class="s">Wages ' + money(a.wages) + ' (' + r2(a.hours) + 'h × $' + wage.toFixed(2) + ') · Tips ' + money(a.tips) + ' · Tip-out ' + money(a.tipout) +
        '<br>' + a.n + ' shift' + (a.n > 1 ? 's' : '') + (a.tipPct != null ? ' · tips ' + (a.tipPct * 100).toFixed(1) + '% of sales' : '') + '</div></div>';
    }
    $('#totals').innerHTML = tcard('This week', W, 'No shifts yet this week.') + tcard('This month', M, 'No shifts yet this month.') + tcard('All time', A, 'No shifts yet.');
    $('#bestList').innerHTML = S.best.length ? S.best.map(function (x) {
      return '<li><div class="who">' + nice(x.s.date) + ' · ' + cap(x.s.shift) + '<div class="sub">' + x.s.hours + 'h · ' + money(take(x.s)) + ' take-home · tips ' + rate(netTips(x.s) / x.s.hours) + '</div></div><div class="rate">$' + x.rate.toFixed(2) + '/hr</div></li>';
    }).join('') : '<li class="empty" style="counter-increment:none">Log a shift to see your best ones.</li>';
    var sorted = list.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : SHIFTS.indexOf(b.shift) - SHIFTS.indexOf(a.shift); });
    var groups = []; var gi = {};
    sorted.forEach(function (s) { var k = iso(monday(fromIso(s.date))); if (!(k in gi)) { gi[k] = groups.length; groups.push({ k: k, items: [] }); } groups[gi[k]].items.push(s); });
    $('#shiftCount').textContent = list.length ? list.length + ' total' : '';
    $('#shiftList').innerHTML = groups.length ? groups.map(function (g) { var a = agg(g.items);
      return '<div class="wk"><div class="wk-h"><span>Week of ' + nice(g.k).slice(4) + '</span><span>' + money(a.take) + ' · ' + rate(a.rate) + '</span></div>' +
        g.items.map(shiftRow).join('') + '</div>'; }).join('') : '<div class="empty">No shifts yet.</div>';
    renderCalendar();

    var d3 = { week: S.days.slice(), weekTotal: W.take, fill: S.fill, today: S.today, money: function (v) { return money(Math.round(v)); },
      bigLabel: money(Math.round(W.take)), subLabel: demo ? 'DEMO · this week' : 'this week · take-home',
      bestLabel: b ? '$' + b.rate.toFixed(2) + '/hr' : '', bestSub: b ? 'best shift · ' + cap(b.s.shift) + ' ' + nice(b.s.date) : '' };
    if (scene) scene.setData(d3); if (fallback) fallback.setData(d3);
    lockUI();
    initReveals();
    if (window.ScrollTrigger) { clearTimeout(renderAll._t); renderAll._t = setTimeout(function () { ScrollTrigger.refresh(); }, 60); }
  }

  /* ---------------- calendar ---------------- */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function short$(v) { v = Math.round(v); return v >= 10000 ? '$' + Math.round(v / 1000) + 'k' : v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + v; }
  function renderCalendar() {
    var list = dataset(), y = calMonth.getFullYear(), m = calMonth.getMonth(), ym = y + '-' + pad(m + 1);
    var byDay = {}; list.forEach(function (s) { if (s.date.slice(0, 7) === ym) (byDay[s.date] = byDay[s.date] || []).push(s); });
    var monthList = list.filter(function (s) { return s.date.slice(0, 7) === ym; }), a = agg(monthList);
    $('#calMonth').textContent = MONTHS[m] + ' ' + y + (isDemo() ? ' · demo' : '');
    $('#calTotal').textContent = money(a.take);
    $('#calSub').textContent = a.n ? a.n + ' shift' + (a.n > 1 ? 's' : '') + ' · ' + r2(a.hours) + 'h · ' + rate(a.rate) + ' · tips ' + money(a.tips) : 'No shifts this month';
    var totals = {}, max = 0; Object.keys(byDay).forEach(function (d) { totals[d] = byDay[d].reduce(function (t, s) { return t + take(s); }, 0); if (totals[d] > max) max = totals[d]; });
    var first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate(), todayIso = iso(new Date()), html = '', i = 0;
    for (var k = 0; k < lead; k++, i++) html += '<div class="cal-cell blank" style="--i:' + i + '" aria-hidden="true"></div>';
    for (var d = 1; d <= days; d++, i++) {
      var di = ym + '-' + pad(d), v = totals[di] || 0, n = (byDay[di] || []).length, heat = max > 0 ? v / max : 0;
      var cls = 'cal-cell' + (n ? ' has' : '') + (heat > 0.55 ? ' hot' : '') + (di === todayIso ? ' today' : '') + (di === calSel ? ' sel' : '') + (di > todayIso ? ' future' : '');
      var bg = n ? 'background:linear-gradient(160deg,rgba(255,210,122,' + (0.18 + heat * 0.72).toFixed(3) + '),rgba(242,184,75,' + (0.08 + heat * 0.6).toFixed(3) + '));' : '';
      html += '<button type="button" class="' + cls + '" data-date="' + di + '" style="--i:' + i + ';' + bg + '" aria-label="' + nice(di) + (n ? ', ' + money(v) + ' take-home' : ', no shifts') + '">' +
        '<span class="dn">' + d + '</span>' + (n > 1 ? '<span class="dots">' + new Array(Math.min(n, 3) + 1).join('<i></i>') + '</span>' : '') +
        '<span class="dv">' + (n ? short$(v) : '') + '</span></button>';
    }
    $('#calGrid').innerHTML = html;
    renderDay();
  }
  function renderDay() {
    var el = $('#calDay'); if (!calSel) { el.hidden = true; el.innerHTML = ''; return; }
    var list = dataset().filter(function (s) { return s.date === calSel; }), a = agg(list);
    var keep = $('#dayQuick') ? $('#dayQuick').value : '';
    el.innerHTML = '<h3>' + nice(calSel) + '</h3><div class="daysum">' + (a.n ? money(a.take) + ' take-home · ' + rate(a.rate) + ' · ' + a.n + ' shift' + (a.n > 1 ? 's' : '') : 'No shifts this day') + '</div>' +
      list.map(shiftRow).join('') +
      (LOGGING ? '<div class="quick-wrap" style="margin-top:10px"><label class="sr" for="dayQuick">Log on this day</label><input id="dayQuick" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="Log here: 6h dinner, 73 tips"></div>' +
        '<div id="dayPreview" class="preview" hidden></div>' +
        '<div class="row-btns"><button type="button" class="btn gold" id="daySave" disabled>Save to ' + nice(calSel).slice(4) + '</button><button type="button" class="btn ghost" id="dayForm">Full form</button></div>' : '');
    el.hidden = false;
    if (keep && $('#dayQuick')) { $('#dayQuick').value = keep; dayPreview(); }
  }
  var dayParsed = null;
  function dayPreview() {
    var v = $('#dayQuick').value.trim(), pv = $('#dayPreview');
    if (!v) { pv.hidden = true; dayParsed = null; $('#daySave').disabled = true; return; }
    dayParsed = parseQuick(v); pv.innerHTML = previewHTML(dayParsed, calSel); pv.hidden = false; $('#daySave').disabled = !quickReady(dayParsed);
  }
  function calShift(delta) {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1); calSel = null; renderCalendar();
    if (window.gsap && !reduced) gsap.fromTo('#calGrid', { x: delta * 36, opacity: 0.2 }, { x: 0, opacity: 1, duration: 0.35, ease: 'power2.out' });
    if (window.ScrollTrigger) ScrollTrigger.refresh();
  }
  function bindCalendar() {
    $('#calPrev').addEventListener('click', function () { calShift(-1); });
    $('#calNext').addEventListener('click', function () { calShift(1); });
    var g = $('#calGrid'), sx = 0, sy = 0, st = 0;
    g.addEventListener('touchstart', function (e) { var t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
    g.addEventListener('touchend', function (e) { var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - st < 800) { g._swiped = Date.now(); calShift(dx < 0 ? 1 : -1); } }, { passive: true });
    g.addEventListener('click', function (e) {
      if (g._swiped && Date.now() - g._swiped < 400) return;
      var c = e.target.closest('.cal-cell[data-date]'); if (!c) return;
      var d = c.getAttribute('data-date'); calSel = calSel === d ? null : d; renderCalendar();
      if (calSel && window.ScrollTrigger) ScrollTrigger.refresh();
    });
    var day = $('#calDay');
    day.addEventListener('input', function (e) { if (e.target.id === 'dayQuick') dayPreview(); });
    day.addEventListener('keydown', function (e) { if (e.target.id === 'dayQuick' && e.key === 'Enter') { e.preventDefault(); if (!$('#daySave').disabled) $('#daySave').click(); } });
    day.addEventListener('click', function (e) {
      if (e.target.id === 'daySave') { if (!dayParsed || !quickReady(dayParsed)) return; editing = null; var keepSel = calSel;
        $('#dayQuick').value = ''; commit(fromParsed(dayParsed, keepSel)); calSel = keepSel; renderCalendar(); return; }
      if (e.target.id === 'dayForm') { var p = $('#dayQuick') && $('#dayQuick').value.trim() ? parseQuick($('#dayQuick').value) : null;
        resetForm(); if (p) fillForm(fromParsed(p, calSel)); $('#fDate').value = calSel; goTo('#log', function () { $('#fHours').focus({ preventScroll: true }); }); return; }
      onShiftAction(e);
    });
  }

  function lockUI() {
    $('#logLocked').hidden = LOGGING; $('.log-card').classList.toggle('is-locked', !LOGGING);
    $('#logHint').textContent = LOGGING ? 'Under 10 seconds' : 'Preview';
    Array.prototype.forEach.call(document.querySelectorAll('#log input, #log button'), function (el) { el.disabled = !LOGGING; });
  }

  var toastT;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2600); }

  /* ---------------- form ---------------- */
  var editing = null;
  function resetForm() {
    editing = null; $('#form').reset(); $('#fDate').value = iso(new Date());
    $('#saveBtn').textContent = 'Save shift'; $('#cancelEdit').hidden = true; $('#formErr').textContent = ''; $('#more').open = false; updateTakeLine();
  }
  function readForm() {
    var sh = document.querySelector('input[name=shift]:checked');
    return { date: $('#fDate').value, shift: sh ? sh.value : null, hours: num($('#fHours').value), tips: num($('#fTips').value),
      sales: num($('#fSales').value), tipout: num($('#fTipout').value), note: $('#fNote').value.trim() };
  }
  function fillForm(s) {
    $('#fDate').value = s.date || iso(new Date());
    Array.prototype.forEach.call(document.querySelectorAll('input[name=shift]'), function (r) { r.checked = r.value === s.shift; });
    $('#fHours').value = s.hours != null ? s.hours : ''; $('#fTips').value = s.tips != null ? s.tips : '';
    $('#fSales').value = s.sales != null ? s.sales : ''; $('#fTipout').value = s.tipout ? s.tipout : ''; $('#fNote').value = s.note || '';
    $('#more').open = !!(s.sales != null || s.note); updateTakeLine();
  }
  function validate(f) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) return 'Pick a date.';
    if (!f.shift) return 'Pick a shift.';
    if (!(f.hours > 0) || f.hours > 24) return 'Hours should be between 0 and 24.';
    if (f.tips == null) return 'Add your tips (0 is fine).';
    if ([f.tips, f.tipout, f.sales].some(function (v) { return v != null && (isNaN(v) || v < 0); })) return 'Amounts should be numbers, 0 or more.';
    return '';
  }
  function updateTakeLine() {
    var f = readForm(), t = f.tipout || 0;
    if (f.tips == null || isNaN(f.tips) || isNaN(t) || !(f.hours > 0)) { $('#takeLine').innerHTML = ''; return; }
    var w = f.hours * wage, tk = w + f.tips - t;
    $('#takeLine').innerHTML = 'Take-home <b>' + money(tk) + '</b> · ' + rate(tk / f.hours) + '<br><span class="muted small">Wages ' + money(w) + ' + tips ' + money(f.tips) + (t ? ' − tip-out ' + money(t) : '') + '</span>';
  }
  function commit(f) {
    var rec = { date: f.date, shift: f.shift, hours: r2(f.hours), tips: r2(f.tips || 0),
      sales: f.sales != null && !isNaN(f.sales) ? r2(f.sales) : null, tipout: r2(f.tipout || 0), note: (f.note || '').slice(0, 200) };
    var msg;
    if (editing) { var i = shifts.findIndex(function (s) { return s.id === editing; }); if (i >= 0) { rec.id = editing; rec.createdAt = shifts[i].createdAt; shifts[i] = rec; } msg = 'Updated'; }
    else { rec.id = uid(); rec.createdAt = new Date().toISOString(); shifts.push(rec); msg = 'Saved'; }
    save(); renderAll(); toast(msg + ' · ' + money(take(rec)) + ' take-home · ' + rate(take(rec) / rec.hours));
    resetForm();
  }

  /* ---------------- quick entry ---------------- */
  var lastParsed = null;
  function renderPreview() {
    var v = $('#quick').value.trim(); var pv = $('#quickPreview'), bt = $('#quickBtns');
    if (!v) { pv.hidden = true; bt.hidden = true; lastParsed = null; return; }
    var p = parseQuick(v); lastParsed = p;
    pv.innerHTML = previewHTML(p); pv.hidden = false; bt.hidden = false;
    $('#quickSave').disabled = !LOGGING || !quickReady(p);
  }
  function onShiftAction(e) {
    var btn = e.target.closest('button[data-act]'); if (!btn) return; var id = btn.closest('.shift').getAttribute('data-id');
    var s = shifts.find(function (x) { return x.id === id; }); if (!s) return;
    if (btn.getAttribute('data-act') === 'edit') { editing = id; fillForm(s); $('#saveBtn').textContent = 'Update shift'; $('#cancelEdit').hidden = false; goTo('#log'); }
    else if (confirm('Delete ' + nice(s.date) + ' ' + s.shift + ' (' + money(take(s)) + ')?')) {
      shifts = shifts.filter(function (x) { return x.id !== id; }); save(); if (editing === id) resetForm(); renderAll(); toast('Deleted'); }
  }

  function bindUI() {
    resetForm(); bindCalendar();
    $('#fWage').value = wage.toFixed(2);
    $('#fWage').addEventListener('change', function () { var v = num(this.value);
      if (v == null || isNaN(v) || v < 0 || v > 200) { this.value = wage.toFixed(2); toast('Wage should be between $0 and $200'); return; }
      wage = r2(v); localStorage.setItem(WAGE_KEY, String(wage)); this.value = wage.toFixed(2); renderAll(); updateTakeLine(); toast('Base wage set to $' + wage.toFixed(2) + '/hr'); });
    $('#form').addEventListener('input', updateTakeLine);
    $('#form').addEventListener('change', updateTakeLine);
    $('#form').addEventListener('submit', function (e) { e.preventDefault(); if (!LOGGING) return;
      var f = readForm(), err = validate(f); $('#formErr').textContent = err; if (!err) commit(f); });
    $('#cancelEdit').addEventListener('click', resetForm);
    $('#quick').addEventListener('input', renderPreview);
    $('#quick').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (!$('#quickSave').disabled) $('#quickSave').click(); } });
    $('#quickSave').addEventListener('click', function () {
      if (!lastParsed || !quickReady(lastParsed)) return; editing = null; commit(fromParsed(lastParsed));
      $('#quick').value = ''; renderPreview(); $('#quick').blur(); });
    $('#quickToForm').addEventListener('click', function () { if (!lastParsed) return; fillForm(fromParsed(lastParsed));
      if (!lastParsed.shift) Array.prototype.forEach.call(document.querySelectorAll('input[name=shift]'), function (r) { r.checked = false; });
      if (lastParsed.tips == null) $('#fTips').value = '';
      $('#quick').value = ''; renderPreview(); $('#fHours').focus(); });
    $('#shiftList').addEventListener('click', onShiftAction);
    $('#fab').addEventListener('click', function () { goTo('#log', function () { if (LOGGING) $('#quick').focus({ preventScroll: true }); }); });
    $('#exportBtn').addEventListener('click', function () {
      if (!shifts.length) { toast('Nothing to export yet'); return; }
      var blob = new Blob([toCSV(shifts)], { type: 'text/csv' }); var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'tips-' + iso(new Date()) + '.csv'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); toast('Exported ' + shifts.length + ' shifts');
    });
    $('#importFile').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return; var rd = new FileReader();
      rd.onload = function () { var r = importCSV(String(rd.result)); e.target.value = '';
        if (r.error) { toast(r.error); return; } renderAll(); toast('Imported ' + r.added + (r.skipped ? ' · skipped ' + r.skipped + ' duplicate' + (r.skipped > 1 ? 's' : '') : '') + (r.bad ? ' · ' + r.bad + ' unreadable' : '')); };
      rd.readAsText(f);
    });
  }

  /* ---------------- scroll + 3D ---------------- */
  var lenis = null;
  var proxy = { p: 0, h: 0 };
  function goTo(sel, cb) {
    var el = $(sel); if (lenis) lenis.scrollTo(el, { offset: -70, duration: reduced ? 0 : 1.1, onComplete: cb || null });
    else { el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); if (cb) setTimeout(cb, reduced ? 0 : 600); }
  }
  function webglLevel() {
    if (qs.has('lite')) return 0;
    try { var c = document.createElement('canvas'); var gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return 0;
      var ext = gl.getExtension('WEBGL_debug_renderer_info'); var r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      if (/swiftshader|llvmpipe|software|basic render/i.test(r)) return 1;
      if ((navigator.deviceMemory || 8) <= 2 || (navigator.hardwareConcurrency || 8) <= 2) return 1;
      return 2; } catch (e) { return 0; }
  }
  function makeFallback() {
    var root = $('#fallback'); root.hidden = false; $('#gl').style.display = 'none';
    var barsEl = root.querySelector('.fb-bars'), jarEl = root.querySelector('.fb-jar'), fillEl = root.querySelector('.fb-fill'), data = { week: [0, 0, 0, 0, 0, 0, 0], fill: 0, today: -1 };
    var D = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    barsEl.innerHTML = D.map(function (d) { return '<div class="fb-bar"><i>' + d + '</i></div>'; }).join('');
    var bars = barsEl.children, last = -1;
    var sm = function (a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    return { setData: function (d) { data = d; last = -1; },
      render: function (p, h) { var key = p.toFixed(4) + h.toFixed(4); if (key === last) return; last = key;
        fillEl.style.setProperty('--fill', (data.fill * sm(0.04, 0.34, p)).toFixed(4));
        jarEl.style.transform = 'rotateY(' + (Math.sin(p * Math.PI * 2) * 14) + 'deg) scale(' + (1 - sm(0.4, 0.6, p) * 0.12) + ')';
        var max = Math.max.apply(null, data.week.concat([1]));
        for (var i = 0; i < 7; i++) { var rise = sm(0.34 + i * 0.012, 0.48 + i * 0.012, p);
          bars[i].style.height = Math.max(2, (data.week[i] / max) * 100 * rise) + '%'; bars[i].classList.toggle('today', i === data.today); }
        barsEl.style.transform = 'rotateX(' + (sm(0.62, 0.85, p) * 18 + h * 8) + 'deg) rotateY(' + (-12 + sm(0.35, 0.6, p) * 12 + sm(0.62, 0.85, p) * 10) + 'deg)';
      } };
  }

  var revealsDone = false;
  function initReveals() {
    if (revealsDone || reduced || !window.gsap) return; revealsDone = true;
    // history cards slide/fade in, scrubbed to scroll (linear)
    gsap.utils.toArray('#log .glass, #calendar .glass, #history > .glass').forEach(function (el) {
      gsap.fromTo(el, { y: 60, opacity: 0.25, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, ease: 'none',
        scrollTrigger: { trigger: el, start: 'top 98%', end: 'top 70%', scrub: 1 } });
    });
    // calendar cells rise in a staggered wave, scrubbed to scroll (CSS var survives month re-renders)
    var grid = document.getElementById('calGrid'); grid.style.setProperty('--rv', 0);
    var rv = { v: 0 };
    gsap.to(rv, { v: 1, ease: 'none', onUpdate: function () { grid.style.setProperty('--rv', rv.v.toFixed(3)); },
      scrollTrigger: { trigger: '#calendar', start: 'top 95%', end: 'top 35%', scrub: 1 } });
  }

  function initScroll() {
    var hasGsap = !!(window.gsap && window.ScrollTrigger);
    if (!hasGsap) return;
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });
    if (!reduced && window.Lenis) {
      lenis = new Lenis({ lerp: 0.09, smoothWheel: true, syncTouch: false });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
    }
    // One master timeline: pinned hero, scrubbed, long cinematic end. Scene = f(proxy.p).
    var tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: {
      trigger: '#hero', start: 'top top', end: '+=300%', pin: true, scrub: reduced ? true : 1, anticipatePin: 1 } });
    tl.to(proxy, { p: 1, duration: 1 }, 0)
      .to('#railFill', { scaleY: 1, duration: 1 }, 0)
      .to('#cue', { autoAlpha: 0, duration: 0.05 }, 0.01)
      .to('#ch1', { autoAlpha: 0, y: -30, duration: 0.05 }, 0.2)
      .fromTo('#ch2', { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.05 }, 0.26)
      .to('#ch2', { autoAlpha: 0, y: -30, duration: 0.05 }, 0.46)
      .fromTo('#ch3', { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.05 }, 0.52)
      .to('#ch3', { autoAlpha: 0, y: -30, duration: 0.05 }, 0.7)
      .fromTo('#ch4', { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.05 }, 0.76);
    // History continues the 3D scroll: proxy.h 0->1 across the content below the pin
    gsap.to(proxy, { h: 1, ease: 'none', scrollTrigger: { trigger: '#after', start: 'top bottom', end: 'bottom bottom', scrub: reduced ? true : 1 } });
    window.__tt = { proxy: proxy, tl: tl, lenis: lenis };
  }

  function startRender(renderFn, onSlow) {
    var samples = [], lastT = 0;
    gsap.ticker.add(function (time) {
      var did = renderFn(proxy.p, proxy.h);
      if (did && onSlow) { var now = performance.now(); if (lastT) samples.push(now - lastT); lastT = now;
        if (samples.length === 90) { samples.sort(function (a, b) { return a - b; }); if (samples[45] > 45) onSlow(); onSlow = null; } }
      else lastT = 0;
    });
  }

  function init() {
    bindUI(); initScroll();
    var level = webglLevel(); var info = { mode: '2d', level: level };
    window.__ttInfo = info;
    function use2D() { fallback = makeFallback(); info.mode = '2d'; renderAll(); if (window.gsap) startRender(fallback.render); }
    if (level === 0 || !window.gsap) { use2D(); }
    else {
      import('./js/scene3d.js').then(function (m) {
        try { scene = m.createScene($('#gl'), { quality: level }); } catch (e) { console.warn('3D init failed, using 2D', e); scene = null; use2D(); return; }
        info.mode = '3d'; info.quality = level;
        window.addEventListener('resize', function () { scene.resize(); });
        $('#gl').addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
        renderAll(); startRender(scene.render, function () { scene.setQuality(1); info.quality = 1; });
      }).catch(function (e) { console.warn('3D load failed, using 2D', e); use2D(); });
    }
    renderAll();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  window.__ttTest = { parseQuick: parseQuick, toCSV: toCSV, parseCSV: parseCSV, wage: function () { return wage; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
