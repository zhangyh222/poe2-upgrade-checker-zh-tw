'use strict';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => { const r = Math.round(n * 10 ** d) / 10 ** d; return (r > 0 ? '+' : '') + r; };
// i18n: English string is the key; returns the active Chinese translation when set.
const t = (s, ...a) => (window.i18n ? window.i18n.t(s, ...a) : (a.length ? s.replace(/\{(\d+)\}/g, (_, i) => (a[Number(i)] != null ? a[Number(i)] : '')) : s));
const displayError = (value) => value && typeof value === 'object'
  ? t(value.key || '', ...(Array.isArray(value.args) ? value.args : []))
  : t(String(value == null ? '' : value));
let data = null;

function label(key, diff) {
  const gt = window.gdText ? window.gdText(key) : key; // stat line in Chinese, numbers still as "#"
  key = gt;
  let first = true;
  const tx = key.includes('#') ? key.replace(/#/g, () => { if (first) { first = false; return fmt(diff); } return '…'; }) : `${fmt(diff)} ${key}`;
  return tx.replace(/^\+\+/, '+').replace(/^\+-/, '-');
}

const VERDICT = {
  upgrade: ['UPGRADE', 'up'], small: ['SMALL UPGRADE', 'up'], risky: ['UPGRADE, BUT…', 'risky'], resloss: ['LOSES RESISTANCE', 'down'], dmgloss: ['LOSES DAMAGE', 'down'], downgrade: ['DOWNGRADE', 'down'], same: ['SIDEGRADE', 'same'],
  new: ['EMPTY SLOT', 'new'], equipped: ['EQUIPPED', 'same'],
};

function dual(p) {
  const a = Number(p.amount); const d = data.divineRate;
  if (p.currency === 'divine') return `≈ ${Math.round(a * d).toLocaleString('en')} ex`;
  if (p.currency === 'exalted') return `≈ ${Math.round((a / d) * 100) / 100} div`;
  return '';
}

const num = (v) => (v == null || Number.isNaN(Number(v)) ? -1e9 : Number(v)); // 0 is a real value

function sorted(list) {
  const mode = $('#sort').value;
  const rank = (x) => (x.compare && x.compare.resRank) || 0;
  // items that lose resistance or damage go below everything else when sorting by upgrade or value
  const lost = (x) => (x.compare && (x.compare.verdict === 'resloss' || x.compare.verdict === 'dmgloss') ? 1 : 0);
  const by = {
    // caps a resistance you're short of → adds toward the cap → no change → loses resistance; then best upgrade
    res: (a, b) => (rank(b) - rank(a)) || (num(b.compare && b.compare.delta) - num(a.compare && a.compare.delta)),
    upgrade: (a, b) => (lost(a) - lost(b)) || (num(b.compare && b.compare.delta) - num(a.compare && a.compare.delta)),
    value: (a, b) => (lost(a) - lost(b)) || ((b.valuePerDiv != null ? b.valuePerDiv : -1e9) - (a.valuePerDiv != null ? a.valuePerDiv : -1e9)),
    price: (a, b) => ((a.priceEx != null ? a.priceEx : 1e15) - (b.priceEx != null ? b.priceEx : 1e15)),
    gear: (a, b) => ((b.gear && b.gear.score != null ? b.gear.score : -1) - (a.gear && a.gear.score != null ? a.gear.score : -1)),
    site: () => 0,
  }[mode];
  let out = (list || []).map((x, i) => ({ ...x, _i: i }));
  if ($('#onlyUp').checked) out = out.filter((x) => x.compare && (['upgrade', 'small', 'risky', 'new'].includes(x.compare.verdict)));
  return out.sort((a, b) => by(a, b) || a._i - b._i);
}

function card(x) {
  const it = x.item;
  const c = x.compare;
  const [vkey, vc] = c ? (VERDICT[c.verdict] || VERDICT.same) : ['?', 'same'];
  const vt = t(vkey);
  const mods = window.itemTooltipHtml ? window.itemTooltipHtml(it, { showHead: false }) : '';
  const gearMode = c && (c.scoreMode === 'gear' || c.scoreMode === 'pob');
  const n = modCount();
  const changed = c ? c.rows.filter((r) => r.diff) : [];
  const rows = c ? changed.slice(0, n).map((r) => {
    const useful = gearMode ? r.useful > 0 : !!r.weight;
    const cls = !useful ? 'unweighted' : (gearMode ? r.diff > 0 : r.impact > 0) ? 'pos' : 'neg';
    return `<span class="chg ${cls}">${esc(label(r.key, r.diff))}</span>`;
  }).join('') : '';
  const loss = c && (c.verdict === 'dmgloss' || c.verdict === 'resloss');
  const value = x.valuePerDiv != null && Math.abs(x.valuePerDiv) >= 0.05 && c && c.delta > 0 && !loss ? `<span class="value" title="${c && c.scoreMode === 'pob' ? t('% better for your build') : gearMode ? t('Gear score points gained') : t('Upgrade score')} per divine spent">${fmt(x.valuePerDiv, 1)} / div</span>` : '';
  const rr = c ? c.resRank || 0 : 0;
  return `<article class="listing ${rr < 0 ? 'res-loss' : rr === 2 ? 'res-cap-item' : ''}">
    <div class="l-top">
      <div>
        <div class="name ${esc(((it && it.rarity) || '').toLowerCase())}">${esc(window.gdName && it ? window.gdName(it.name) : it ? it.name : t('Unreadable listing'))}</div>
        <div class="dim">${esc(it && it.baseType !== it.name && window.gdName ? window.gdName(it.baseType) : it && it.baseType !== it.name ? it.baseType : '')}${it && it.itemLevel ? ` · ilvl ${it.itemLevel}` : ''}</div>
      </div>
      <div class="l-price">
        <div class="price">${esc(x.priceText)}</div>
        ${x.price && data.divineRate ? `<div class="dim">${esc(dual(x.price))}</div>` : ''}
        <div class="dim">${x.instant ? t('Instant buyout') : `${x.online ? '<span class="dot on"></span>' + t('online') : '<span class="dot"></span>' + t('offline')} · ${esc(x.seller)}`}</div>
      </div>
    </div>
    ${c ? `<div class="verdict ${vc}"><span class="badge">${vt}</span><span class="score">${c.verdict === 'new' || c.delta == null || (loss && c.delta > 0) ? '' : c.scoreMode === 'pob' ? `${esc(fmt(c.delta, 1))}% <small>${t('for your build')}</small>` : gearMode ? `${esc(fmt(c.delta, 0))} <small>${t('gear score')}</small>` : esc(fmt(c.delta))}${!gearMode && c.pct != null && c.verdict !== 'equipped' ? ` <small>(${esc(fmt(c.pct))}%)</small>` : ''}</span>${value}<span class="dim">${t('vs')} ${esc((c.replacing || []).join(' + ') || c.targetSlot)}</span></div>` : ''}
    ${x.gear && x.gear.score != null && !(c && c.pob) ? `<div class="gear"><span class="gs g-${esc(x.gear.grade)}" title="${t('Gear score for {0}', esc(x.gear.buildName || t('your build')))}">${x.gear.score} ${esc(x.gear.grade)}</span> <span>${t('Gear score')}${x.gearEquipped != null ? ` · ${t('yours {0}', x.gearEquipped)}` : ''}</span>${x.gear.missing && x.gear.missing.length ? ` <span class="dim">${t('Missing: {0}', esc(x.gear.missing.join(', ')))}</span>` : ''} <button class="link gear-why" data-why="${esc(x.id)}">${t('why?')}</button></div>
      <div class="gear-detail hidden" data-whybox="${esc(x.id)}">${window.gearCompareHtml ? window.gearCompareHtml(x.gear, x.gearEquippedDetail) : ''}</div>` : ''}
    ${rows ? `<div class="chgs">${rows}${changed.length > n ? `<span class="dim">+${changed.length - n} ${t('more')}</span>` : ''}</div>` : ''}
    ${c && c.pob && window.pobBlock ? window.pobBlock(c.pob) : c && window.characterBlock ? window.characterBlock(c.character, { risks: c.risks }) : ''}
    <details><summary>${t('Item mods')}</summary>${mods}</details>
    <div class="actions">
      ${x.instant && x.hideoutToken ? `<button class="primary gilded" data-hideout="${esc(x.id)}" title="${data.signedIn ? t('Asks the trade site to take you to the seller\'s hideout, straight from here') : t('Takes you to the seller\'s hideout from here – you sign in to pathofexile.com once the first time')}">${t('Travel to hideout')}</button>` : ''}
      ${x.whisper ? `<button class="primary gilded" data-whisper="${esc(x.id)}" title="${t('Copies the seller\'s whisper – paste it in game chat with Enter, Ctrl+V')}">${t('Copy whisper')}</button>` : ''}
      <button class="link" data-listing="${esc(x.id)}" title="${t('Opens the trade site in your browser on just this seller\'s listing')}">${t('on trade site ↗')}</button>
    </div>
  </article>`;
}

function render() {
  if (!data) return;
  $('#title').textContent = data.title ? displayError(data.title) : t('Trade results');
  $('#gsHelpBtn').textContent = data.pobOn ? t('How are items judged?') : t('What\'s the gear score?');
  $('#hideHint').textContent = t('Esc hides{0}', data.resultsHotkey ? ` · ${data.resultsHotkey} reopens` : '');
  const ups = (data.listings || []).filter((x) => x.compare && ['upgrade', 'small', 'risky', 'new'].includes(x.compare.verdict)).length;
  const losing = (data.listings || []).filter((x) => x.compare && x.compare.verdict === 'resloss').length;
  const dmgLosing = (data.listings || []).filter((x) => x.compare && x.compare.pob && x.compare.pob.dmgLoss).length;
  const capping = (data.listings || []).filter((x) => x.compare && x.compare.resRank === 2).length;
  $('#sub').textContent = data.total == null ? (data.league || '') : `${data.league} · ${t('{0} listing{1}', data.total, data.total === 1 ? '' : 's')}${data.shown != null ? ` · ${t('showing {0}', data.shown)}` : ''}${data.listings && data.listings.length ? ` · ${t('{0} upgrade{1} for you', ups, ups === 1 ? '' : 's')}${capping ? t(' · {0} cap a resistance', capping) : ''}${losing ? t(' · {0} lose resistance', losing) : ''}${dmgLosing ? t(' · {0} lose damage', dmgLosing) : ''}` : ''}${data.divineRate ? ` · ${t('1 div ≈ {0} ex', data.divineRate)}` : ''}`;
  $('#note').textContent = data.note ? displayError(data.note) : '';
  if (data.priceSummary) {
    $('#priceBanner').classList.remove('hidden');
    const ps = data.priceSummary;
    $('#priceBanner').innerHTML = (ps.typical
      ? t('Typical {0} · most {1} · cheapest {0}', esc(ps.typical), esc(ps.range), esc(ps.cheapest))
      : `<b>${esc(displayError(ps.verdict || { key: 'No price' }))}</b>`)
      + ` <span class="dim">${t("(each seller's cheapest: {0} seller{1} in {2} listings loaded)", ps.sellers, ps.sellers === 1 ? '' : 's', ps.total)}</span>`
      + (ps.notes && ps.notes.length ? `<div class="dim small">${esc(ps.notes.map(displayError).join(' · '))}</div>` : '');
  } else $('#priceBanner').classList.add('hidden');
  $('#save').textContent = data.saved ? t('★ Saved') : t('☆ Save search');
  $('#save').disabled = !!data.saved;
  const all = data.listings || [];
  const list = sorted(all);
  // a failed search or fetch must not leave the previous search's listings on screen
  $('#list').innerHTML = data.error ? `<div class="note">${esc(displayError(data.error))}</div>`
    : list.map(card).join('') || `<div class="note">${!all.length && data.total ? t('The listings couldn\'t be loaded. Use Open on trade site to see them in your browser.') : !all.length ? t('Nothing listed.') : t('No listings match these filters.')}</div>`;
  $('#more').classList.toggle('hidden', !data.more || !!data.error);
  $('#site').disabled = !data.url;
  $('#save').classList.toggle('hidden', !!data.error);
  if (window.bindGearWhy) window.bindGearWhy(document);
  document.querySelectorAll('[data-whisper]').forEach((b) => b.addEventListener('click', () => {
    const x = data.listings.find((l) => l.id === b.dataset.whisper);
    window.api.copyText(x.whisper);
    b.textContent = t('Copied – paste in game chat');
  }));
  document.querySelectorAll('[data-listing]').forEach((b) => b.addEventListener('click', async () => {
    const r = await window.api.openListing(b.dataset.listing);
    if (r && r.ok) b.textContent = t('Opened in your browser');
  }));
  document.querySelectorAll('[data-hideout]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = t('Asking the trade site…');
    let r = await window.api.hideout(b.dataset.hideout);
    if (r && r.needSignIn) {
      b.textContent = t('Sign in to pathofexile.com…');
      const s = await window.api.signIn();
      if (s && s.signedIn) { data.signedIn = true; b.textContent = t('Asking the trade site…'); r = await window.api.hideout(b.dataset.hideout); }
      else r = { ok: false, error: t('Not signed in – use Open this item on trade site instead.') };
    }
    b.disabled = false;
    const old = b.parentNode.querySelector('.note'); if (old) old.remove();
    b.textContent = r.ok ? t('Sent – check the game') : t('Travel to hideout');
    if (!r.ok) { const n = document.createElement('span'); n.className = 'note'; n.textContent = ' ' + displayError(r.error); b.after(n); }
  }));
}

// colour-blind palette, same setting as the popup and the app pages
function applyColorblind() {
  window.api.getState().then((st) => { document.body.classList.toggle('cb', !!(st && st.settings && st.settings.colorblind)); }).catch(() => {});
}
applyColorblind();

window.api.onResults((d) => {
  data = d || { error: t('No results.') };
  applyColorblind();
  $('#moreMsg').textContent = '';
  // price checks read best cheapest-first; upgrade searches best-upgrade-first
  $('#sort').value = data.mode === 'price' ? 'price' : data.resFirst ? 'res' : 'upgrade';
  render();
  window.scrollTo(0, 0);
});
$('#sort').addEventListener('change', render);
$('#onlyUp').addEventListener('change', render);
function modCount() { const v = $('#modCount').value; return v === 'all' ? 1e9 : Number(v) || 4; }
try { const v = localStorage.getItem('modCount'); if (v && [...$('#modCount').options].some((o) => o.value === v)) $('#modCount').value = v; else $('#modCount').value = '4'; } catch (_) { $('#modCount').value = '4'; }
$('#modCount').addEventListener('change', () => { try { localStorage.setItem('modCount', $('#modCount').value); } catch (_) {} render(); });
$('#site').addEventListener('click', () => data && window.api.openUrl(data.url));
$('#save').addEventListener('click', async () => {
  const r = await window.api.saveSearch(data.title);
  if (r && r.ok) { data.saved = true; render(); }
});
$('#more').addEventListener('click', async () => {
  $('#more').disabled = true; $('#moreMsg').textContent = t('Loading…');
  const d = await window.api.resultsMore();
  $('#more').disabled = false;
  if (d && d.error) { $('#moreMsg').textContent = displayError(d.error); return; }
  $('#moreMsg').textContent = '';
  if (d) { data = d; render(); }
});
window.api.onChanged(async () => { applyColorblind(); const d = await window.api.resultsRescore(); if (d) { data = d; render(); } });

// Esc hides the results window; bring it back with the results hotkey (Ctrl+Shift+D) or a new search.
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.api.hideResults(); });

// "What's the gear score?" panel
window.showGearHelp = () => {
  const p = $('#gsHelp');
  p.innerHTML = window.gearExplainHtml({ where: t('Build & stats page of the main window'), pobOn: data && data.pobOn });
  p.classList.remove('hidden');
  p.scrollIntoView({ block: 'nearest' });
};
$('#gsHelpBtn').addEventListener('click', () => {
  const p = $('#gsHelp');
  if (p.classList.contains('hidden')) window.showGearHelp(); else p.classList.add('hidden');
});

// i18n: translate the static markup, and re-apply + re-render when the language changes.
if (window.applyI18n) window.applyI18n(document);
if (window.i18n && window.i18n.onChange) window.i18n.onChange(() => { if (window.applyI18n) window.applyI18n(document); if (data) render(); });
if (window.api && window.api.onLang) window.api.onLang((lang) => { if (window.i18n && window.i18n.setLangLocal) window.i18n.setLangLocal(lang); });
