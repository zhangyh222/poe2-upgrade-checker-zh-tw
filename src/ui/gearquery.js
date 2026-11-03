'use strict';
/* global window, document */

// Gear query panel: the item you wear, each affix with its tier (and the whole tier
// ladder behind the slider), and the three layers of "must still be true after the
// swap". The search itself is the next step; this page is where its conditions are
// decided, and the tier a line has to keep is the same number the trade search will
// have to ask for.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const t = (s, ...a) => (window.i18n ? window.i18n.t(s, ...a) : (a.length ? s.replace(/\{(\d+)\}/g, (_, i) => (a[Number(i)] != null ? a[Number(i)] : '')) : s));
  const gn = (s) => (window.gdName ? window.gdName(s) : s);
  const displayError = (v) => (v && typeof v === 'object' ? t(v.key || '', ...(Array.isArray(v.args) ? v.args : [])) : t(String(v == null ? '' : v)));

  let state = null;
  let slot = 'Helmet';
  let slotInfo = null; // { item, lines }
  let guards = null; // { global, slot, merged }
  let choices = new Map(); // line text -> { action: 'keep'|'min'|'ignore', tier }
  let savedChoices = {}; // `${slot}|${line}` -> { action, tier }, kept in the settings file
  let saveTimer = null;
  let temp = []; // temporary conditions for this panel session
  let busy = false;
  let message = '';
  let candidates = []; // listings from the trade search
  let verified = []; // the listings that went through Path of Building + the condition layers
  let searchCtx = null; // { league, searchId, ids, from } for "load more"
  let workMsg = '';
  let working = false;
  let budget = ''; // max price, in the chosen currency
  let currency = 'chaos';

  const firstNumber = (text) => {
    const m = String(text || '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  };
  const bandOf = (line, tier) => {
    const hit = (line.tiers || []).find((x) => x.tier === tier);
    return hit && hit.band ? hit.band.min : firstNumber(line.text);
  };
  const requiredPicks = () => {
    const out = [];
    for (const line of (slotInfo && slotInfo.lines) || []) {
      const c = choices.get(line.text);
      // "take it off" means the line is not searched for: what replaces it is a
      // condition (e.g. cold resistance), not another copy of the same affix
      if (!c || c.action === 'ignore' || c.action === 'replace' || !line.match) continue;
      out.push({ text: line.text, min: c.action === 'keep' ? firstNumber(line.text) : bandOf(line, c.tier) });
    }
    return out;
  };
  const statusTag = (status) => {
    const cls = status === 'pass' ? 'good' : status === 'fail' ? 'neg' : 'dim';
    const label = status === 'pass' ? t('Calculated: passed') : status === 'fail' ? t('Calculated: failed') : t('Not verified');
    return `<span class="char-tag ${cls}">${esc(label)}</span>`;
  };
  const RESULT = { pass: 'pass', fail: 'fail', unverified: 'unverified' };

  const METRIC_LABELS = {
    life: 'Life', energyShield: 'Energy Shield', ehp: 'Effective HP', dps: 'DPS',
    fireRes: 'Fire resistance', coldRes: 'Cold resistance', lightningRes: 'Lightning resistance',
    chaosRes: 'Chaos resistance', armour: 'Armour', evasion: 'Evasion', spirit: 'Spirit',
    str: 'Strength', dex: 'Dexterity', int: 'Intelligence', movementSpeed: 'Movement speed',
  };

  function initialSlot(st) {
    const slots = st.slots || [];
    const equipped = st.equipped || {};
    return slots.find((s) => equipped[s]) || slots[0] || 'Helmet';
  }

  function condRow(c, layer, index) {
    const label = t(METRIC_LABELS[c.metric] || c.metric);
    const opText = c.op === 'keep' ? t('does not drop') : c.op === 'min' ? '≥' : '≤';
    const value = c.op === 'keep' ? '' : ` ${c.value}${c.unit === 'percent' ? '%' : ''}`;
    return `<div class="row gq-cond"><span class="grow">${esc(label)} ${esc(opText)}${esc(value)}</span>`
      + `<button type="button" class="link" data-guard="remove" data-layer="${layer}" data-index="${index}">${t('Remove')}</button></div>`;
  }

  function addRow(layer) {
    const options = Object.keys(METRIC_LABELS).map((k) => `<option value="${k}">${esc(t(METRIC_LABELS[k]))}</option>`).join('');
    return `<div class="row gq-add"><select data-gq-metric="${layer}">${options}</select>`
      + `<select data-gq-op="${layer}"><option value="keep">${t('does not drop')}</option><option value="min">≥</option><option value="max">≤</option></select>`
      + `<input data-gq-value="${layer}" type="number" step="any" placeholder="${t('value')}"/>`
      + `<button type="button" class="link" data-guard="add" data-layer="${layer}">${t('Add')}</button></div>`;
  }

  function lineHtml(line) {
    const m = line.match;
    if (!m) return `<div class="gq-line unknown"><span class="grow">${esc(line.text)}</span><small class="dim">${t('no tier')}</small></div>`;
    const choice = choices.get(line.text) || { action: 'keep', tier: m.tier };
    const maxTier = line.tiers ? line.tiers.length : m.tier;
    return `<div class="gq-line">
      <div class="row"><span class="grow">${esc(line.text)}</span>
        <span class="tier${m.confidence === 'range-only' ? ' dim' : ''}">T${m.tier}</span>
        <small class="dim">${esc(m.group)}</small></div>
      <div class="row gq-slider">
        <label class="dim small">${t('keep at least')} <b data-gq-tier>${t('T{0}', choice.tier)}</b></label>
        <input type="range" min="1" max="${Math.max(1, maxTier)}" value="${choice.tier}" data-gq-slider="${esc(line.text)}"/>
        <label class="dim small">${t('best T1 · worst T{0}', Math.max(1, maxTier))}</label>
        <select data-gq-action="${esc(line.text)}">
          <option value="keep"${choice.action === 'keep' ? ' selected' : ''}>${t('same roll or better')}</option>
          <option value="min"${choice.action === 'min' ? ' selected' : ''}>${t('tier only')}</option>
          <option value="ignore"${choice.action === 'ignore' ? ' selected' : ''}>${t('not required')}</option>
          <option value="replace"${choice.action === 'replace' ? ' selected' : ''}>${t('take it off (use the conditions below)')}</option>
        </select>
      </div></div>`;
  }

  function render() {
    const body = $('#gqBody');
    if (!body) return;
    const slots = (state && state.slots) || [];
    const slotOpts = slots.map((s) => `<option value="${esc(s)}"${s === slot ? ' selected' : ''}>${esc(t(s))}</option>`).join('');
    const item = slotInfo && slotInfo.item;
    // property lines (Item Level, Energy Shield, …) are not affixes: they would only
    // add "no tier" rows to a list that is about tiers
    const PROPERTY = /^(Item Class|Rarity|Item Level|Quality|Sockets|LevelReq|Requires|Corrupted|Mirrored|Radius|Limited to|Armour|Evasion Rating|Energy Shield|Ward|Spirit|Physical Damage|Attacks per Second|Critical Hit Chance|Block Chance|Stack Size|Charges|Level|Map Tier|Talisman Tier|Cluster Jewel|Influence|Grants Skill)\b/i;
    const lines = ((slotInfo && slotInfo.lines) || []).filter((l) => !PROPERTY.test(l.text));
    const itemCard = `<div class="card-p"><h3>${t('Equipped {0}', t(slot))}</h3>`
      + `<div class="row"><select id="gqSlot">${slotOpts}</select></div>`
      + (item ? `<div class="gq-name">${esc(gn(item.name))}${item.baseType && item.baseType !== item.name ? ` <small class="dim">${esc(gn(item.baseType))}</small>` : ''}</div>` : `<div class="dim">${t('Nothing equipped in this slot.')}</div>`)
      + (lines.length ? lines.map(lineHtml).join('') : '')
      + `</div>`;
    const g = guards || { global: [], slot: [] };
    const guardsCard = `<div class="card-p"><h3>${t('Must still be true after the swap')}</h3>`
      + `<div class="gq-layer"><h4 class="small">${t('Character')}</h4>${(g.global || []).map((c, i) => condRow(c, 'global', i)).join('')}${addRow('global')}</div>`
      + `<div class="gq-layer"><h4 class="small">${t('This slot ({0})', t(slot))}</h4>${(g.slot || []).map((c, i) => condRow(c, 'slot', i)).join('')}${addRow('slot')}</div>`
      + `<div class="gq-layer"><h4 class="small">${t('This search only')}</h4>${temp.map((c, i) => condRow(c, 'temp', i)).join('')}${addRow('temp')}</div>`
      + `<div class="row"><button type="button" class="link" data-guard="save">${t('Save this slot’s conditions')}</button>`
      + `<button type="button" class="link" data-guard="cleartemp">${t('Clear the temporary layer')}</button></div>`
      + `<div class="dim small">${t('A temporary condition can tighten an inherited one, never loosen it.')}</div>`
      + (message ? `<div class="small ${message.ok ? 'pos' : 'neg'}">${esc(message.text)}</div>` : '')
      + `</div>`;
    const rows = candidates.slice(0, 20).map((c) => {
      const v = verified.find((x) => x.id === c.id) || null;
      const fails = v && v.guards ? v.guards.filter((g) => g.status === 'fail') : [];
      const fmtDelta = (d) => {
        const sign = d > 0 ? '+' : '';
        if (Math.abs(d) >= 10000) return `${sign}${(d / 1000).toFixed(1)}k`;
        if (Math.abs(d) >= 100) return `${sign}${Math.round(d)}`;
        return `${sign}${Math.round(d * 10) / 10}`;
      };
      const deltas = v && v.guards ? v.guards.filter((g) => g.delta != null).slice(0, 3)
        .map((g) => `${esc(t(METRIC_LABELS[g.metric] || g.metric))} ${fmtDelta(g.delta)}`).join(' · ') : '';
      return `<div class="row gq-candidate"><span class="grow">${esc(gn(c.name))}</span>`
        + `<small class="dim">${esc(c.priceText || '')}</small>`
        + (v ? statusTag(v.status) : '')
        + (fails.length ? `<small class="neg">${esc(fails.map((f) => t(METRIC_LABELS[f.metric] || f.metric)).join(', '))}</small>` : '')
        + (deltas ? `<small class="dim">${esc(deltas)}</small>` : '')
        // only a candidate that actually passed can be worn: a failed or unchecked
        // one must not look like a result the player can take
        + (v && v.status === 'pass' ? `<button type="button" class="link" data-adopt="${esc(c.id)}">${t('Equip it')}</button>` : '')
        + `</div>`;
    }).join('');
    const moreLeft = searchCtx && searchCtx.from < searchCtx.ids.length;
    const unverifiedLeft = candidates.filter((c) => !verified.some((v) => v.id === c.id)).length;
    const resultsCard = `<div class="card-p gq-wide"><h3>${t('Candidates')}</h3>`
      + `<div class="row"><input id="gqBudget" type="number" min="0" step="any" value="${esc(budget)}" placeholder="${t('max price')}"/>`
      + `<select id="gqCurrency">`
      + `<option value="chaos"${currency === 'chaos' ? ' selected' : ''}>chaos</option>`
      + `<option value="divine"${currency === 'divine' ? ' selected' : ''}>divine</option>`
      + `<option value="exalted"${currency === 'exalted' ? ' selected' : ''}>exalted</option>`
      + `</select>`
      + `<button type="button" class="link" data-gq="search">${t('Search candidates')}</button>`
      + `<button type="button" class="link" data-gq="verify"${unverifiedLeft ? '' : ' disabled'}>${t('Check each with Path of Building')}</button>`
      + (moreLeft ? `<button type="button" class="link" data-gq="more">${t('Load more')}</button>` : '')
      + `<span class="dim small">${esc(workMsg)}</span></div>`
      + (rows || `<div class="dim small">${t('Nothing searched yet.')}</div>`)
      + `</div>`;
    body.innerHTML = itemCard + guardsCard + resultsCard;
  }

  async function loadSlot() {
    const r = await window.api.tiersSlot(slot).catch(() => null);
    slotInfo = r && r.ok ? r : { item: null, lines: [] };
    choices = new Map();
    for (const line of slotInfo.lines || []) {
      if (!line.match) continue;
      const saved = savedChoices[`${slot}|${line.text}`];
      choices.set(line.text, saved ? { action: saved.action, tier: saved.tier } : { action: 'keep', tier: line.match.tier });
    }
  }

  function remember() {
    for (const [text, c] of choices) savedChoices[`${slot}|${text}`] = { action: c.action, tier: c.tier };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      window.api.setSetting('gearQuery', savedChoices).catch(() => {});
    }, 400);
  }

  async function loadGuards() {
    const r = await window.api.guardsGet(slot).catch(() => null);
    guards = r && r.ok ? { global: r.global || [], slot: r.slot || [], merged: r.merged } : { global: [], slot: [] };
  }

  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      state = state || await window.api.getState();
      await Promise.all([loadSlot(), loadGuards()]);
      render();
    } finally { busy = false; }
  }

  async function open() {
    state = await window.api.getState();
    savedChoices = (state.settings && state.settings.gearQuery) || {};
    slot = initialSlot(state);
    temp = []; message = '';
    await refresh();
  }

  // one handler for the whole page: slot change, sliders, tier actions, conditions
  document.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (!el || !el.dataset) return;
    if (el.id === 'gqSlot') { slot = el.value; temp = []; message = ''; await refresh(); return; }
    if (el.dataset.gqSlider) {
      const text = el.dataset.gqSlider;
      const c = choices.get(text) || { action: 'keep', tier: 1 };
      c.tier = Number(el.value);
      if (c.action === 'ignore') c.action = 'keep';
      choices.set(text, c);
      remember();
      const label = el.closest('.gq-slider') && el.closest('.gq-slider').querySelector('[data-gq-tier]');
      if (label) label.textContent = t('T{0}', c.tier);
      return;
    }
    if (el.dataset.gqAction) {
      const text = el.dataset.gqAction;
      const c = choices.get(text) || { action: 'keep', tier: 1 };
      c.action = el.value;
      choices.set(text, c);
      remember();
      return;
    }
  });

  document.addEventListener('click', async (ev) => {
    const adoptBtn = ev.target.closest ? ev.target.closest('[data-adopt]') : null;
    if (adoptBtn) {
      ev.stopPropagation();
      const c = candidates.find((x) => x.id === adoptBtn.dataset.adopt);
      if (!c) return;
      // wearing it changes the build, so the next search starts from the new item
      const ok = await window.api.equip(slot, c.text).catch(() => false);
      workMsg = ok ? t('Equipped. The next search starts from it.') : t('That item could not be equipped.');
      if (ok) { verified = null; candidates = []; }
      await refresh();
      return;
    }
    const gq = ev.target.closest ? ev.target.closest('[data-gq]') : null;
    if (gq) {
      ev.stopPropagation();
      if (working) return;
      if (gq.dataset.gq === 'search') {
        const picks = requiredPicks();
        if (!picks.length) { workMsg = t('Pick at least one affix to require.'); render(); return; }
        const maxPrice = Number(document.querySelector('#gqBudget').value);
        budget = document.querySelector('#gqBudget').value;
        currency = document.querySelector('#gqCurrency').value;
        const cap = Number.isFinite(maxPrice) && maxPrice > 0 ? { max: maxPrice, currency } : undefined;
        working = true; workMsg = t('Searching the trade site…'); render();
        const r = await window.api.gearQuerySearch({ slot, picks, budget: cap }).catch((err) => ({ ok: false, error: err.message }));
        working = false;
        if (!r || !r.ok) { candidates = []; verified = []; searchCtx = null; workMsg = displayError((r && r.error) || 'search failed'); }
        else {
          candidates = r.candidates || []; verified = [];
          searchCtx = r.ids && r.ids.length ? { league: r.league, searchId: r.searchId, ids: r.ids, from: candidates.length } : null;
          workMsg = t('{0} candidates', r.total == null ? candidates.length : r.total);
        }
        render();
      } else if (gq.dataset.gq === 'more') {
        if (!searchCtx) return;
        working = true; workMsg = t('Loading more…'); render();
        const r = await window.api.gearQueryMore({ slot, league: searchCtx.league, searchId: searchCtx.searchId, ids: searchCtx.ids, from: searchCtx.from, count: 10 }).catch((err) => ({ ok: false, error: err.message }));
        working = false;
        if (!r || !r.ok) workMsg = displayError((r && r.error) || 'load failed');
        else {
          candidates = candidates.concat(r.candidates || []);
          searchCtx.from += 10;
          workMsg = t('{0} candidates', candidates.length);
        }
        render();
      } else if (gq.dataset.gq === 'verify') {
        // in small batches: each batch is one engine run, and the table fills in as
        // it goes instead of after a long silence
        const todo = candidates.filter((c) => !verified.some((v) => v.id === c.id)).slice(0, 10);
        working = true; workMsg = t('Checking with Path of Building…'); render();
        for (let i = 0; i < todo.length; i += 5) {
          const chunk = todo.slice(i, i + 5);
          const r = await window.api.gearQueryVerify({ slot, candidates: chunk }).catch((err) => ({ ok: false, error: err.message }));
          if (!r || !r.ok) { workMsg = displayError((r && r.error) || 'check failed'); break; }
          for (const v of r.candidates || []) {
            const at = verified.findIndex((x) => x.id === v.id);
            if (at >= 0) verified[at] = v; else verified.push(v);
          }
          workMsg = t('Checked {0} items', verified.length);
          render();
        }
        working = false;
        render();
      }
      return;
    }
    const el = ev.target.closest ? ev.target.closest('[data-guard]') : null;
    if (!el) return;
    ev.stopPropagation();
    const action = el.dataset.guard;
    const layer = el.dataset.layer;
    message = '';
    try {
      if (action === 'add') {
        const metric = document.querySelector(`[data-gq-metric="${layer}"]`).value;
        const op = document.querySelector(`[data-gq-op="${layer}"]`).value;
        const raw = document.querySelector(`[data-gq-value="${layer}"]`).value;
        const value = raw === '' ? null : Number(raw);
        const cond = { metric, op, value: op === 'keep' ? null : value, unit: /Res|movementSpeed/.test(metric) ? 'percent' : 'number' };
        if (layer === 'temp') temp.push(cond);
        else {
          const list = layer === 'global' ? [...(guards.global || [])] : [...(guards.slot || [])];
          list.push(cond);
          const r = await window.api.guardsSet(layer, slot, list);
          if (!r.ok) message = { ok: false, text: displayError(r.error) };
        }
      } else if (action === 'remove') {
        const index = Number(el.dataset.index);
        if (layer === 'temp') temp.splice(index, 1);
        else {
          const list = layer === 'global' ? [...(guards.global || [])] : [...(guards.slot || [])];
          list.splice(index, 1);
          const r = await window.api.guardsSet(layer, slot, list);
          if (!r.ok) message = { ok: false, text: displayError(r.error) };
        }
      } else if (action === 'save') {
        const r = await window.api.guardsSet('slot', slot, guards.slot || []);
        message = r.ok ? { ok: true, text: t('Saved.') } : { ok: false, text: displayError(r.error) };
      } else if (action === 'cleartemp') {
        temp = [];
      }
      await refresh();
    } catch (err) {
      message = { ok: false, text: displayError(err && (err.message || err)) };
      render();
    }
  });

  // the page is lazy: load when its tab is opened (and after a character switch)
  const tab = document.querySelector('.tabs button[data-tab="gearquery"]');
  if (tab) tab.addEventListener('click', () => { setTimeout(() => { open().catch(() => {}); }, 0); });
  if (window.api.onChanged) window.api.onChanged(() => { if (document.querySelector('#tab-gearquery.active')) refresh(); });
  if (document.querySelector('#tab-gearquery.active')) setTimeout(() => { open().catch(() => {}); }, 0);
  window.renderGearQuery = refresh;
})();
