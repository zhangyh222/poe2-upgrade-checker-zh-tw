'use strict';
/* global window, document, ResizeObserver */

// Passive tree page: the whole PoE2 tree drawn on a canvas, with your allocated path
// highlighted. Positions come from PoB's own tree data (group centre + orbit radius and
// angle), so the drawing lines up with the game. Scroll to zoom, drag to move, hover a
// node for its stats, search to find one.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const t = (s, ...a) => (window.i18n ? window.i18n.t(s, ...a) : (a.length ? String(s).replace(/\{(\d+)\}/g, (_, i) => (a[Number(i)] != null ? a[Number(i)] : '')) : s));
  const gn = (s) => (window.gdName ? window.gdName(s) : s);
  const gt = (s) => (window.gdText ? window.gdText(s) : s);
  const displayError = (v) => (v && typeof v === 'object' ? t(v.key || '', ...(Array.isArray(v.args) ? v.args : [])) : t(String(v == null ? '' : v)));

  const COLORS = {
    background: '#0d0c0a',
    edge: '#343029',
    edgeOn: '#d9b877',
    set1: '#e06c5a',
    set2: '#6fce86',
    normal: '#6b665c',
    notable: '#4c6884',
    keystone: '#e0b070',
    ascendancy: '#c9a3ff',
    socket: '#5f8f7f',
    on: '#ffe14d',
    jewel: '#b06ef0',
    label: '#cfc6b8',
  };

  let tree = null; // PoB's tree payload
  let sheet = null;
  let nodes = []; // { id, x, y, flags, name, stats, asc }
  let edges = []; // [node, node]
  let byId = new Map();
  let jewelById = new Map(); // socket node id -> the jewel in it
  let busy = false;
  let view = { s: 0.02, x: 0, y: 0 }; // world -> screen: x*s + view.x
  let hover = null;
  let matches = new Set();
  let dragging = null;

  const canvas = $('#passCanvas');
  const wrap = $('#passWrap');
  const tip = $('#passTip');
  const ctx = canvas.getContext('2d');

  let lastSize = { w: 0, h: 0, dpr: 0 };
  function sizeCanvas(force) {
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(320, Math.round(rect.width));
    const h = Math.max(320, Math.round(rect.height));
    // resizing the backing store clears it, so only do it when the size really changed
    if (force || w !== lastSize.w || h !== lastSize.h || dpr !== lastSize.dpr) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastSize = { w, h, dpr };
    }
    return { w, h };
  }

  function build() {
    nodes = [];
    byId = new Map();
    for (const n of tree.nodes || []) {
      const [id, x, y, name, flags, asc, stats] = n;
      const node = { id, x, y, flags, name: name || '', asc: asc || '', stats: stats || [] };
      byId.set(id, node);
      nodes.push(node);
    }
    edges = [];
    for (const [a, b] of tree.edges || []) {
      const ia = byId.get(a); const ib = byId.get(b);
      if (ia && ib) edges.push([ia, ib]);
    }
    jewelById = new Map((tree.jewels || []).map((j) => [j.nodeId, j]));
  }

  function nodeRadius(n) {
    if (n.flags & 2) return 6.5; // keystone
    if (n.flags & 1) return 4.6; // notable
    if (n.flags & 4) return 3.6; // ascendancy
    if (n.flags & 16) return 3.4; // jewel socket
    return 3;
  }

  // shared points are yellow; points that only work with weapon set 1 / 2 are red / green
  function setOf(n) { return n.flags & 32 ? 1 : n.flags & 64 ? 2 : 0; }
  function allocColor(n) { const set = setOf(n); return set === 1 ? COLORS.set1 : set === 2 ? COLORS.set2 : COLORS.on; }

  function colorOf(n) {
    if (n.flags & 8) return allocColor(n);
    if (n.flags & 2) return COLORS.keystone;
    if (n.flags & 4) return COLORS.ascendancy;
    if (n.flags & 1) return COLORS.notable;
    if (n.flags & 16) return COLORS.socket;
    return COLORS.normal;
  }

  function viewBounds() {
    const w = canvas.clientWidth || 1; const h = canvas.clientHeight || 1;
    return { left: -view.x / view.s, top: -view.y / view.s, right: (w - view.x) / view.s, bottom: (h - view.y) / view.s };
  }

  function draw() {
    if (!tree || !nodes.length) return;
    const { w, h } = sizeCanvas();
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, w, h);
    const b = viewBounds();
    const visible = (n) => n.x >= b.left - 20 && n.x <= b.right + 20 && n.y >= b.top - 20 && n.y <= b.bottom + 20;

    // jewel radii: solid purple rings, drawn under the nodes (only for sockets you have allocated)
    for (const j of tree.jewels || []) {
      if (!j.allocated || !j.outer) continue;
      const cx = j.x * view.s + view.x;
      const cy = j.y * view.s + view.y;
      const ro = j.outer * view.s;
      if (ro < 8) continue;
      const ri = (j.inner || 0) * view.s;
      const col = COLORS.jewel;
      ctx.save();
      ctx.fillStyle = `${col}1a`;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, ro, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (ri > 3) { ctx.beginPath(); ctx.arc(cx, cy, ri, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }

    // links: gold where both ends are allocated
    for (const [a, c] of edges) {
      if (!visible(a) && !visible(c)) continue;
      const on = (a.flags & 8) && (c.flags & 8);
      let edge = COLORS.edge;
      if (on) {
        const sa = setOf(a); const sc = setOf(c);
        edge = sa && sa === sc ? (sa === 1 ? COLORS.set1 : COLORS.set2) : COLORS.edgeOn;
        // a shared segment that leads into a set-specific branch is drawn in the set's colour
      }
      ctx.strokeStyle = edge;
      ctx.lineWidth = on ? Math.max(2, Math.min(3.4, view.s * 26)) : 1.2;
      ctx.beginPath();
      ctx.moveTo(a.x * view.s + view.x, a.y * view.s + view.y);
      ctx.lineTo(c.x * view.s + view.x, c.y * view.s + view.y);
      ctx.stroke();
    }

    // nodes
    // node size follows the space between nodes, so the tree stays readable at any zoom
    const gap = 115 * view.s;
    const radiusPx = (n) => Math.max(1.1, Math.min(nodeRadius(n), gap * 0.42));
    const big = view.s > 0.12; // names only once there is room
    const keystoneLabels = view.s > 0.02;
    for (const n of nodes) {
      if (!visible(n)) continue;
      const x = n.x * view.s + view.x;
      const y = n.y * view.s + view.y;
      const r = radiusPx(n) + ((n.flags & 8) && view.s < 0.05 ? 0.6 : 0);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = colorOf(n);
      ctx.fill();
      if (n.flags & 8) {
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#3a2f1e';
        ctx.stroke();
      }
      // a socket with something in it gets a purple ring
      const jw = jewelById.get(n.id);
      if (jw && jw.allocated) {
        ctx.beginPath();
        ctx.arc(x, y, r + 2.4, 0, Math.PI * 2);
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = COLORS.jewel;
        ctx.stroke();
      }
      if (hover === n || matches.has(n.id)) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = hover === n ? '#fff4d6' : '#ffffff';
        ctx.stroke();
      }
    }

    // names of the big nodes, once there is room for them
    if (keystoneLabels) {
      ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const n of nodes) {
        if (!(n.flags & 2) && !(big && (n.flags & 1))) continue; // keystones, then notables when zoomed in
        if (!visible(n)) continue;
        const label = gn(n.name);
        if (!label) continue;
        const x = n.x * view.s + view.x;
        const y = n.y * view.s + view.y + radiusPx(n) + 3;
        const width = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(10,9,7,.75)';
        ctx.fillRect(x - width / 2 - 2, y - 1, width + 4, 13);
        ctx.fillStyle = n.flags & 8 ? '#f4e2b8' : COLORS.label;
        ctx.fillText(label, x, y);
      }
    }
    drawLegend();
  }

  function drawLegend() {
    const items = [
      ['on', t('Allocated')],
      ['set1', t('Weapon set 1')],
      ['set2', t('Weapon set 2')],
      ['keystone', t('Keystones')],
      ['notable', t('Notables')],
      ['ascendancy', t('Ascendancy')],
      ['normal', t('Small passives')],
    ];
    $('#passLegend').innerHTML = items.map(([k, label]) => `<span class="lg"><i style="background:${COLORS[k]}"></i>${esc(label)}</span>`).join('');
  }

  function fitAll() {
    const [minX, minY, maxX, maxY] = tree.bounds || [-1000, -1000, 1000, 1000];
    const w = canvas.clientWidth || 800; const h = canvas.clientHeight || 520;
    const s = Math.min(w / (maxX - minX), h / (maxY - minY)) * 0.94;
    view = { s, x: w / 2 - ((minX + maxX) / 2) * s, y: h / 2 - ((minY + maxY) / 2) * s };
    draw();
  }

  function centerAllocated() {
    const on = nodes.filter((n) => n.flags & 8);
    if (!on.length) { fitAll(); return; }
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const n of on) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
    const pad = 900;
    const w = canvas.clientWidth || 800; const h = canvas.clientHeight || 520;
    const s = Math.min(w / (maxX - minX + pad * 2), h / (maxY - minY + pad * 2));
    view = { s, x: w / 2 - ((minX + maxX) / 2) * s, y: h / 2 - ((minY + maxY) / 2) * s };
    draw();
  }

  function nodeAt(px, py) {
    const wx = (px - view.x) / view.s;
    const wy = (py - view.y) / view.s;
    let best = null; let bestD = Infinity;
    for (const n of nodes) {
      const dx = n.x - wx; const dy = n.y - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = n; }
    }
    const radius = best ? nodeRadius(best) + 10 : 12;
    return best && bestD * view.s * view.s <= radius * radius ? best : null;
  }

  // what is socketed in this node, and how far a radius jewel reaches
  function jewelHtml(n) {
    const j = jewelById.get(n.id);
    if (!j) return '';
    const name = gn(j.name) || '';
    const base = j.baseType && j.baseType !== j.name ? gn(j.baseType) : '';
    // a jewel's size is game text, so it follows the game data's language (Traditional Chinese)
    const tw = (s) => (window.i18n && window.i18n.tIn ? window.i18n.tIn('zh-TW', s) : t(s));
    const radius = j.label ? `<span class="pj-rad">${esc(tw(j.label))}</span>` : '';
    const mods = (j.mods || []).map((m) => `<div>${esc(gt(m))}</div>`).join('');
    // From Nothing-style jewels reach around a keystone instead of the socket itself
    const note = j.keystone
      ? t('Its radius is drawn around {0}', gn(j.keystone))
      : j.label ? t('Passives inside the ring are the ones this jewel affects') : '';
    return `<div class="pt-jewel"><div class="pj-head"><b>${esc(name)}</b>${base ? `<small>${esc(base)}</small>` : ''}${radius}</div>`
      + (mods ? `<div class="pj-mods">${mods}</div>` : '')
      + (j.allocated ? '' : `<div class="pj-note">${esc(t('This socket is not allocated, so the jewel does nothing yet'))}</div>`)
      + (note ? `<div class="pj-note">${esc(note)}</div>` : '')
      + '</div>';
  }

  function showTip(n, px, py) {
    if (!n) { tip.classList.add('hidden'); return; }
    const kind = n.flags & 2 ? t('Keystones') : n.flags & 4 ? t('Ascendancy') : n.flags & 1 ? t('Notables') : n.flags & 16 ? t('Jewel socket') : t('Small passives');
    const stats = (n.stats || []).map((s) => `<div>${esc(gt(s))}</div>`).join('');
    const set = setOf(n);
    const onLabel = !(n.flags & 8) ? '' : set === 1 ? t('Weapon set 1') : set === 2 ? t('Weapon set 2') : t('Allocated');
    tip.innerHTML = `<div class="pt-head"><b>${esc(gn(n.name) || '?')}</b><span class="pt-kind">${esc(kind)}</span>${onLabel ? `<span class="pt-on">${esc(onLabel)}</span>` : ''}</div>`
      + (stats ? `<div class="pt-stats">${stats}</div>` : '')
      + jewelHtml(n)
      + (n.asc ? `<div class="pt-asc">${esc(gn(n.asc))}</div>` : '');
    tip.classList.remove('hidden');
    const tw = tip.offsetWidth; const th = tip.offsetHeight;
    let left = px + 14; let top = py + 14;
    if (left + tw > (canvas.clientWidth || 0) - 6) left = Math.max(6, px - tw - 14);
    if (top + th > (canvas.clientHeight || 0) - 6) top = Math.max(6, canvas.clientHeight - th - 6);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function setMatches() {
    const q = ($('#passSearch').value || '').trim().toLowerCase();
    matches = new Set();
    if (!q) return;
    for (const n of nodes) {
      const hay = [n.name, gn(n.name), ...n.stats, ...n.stats.map(gt)].join(' ').toLowerCase();
      if (hay.includes(q)) matches.add(n.id);
    }
  }

  function focusNode(n) {
    const w = canvas.clientWidth || 800; const h = canvas.clientHeight || 520;
    view.s = Math.max(0.12, view.s);
    view.x = w / 2 - n.x * view.s;
    view.y = h / 2 - n.y * view.s;
    hover = n;
    draw();
    showTip(n, w / 2, h / 2);
  }

  async function load(refresh) {
    if (busy) return;
    busy = true;
    try {
      const [d, sheetRes] = await Promise.all([window.api.pobTree(), window.api.pobSheet(!!refresh)]);
      if (!d || !d.ok) {
        tree = null;
        $('#passSub').textContent = displayError((d && d.error) || '') || t('Paste your Path of Building export on My gear to see your passive tree.');
        sizeCanvas();
        return;
      }
      tree = d;
      sheet = sheetRes && sheetRes.sheet;
      build();
      const treeSheet = (sheet && sheet.tree) || {};
      const asc = (treeSheet.nodes || []).filter((n) => n.asc).length;
      $('#passSub').textContent = t('All {0} passives you have allocated ({2} points), {1} of them ascendancy, with what each one gives you.', (treeSheet.nodes || []).length, asc, treeSheet.points || 0);
      sizeCanvas();
      fitAll();
    } catch (err) {
      $('#passSub').textContent = String((err && err.message) || err);
    } finally {
      busy = false;
    }
  }

  // ---- interaction ----
  canvas.style.cursor = 'grab';
  canvas.addEventListener('mousemove', (ev) => {
    if (dragging) {
      view.x = dragging.x + (ev.clientX - dragging.cx);
      view.y = dragging.y + (ev.clientY - dragging.cy);
      draw();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const n = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top);
    if (n !== hover) { hover = n; draw(); }
    showTip(n, ev.clientX - rect.left, ev.clientY - rect.top);
  });
  canvas.addEventListener('mouseleave', () => { hover = null; tip.classList.add('hidden'); draw(); });
  canvas.addEventListener('mousedown', (ev) => {
    dragging = { cx: ev.clientX, cy: ev.clientY, x: view.x, y: view.y };
    canvas.style.cursor = 'grabbing';
    ev.preventDefault();
  });
  document.addEventListener('mouseup', () => { if (dragging) { dragging = null; canvas.style.cursor = 'grab'; } });
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left; const my = ev.clientY - rect.top;
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    const s = Math.min(0.6, Math.max(0.008, view.s * factor));
    view.x = mx - (mx - view.x) * (s / view.s);
    view.y = my - (my - view.y) * (s / view.s);
    view.s = s;
    draw();
  }, { passive: false });
  canvas.addEventListener('dblclick', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const n = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top);
    if (n) focusNode(n);
  });

  $('#passFit').addEventListener('click', () => { if (tree) fitAll(); });
  $('#passCenter').addEventListener('click', () => { if (tree) centerAllocated(); });
  $('#passSearch').addEventListener('input', () => { setMatches(); draw(); });
  $('#passSearch').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    setMatches();
    const first = nodes.find((n) => matches.has(n.id));
    if (first) focusNode(first);
  });

  document.querySelector('.tabs button[data-tab="passives"]').addEventListener('click', () => load(false));
  window.api.onChanged(() => { if ($('#tab-passives').classList.contains('active')) load(true); });
  if (window.i18n && window.i18n.onChange) window.i18n.onChange(() => { if ($('#tab-passives').classList.contains('active') && tree) draw(); });
  // jump to one passive (used to check a jewel's radius lands where the game draws it)
  window.passivesFocusNode = (id) => { const n = byId.get(Number(id)); if (n) focusNode(n); };
  if (window.api && window.api.onLang) window.api.onLang((lang) => { if (window.i18n) window.i18n.setLangLocal(lang); });

  new ResizeObserver(() => { if (tree && $('#tab-passives').classList.contains('active')) { sizeCanvas(); draw(); } }).observe(wrap);
  window.renderPassives = () => load(true);
})();
