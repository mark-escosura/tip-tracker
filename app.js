/* Server Life · Tip Tracker. Offline-first, localStorage only. No accounts, no network, nothing shared. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); }, $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var SHIFTS = ['breakfast', 'lunch', 'dinner', 'overnight'];
  var K = { shifts: 'serverlife.shifts.v2', roles: 'serverlife.roles', last: 'serverlife.lastRole', sched: 'serverlife.schedule', goals: 'serverlife.goals', theme: 'serverlife.theme' };
  var OLD = { shifts: 'tiptracker.shifts.v1', roles: 'tiptracker.roles', wage: 'tiptracker.wage', sched: 'tiptracker.schedule.v1' };
  var DEFAULT_WAGE = 16.90;
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromIso(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function monday(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
  function r2(v) { return Math.round((+v + Number.EPSILON) * 100) / 100; }
  function money(v) { v = r2(v); var neg = v < 0; v = Math.abs(v); return (neg ? '−$' : '$') + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(v) { return (v < 0 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'); }
  function rate(v) { return v == null || !isFinite(v) ? '—' : '$' + v.toFixed(2) + '/hr'; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function nice(s) { var d = fromIso(s); return DOW[d.getDay()] + ' ' + MON[d.getMonth()] + ' ' + d.getDate(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { if (v == null) return null; v = String(v).replace(/[$,\s]/g, ''); if (v === '') return null; var n = Number(v); return isFinite(n) ? n : NaN; }
  function uid(p) { return (p || 's') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function okWage(w) { return typeof w === 'number' && isFinite(w) && w >= 0 && w <= 200; }
  function okTime(t) { return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
  function normTime(t) { if (!t) return null; var m = String(t).trim().match(/^(\d{1,2}):(\d{2})/); if (!m) return null; var v = pad(+m[1]) + ':' + m[2]; return okTime(v) ? v : null; }
  function spanHours(a, b) { if (!okTime(a) || !okTime(b)) return null; var d = (+b.slice(0, 2) * 60 + +b.slice(3)) - (+a.slice(0, 2) * 60 + +a.slice(3)); if (d <= 0) d += 1440; return r2(d / 60); }
  function fmtTime(t) { if (!okTime(t)) return ''; var h = +t.slice(0, 2), m = t.slice(3); return ((h % 12) || 12) + (m === '00' ? '' : ':' + m) + (h < 12 ? 'am' : 'pm'); }
  function shiftFor(t) { if (!okTime(t)) return null; var m = +t.slice(0, 2) * 60 + +t.slice(3); return m < 300 ? 'overnight' : m < 630 ? 'breakfast' : m < 900 ? 'lunch' : m < 1260 ? 'dinner' : 'overnight'; }
  function getJSON(k) { try { var v = JSON.parse(localStorage.getItem(k)); return v; } catch (e) { return null; } }
  function setJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  /* ---------- roles ---------- */
  function loadRoles() { var a = getJSON(K.roles); if (!Array.isArray(a)) a = getJSON(OLD.roles);
    a = Array.isArray(a) ? a.filter(function (r) { return r && r.name && okWage(+r.wage); }).map(function (r) { return { id: String(r.id || uid('r')), name: String(r.name).slice(0, 40), wage: r2(+r.wage) }; }) : [];
    if (!a.length) { var w = parseFloat(localStorage.getItem(OLD.wage)); a = [{ id: 'r-server', name: 'Server', wage: okWage(w) ? r2(w) : DEFAULT_WAGE }]; }
    setJSON(K.roles, a); return a; }
  var roles = loadRoles();
  function saveRoles() { setJSON(K.roles, roles); }
  function roleByName(n) { n = String(n || '').trim().toLowerCase(); return roles.find(function (r) { return r.name.toLowerCase() === n; }) || null; }
  function defaultRole() { var id = localStorage.getItem(K.last); return roles.find(function (r) { return r.id === id; }) || roles[0]; }

  /* ---------- shifts + safe migration ----------
     New records: cash + card tips (each number or null); tips = cash + card, or null if both blank.
     Old single-Tips records keep their total in `tips` with cash/card = null ("split unknown"). Nothing is invented. Old keys are left untouched. */
  function nOrNull(v) { if (v === '' || v == null) return null; v = +v; return isFinite(v) ? r2(v) : null; }
  function migrate(s) {
    if (!s || typeof s !== 'object') return null;
    var hasSplit = s.cash != null || s.card != null;
    var o = { id: String(s.id || uid()), date: s.date, shift: s.shift, hours: +s.hours, role: s.role || roles[0].name, wage: okWage(+s.wage) ? r2(+s.wage) : roles[0].wage,
      clockIn: normTime(s.clockIn), clockOut: normTime(s.clockOut), cash: hasSplit ? nOrNull(s.cash) : null, card: hasSplit ? nOrNull(s.card) : null,
      tipout: nOrNull(s.tipout) || 0, sales: nOrNull(s.sales), note: String(s.note || '').slice(0, 200), createdAt: s.createdAt || null };
    o.tips = hasSplit ? (o.cash == null && o.card == null ? null : r2((o.cash || 0) + (o.card || 0))) : nOrNull(s.tips);
    return /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') && SHIFTS.indexOf(o.shift) >= 0 && o.hours > 0 ? o : null;
  }
  function loadShifts() { var a = getJSON(K.shifts), first = !Array.isArray(a); if (first) a = getJSON(OLD.shifts);
    var out = (Array.isArray(a) ? a : []).map(migrate).filter(Boolean); setJSON(K.shifts, out); return out; }
  var shifts = loadShifts();
  function save() { setJSON(K.shifts, shifts); }
  function tipsOf(s) { return typeof s.tips === 'number' ? s.tips : null; }
  function splitKnown(s) { return s.cash != null || s.card != null; }
  function wages(s) { return s.hours * (okWage(s.wage) ? s.wage : roles[0].wage); }
  function take(s) { return wages(s) + (tipsOf(s) || 0) - (s.tipout || 0); }
  function agg(list) { var a = { n: list.length, hours: 0, wages: 0, tips: 0, cash: 0, card: 0, unknown: 0, tipout: 0, tipN: 0, tipHours: 0, take: 0 };
    list.forEach(function (s) { var t = tipsOf(s); a.hours += s.hours; a.wages += wages(s); a.tipout += s.tipout || 0;
      if (t != null) { a.tips += t; a.tipN++; a.tipHours += s.hours; if (splitKnown(s)) { a.cash += s.cash || 0; a.card += s.card || 0; } else a.unknown += t; } });
    a.take = a.wages + a.tips - a.tipout; a.rate = a.hours > 0 ? a.take / a.hours : null; a.tipRate = a.tipHours > 0 ? (a.tips - a.tipout) / a.tipHours : null; return a; }

  /* ---------- schedule ---------- */
  function validSched(x) { return x && typeof x.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && okTime(x.start) && okTime(x.end) && SHIFTS.indexOf(x.shift) >= 0; }
  function loadSched() { var a = getJSON(K.sched); if (!Array.isArray(a)) a = getJSON(OLD.sched); a = Array.isArray(a) ? a.filter(validSched) : []; setJSON(K.sched, a); return a; }
  var sched = loadSched();
  function saveSched() { setJSON(K.sched, sched); }
  function schedStart(x) { var d = fromIso(x.date); d.setHours(+x.start.slice(0, 2), +x.start.slice(3), 0, 0); return d; }
  function schedEnd(x) { var d = fromIso(x.date); d.setHours(+x.end.slice(0, 2), +x.end.slice(3), 0, 0); if (x.end <= x.start) d.setDate(d.getDate() + 1); return d; }
  function schedLogged(x) { return !!x.logged || shifts.some(function (s) { return s.date === x.date && s.shift === x.shift && (!x.role || s.role === x.role); }); }
  function upcoming() { var now = new Date(); return sched.filter(function (x) { return schedEnd(x) > now; }).sort(function (a, b) { return schedStart(a) - schedStart(b); }); }
  function dueToLog() { var now = new Date(), cut = addDays(now, -14);
    return sched.filter(function (x) { var e = schedEnd(x); return e <= now && e > cut && !x.dismissed && !schedLogged(x); }).sort(function (a, b) { return schedEnd(b) - schedEnd(a); }); }

  /* ---------- period (month picker) ---------- */
  var period = iso(new Date()).slice(0, 7);
  function monthRange(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5) - 1, s = new Date(y, m, 1), e = new Date(y, m + 1, 0), t = new Date(); t = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return { ym: ym, start: s, end: e, through: e > t && s <= t ? t : e, current: s <= t && e >= t, days: e.getDate() }; }
  function prevYm(ym) { var d = new Date(+ym.slice(0, 4), +ym.slice(5) - 2, 1); return iso(d).slice(0, 7); }
  function inMonth(ym) { return shifts.filter(function (s) { return s.date.slice(0, 7) === ym; }); }
  function rangeText(R) { return MON[R.start.getMonth()] + ' 1 – ' + MON[R.through.getMonth()] + ' ' + R.through.getDate() + ', ' + R.start.getFullYear(); }
  function renderMonthPick() { var now = new Date(), first = shifts.reduce(function (m, s) { return s.date < m ? s.date : m; }, iso(now)).slice(0, 7), opts = [], ym = iso(now).slice(0, 7);
    var guard = 0; while (ym >= first && guard++ < 120) { opts.push(ym); ym = prevYm(ym); }
    if (opts.indexOf(period) < 0) opts.unshift(period);
    $('#monthPick').innerHTML = opts.map(function (v) { return '<option value="' + v + '"' + (v === period ? ' selected' : '') + '>' + MON[+v.slice(5) - 1] + ' ' + v.slice(0, 4) + '</option>'; }).join(''); }

  /* ---------- dashboard ---------- */
  function pct(a, b) { if (a == null || b == null || !b) return null; return (a - b) / Math.abs(b) * 100; }
  function deltaHTML(p, vs) { if (p == null) return '<span class="muted">' + (vs ? 'No data for ' + vs : '') + '</span>'; var up = p >= 0;
    return '<span class="' + (up ? 'up' : 'down') + '">' + (up ? '↑ ' : '↓ ') + Math.abs(p).toFixed(1) + '%</span>' + (vs ? ' vs ' + vs : ''); }
  function lineChart(pts, R) { /* pts: [{d:dayIndex, v:value}] */
    if (pts.length < 2) return '<p class="muted xs" style="margin-top:30px;text-align:center">The chart fills in after shifts on 2 different days.</p>';
    var W = 340, H = 130, L = 4, Rr = 34, T = 8, B = 20, vs = pts.map(function (p) { return p.v; }), mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
    if (mx - mn < 1) { mn -= 1; mx += 1; } var span = Math.max(1, R.days - 1);
    var X = function (d) { return L + (W - L - Rr) * d / span; }, Y = function (v) { return T + (H - T - B) * (1 - (v - mn) / (mx - mn)); };
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.d).toFixed(1) + ' ' + Y(p.v).toFixed(1); }).join(' ');
    var area = line + ' L' + X(pts[pts.length - 1].d).toFixed(1) + ' ' + (H - B) + ' L' + X(pts[0].d).toFixed(1) + ' ' + (H - B) + ' Z', last = pts[pts.length - 1];
    var ticks = [mx, (mx + mn) / 2, mn].map(function (v) { return '<text class="axis" x="' + (W - Rr + 4) + '" y="' + (Y(v) + 3).toFixed(1) + '">$' + Math.round(v) + '</text>'; }).join('');
    var xl = [0, Math.round(span / 2), span].map(function (d) { return '<text class="axis" x="' + X(d).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + (d === 0 ? 'start' : d === span ? 'end' : 'middle') + '">' + MON[R.start.getMonth()] + ' ' + (d + 1) + '</text>'; }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Effective hourly rate by day"><defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2DD4BF" stop-opacity=".45"/><stop offset="1" stop-color="#2DD4BF" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#ga)"/><path d="' + line + '" fill="none" stroke="#2DD4BF" stroke-width="2" stroke-linejoin="round"/><circle cx="' + X(last.d).toFixed(1) + '" cy="' + Y(last.v).toFixed(1) + '" r="3.5" fill="#2DD4BF"/>' + ticks + xl + '</svg>'; }
  function donut(cash, card) { var tot = cash + card, C = 2 * Math.PI * 40, f = tot > 0 ? cash / tot : 0;
    return '<svg viewBox="0 0 110 110" role="img" aria-label="Cash vs card"><circle cx="55" cy="55" r="40" fill="none" stroke="' + (tot > 0 ? '#6B7280' : '#2D323C') + '" stroke-width="14"/>' +
      (tot > 0 ? '<circle cx="55" cy="55" r="40" fill="none" stroke="#2DD4BF" stroke-width="14" stroke-dasharray="' + (C * f).toFixed(2) + ' ' + C.toFixed(2) + '" transform="rotate(-90 55 55)"/>' : '') +
      '<text x="55" y="55" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor">' + money0(tot) + '</text><text x="55" y="70" text-anchor="middle" font-size="9" fill="#9CA3AF">Total tips</text></svg>'; }
  function similarAvg(x, list) { var m = list.filter(function (s) { return s.shift === x.shift && s.role === x.role; }); if (!m.length) m = list.filter(function (s) { return s.shift === x.shift; }); return m.length ? agg(m).take / m.length : null; }
  function projection(R, list) { var A = agg(list);
    if (!R.current) return { v: A.take, how: 'Month total (finished month)' };
    var now = new Date(), rest = sched.filter(function (x) { return x.date.slice(0, 7) === R.ym && schedStart(x) > now && !schedLogged(x); }), est = 0, used = 0, skip = 0;
    rest.forEach(function (x) { var g = similarAvg(x, shifts); if (g != null) { est += g; used++; } else skip++; });
    if (used) return { v: A.take + est, how: money(A.take) + ' so far + ' + used + ' scheduled shift' + (used > 1 ? 's' : '') + ' at your average for shifts like them' + (skip ? ' (' + skip + ' not counted, no similar shifts yet)' : '') };
    var dd = R.through.getDate(); return { v: A.take / dd * R.days, how: 'Based on your current daily average (' + money(A.take) + ' in ' + dd + ' days)' + (rest.length ? ' · ' + rest.length + ' scheduled not counted' : '') }; }
  function renderDashboard() {
    var R = monthRange(period), list = inMonth(period).filter(function (s) { return s.date <= iso(R.through) || !R.current; }), A = agg(list);
    var P = monthRange(prevYm(period)), PA = agg(inMonth(P.ym));
    $('#dRange').textContent = rangeText(R);
    $('#dEmpty').hidden = !!A.n; $('#dBody').hidden = !A.n; if (!A.n) return;
    var vsTxt = MON[P.start.getMonth()] + ' 1 – ' + MON[P.end.getMonth()] + ' ' + P.end.getDate();
    $('#dRate').textContent = A.rate != null ? '$' + A.rate.toFixed(2) : '—';
    $('#dRateDelta').innerHTML = deltaHTML(PA.n ? pct(A.rate, PA.rate) : null, PA.n ? vsTxt : vsTxt);
    var byDay = {}; list.forEach(function (s) { (byDay[s.date] = byDay[s.date] || []).push(s); });
    var cT = 0, cH = 0, pts = Object.keys(byDay).sort().map(function (d) { var a = agg(byDay[d]); cT += a.take; cH += a.hours; return { d: fromIso(d).getDate() - 1, v: cT / cH }; });
    $('#dChart').innerHTML = lineChart(pts, R);
    var tot = A.cash + A.card;
    $('#dDonut').innerHTML = donut(A.cash, A.card);
    $('#dLegend').innerHTML = tot > 0 ? '<div><i style="background:#2DD4BF"></i>Cash<b>' + money0(A.cash) + ' <span class="muted">(' + (A.cash / tot * 100).toFixed(1) + '%)</span></b></div><div><i style="background:#6B7280"></i>Card<b>' + money0(A.card) + ' <span class="muted">(' + (A.card / tot * 100).toFixed(1) + '%)</span></b></div>' : '<p class="muted xs">No cash/card tips logged this month.</p>';
    $('#dUnknown').textContent = A.unknown ? money(A.unknown) + ' older tips with no cash/card split (not in the chart)' : '';
    var best = null; Object.keys(byDay).forEach(function (d) { var a = agg(byDay[d]); if (a.rate != null && (!best || a.rate > best.a.rate)) best = { d: d, a: a }; });
    $('#dBest').innerHTML = best ? '<span class="trophy" aria-hidden="true">🏆</span><p class="lbl">Best day</p><h3>' + DOWL[fromIso(best.d).getDay()] + '</h3><p class="muted s" style="margin:0">' + MONL[fromIso(best.d).getMonth()].slice(0, 3) + ' ' + fromIso(best.d).getDate() + ', ' + best.d.slice(0, 4) + '</p><p class="money">$' + best.a.rate.toFixed(2) + '</p><p class="muted s" style="margin:0">Effective hourly rate</p><div class="foot">' + money0(best.a.take) + ' in ' + r2(best.a.hours) + ' hrs</div>' : '';
    function av(a) { return { tips: a.tipN ? a.tips / a.tipN : null, hrs: a.n ? a.hours / a.n : null, rate: a.rate, n: a.n }; }
    var c = av(A), p = av(PA);
    function cell(k, v, d, g) { return '<div><p class="k">' + k + '</p><p class="v' + (g ? ' g' : '') + '">' + v + '</p><p class="d">' + d + '</p></div>'; }
    $('#dAvgs').innerHTML = cell('Avg tips / shift', c.tips == null ? '—' : money(c.tips), deltaHTML(PA.n ? pct(c.tips, p.tips) : null), 1) + cell('Avg hours / shift', c.hrs.toFixed(2), deltaHTML(PA.n ? pct(c.hrs, p.hrs) : null)) +
      cell('Avg effective rate', c.rate == null ? '—' : money(c.rate), deltaHTML(PA.n ? pct(c.rate, p.rate) : null), 1) + cell('Shifts', c.n, R.current ? 'This month' : MON[R.start.getMonth()]);
    var pr = projection(R, list); $('#dProj').textContent = money0(pr.v); $('#dProjHow').textContent = pr.how;
    var wk = [], cur = monday(R.start); while (cur <= R.end) { var s0 = iso(cur), e0 = iso(addDays(cur, 6)); wk.push(agg(list.filter(function (s) { return s.date >= s0 && s.date <= e0; })).take); cur = addDays(cur, 7); }
    var mx = Math.max.apply(null, wk.concat([1])); $('#dBars').innerHTML = wk.map(function (v, i) { return '<i style="height:' + Math.max(3, v / mx * 100).toFixed(0) + '%" title="Week ' + (i + 1) + ': ' + money0(v) + '"></i>'; }).join('');
    var nx = upcoming()[0]; $('#dNext').hidden = !nx;
    if (nx) $('#dNext').innerHTML = '<p class="lbl">Next scheduled shift</p><p><b>' + nice(nx.date) + ' · ' + cap(nx.shift) + '</b> <span class="muted">' + fmtTime(nx.start) + '–' + fmtTime(nx.end) + '</span></p>';
  }

  /* ---------- shifts: history ---------- */
  var roleFilter = '';
  function tipText(s) { var t = tipsOf(s); if (t == null) return 'no tips'; return splitKnown(s) ? 'cash ' + money(s.cash || 0) + ' · card ' + money(s.card || 0) : 'tips ' + money(t) + ' (split unknown)'; }
  function shiftRow(s) { var tk = take(s);
    return '<div class="shift" data-id="' + esc(s.id) + '"><div class="main"><div class="t">' + nice(s.date) + ' · ' + cap(s.shift) + (roles.length > 1 || !roleByName(s.role) ? ' · ' + esc(s.role) : '') + '</div>' +
      '<div class="d">' + (s.clockIn ? fmtTime(s.clockIn) + '–' + fmtTime(s.clockOut) + ' · ' : '') + r2(s.hours) + 'h · ' + tipText(s) + (s.tipout ? ' · tip-out ' + money(s.tipout) : '') + (s.note ? ' · ' + esc(s.note) : '') + '</div></div>' +
      '<div class="amt"><b>' + money(tk) + '</b><span>' + rate(tk / s.hours) + '</span></div><button class="ibtn" data-act="edit" aria-label="Edit shift">✎</button><button class="ibtn del" data-act="del" aria-label="Delete shift">✕</button></div>'; }
  function renderHistory() {
    var names = []; roles.concat(shifts.map(function (s) { return { name: s.role }; })).forEach(function (r) { if (r.name && names.indexOf(r.name) < 0) names.push(r.name); });
    if (roleFilter && names.indexOf(roleFilter) < 0) roleFilter = '';
    $('#roleFilter').hidden = names.length < 2;
    $('#roleFilter').innerHTML = ['All roles'].concat(names).map(function (n, i) { var v = i ? n : ''; return '<button type="button" class="rchip' + (v === roleFilter ? ' on' : '') + '" data-rf="' + esc(v) + '">' + esc(n) + '</button>'; }).join('');
    var list = shifts.filter(function (s) { return !roleFilter || s.role === roleFilter; }), A = agg(list);
    $('#hTotals').innerHTML = '<div><p class="v money">' + money0(A.take) + '</p><p class="k">Take-home</p></div><div><p class="v">' + r2(A.hours) + 'h</p><p class="k">' + A.n + ' shift' + (A.n === 1 ? '' : 's') + '</p></div><div><p class="v">' + rate(A.rate).replace('/hr', '') + '</p><p class="k">per hour</p></div>';
    if (!list.length) { $('#hList').innerHTML = '<div class="card empty"><p class="big">No shifts yet</p><p class="muted">Tap “+ Log” after your next shift.</p></div>'; return; }
    var sorted = list.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : SHIFTS.indexOf(b.shift) - SHIFTS.indexOf(a.shift); }), groups = [], gi = {};
    sorted.forEach(function (s) { var k = iso(monday(fromIso(s.date))); if (!(k in gi)) { gi[k] = groups.length; groups.push({ k: k, items: [] }); } groups[gi[k]].items.push(s); });
    $('#hList').innerHTML = groups.map(function (g) { var a = agg(g.items); return '<div class="wkhead"><span>Week of ' + nice(g.k) + '</span><span>' + money(a.take) + ' · ' + rate(a.rate) + '</span></div><div class="card">' + g.items.map(shiftRow).join('') + '</div>'; }).join('');
  }
  function onShiftAction(e) { var b = e.target.closest('[data-act]'); if (!b) return; var row = b.closest('[data-id]'); if (!row) return; var id = row.getAttribute('data-id'), s = shifts.find(function (x) { return x.id === id; }); if (!s) return;
    if (b.getAttribute('data-act') === 'edit') { resetForm(); editing = id; fillForm(s); $('#saveBtn').textContent = 'Update shift'; $('#logTitle').textContent = 'Edit shift'; $('#cancelEdit').hidden = false; go('log'); }
    else if (confirm('Delete ' + nice(s.date) + ' ' + s.shift + ' (' + money(take(s)) + ')?')) { shifts = shifts.filter(function (x) { return x.id !== id; }); save(); renderAll(); toast('Deleted'); } }

  /* ---------- calendar + schedule ---------- */
  var calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1), calSel = null;
  function renderCalendar() {
    var y = calMonth.getFullYear(), m = calMonth.getMonth(), ym = y + '-' + pad(m + 1), list = inMonth(ym), A = agg(list);
    $('#calTitle').textContent = MONL[m] + ' ' + y; $('#calSub').textContent = A.n ? money(A.take) + ' · ' + A.n + ' shift' + (A.n > 1 ? 's' : '') : 'No shifts logged';
    var by = {}, mx = 0; list.forEach(function (s) { by[s.date] = (by[s.date] || 0) + take(s); }); Object.keys(by).forEach(function (k) { mx = Math.max(mx, by[k]); });
    var sc = {}; sched.forEach(function (x) { if (x.date.slice(0, 7) === ym && !schedLogged(x)) (sc[x.date] = sc[x.date] || []).push(x); });
    var lead = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate(), t = iso(new Date()), h = '';
    for (var i = 0; i < lead; i++) h += '<div class="cc blank"></div>';
    for (var d = 1; d <= days; d++) { var di = ym + '-' + pad(d), v = by[di], s = sc[di] || [];
      h += '<button type="button" class="cc' + (v != null ? ' has' : '') + (s.length ? ' sched' : '') + (di === t ? ' today' : '') + (di === calSel ? ' sel' : '') + '" data-date="' + di + '" style="--h:' + (v != null && mx ? (v / mx).toFixed(2) : 0) + '" aria-label="' + nice(di) + (v != null ? ', ' + money(v) : '') + (s.length ? ', scheduled ' + fmtTime(s[0].start) : '') + '">' +
        '<span class="n">' + d + '</span>' + (v != null ? '<span class="v">$' + Math.round(v) + '</span>' : s.length ? '<span class="sc">' + fmtTime(s[0].start).replace(/(a|p)m$/, '$1') + '</span>' : '') + '</button>'; }
    $('#calGrid').innerHTML = h; $('#icsBtn').hidden = !upcoming().length; renderDay(); }
  function schedRow(x) { var past = schedEnd(x) <= new Date(), lg = schedLogged(x);
    return '<div class="shift srow" data-sid="' + esc(x.id) + '"><div class="main"><div class="t">' + cap(x.shift) + ' · scheduled' + (roles.length > 1 ? ' · ' + esc(x.role) : '') + '</div><div class="d">' + fmtTime(x.start) + '–' + fmtTime(x.end) + ' · ' + spanHours(x.start, x.end) + 'h' + (lg ? ' · logged' : past ? ' · not logged yet' : '') + '</div></div>' +
      (past && !lg ? '<button class="btn sm" data-sact="log">Log</button>' : '') + '<button class="ibtn" data-sact="edit" aria-label="Edit scheduled shift">✎</button><button class="ibtn del" data-sact="del" aria-label="Delete scheduled shift">✕</button></div>'; }
  function renderDay() { var el = $('#calDay'); if (!calSel) { el.innerHTML = ''; return; }
    var l = shifts.filter(function (s) { return s.date === calSel; }), sl = sched.filter(function (x) { return x.date === calSel; });
    el.innerHTML = '<h3>' + nice(calSel) + '</h3>' + (l.length || sl.length ? l.map(shiftRow).join('') + sl.map(schedRow).join('') : '<p class="muted s">Nothing on this day.</p>') +
      (calSel <= iso(new Date()) ? '<button class="btn ghost wide" id="dayLog">Log a shift on ' + nice(calSel).slice(4) + '</button>' : ''); }
  var schedEditing = null;
  function schedHint() { var a = normTime($('#sStart').value), b = normTime($('#sEnd').value), g = shiftFor(a), hh = spanHours(a, b);
    $('#sHint').textContent = g ? cap(g) + ' shift' + (hh ? ' · ' + hh + 'h' + (b <= a ? ' (ends next day)' : '') : '') : ''; }
  function openSchedForm(x) { schedEditing = x ? x.id : null; $('#schedTitle').textContent = x ? 'Edit scheduled shift' : 'Add a scheduled shift';
    $('#sDate').value = x ? x.date : (calSel && calSel >= iso(new Date()) ? calSel : iso(new Date()));
    var cur = x && x.role ? x.role : defaultRole().name; $('#sRoles').hidden = roles.length < 2;
    $('#sRoles').innerHTML = roles.map(function (r) { return '<label><input type="radio" name="srole" value="' + esc(r.name) + '"' + (r.name === cur ? ' checked' : '') + '><span>' + esc(r.name) + '</span></label>'; }).join('');
    $('#sStart').value = x ? x.start : ''; $('#sEnd').value = x ? x.end : ''; $('#sErr').textContent = ''; $('#sDel').hidden = !x; $('#sSave').textContent = x ? 'Save changes' : 'Add to schedule'; $('#schedForm').hidden = false; schedHint(); }
  function closeSchedForm() { $('#schedForm').hidden = true; schedEditing = null; }
  function submitSched() { var d = $('#sDate').value, a = normTime($('#sStart').value), b = normTime($('#sEnd').value), rr = document.querySelector('input[name=srole]:checked');
    var err = !/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? 'Pick a date.' : !a || !b ? 'Add a start and end time.' : a === b ? 'Start and end can\'t be the same.' : '';
    var rec = { id: schedEditing || uid('c'), date: d, start: a, end: b, shift: shiftFor(a), role: rr ? rr.value : defaultRole().name };
    if (!err && schedEnd(rec) <= new Date()) err = 'That time has already passed. Pick an upcoming shift.';
    $('#sErr').textContent = err; if (err) return;
    var i = sched.findIndex(function (x) { return x.id === rec.id; }); if (i >= 0) { rec.rev = (sched[i].rev || 0) + 1; sched[i] = rec; } else sched.push(rec);
    saveSched(); closeSchedForm(); calSel = d; calMonth = new Date(fromIso(d).getFullYear(), fromIso(d).getMonth(), 1); renderAll(); toast((i >= 0 ? 'Updated · ' : 'Scheduled · ') + nice(d) + ' ' + fmtTime(a) + '–' + fmtTime(b)); }
  function delSched(x) { if (!confirm('Remove ' + nice(x.date) + ' ' + x.shift + ' from your schedule?')) return; sched = sched.filter(function (y) { return y.id !== x.id; }); saveSched(); if (schedEditing === x.id) closeSchedForm(); renderAll(); toast('Removed from schedule'); }
  /* .ics: upcoming shifts, alarm 1h before + "Log your tips" at end, stable UID per scheduled shift */
  function icsDate(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function icsText(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function icsFold(l) { var out = []; while (l.length > 73) { out.push(l.slice(0, 73)); l = ' ' + l.slice(73); } out.push(l); return out.join('\r\n'); }
  function buildICS(list) { var now = icsDate(new Date()), L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Server Life//Tip Tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Work shifts'];
    list.forEach(function (x) { var t = cap(x.shift) + ' shift' + (x.role ? ' (' + x.role + ')' : '');
      L.push('BEGIN:VEVENT', 'UID:' + x.id + '@tip-tracker.mark-escosura.github.io', 'SEQUENCE:' + (x.rev || 0), 'DTSTAMP:' + now, 'DTSTART:' + icsDate(schedStart(x)), 'DTEND:' + icsDate(schedEnd(x)),
        'SUMMARY:' + icsText(t), 'DESCRIPTION:' + icsText('Scheduled ' + fmtTime(x.start) + '–' + fmtTime(x.end) + '. After your shift, open Server Life to log your tips.'),
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(t + ' starts in 1 hour'), 'TRIGGER:-PT1H', 'END:VALARM',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'SUMMARY:Log your tips', 'DESCRIPTION:Log your tips', 'TRIGGER;RELATED=END:PT0S', 'END:VALARM', 'END:VEVENT'); });
    L.push('END:VCALENDAR'); return L.map(icsFold).join('\r\n') + '\r\n'; }
  function download(name, text, type) { var url = URL.createObjectURL(new Blob([text], { type: type })), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000); }
  function downloadICS() { var l = upcoming(); if (!l.length) { toast('Add an upcoming shift first'); return; } download('work-shifts.ics', buildICS(l), 'text/calendar;charset=utf-8'); toast(l.length + ' shift' + (l.length > 1 ? 's' : '') + ' ready for Calendar. Re-adding updates them.'); }
  /* banner */
  var pendingSched = null;
  function renderBanner() { var d = dueToLog()[0], b = $('#logBanner'); b.hidden = !d; if (d) { b.setAttribute('data-sid', d.id); $('#bannerText').textContent = 'Log your ' + DOW[fromIso(d.date).getDay()] + ' ' + d.shift + ' shift?'; } }
  function openFromSched(x) { resetForm(); fillForm({ date: x.date, shift: x.shift, role: x.role, clockIn: x.start, clockOut: x.end, hours: spanHours(x.start, x.end) }); pendingSched = x.id; go('log'); setTimeout(function () { $('#fCash').focus(); }, 60); }

  /* ---------- tips ---------- */
  function renderTips() { var R = monthRange(period), list = inMonth(period), A = agg(list);
    $('#tRange').textContent = rangeText(R); $('#tEmpty').hidden = !!A.tipN; $('#tBody').hidden = !A.tipN && !shifts.length;
    $('#tKpis').innerHTML = [['Total tips', money(A.tips), 1], ['Tip $/hr (after tip-out)', rate(A.tipRate), 1], ['Cash', money(A.cash)], ['Card', money(A.card)], ['Tipped out', money(A.tipout)], ['Split unknown', money(A.unknown)]]
      .map(function (k) { return '<div><p class="k">' + k[0] + '</p><p class="v' + (k[2] ? ' g' : '') + '">' + k[1] + '</p></div>'; }).join('');
    var by = {}; list.forEach(function (s) { if (tipsOf(s) != null) (by[s.date] = by[s.date] || []).push(s); });
    $('#tDays').innerHTML = Object.keys(by).sort().reverse().map(function (d) { var a = agg(by[d]); return '<div class="dayrow"><span>' + nice(d) + '</span><span class="muted">' + (a.unknown ? '' : 'cash ' + money0(a.cash) + ' · card ' + money0(a.card)) + '</span><b>' + money(a.tips) + '</b></div>'; }).join('') || '<p class="muted s">No tips this month.</p>';
    var G = {}; shifts.forEach(function (s) { var k = ((fromIso(s.date).getDay() + 6) % 7) + s.shift; (G[k] = G[k] || []).push(s); });
    $('#dayGrid').innerHTML = shifts.length ? '<table class="dg"><thead><tr><th></th>' + SHIFTS.map(function (s) { return '<th>' + cap(s).slice(0, 5) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (dn, i) { return '<tr><th>' + dn + '</th>' + SHIFTS.map(function (sh) { var g = G[i + sh]; if (!g) return '<td class="none">·</td>'; var a = agg(g);
        return '<td data-k="' + dn + '-' + sh + '"><b>' + money0(a.take / a.n) + '</b><span>' + rate(a.rate).replace('/hr', '/h') + ' · ' + a.n + '</span></td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table><p class="xs">All time · avg take-home per shift, $/hr, shift count</p>' : '<p class="muted s">Log shifts to see which days and shifts pay best.</p>'; }

  /* ---------- reports ---------- */
  var wkStart = monday(new Date());
  function kp(k, v, g) { return '<div><p class="k">' + k + '</p><p class="v' + (g ? ' g' : '') + '">' + v + '</p></div>'; }
  function renderReports() {
    var s0 = iso(wkStart), e0 = iso(addDays(wkStart, 6)), wl = shifts.filter(function (s) { return s.date >= s0 && s.date <= e0; }), W = agg(wl);
    var p0 = iso(addDays(wkStart, -7)), pe = iso(addDays(wkStart, -1)), PW = agg(shifts.filter(function (s) { return s.date >= p0 && s.date <= pe; }));
    $('#wkTitle').textContent = 'Week of ' + nice(s0); $('#wkSub').textContent = MON[wkStart.getMonth()] + ' ' + wkStart.getDate() + ' – ' + MON[addDays(wkStart, 6).getMonth()] + ' ' + addDays(wkStart, 6).getDate();
    $('#wkKpis').innerHTML = W.n ? kp('Take-home', money(W.take), 1) + kp('vs last week', PW.n ? deltaHTML(pct(W.take, PW.take)) : '—') + kp('Hours · shifts', r2(W.hours) + 'h · ' + W.n) + kp('Effective rate', rate(W.rate), 1) + kp('Cash tips', money(W.cash)) + kp('Card tips', money(W.card)) : '<p class="muted s">No shifts this week.</p>';
    $('#wkDays').innerHTML = W.n ? [0, 1, 2, 3, 4, 5, 6].map(function (i) { var d = iso(addDays(wkStart, i)), a = agg(wl.filter(function (s) { return s.date === d; })); return a.n ? '<div class="dayrow"><span>' + nice(d) + '</span><span class="muted">' + r2(a.hours) + 'h · ' + rate(a.rate) + '</span><b>' + money(a.take) + '</b></div>' : ''; }).join('') : '';
    var A = agg(shifts); $('#stAll').innerHTML = A.n ? kp('Take-home', money(A.take), 1) + kp('Effective rate', rate(A.rate), 1) + kp('Shifts · hours', A.n + ' · ' + r2(A.hours) + 'h') + kp('Tips', money(A.tips)) + kp('Wages', money(A.wages)) + kp('Tip $/hr', rate(A.tipRate)) : '<p class="muted s">No shifts yet.</p>';
    var br = {}; shifts.forEach(function (s) { (br[s.role] = br[s.role] || []).push(s); }); var ks = Object.keys(br);
    $('#stRoles').hidden = ks.length < 2; $('#stRoles').innerHTML = '<p class="lbl">By role</p>' + ks.map(function (k) { var a = agg(br[k]); return '<div class="dayrow"><span>' + esc(k) + '</span><span class="muted">' + r2(a.hours) + 'h · ' + rate(a.rate) + '</span><b>' + money(a.take) + '</b></div>'; }).join('');
    var best = shifts.map(function (s) { return { s: s, r: take(s) / s.hours }; }).sort(function (a, b) { return b.r - a.r; }).slice(0, 5);
    $('#stBest').innerHTML = best.length ? best.map(function (x) { return '<li>' + nice(x.s.date) + ' · ' + cap(x.s.shift) + ' <b>' + rate(x.r) + '</b><div class="xs">' + money(take(x.s)) + ' in ' + x.s.hours + 'h</div></li>'; }).join('') : '<li class="muted">Log a shift to see your best ones.</li>';
    var g = getJSON(K.goals) || {}; if (document.activeElement !== $('#gWeek')) $('#gWeek').value = g.week || ''; if (document.activeElement !== $('#gMonth')) $('#gMonth').value = g.month || '';
    var tw = monday(new Date()), cw = agg(shifts.filter(function (s) { return s.date >= iso(tw) && s.date <= iso(addDays(tw, 6)); })).take, cm = agg(inMonth(iso(new Date()).slice(0, 7))).take;
    function bar(lbl, have, goal) { return goal ? '<div class="gbar"><div class="dayrow" style="border:0;padding:0"><span>' + lbl + '</span><span class="muted">' + money0(have) + ' of ' + money0(goal) + '</span><b>' + Math.round(have / goal * 100) + '%</b></div><div class="tr"><i style="width:' + Math.min(100, have / goal * 100).toFixed(1) + '%"></i></div></div>' : ''; }
    $('#goalBars').innerHTML = (bar('This week', cw, g.week) + bar('This month', cm, g.month)) || '<p class="muted s">Set a goal to see your progress.</p>'; }

  /* ---------- CSV ---------- */
  function csvCell(v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) || /^[=+\-@]/.test(v) ? '"' + (/^[=+\-@]/.test(v) ? "'" : '') + v.replace(/"/g, '""') + '"' : v; }
  function toCSV() { var H = ['date', 'shift', 'role', 'hourly_wage', 'clock_in', 'clock_out', 'hours', 'cash_tips', 'card_tips', 'total_tips', 'tipped_out', 'sales', 'wages', 'take_home', 'note'];
    var rows = shifts.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).map(function (s) { var sk = splitKnown(s);
      return [s.date, s.shift, s.role, s.wage.toFixed(2), s.clockIn, s.clockOut, s.hours, sk && s.cash != null ? s.cash.toFixed(2) : '', sk && s.card != null ? s.card.toFixed(2) : '', tipsOf(s) != null ? tipsOf(s).toFixed(2) : '', (s.tipout || 0).toFixed(2), s.sales != null ? s.sales.toFixed(2) : '', r2(wages(s)).toFixed(2), r2(take(s)).toFixed(2), s.note].map(csvCell).join(','); });
    return [H.join(',')].concat(rows).join('\r\n') + '\r\n'; }
  function exportCSV() { if (!shifts.length) { toast('No shifts to export yet'); return; } download('server-life-shifts-' + iso(new Date()) + '.csv', '\ufeff' + toCSV(), 'text/csv;charset=utf-8'); toast('Exported ' + shifts.length + ' shift' + (shifts.length > 1 ? 's' : '')); }

  /* ---------- log form ---------- */
  var editing = null, shiftTouched = false, formWage = null;
  function selRole() { var r = document.querySelector('input[name=role]:checked'); return r ? r.value : null; }
  function renderRoleChips(cur) { $('#roleChips').hidden = roles.length < 2;
    $('#roleChips').innerHTML = roles.map(function (r) { return '<label><input type="radio" name="role" value="' + esc(r.name) + '"' + (r.name === cur ? ' checked' : '') + '><span>' + esc(r.name) + '<em>$' + r.wage.toFixed(2) + '</em></span></label>'; }).join('');
    if (cur && !roleByName(cur)) { $('#roleChips').hidden = false; $('#roleChips').insertAdjacentHTML('beforeend', '<label><input type="radio" name="role" value="' + esc(cur) + '" checked><span>' + esc(cur) + '<em>deleted</em></span></label>'); } }
  function guessShift() { if (shiftTouched) return; var g = shiftFor(normTime($('#fIn').value)) || shiftFor(pad(new Date().getHours()) + ':' + pad(new Date().getMinutes())); $$('input[name=shift]').forEach(function (r) { r.checked = r.value === g; }); }
  function resetForm() { editing = null; pendingSched = null; formWage = null; $('#form').reset(); $('#fDate').value = iso(new Date()); renderRoleChips(defaultRole().name); shiftTouched = false; guessShift();
    $('#saveBtn').textContent = 'Add shift'; $('#logTitle').textContent = 'Log shift'; $('#cancelEdit').hidden = true; $('#formErr').textContent = ''; $('#hoursHint').textContent = ''; $('#legacyNote').hidden = true; $('#more').open = false; moreSummary(); updateTake(); }
  function fillForm(s) { $('#fDate').value = s.date || iso(new Date()); renderRoleChips(s.role || defaultRole().name); formWage = okWage(s.wage) ? s.wage : null;
    $$('input[name=shift]').forEach(function (r) { r.checked = r.value === s.shift; }); shiftTouched = !!s.shift;
    $('#fIn').value = s.clockIn || ''; $('#fOut').value = s.clockOut || ''; $('#fHours').value = s.hours != null ? s.hours : '';
    var legacy = s.id && tipsOf(s) != null && !splitKnown(s);
    $('#fCash').value = s.cash != null ? s.cash : ''; $('#fCard').value = s.card != null ? s.card : '';
    $('#legacyNote').hidden = !legacy; $('#legacyNote').textContent = legacy ? 'This older shift has ' + money(s.tips) + ' in tips with no cash/card split. Leave both blank to keep it, or enter cash and card to replace it.' : '';
    $('#fTipout').value = s.tipout ? s.tipout : ''; $('#fSales').value = s.sales != null ? s.sales : ''; $('#fNote').value = s.note || '';
    $('#more').open = !!(s.sales != null || s.note || s.tipout || (s.hours && !s.clockIn)); hoursHint(); moreSummary(); updateTake(); }
  function readForm() { var sh = document.querySelector('input[name=shift]:checked');
    return { date: $('#fDate').value, shift: sh ? sh.value : null, role: selRole(), clockIn: normTime($('#fIn').value), clockOut: normTime($('#fOut').value), hours: num($('#fHours').value),
      cash: num($('#fCash').value), card: num($('#fCard').value), tipout: num($('#fTipout').value), sales: num($('#fSales').value), note: $('#fNote').value.trim() }; }
  function validate(f) { if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) return 'Pick a date.'; if (!f.shift) return 'Pick a shift.'; if (!f.role) return 'Pick a role.';
    if (!!f.clockIn !== !!f.clockOut) return 'Add both clock in and clock out (or neither).'; if (f.hours == null && !f.clockIn) return 'Add your clock in and clock out times.';
    if (!(f.hours > 0) || f.hours > 24) return 'Hours should be between 0 and 24.';
    if ([f.cash, f.card, f.tipout, f.sales].some(function (v) { return v != null && (isNaN(v) || v < 0); })) return 'Amounts should be numbers, 0 or more.'; return ''; }
  function editingRec() { return editing ? shifts.find(function (x) { return x.id === editing; }) : null; }
  function formRate(name) { var e = editingRec(); if (e && e.role === name && okWage(formWage)) return formWage; var r = roleByName(name); return r ? r.wage : e && okWage(e.wage) ? e.wage : roles[0].wage; }
  function formTips(f) { var e = editingRec(); if (f.cash == null && f.card == null) return e && !splitKnown(e) ? { tips: tipsOf(e), cash: null, card: null } : { tips: null, cash: null, card: null };
    return { cash: f.cash == null ? null : r2(f.cash), card: f.card == null ? null : r2(f.card), tips: r2((f.cash || 0) + (f.card || 0)), split: true }; }
  function updateTake() { var f = readForm(); if ([f.cash, f.card, f.tipout].some(function (v) { return v != null && isNaN(v); }) || !(f.hours > 0)) { $('#takeLine').innerHTML = ''; return; }
    var T = formTips(f), w = f.hours * formRate(f.role), tk = w + (T.tips || 0) - (f.tipout || 0);
    $('#takeLine').innerHTML = 'Take-home <b>' + money(tk) + '</b> · ' + rate(tk / f.hours) + '<br><span class="muted s">Wages ' + money(w) + (T.tips != null ? ' + tips ' + money(T.tips) : ' · no tips') + (f.tipout ? ' − tip-out ' + money(f.tipout) : '') + '</span>'; }
  function hoursHint() { var sp = spanHours(normTime($('#fIn').value), normTime($('#fOut').value)), h = num($('#fHours').value);
    $('#hoursHint').textContent = sp == null ? '' : h != null && !isNaN(h) && Math.abs(h - sp) > 0.004 ? '(' + sp + 'h clocked, ' + (h < sp ? r2(sp - h) + 'h break' : 'override') + ')' : '(from clock)'; }
  function moreSummary() { var f = readForm(), b = []; if (f.date && f.date !== iso(new Date())) b.push(nice(f.date)); if (f.tipout) b.push('tipped out ' + money(f.tipout)); if (f.sales) b.push('sales ' + money(f.sales)); if (f.note) b.push('note'); $('#moreSum').textContent = b.length ? '· ' + b.join(' · ') : ''; }
  function commit(f) { var role = roleByName(f.role), prev = editingRec(), T = formTips(f);
    var w = prev && prev.role === f.role && okWage(prev.wage) ? prev.wage : role ? role.wage : prev ? prev.wage : roles[0].wage; if (role) localStorage.setItem(K.last, role.id);
    var rec = { date: f.date, shift: f.shift, role: f.role, wage: r2(w), clockIn: f.clockIn, clockOut: f.clockOut, hours: r2(f.hours), cash: T.cash, card: T.card, tips: T.tips,
      tipout: r2(f.tipout || 0), sales: f.sales == null ? null : r2(f.sales), note: f.note.slice(0, 200) };
    if (prev) { rec.id = prev.id; rec.createdAt = prev.createdAt; shifts[shifts.indexOf(prev)] = rec; } else { rec.id = uid(); rec.createdAt = new Date().toISOString(); shifts.push(rec); }
    if (pendingSched && !prev) { var ps = sched.find(function (x) { return x.id === pendingSched; }); if (ps) { ps.logged = rec.id; saveSched(); } }
    save(); toast((prev ? 'Updated' : 'Saved') + ' · ' + money(take(rec)) + ' take-home · ' + rate(take(rec) / rec.hours)); resetForm(); period = rec.date.slice(0, 7) <= iso(new Date()).slice(0, 7) ? rec.date.slice(0, 7) : period; renderAll(); go(prev ? 'shifts' : 'dashboard'); }
  function prefillFromLink() { var q = new URLSearchParams(location.search); if (!q.has('log') && !q.has('in')) return false;
    var d = q.get('log'), sh = q.get('shift'), rl = roleByName(q.get('role')), ci = normTime(q.get('in')), co = normTime(q.get('out'));
    resetForm(); fillForm({ date: /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : iso(new Date()), shift: SHIFTS.indexOf(sh) >= 0 ? sh : null, role: rl ? rl.name : null, clockIn: ci && co ? ci : null, clockOut: ci && co ? co : null, hours: ci && co ? spanHours(ci, co) : null });
    if (!(SHIFTS.indexOf(sh) >= 0)) { shiftTouched = false; guessShift(); } return true; }

  /* ---------- settings ---------- */
  var rolesRendering = false;
  function renderRoleSettings() { rolesRendering = true;
    $('#roleList').innerHTML = roles.map(function (r) { return '<div class="role-row" data-id="' + esc(r.id) + '"><input type="text" class="rName" maxlength="40" value="' + esc(r.name) + '" aria-label="Role name"><span>$</span><input type="text" inputmode="decimal" class="rWage" value="' + r.wage.toFixed(2) + '" aria-label="' + esc(r.name) + ' hourly wage"><button type="button" class="ibtn rDel" aria-label="Delete ' + esc(r.name) + '"' + (roles.length < 2 ? ' disabled' : '') + '>✕</button></div>'; }).join('');
    rolesRendering = false; }
  function rolesChanged(msg) { saveRoles(); renderRoleSettings(); renderAll(); if (msg) toast(msg); }
  function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); $('#darkToggle').checked = t === 'dark'; var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', t === 'dark' ? '#0F1115' : '#F3F4F6'); }

  /* ---------- navigation ---------- */
  var TAB = { dashboard: 'dashboard', shifts: 'shifts', tips: 'tips', reports: 'reports', log: 'shifts', settings: 'reports' }, screen = 'dashboard';
  function go(name, sub) { if (!document.getElementById('s-' + name)) name = 'dashboard'; screen = name;
    $$('.screen').forEach(function (s) { s.hidden = s.id !== 's-' + name; });
    $$('#tabbar button').forEach(function (b) { var on = b.getAttribute('data-tab') === TAB[name]; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (sub) setSeg('shiftsSeg', sub); if (history.replaceState) history.replaceState(null, '', location.pathname + '#' + name); window.scrollTo(0, 0); }
  function setSeg(id, v) { $$('#' + id + ' button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === v); });
    if (id === 'shiftsSeg') { $('#vList').hidden = v !== 'list'; $('#vCal').hidden = v !== 'cal'; }
    else { $('#rWeek').hidden = v !== 'week'; $('#rStats').hidden = v !== 'stats'; $('#rGoals').hidden = v !== 'goals'; } }
  var toastT; function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2600); }
  function renderAll() { renderMonthPick(); renderBanner(); renderDashboard(); renderHistory(); renderCalendar(); renderTips(); renderReports(); }

  function bind() {
    $('#tabbar').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) go(b.getAttribute('data-tab')); });
    document.addEventListener('click', function (e) { var g = e.target.closest('[data-go]'); if (!g) return; var n = g.getAttribute('data-go'); if (n === 'log' && !editing) resetForm(); go(n); });
    $('#hdrCal').addEventListener('click', function () { go('shifts', 'cal'); }); $('#hdrSet').addEventListener('click', function () { go('settings'); });
    $('#monthPick').addEventListener('change', function () { period = this.value; calMonth = new Date(+period.slice(0, 4), +period.slice(5) - 1, 1); calSel = null; renderAll(); });
    $('#shiftsSeg').addEventListener('click', function (e) { var b = e.target.closest('[data-v]'); if (b) setSeg('shiftsSeg', b.getAttribute('data-v')); });
    $('#repSeg').addEventListener('click', function (e) { var b = e.target.closest('[data-v]'); if (b) setSeg('repSeg', b.getAttribute('data-v')); });
    $('#logBack').addEventListener('click', function () { var was = editing; resetForm(); go(was ? 'shifts' : 'dashboard'); });
    $('#cancelEdit').addEventListener('click', function () { resetForm(); go('shifts'); });
    ['#fIn', '#fOut'].forEach(function (s) { ['input', 'change'].forEach(function (ev) { $(s).addEventListener(ev, function () { guessShift(); var sp = spanHours(normTime($('#fIn').value), normTime($('#fOut').value)); if (sp != null) $('#fHours').value = sp; hoursHint(); updateTake(); }); }); });
    $('#fHours').addEventListener('input', hoursHint); $('#form').addEventListener('input', function () { updateTake(); moreSummary(); }); $('#form').addEventListener('change', updateTake);
    $$('input[name=shift]').forEach(function (r) { r.addEventListener('change', function () { shiftTouched = true; }); });
    $('#form').addEventListener('submit', function (e) { e.preventDefault(); var f = readForm(), err = validate(f); $('#formErr').textContent = err; if (/Hours|date/.test(err)) $('#more').open = true; if (!err) commit(f); });
    $('#hList').addEventListener('click', onShiftAction);
    $('#roleFilter').addEventListener('click', function (e) { var b = e.target.closest('[data-rf]'); if (b) { roleFilter = b.getAttribute('data-rf'); renderHistory(); } });
    $('#calPrev').addEventListener('click', function () { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); calSel = null; renderCalendar(); });
    $('#calNext').addEventListener('click', function () { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); calSel = null; renderCalendar(); });
    $('#calGrid').addEventListener('click', function (e) { var c = e.target.closest('[data-date]'); if (!c) return; var d = c.getAttribute('data-date'); calSel = calSel === d ? null : d; renderCalendar(); });
    $('#calDay').addEventListener('click', function (e) { if (e.target.id === 'dayLog') { resetForm(); $('#fDate').value = calSel; moreSummary(); go('log'); return; }
      var b = e.target.closest('[data-sact]'); if (b) { var x = sched.find(function (y) { return y.id === b.closest('[data-sid]').getAttribute('data-sid'); }); if (!x) return; var a = b.getAttribute('data-sact');
        if (a === 'edit') openSchedForm(x); else if (a === 'log') openFromSched(x); else delSched(x); return; } onShiftAction(e); });
    $('#calAdd').addEventListener('click', function () { openSchedForm(null); setTimeout(function () { $('#sStart').focus(); }, 50); });
    $('#schedForm').addEventListener('submit', function (e) { e.preventDefault(); submitSched(); }); $('#schedForm').addEventListener('input', schedHint);
    $('#sCancel').addEventListener('click', closeSchedForm); $('#sDel').addEventListener('click', function () { var x = sched.find(function (y) { return y.id === schedEditing; }); if (x) delSched(x); });
    $('#icsBtn').addEventListener('click', downloadICS);
    $('#bannerText').addEventListener('click', function () { var x = sched.find(function (y) { return y.id === $('#logBanner').getAttribute('data-sid'); }); if (x) openFromSched(x); });
    $('#bannerX').addEventListener('click', function () { var x = sched.find(function (y) { return y.id === $('#logBanner').getAttribute('data-sid'); }); if (x) { x.dismissed = true; saveSched(); } renderBanner(); });
    $('#wkPrev').addEventListener('click', function () { wkStart = addDays(wkStart, -7); renderReports(); }); $('#wkNext').addEventListener('click', function () { wkStart = addDays(wkStart, 7); renderReports(); });
    ['#gWeek', '#gMonth'].forEach(function (s) { $(s).addEventListener('change', function () { var v = num(this.value), g = getJSON(K.goals) || {}; if (v != null && (isNaN(v) || v < 0)) { toast('Goal should be a number'); this.value = ''; return; }
      g[s === '#gWeek' ? 'week' : 'month'] = v ? r2(v) : null; setJSON(K.goals, g); renderReports(); }); });
    $('#csvBtn').addEventListener('click', exportCSV); $('#repCsv').addEventListener('click', exportCSV);
    $('#darkToggle').addEventListener('change', function () { var t = this.checked ? 'dark' : 'light'; localStorage.setItem(K.theme, t); applyTheme(t); });
    $('#roleList').addEventListener('change', function (e) { if (rolesRendering) return; var row = e.target.closest('.role-row'); if (!row) return; var r = roles.find(function (x) { return x.id === row.getAttribute('data-id'); }); if (!r) return;
      if (e.target.classList.contains('rName')) { var n = e.target.value.trim().slice(0, 40), dup = roleByName(n); if (!n || (dup && dup !== r)) { e.target.value = r.name; toast(n ? 'You already have ' + n : 'Role needs a name'); return; } r.name = n; rolesChanged('Renamed to ' + n + ' (past shifts keep their saved name)'); }
      else { var v = num(e.target.value); if (v == null || isNaN(v) || v < 0 || v > 200) { e.target.value = r.wage.toFixed(2); toast('Wage should be between $0 and $200'); return; } r.wage = r2(v); rolesChanged(r.name + ' set to $' + r.wage.toFixed(2) + '/hr for new shifts'); } });
    $('#roleList').addEventListener('click', function (e) { var b = e.target.closest('.rDel'); if (!b || roles.length < 2) return; var id = b.closest('.role-row').getAttribute('data-id'), r = roles.find(function (x) { return x.id === id; });
      if (r && confirm('Delete role ' + r.name + '? Past shifts keep their saved role and wage.')) { roles = roles.filter(function (x) { return x.id !== id; }); rolesChanged('Deleted ' + r.name); } });
    $('#addRole').addEventListener('click', function () { var n = $('#newRoleName').value.trim().slice(0, 40), v = num($('#newRoleWage').value);
      if (!n) { toast('Give the role a name'); return; } if (roleByName(n)) { toast('You already have ' + n); return; } if (v == null || isNaN(v) || v < 0 || v > 200) { toast('Wage should be between $0 and $200'); return; }
      roles.push({ id: uid('r'), name: n, wage: r2(v) }); $('#newRoleName').value = ''; $('#newRoleWage').value = ''; rolesChanged('Added ' + n + ' $' + r2(v).toFixed(2) + '/hr'); });
    window.addEventListener('storage', function (e) { if (e.key === K.sched) { sched = loadSched(); renderAll(); } if (e.key === K.shifts) { shifts = loadShifts(); renderAll(); } });
  }
  function init() { applyTheme(localStorage.getItem(K.theme) === 'light' ? 'light' : 'dark'); bind(); resetForm(); renderRoleSettings(); renderAll();
    var h = (location.hash || '').slice(1); if (prefillFromLink()) { renderAll(); go('log'); } else go(TAB[h] || h === 'log' || h === 'settings' ? h : 'dashboard');
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(function () {}); }
  window.__ttTest = { buildICS: function () { return buildICS(upcoming()); }, toCSV: toCSV, sched: function () { return sched; }, roles: function () { return roles; }, shifts: function () { return shifts; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
