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
  let searchInfo = new Map(); // id -> { cost, allocated } from the engine's search
  let path = null; // the node ids from something allocated to the picked node
  let pathCost = null;
  let currentSet = 1; // which weapon set the page is calculated on
  // The tree draft is edited on the tree itself: the working set starts as a copy
  // of what the build has, every click adds or takes back one node, and nothing
  // reaches the draft until the player says the shape is right.
  let draftMode = false;
  let draftBase = new Set();
  let draftSet = new Set();
  let draftSel = null;
  let draftMsg = '';
  let lastResult = null; // the last engine answer, so the set filter needs no new call
  let filter = null; // a legend chip picked: highlight/zoom just those nodes
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

  // which nodes a picked legend chip keeps in focus (the rest are dimmed)
  function filterMatch(n) {
    switch (filter) {
      case 'on': return !!(n.flags & 8);
      // a weapon-set chip keeps the shared trunk visible: the set's own nodes are
      // only meaningful together with the path that leads to them
      case 'set1': return setOf(n) !== 2;
      case 'set2': return setOf(n) !== 1;
      case 'keystone': return !!(n.flags & 2);
      case 'notable': return !!(n.flags & 1);
      case 'ascendancy': return !!(n.flags & 4);
      case 'normal': return !(n.flags & (2 | 1 | 4 | 16));
      default: return true;
    }
  }

  // what the chip actually points at: the set's own nodes. The shared trunk is
  // visible but not ringed, or every node on the tree would get a ring
  function filterHighlight(n) {
    switch (filter) {
      case 'set1': return setOf(n) === 1;
      case 'set2': return setOf(n) === 2;
      default: return filterMatch(n);
    }
  }

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
      ctx.globalAlpha = filter && !(filterMatch(a) && filterMatch(c)) ? 0.1 : 1;
      ctx.beginPath();
      ctx.moveTo(a.x * view.s + view.x, a.y * view.s + view.y);
      ctx.lineTo(c.x * view.s + view.x, c.y * view.s + view.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // the route to the node the player picked: drawn over the links, under the dots
    if (path && path.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#7fd3ff';
      ctx.lineWidth = Math.max(2, Math.min(5, view.s * 30));
      ctx.globalAlpha = 0.95;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 1; i < path.length; i++) {
        const a = byId.get(path[i - 1].id); const b = byId.get(path[i].id);
        if (!a || !b) continue;
        ctx.moveTo(a.x * view.s + view.x, a.y * view.s + view.y);
        ctx.lineTo(b.x * view.s + view.x, b.y * view.s + view.y);
      }
      ctx.stroke();
      ctx.restore();
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
      // a legend chip or a search dims everything it did not keep
      const keep = (filter ? filterMatch(n) : true) && (!matches.size || matches.has(n.id));
      ctx.globalAlpha = keep ? 1 : 0.14; // unfocused nodes fade back when a legend chip is picked
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
      if (hover === n || matches.has(n.id) || (filter && filterHighlight(n))) {
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = hover === n ? '#fff4d6' : (filter ? '#ffe14d' : '#ffffff');
        ctx.stroke();
      }
      // draft editing: added nodes ring green, taken-back nodes ring red, and the
      // node you last clicked gets a wide ring so it is obvious which one it is
      if (draftMode) {
        const inBase = draftBase.has(n.id);
        const inSet = draftSet.has(n.id);
        if (inSet && !inBase) {
          ctx.beginPath(); ctx.arc(x, y, r + 4.5, 0, Math.PI * 2);
          ctx.lineWidth = 2; ctx.strokeStyle = '#7ddc7d'; ctx.stroke();
        } else if (!inSet && inBase) {
          ctx.beginPath(); ctx.arc(x, y, r + 4.5, 0, Math.PI * 2);
          ctx.lineWidth = 2; ctx.strokeStyle = '#e26a5c'; ctx.stroke();
        }
      }
      // the node you last picked keeps a wide white ring, so "which one was it" has
      // an answer after the hover moves away (draft or not)
      if (draftSel === n.id) {
        ctx.beginPath(); ctx.arc(x, y, r + 7.5, 0, Math.PI * 2);
        ctx.lineWidth = 1.6; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      }
      ctx.globalAlpha = 1;
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
        ctx.globalAlpha = !filter || filterMatch(n) ? 1 : 0.15;
        ctx.fillStyle = 'rgba(10,9,7,.75)';
        ctx.fillRect(x - width / 2 - 2, y - 1, width + 4, 13);
        ctx.fillStyle = n.flags & 8 ? '#f4e2b8' : COLORS.label;
        ctx.fillText(label, x, y);
        ctx.globalAlpha = 1;
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
    // the legend doubles as a filter: pick a kind to highlight/zoom those nodes, pick it again to clear
    $('#passLegend').innerHTML = items.map(([k, label]) =>
      `<span class="lg${filter === k ? ' on' : ''}" data-filter="${k}" role="button" tabindex="0"><i style="background:${COLORS[k]}"></i>${esc(label)}</span>`).join('');
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

  // zoom to a subset (a picked legend chip) so the matching nodes fill the view
  function fitTo(list) {
    if (!list || !list.length) { draw(); return; }
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const n of list) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
    const pad = 700;
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

  // Typing filters locally first so the tree answers immediately; the engine then
  // replaces the list with its own matches, which carry the points each node costs
  // from what is already allocated ("close to your path" is the question players ask).
  function localMatches(q) {
    const needle = q.toLowerCase();
    const found = new Set();
    for (const n of nodes) {
      const hay = [n.name, gn(n.name), ...n.stats, ...n.stats.map(gt)].join(' ').toLowerCase();
      if (hay.includes(needle)) found.add(n.id);
    }
    return found;
  }

  function renderResults(result) {
    const box = $('#passResults');
    if (!box) return;
    if (!result) { box.innerHTML = ''; return; }
    const KIND_LABEL = {
      maxShield: 'max ES', esPercent: 'ES %', rechargeRate: 'recharge', rechargeDelay: 'delay',
      spirit: 'spirit', life: 'life', resistances: 'res',
    };
    const all = result.nodes || [];
    const total = result.total == null ? all.length : result.total;
    // a list you can read and click, not a row of chips: one node per line, name on
    // the left, what it gives in the middle, what it costs on the right
    const rows = all.slice(0, 40).map((n) => {
      const cost = n.cost == null ? t('not connected') : (n.allocated ? t('already allocated') : t('{0} points away', n.cost));
      const kinds = (n.kinds || []).map((k) => `<small class="kind">${esc(KIND_LABEL[k] || k)}</small>`).join(' ');
      // what the node actually gives, translated the same way the tooltip is: a list
      // of names cannot be told apart without it
      const stats = (n.stats || []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 3)
        .map((x) => `<div class="pr-stat">${esc(gt(x))}</div>`).join('');
      const more = (n.stats || []).length > 3 ? `<div class="pr-stat dim">+${(n.stats || []).length - 3} ${esc(t('more'))}</div>` : '';
      return `<button type="button" class="pass-row${n.allocated ? ' on' : ''}" data-node="${n.id}">`
        + `<span class="pr-main"><span class="pr-name">${esc(gn(n.name) || n.name)}</span>`
        + (stats ? `<span class="pr-stats">${stats}${more}</span>` : '') + `</span>`
        + `<span class="pr-kinds">${kinds}</span>`
        + `<span class="pr-cost">${esc(cost)}</span></button>`;
    }).join('');
    // a Chinese query was translated for the engine: say what was actually searched
    const trans = result.translated && result.translated.english
      ? ` <span class="dim small">→ ${esc(result.translated.english)}${result.translated.dropped ? ` (${esc(t('ignored: {0}', result.translated.dropped))})` : ''}</span>`
      : '';
    const head = `<div class="pass-list-head">${esc(t('{0} matches', total))}${trans}`
      + (result.pending ? ` <span class="dim">${esc(t('still asking Path of Building…'))}</span>` : '')
      + (result.localOnly ? ` <span class="dim">${esc(t('names only: the engine did not answer'))}</span>` : '')
      + (result.error ? ` <span class="neg small">${esc(result.error)}</span>` : '')
      + ` <span class="dim">${esc(t('click a row to centre that node'))}</span></div>`;
    box.innerHTML = rows
      ? `<div class="pass-list">${head}${rows}</div>`
      : `<div class="dim small">${esc(result.pending ? t('still asking Path of Building…') : t('Nothing matches that.'))}</div>`;
  }

  let searchTimer = null;
  let searchSeq = 0;
  async function runSearch() {
    const q = ($('#passSearch').value || '').trim();
    const seq = ++searchSeq;
    matches = new Set();
    searchInfo = new Map();
    path = null; pathCost = null; renderPathNote(); // a new search is a new question
    // clearing the box also clears what the search had picked out: the white ring
    // around a node nobody is looking at any more reads as a stuck selection
    if (!q) { lastResult = null; draftSel = null; renderResults(null); renderPathNote(); draw(); return; }
    matches = localMatches(q);
    const localList = {
      nodes: [...matches].map((id) => {
        const n = byId.get(id) || {};
        return { id, name: n.name || '', stats: Array.isArray(n.stats) ? n.stats : [], kinds: [], cost: null };
      }).slice(0, 40),
      total: matches.size, pending: true, localOnly: true,
    };
    lastResult = localList;
    renderResults(localList);
    draw();
    try {
      const r = await window.api.searchNodes(q, 30);
      if (seq !== searchSeq) return; // a later keystroke wins
      if (r && r.ok) {
        lastResult = r;
        matches = new Set((r.nodes || []).map((n) => n.id));
        searchInfo = new Map((r.nodes || []).map((n) => [n.id, n]));
        renderResults(r);
        draw();
      } else {
        // the engine says no: keep the local names, and say why in the header
        localList.pending = false;
        localList.error = r && r.error ? displayError(r.error) : '';
        renderResults(localList);
      }
    } catch (err) {
      localList.pending = false;
      localList.error = String((err && err.message) || err);
      renderResults(localList);
    }
  }

  let pathMsg = '';

  const draftChange = () => ({
    add: [...draftSet].filter((id) => !draftBase.has(id)),
    remove: [...draftBase].filter((id) => !draftSet.has(id)),
  });
  // how many picked neighbours a node has: a new node needs one, a node can only be
  // taken back while nothing else hangs off it
  function pickedNeighbours(set, id) {
    let count = 0;
    for (const [a, b] of edges) {
      if (a === id && set.has(b)) count += 1;
      else if (b === id && set.has(a)) count += 1;
    }
    return count;
  }
  function draftToggle(n) {
    if (!n) return;
    draftSel = n.id;
    if (draftSet.has(n.id)) {
      if (pickedNeighbours(draftSet, n.id) > 1) {
        draftMsg = t('That node still holds up other picked nodes, so it stays.');
        draw(); renderPathNote(); return;
      }
      draftSet.delete(n.id);
    } else {
      if (!pickedNeighbours(draftSet, n.id)) {
        draftMsg = t('That node has to touch a node you have already picked.');
        draw(); renderPathNote(); return;
      }
      draftSet.add(n.id);
    }
    draftMsg = '';
    draw(); renderPathNote();
  }
  function startDraft() {
    draftMode = true;
    draftBase = new Set(nodes.filter((n) => n.flags & 8).map((n) => n.id));
    draftSet = new Set(draftBase);
    draftSel = null; draftMsg = ''; path = null; pathMsg = '';
    draw(); renderPathNote();
  }
  function exitDraft() {
    draftMode = false; draftSel = null; draftMsg = '';
    draw(); renderPathNote();
  }
  async function commitDraft() {
    const { add, remove } = draftChange();
    if (!add.length && !remove.length) { draftMsg = t('Nothing has changed yet.'); renderPathNote(); return; }
    draftMsg = t('Saving the tree changes into the draft…');
    renderPathNote();
    const r = await window.api.draftTree({ add, remove }).catch((err) => ({ ok: false, error: String((err && err.message) || err) }));
    if (r && r.ok) {
      const changed = add.length + remove.length;
      exitDraft();
      pathMsg = t('Draft tree updated: {0} change(s), revision {1}. Calculate and adopt it on the Builds page.', changed, r.draft.revision);
      renderPathNote();
      await load(true);
      return;
    }
    draftMsg = displayError((r && r.error) || 'could not update the draft');
    renderPathNote();
  }

  function renderPathNote() {
    const el = document.querySelector('#passPath');
    if (!el) return;
    if (draftMode) {
      const { add, remove } = draftChange();
      const nameOf = (id) => { const n = byId.get(id); return gn((n && n.name) || '') || String(id); };
      const chips = [
        ...add.map((id) => `<span class="draft-chip add">+ ${esc(nameOf(id))}<button type="button" class="link" data-drafttoggle="${id}" title="${esc(t('Take it back'))}">×</button></span>`),
        ...remove.map((id) => `<span class="draft-chip remove">− ${esc(nameOf(id))}<button type="button" class="link" data-drafttoggle="${id}" title="${esc(t('Put it back'))}">×</button></span>`),
      ].join('');
      el.innerHTML = `<div class="row draft-bar"><span class="small">${esc(t('Draft tree: {0} added, {1} taken back', add.length, remove.length))}</span>`
        + ` <button type="button" class="link" data-draft="apply">${esc(t('Add these to a draft'))}</button>`
        + ` <button type="button" class="link" data-draft="cancel">${esc(t('Discard the picks'))}</button>`
        + (draftMsg ? ` <span class="small neg">${esc(draftMsg)}</span>` : '') + `</div>`
        + (chips ? `<div class="row draft-chips">${chips}</div>` : '')
        + `<div class="dim small">${esc(t('Click an empty node next to something picked to add it; click a picked node with nothing hanging off it to take it back.'))}</div>`;
      return;
    }
    if (!path || !path.length) { el.innerHTML = pathMsg ? `<span class="small">${esc(pathMsg)}</span>` : ''; return; }
    // just what the route costs: the node names were a wall of text nobody reads
    const last = path[path.length - 1];
    el.innerHTML = `<span class="small">${esc(t('{0} points to reach {1}', pathCost == null ? '?' : pathCost, gn(last.name) || last.name))}</span>`
      + (pathMsg ? ` <span class="small">${esc(pathMsg)}</span>` : '');
  }

  // the route is fetched when a node is picked, not for every search hit: it is a
  // separate walk and only one node at a time is being looked at
  async function tracePath(n) {
    path = null; pathCost = null; pathMsg = '';
    renderPathNote();
    try {
      const r = await window.api.nodePath(n.id).catch(() => null);
      if (r && r.ok && r.path && r.path.length) {
        path = r.path; pathCost = r.cost;
        renderPathNote();
        draw();
      }
    } catch (_) { /* no path is a valid answer */ }
  }

  function focusNode(n) {
    const w = canvas.clientWidth || 800; const h = canvas.clientHeight || 520;
    view.s = Math.max(0.12, view.s);
    view.x = w / 2 - n.x * view.s;
    view.y = h / 2 - n.y * view.s;
    hover = n;
    draw();
    showTip(n, w / 2, h / 2);
    tracePath(n);
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
      currentSet = sheet && sheet.weaponSwap ? 2 : 1;
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
  document.addEventListener('mouseup', (ev) => {
    if (!dragging) return;
    const moved = Math.abs(ev.clientX - dragging.cx) + Math.abs(ev.clientY - dragging.cy);
    dragging = null; canvas.style.cursor = 'grab';
    // a click (not a drag) picks the node under the cursor while the draft is open
    if (!draftMode || moved > 4) return;
    const rect = canvas.getBoundingClientRect();
    const n = nodeAt(ev.clientX - rect.left, ev.clientY - rect.top);
    if (n) draftToggle(n);
  });
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
  const draftStartBtn = $('#passDraftEdit');
  if (draftStartBtn) draftStartBtn.addEventListener('click', () => { if (tree) startDraft(); });
  $('#passCenter').addEventListener('click', () => { if (tree) centerAllocated(); });
  $('#passSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 220);
  });
  $('#passSearch').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    clearTimeout(searchTimer);
    runSearch().then(() => {
      const first = nodes.find((n) => matches.has(n.id));
      if (first) focusNode(first);
    });
  });
  // draft editing controls: apply what was picked, or walk away from it
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest ? ev.target.closest('[data-draft],[data-drafttoggle]') : null;
    if (!el) return;
    ev.stopPropagation();
    if (el.dataset.drafttoggle != null) {
      const n = nodes.find((x) => x.id === Number(el.dataset.drafttoggle));
      if (n) draftToggle(n);
      return;
    }
    if (el.dataset.draft === 'apply') commitDraft().catch(() => {});
    else if (el.dataset.draft === 'cancel') exitDraft();
  });

  // clicking a match centres that node (the nearest ones are listed first)
  $('#passResults').addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-node]');
    if (!el) return;
    const n = nodes.find((x) => x.id === Number(el.dataset.node));
    if (n) { draftSel = n.id; focusNode(n); draw(); }
  });

  // the legend chips filter the tree: pick one to highlight + zoom to those nodes, pick it again to clear
  $('#passLegend').addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-filter]');
    if (!el) return;
    const k = el.dataset.filter;
    filter = filter === k ? null : k;
    drawLegend();
    if (!filter) { fitAll(); return; }
    const list = nodes.filter(filterHighlight);
    if (list.length) fitTo(list); else draw();
  });
  $('#passLegend').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const el = ev.target.closest('[data-filter]');
    if (el) { ev.preventDefault(); el.click(); }
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
