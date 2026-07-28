/* Komari Retro Trio — vanilla JS SPA (no build required) */
'use strict';

/* ---------------- i18n ---------------- */
const I18N = {
  'zh-CN': {
    overview:'总览', online:'在线', offline:'离线', nodes:'节点',
    up:'上行', down:'下行', totalTraffic:'总流量', cpu:'CPU', ram:'内存', disk:'硬盘', swap:'SWAP',
    load:'负载', uptime:'运行时间', network:'网络', details:'详情', back:'← 返回列表',
    processes:'进程', connections:'连接', ping:'延迟', history:'4 小时历史', cores:'核',
    loginTitle:'🔒 私有站点', loginHint:'该站点为私有站点，请登录后查看。', goLogin:'前往登录',
    empty:'暂无节点数据', loading:'加载中…',
    days:'天', hours:'小时', mins:'分钟', expiredIn:'天后到期', free:'免费',
    tcp:'TCP', udp:'UDP', virt:'虚拟化', cycle:'天周期',
    loss:'丢包', min:'最小', max:'最大', avg:'平均', live:'实时', lost:'断开',
  },
  'en': {
    overview:'Overview', online:'Online', offline:'Offline', nodes:'Nodes',
    up:'Up', down:'Down', totalTraffic:'Total traffic', cpu:'CPU', ram:'RAM', disk:'Disk', swap:'Swap',
    load:'Load', uptime:'Uptime', network:'Network', details:'Details', back:'← Back to list',
    processes:'Processes', connections:'Connections', ping:'Ping', history:'4h history', cores:'cores',
    loginTitle:'🔒 Private site', loginHint:'This site is private. Please log in.', goLogin:'Log in',
    empty:'No node data', loading:'Loading…',
    days:'d', hours:'h', mins:'m', expiredIn:'d left', free:'Free',
    tcp:'TCP', udp:'UDP', virt:'Virt', cycle:'d cycle',
    loss:'Loss', min:'Min', max:'Max', avg:'Avg', live:'LIVE', lost:'LOST',
  }
};

/* ---------------- state ---------------- */
const S = {
  style: localStorage.getItem('trio.style') || '',
  appearance: localStorage.getItem('appearance') || 'system',
  lang: localStorage.getItem('language') || (navigator.language || 'en'),
  settings: {}, nodes: [], live: {}, online: new Set(),
  privateSite: false, loggedIn: false,
  route: { page: 'home', uuid: null },
  ws: null, wsTimer: null, histTimer: null, reconnect: 1000,
  homeSig: '', hist: null,
};
const t = k => (I18N[S.lang] && I18N[S.lang][k]) || I18N['en'][k] || k;

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fmtBytes(b, dec = 1) {
  b = Number(b) || 0;
  const u = ['B','KB','MB','GB','TB','PB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return b.toFixed(i ? dec : 0) + ' ' + u[i];
}
const fmtSpeed = b => fmtBytes(b) + '/s';
function fmtUptime(sec) {
  sec = Number(sec) || 0;
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  if (d) return `${d}${t('days')} ${h}${t('hours')}`;
  if (h) return `${h}${t('hours')} ${m}${t('mins')}`;
  return `${m}${t('mins')}`;
}
const pct = (a, b) => b > 0 ? Math.min(100, Math.max(0, a / b * 100)) : 0;
const barCls = p => p >= 90 ? 'crit' : p >= 70 ? 'warn' : '';
const nodeById = u => S.nodes.find(n => n.uuid === u);
const sortedNodes = () => [...S.nodes].sort((a, b) => (b.weight || 0) - (a.weight || 0) || String(a.name).localeCompare(String(b.name)));

async function api(path) {
  const r = await fetch(path, { credentials: 'same-origin' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return j.data !== undefined ? j.data : j;
}

/* ---------------- prefs / skins ---------------- */
function resolveMode() {
  if (S.appearance === 'system')
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return S.appearance;
}
function applyPrefs() {
  if (!S.style) S.style = S.settings.default_style || 'terminal';
  const root = document.documentElement;
  root.dataset.skin = S.style;
  root.dataset.mode = resolveMode();
  root.lang = S.lang;
  const fx = (S.style === 'terminal' && String(S.settings.scanlines) !== 'false')
          || (S.style === 'cyber' && String(S.settings.glow) !== 'false');
  document.body.classList.toggle('fx', !!fx);
  $$('#skin-seg button').forEach(b => b.classList.toggle('active', b.dataset.skin === S.style));
  $('#lang-btn').textContent = S.lang.startsWith('zh') ? 'EN' : '文';
  $('#mode-btn').textContent = { light: '☀', dark: '☾', system: '◐' }[S.appearance] || '◐';
}
function bindUI() {
  $$('#skin-seg button').forEach(b => b.onclick = () => {
    S.style = b.dataset.skin; localStorage.setItem('trio.style', S.style);
    applyPrefs(); if (S.route.page === 'node') drawHistory(); // chart colors follow skin
  });
  $('#mode-btn').onclick = () => {
    S.appearance = { light: 'dark', dark: 'system', system: 'light' }[S.appearance];
    localStorage.setItem('appearance', S.appearance);
    applyPrefs(); if (S.route.page === 'node') drawHistory();
  };
  $('#lang-btn').onclick = () => {
    S.lang = S.lang.startsWith('zh') ? 'en' : 'zh-CN';
    localStorage.setItem('language', S.lang); applyPrefs(); render(true);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyPrefs(); if (S.route.page === 'node') drawHistory();
  });
}

/* ---------------- websocket ---------------- */
function setWsDot(live) {
  const d = $('#ws-dot'); if (!d) return;
  d.classList.toggle('live', !!live);
  d.title = live ? t('live') : t('lost');
}
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  try { S.ws && S.ws.close(); } catch (e) {}
  const ws = new WebSocket(`${proto}://${location.host}/api/clients`);
  S.ws = ws;
  ws.onopen = () => {
    S.reconnect = 1000; setWsDot(true);
    ws.send('get');
    clearInterval(S.wsTimer);
    S.wsTimer = setInterval(() => { if (ws.readyState === 1) ws.send('get'); }, 3000);
  };
  ws.onmessage = ev => {
    try {
      const j = JSON.parse(ev.data);
      const d = j.data || {};
      if (Array.isArray(d.online)) S.online = new Set(d.online);
      if (d.data) S.live = d.data;
      liveUpdate();
    } catch (e) {}
  };
  ws.onclose = () => {
    setWsDot(false);
    clearInterval(S.wsTimer);
    setTimeout(connectWS, S.reconnect);
    S.reconnect = Math.min(S.reconnect * 2, 15000);
  };
  ws.onerror = () => ws.close();
}

/* ---------------- live field helpers ---------------- */
function setBar(el, p) {
  const bar = el.querySelector('.bar');
  if (!bar) return;
  bar.className = 'bar ' + barCls(p);
  bar.firstElementChild.style.width = p.toFixed(1) + '%';
}
function setText(el, sel, txt) {
  const n = el.querySelector(sel);
  if (n && n.textContent !== txt) n.textContent = txt;
}

/* ---------------- home ---------------- */
function overviewHTML() {
  return `<div class="ov">
    <div class="ov-item"><div class="k">${t('nodes')}</div><div class="v"><span id="ov-on">0</span><small class="dim" id="ov-total"> / 0</small></div></div>
    <div class="ov-item"><div class="k">↑ ${t('up')}</div><div class="v" id="ov-up">-</div></div>
    <div class="ov-item"><div class="k">↓ ${t('down')}</div><div class="v" id="ov-down">-</div></div>
    <div class="ov-item"><div class="k">Σ ${t('totalTraffic')}</div><div class="v" id="ov-traffic">-</div></div>
  </div>`;
}
function nodeCardHTML(n) {
  return `<a class="card" data-uuid="${n.uuid}" href="#/node/${n.uuid}">
    <div class="head"><span class="dot"></span>
      <span class="name">${esc(n.name)}</span><span class="off-badge">${t('offline')}</span><span class="region">${esc(n.region || '')}</span></div>
    <div class="sub">${esc(n.os || '')} · ${n.cpu_cores || '?'}${t('cores')}${n.group ? ' · ' + esc(n.group) : ''}</div>
    <div class="meter" data-m="cpu"><div class="lab"><span>${t('cpu')}</span><b>-</b></div><div class="bar"><i></i></div></div>
    <div class="meter" data-m="ram"><div class="lab"><span>${t('ram')}</span><b>-</b></div><div class="bar"><i></i></div></div>
    <div class="meter" data-m="disk"><div class="lab"><span>${t('disk')}</span><b>-</b></div><div class="bar"><i></i></div></div>
    <div class="net"><span class="up">↑ <b>-</b></span><span class="down">↓ <b>-</b></span><span>Σ <b>-</b></span></div>
    <div class="foot"><span class="f-uptime">-</span><span class="f-price">${(() => {
      if (n.price > 0) return esc(n.currency || '$') + n.price + '/' + (n.billing_cycle || 30) + t('cycle');
      if (n.price === -1) return t('free');
      return '';
    })()}${n.expired_at ? (n.price > 0 || n.price === -1 ? ' · ' : '') + Math.max(0, Math.ceil((new Date(n.expired_at) - Date.now()) / 86400000)) + ' ' + t('expiredIn') : ''}</span></div>
  </a>`;
}
function renderHome(force) {
  const cards = sortedNodes();
  const sig = cards.map(n => n.uuid).join(',') + '|' + S.lang;
  if (!force && sig === S.homeSig && $('#view .grid')) { updateHomeLive(); return; }
  S.homeSig = sig;
  $('#view').innerHTML = overviewHTML() + (cards.length
    ? `<div class="grid">${cards.map(nodeCardHTML).join('')}</div>`
    : `<div class="msg">${t('empty')}</div>`);
  updateHomeLive();
}
function updateHomeLive() {
  if (S.route.page !== 'home') return;
  let up = 0, down = 0, traffic = 0;
  for (const u of Object.keys(S.live)) {
    const L = S.live[u];
    if (L.network) { up += L.network.up || 0; down += L.network.down || 0; traffic += (L.network.totalUp || 0) + (L.network.totalDown || 0); }
  }
  const on = $('#ov-on'); if (!on) return;
  on.textContent = S.online.size;
  $('#ov-total').textContent = ' / ' + S.nodes.length;
  $('#ov-up').textContent = fmtSpeed(up);
  $('#ov-down').textContent = fmtSpeed(down);
  $('#ov-traffic').textContent = fmtBytes(traffic);
  $$('#view .card[data-uuid]').forEach(card => {
    const u = card.dataset.uuid, n = nodeById(u);
    if (!n) return;
    const isOn = S.online.has(u);
    card.classList.toggle('off', !isOn);
    card.querySelector('.dot').className = 'dot' + (isOn ? ' on' : '');
    const L = S.live[u] || {};
    const cpuU = L.cpu ? L.cpu.usage || 0 : 0;
    const ramT = (L.ram && L.ram.total) || n.mem_total || 0, ramU = L.ram ? L.ram.used || 0 : 0;
    const dskT = (L.disk && L.disk.total) || n.disk_total || 0, dskU = L.disk ? L.disk.used || 0 : 0;
    const mc = card.querySelector('[data-m=cpu]'), mr = card.querySelector('[data-m=ram]'), md = card.querySelector('[data-m=disk]');
    setText(mc, '.lab b', cpuU.toFixed(1) + '%'); setBar(mc, cpuU);
    setText(mr, '.lab b', `${fmtBytes(ramU)} / ${fmtBytes(ramT)}`); setBar(mr, pct(ramU, ramT));
    setText(md, '.lab b', `${fmtBytes(dskU)} / ${fmtBytes(dskT)}`); setBar(md, pct(dskU, dskT));
    const net = L.network || {};
    setText(card, '.net .up b', fmtSpeed(net.up || 0));
    setText(card, '.net .down b', fmtSpeed(net.down || 0));
    setText(card, '.net span:last-child b', fmtBytes((net.totalUp || 0) + (net.totalDown || 0)));
    setText(card, '.f-uptime', '⏱ ' + (isOn ? fmtUptime(L.uptime) : t('offline')));
  });
}

/* ---------------- detail ---------------- */
const stat = (k, key) => `<div class="stat"><div class="k">${k}</div><div class="v" data-k="${key}">-</div></div>`;
function renderDetail() {
  const n = nodeById(S.route.uuid);
  if (!n) { $('#view').innerHTML = `<a class="back" href="#/">${t('back')}</a><div class="msg">${t('empty')}</div>`; return; }
  $('#view').innerHTML = `
    <a class="back" href="#/">${t('back')}</a>
    <div class="dhead"><span class="dot" id="d-dot"></span><h1>${esc(n.name)}</h1><span>${esc(n.region || '')}</span>
      <span class="tag">${esc(n.os || '')} · ${esc(n.cpu_name || '')} (${n.cpu_cores || '?'}${t('cores')}) · ${esc(n.virtualization || '')}</span></div>
    <div class="stat-grid">
      ${stat(t('cpu'), 'cpu')}${stat(t('ram'), 'ram')}${stat(t('swap'), 'swap')}${stat(t('disk'), 'disk')}
      ${stat(`↑ ${t('up')}`, 'up')}${stat(`↓ ${t('down')}`, 'down')}
      ${stat(t('load'), 'load')}${stat(t('uptime'), 'uptime')}
      ${stat(t('connections'), 'conn')}${stat(t('processes'), 'proc')}
    </div>
    <div class="panel"><h3>${t('cpu')} % — ${t('history')}</h3><canvas id="ch-cpu"></canvas></div>
    <div class="panel"><h3>${t('ram')} % — ${t('history')}</h3><canvas id="ch-ram"></canvas></div>
    <div class="panel"><h3>${t('network')} — ${t('history')}</h3><canvas id="ch-net"></canvas>
      <div class="legend"><span><i style="background:var(--pri)"></i>${t('up')}</span><span><i style="background:var(--acc)"></i>${t('down')}</span></div></div>
    <div class="panel" id="ping-panel" style="display:none"><h3>${t('ping')} — ${t('history')}</h3><canvas id="ch-ping"></canvas>
      <div class="legend" id="ping-legend"></div></div>`;
  updateDetailLive();
  fetchHistory(n.uuid);
}
function updateDetailLive() {
  if (S.route.page !== 'node') return;
  const n = nodeById(S.route.uuid); if (!n) return;
  const isOn = S.online.has(n.uuid);
  const dd = $('#d-dot'); if (dd) dd.className = 'dot' + (isOn ? ' on' : '');
  const L = S.live[n.uuid] || {};
  const ramT = (L.ram && L.ram.total) || n.mem_total || 0, ramU = L.ram ? L.ram.used || 0 : 0;
  const swT = (L.swap && L.swap.total) || n.swap_total || 0, swU = L.swap ? L.swap.used || 0 : 0;
  const dskT = (L.disk && L.disk.total) || n.disk_total || 0, dskU = L.disk ? L.disk.used || 0 : 0;
  const net = L.network || {}, conn = L.connections || {}, load = L.load || {};
  const set = (k, v) => { const el = $(`[data-k=${k}]`); if (el && el.textContent !== v) el.textContent = v; };
  set('cpu', (L.cpu ? (L.cpu.usage || 0).toFixed(1) : '0.0') + '%');
  set('ram', `${fmtBytes(ramU)} / ${fmtBytes(ramT)} (${pct(ramU, ramT).toFixed(0)}%)`);
  set('swap', `${fmtBytes(swU)} / ${fmtBytes(swT)}`);
  set('disk', `${fmtBytes(dskU)} / ${fmtBytes(dskT)} (${pct(dskU, dskT).toFixed(0)}%)`);
  set('up', fmtSpeed(net.up || 0));
  set('down', fmtSpeed(net.down || 0));
  set('load', `${load.load1 ?? 0} / ${load.load5 ?? 0} / ${load.load15 ?? 0}`);
  set('uptime', isOn ? fmtUptime(L.uptime) : t('offline'));
  set('conn', `${t('tcp')} ${conn.tcp ?? 0} · ${t('udp')} ${conn.udp ?? 0}`);
  set('proc', String(L.process ?? 0));
}

/* ---------------- history ---------------- */
async function fetchHistory(uuid) {
  clearInterval(S.histTimer);
  const load = async () => {
    if (S.route.page !== 'node' || S.route.uuid !== uuid) return;
    const hist = { times: [], recs: [], ping: null };
    try {
      const d = await api(`/api/records/load?uuid=${uuid}&hours=4`);
      hist.recs = (d && d.records) || [];
      hist.times = hist.recs.map(r => new Date(r.time));
    } catch (e) {}
    try {
      const d = await api(`/api/records/ping?uuid=${uuid}&hours=4`);
      const recs = (d && d.records) || [], tasks = (d && d.tasks) || [];
      if (recs.length && tasks.length) {
        const byTask = {};
        recs.forEach(r => { (byTask[r.task_id] = byTask[r.task_id] || { times: [], data: [] });
          byTask[r.task_id].times.push(new Date(r.time)); byTask[r.task_id].data.push(r.value < 0 ? null : r.value); });
        hist.ping = { byTask, tasks };
      }
    } catch (e) {}
    if (S.route.page !== 'node' || S.route.uuid !== uuid) return;
    S.hist = hist;
    drawHistory();
  };
  await load();
  S.histTimer = setInterval(load, 60000);
}
function drawHistory() {
  const h = S.hist;
  if (!h || S.route.page !== 'node') return;
  drawChart($('#ch-cpu'), h.times, [{ data: h.recs.map(r => r.cpu || 0), color: cssVar('--pri'), max: 100 }]);
  drawChart($('#ch-ram'), h.times, [{ data: h.recs.map(r => pct(r.ram, r.ram_total)), color: cssVar('--pri'), max: 100 }]);
  drawChart($('#ch-net'), h.times, [
    { data: h.recs.map(r => r.net_out || 0), color: cssVar('--pri') },
    { data: h.recs.map(r => r.net_in || 0), color: cssVar('--acc') },
  ], fmtSpeed);
  const pp = $('#ping-panel');
  if (h.ping && pp) {
    const colors = ['--pri', '--acc', '--warn', '--ok', '--blue', '--gold'];
    const series = [], legend = [];
    let tt = [], i = 0;
    for (const task of h.ping.tasks) {
      const s = h.ping.byTask[task.id]; if (!s) continue;
      if (s.times.length > tt.length) tt = s.times;
      series.push({ data: s.data, color: cssVar(colors[i % colors.length]) });
      legend.push(`<span><i style="background:var(${colors[i % colors.length]})"></i>${esc(task.name)} · ${t('avg')} ${task.avg ?? '?'}ms · ${t('loss')} ${task.loss ?? '?'}%</span>`);
      i++;
    }
    if (series.length) {
      pp.style.display = '';
      drawChart($('#ch-ping'), tt, series, v => v == null ? 'loss' : v.toFixed(0) + 'ms');
      const lg = $('#ping-legend'); if (lg) lg.innerHTML = legend.join('');
    }
  }
}

/* ---------------- canvas chart ---------------- */
function cssVar(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || '#888';
}
function drawChart(canvas, times, series, fmt) {
  if (!canvas || !series.length) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const padL = 46, padR = 8, padT = 8, padB = 18;
  const iw = W - padL - padR, ih = H - padT - padB;
  let max = 0;
  series.forEach(s => { if (s.max) max = Math.max(max, s.max); else s.data.forEach(v => { if (v != null && v > max) max = v; }); });
  if (!max) max = 1; max *= 1.1;
  const n = Math.max(...series.map(s => s.data.length), 2);
  const x = i => padL + iw * i / (n - 1);
  const y = v => padT + ih * (1 - (v || 0) / max);
  const dim = cssVar('--faint'), fg = cssVar('--dim');
  ctx.strokeStyle = dim; ctx.fillStyle = fg; ctx.lineWidth = 1;
  ctx.font = '10px ' + getComputedStyle(document.body).fontFamily;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const rows = 4;
  for (let g = 0; g <= rows; g++) {
    const gy = padT + ih * g / rows, val = max * (1 - g / rows) / 1.1;
    ctx.globalAlpha = .35; ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillText(fmt ? fmt(val) : val.toFixed(0), padL - 6, gy);
  }
  if (times && times.length) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const f = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    ctx.fillText(f(times[0]), padL, H - padB + 4);
    ctx.textAlign = 'right';
    ctx.fillText(f(times[times.length - 1]), W - padR, H - padB + 4);
  }
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = 1.6; ctx.beginPath();
    let started = false, lastX = 0, lastY = 0;
    s.data.forEach((v, i) => {
      if (v == null) { started = false; return; }
      const px = x(i), py = y(v);
      if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      lastX = px; lastY = py;
    });
    ctx.stroke();
    ctx.globalAlpha = .12; ctx.fillStyle = s.color; ctx.beginPath();
    started = false;
    s.data.forEach((v, i) => {
      if (v == null) { started = false; return; }
      const px = x(i), py = y(v);
      if (!started) { ctx.moveTo(px, padT + ih); ctx.lineTo(px, py); started = true; } else ctx.lineTo(px, py);
    });
    if (started) { ctx.lineTo(lastX, padT + ih); ctx.closePath(); ctx.fill(); }
    ctx.globalAlpha = 1;
    // endpoint marker
    if (started) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2); ctx.fill(); }
  }
}

/* ---------------- router ---------------- */
function route() {
  clearInterval(S.histTimer);
  S.hist = null;
  const h = location.hash || '#/';
  const m = h.match(/^#\/node\/([\w-]+)/);
  S.route = m ? { page: 'node', uuid: m[1] } : { page: 'home', uuid: null };
  render(true);
  window.scrollTo(0, 0);
}
function render(force) {
  if (S.privateSite && !S.loggedIn && !S.nodes.length) { renderLock(); return; }
  if (S.route.page === 'node') renderDetail(); else renderHome(force);
}
function liveUpdate() {
  if (S.route.page === 'node') updateDetailLive(); else updateHomeLive();
}
function renderLock() {
  $('#view').innerHTML = `<div class="msg"><span class="big">${t('loginTitle')}</span>
    <p>${t('loginHint')}</p><p style="margin-top:14px"><a class="icon-btn" style="width:auto;padding:0 14px" href="/admin">${t('goLogin')}</a></p></div>`;
}

/* ---------------- boot ---------------- */
(async function init() {
  bindUI();
  window.addEventListener('hashchange', route);
  try { document.getElementById('sitename').textContent = document.title || 'Komari'; } catch (e) {}
  try {
    const pub = await api('/api/public');
    S.settings = pub.theme_settings || {};
    S.privateSite = !!pub.private_site;
    if (pub.sitename) $('#sitename').textContent = pub.sitename;
    if (S.settings.footer_text) $('#footer-extra').innerHTML = S.settings.footer_text;
  } catch (e) {}
  applyPrefs();
  try { const me = await api('/api/me'); S.loggedIn = !!me.logged_in; } catch (e) {}
  $('#view').innerHTML = `<div class="msg">${t('loading')}</div>`;
  try { S.nodes = await api('/api/nodes') || []; } catch (e) { S.nodes = []; }
  route();
  connectWS();
  setInterval(async () => {
    try {
      const fresh = await api('/api/nodes') || [];
      const changed = fresh.length !== S.nodes.length || fresh.some(n => { const o = nodeById(n.uuid); return !o || o.name !== n.name || o.weight !== n.weight; });
      S.nodes = fresh;
      if (changed && S.route.page === 'home') renderHome(true);
    } catch (e) {}
  }, 60000);
  let rzT = null;
  window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(drawHistory, 200); });
})();
