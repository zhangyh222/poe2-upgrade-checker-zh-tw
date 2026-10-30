'use strict';

// Shared renderer for a comparison result (used by the popup and the
// settings "Test an item" tab). Exposes window.renderComparison.

(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => {
    const r = Math.round(n * 100) / 100;
    return (r > 0 ? '+' : '') + (Number.isInteger(r) ? r : r.toFixed(1));
  };
  // i18n: English string is the key; returns the active Chinese translation when set.
  const t = (s, ...a) => (window.i18n ? window.i18n.t(s, ...a) : (a.length ? s.replace(/\{(\d+)\}/g, (_, i) => (a[Number(i)] != null ? a[Number(i)] : '')) : s));
  const sourceText = (value) => {
    if (!value || typeof value !== 'object') return String(value == null ? '' : value);
    const args = Array.isArray(value.args) ? value.args : [];
    return String(value.key || '').replace(/\{(\d+)\}/g, (_, i) => (args[Number(i)] != null ? args[Number(i)] : ''));
  };
  const displayText = (value) => {
    if (value && typeof value === 'object') return t(value.key || '', ...(Array.isArray(value.args) ? value.args : []));
    return t(String(value == null ? '' : value));
  };
  const displayList = (values) => (values || []).map(displayText);

  function label(key, diff) {
    key = String(key).replace(/^\[Base\]\s*/, '').replace(/\s*\(Local\)\s*$/i, ''); // internal tags, not game text
    if (window.gdText) key = window.gdText(key); // stat line in Chinese, numbers still as "#"
    if (!key.includes('#')) return `${fmt(diff)} ${key}`;
    let first = true;
    // "+# to x" style keys: put the signed diff in the first #, leave other #s as "…"
    return key.replace(/#/g, () => { if (first) { first = false; return fmt(diff); } return '…'; })
      .replace(/^\+\+/, '+').replace(/^\+-/, '-');
  }

  const VERDICT = {
    upgrade: { text: 'UPGRADE', cls: 'up' },
    small: { text: 'SMALL UPGRADE', cls: 'up' },
    risky: { text: 'UPGRADE, BUT…', cls: 'risky' },
    resloss: { text: 'LOSES RESISTANCE', cls: 'down' },
    dmgloss: { text: 'LOSES DAMAGE', cls: 'down' },
    downgrade: { text: 'DOWNGRADE', cls: 'down' },
    same: { text: 'SIDEGRADE', cls: 'same' },
    new: { text: 'EMPTY SLOT', cls: 'new' },
    equipped: { text: 'EQUIPPED', cls: 'same' },
  };

  function equipButtons(r) {
    const item = r.item;
    let slots;
    const groups = (r.slots && r.slotGroups) || {};
    if (groups[item.slot]) slots = groups[item.slot];
    else if (item.slot === 'Ring') slots = ['Ring 1', 'Ring 2'];
    else slots = [item.slot];
    return slots.map((s) => `<button class="equip" data-slot="${esc(s)}">${t('Set as {0}', esc(t(s)))}</button>`).join('');
  }

  // Shows the outcome of a trade search in `el` (text + "open anyway" link).
  window.showSearchResult = function (el, res) {
    if (!res) { el.textContent = ''; return; }
    if (!res.ok) { el.textContent = res.error ? displayText(res.error) : t('Search failed.'); return; }
    const where = `${res.league}${res.budget ? ', ' + res.budget : ''}`;
    let t2;
    if (res.total === 0) {
      t2 = t('No listings found ({0}).', where);
      if (res.mode === 'price') t2 += t(' Nothing similar is listed – it may be rare (or worth little).');
      else if (res.mode === 'craft') t2 += t(' No rare base with those stats and an open affix right now – try a higher price limit.');
      else if (res.mode === 'similar') t2 += t(' Even at {0} with {1} of {2} stats nothing is listed – try a higher price limit, or Custom search and untick a stat.', res.levelLabel || 'looser values', res.need, res.of);
      else if (res.mode === 'weights') t2 += t(' Nothing scores higher with your weights – check they suit your build.');
      else if (res.mode === 'pob') t2 += t(' Nothing is listed in your price range with the stats Path of Building looked for – try a higher price limit.');
      else if (res.mode === 'gear') t2 += t(' Nothing listed is better for your build{0}, even within 10% – try a higher price limit.', res.score != null ? ` (${t('gear score')} ${res.score})` : '');
      else t2 += t(' Untick a stat or lower some minimums.');
    } else {
      t2 = `${res.inApp ? t('Showing in the results window') : res.opened ? t('Opened in your browser') : t('Search ready')} (${where})${res.total != null ? ` – ${res.total} listing${res.total === 1 ? '' : 's'}` : ''}.`;
      if (res.mode === 'price' && res.summary) {
        const sm = res.summary;
        t2 = `${sm.verdict || ''} ${sm.cheapest && sm.typical ? t('Cheapest {0}. ', sm.cheapest) : ''}${t('{0} similar listed.', res.total)}${sm.notes && sm.notes.length ? t(' Note: {0}.', sm.notes.join('; ')) : ''}`;
      }
      if (res.mode === 'price' && res.level > 0) t2 += ` ${t('Compared with {0}.', res.levelLabel)}`;
      if (res.mode === 'craft' && res.keyStats) t2 += ` ${t('Rare bases with {0} and an open affix to craft.', res.keyStats.join(' + '))}`;
      if (res.mode === 'similar' && res.of) {
        t2 += res.unique ? t(' Same unique{0}, {1} of {2} mods at {3}.', res.need ? `, ${res.need}` : '', res.need, res.of, res.levelLabel) : t(' At least {0} of your {1} stats at {2}.', res.need, res.of, res.levelLabel);
        if (res.level > 0) t2 += t(' (Loosened: nothing matched your exact values.)');
      }
      if (res.mode === 'gear') t2 += res.level === 1 ? t(' No clear upgrade listed; these are a little better than yours.') : res.level > 1 ? t(' Nothing beats yours yet; these come close ({0}).', res.levelLabel) : t(' Clearly better for your build than yours{0} – best for your build first.', res.score != null ? ` (${t('gear score')} ${res.score})` : '');
      if (res.fallback) t2 += t(' The direct search failed, so a pre-filled link was used – see the log.');
    }
    if (res.skipped && res.skipped.length) t2 += ` ${t('Left out rune bonuses: {0}.', res.skipped.length)}`;
    if (res.ignored && res.ignored.length) t2 += ` ${t('Ignored: {0} stat{1}.', res.ignored.length, res.ignored.length === 1 ? '' : 's')}`;
    if (res.excluded) t2 += t(' Listings with your excluded stats are hidden.');
    if (res.unmatched && res.unmatched.length) t2 += ` ${t('Not searchable: {0}.', res.unmatched.join(', '))}`;
    el.textContent = t2;
    if (res.url && !res.opened) {
      const a = document.createElement('button');
      a.className = 'link'; a.textContent = t('Open on trade site anyway');
      a.addEventListener('click', () => window.api.openUrl(res.url));
      el.appendChild(document.createTextNode(' ')); el.appendChild(a);
    }
  };

  // "If you equip it": changes to your character's totals (resistances vs cap, Spirit, ES, ...)
  window.characterBlock = function (ch, opts) {
    if (!ch) return '';
    opts = opts || {};
    const n = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
    const sg = (v) => `${v > 0 ? '+' : '−'}${n(Math.abs(v))}`;
    const items = [];
    if (ch.overall && ch.overall.delta) items.push({ cls: ch.overall.delta > 0 ? 'pos' : 'neg', html: t('Overall gear score {0} → {1}', ch.overall.from, `<b>${ch.overall.to}</b>`) });
    for (const r of ch.res || []) {
      if (r.from == null) { items.push({ cls: r.delta > 0 ? 'pos' : 'neg', html: `${esc(t(r.label))} ${sg(r.delta)}%` }); continue; }
      const capped = (v) => (v >= r.cap ? `${r.cap}%${v > r.cap ? ` (+${n(v - r.cap)} over)` : ''}` : `${n(v)}%`);
      // only matters when it crosses or sits below the cap
      const matters = r.under || r.wasUnder || (r.thin && r.delta < 0);
      items.push({ cls: r.under && r.delta < 0 ? 'neg warn' : r.thin && r.delta < 0 ? 'neg warn' : r.wasUnder && r.delta > 0 ? 'pos' : 'dim', html: `${esc(t(r.label))} ${capped(r.from)} → <b>${capped(r.to)}</b>${r.under ? ` ⚠ ${t('below cap')}` : r.thin && r.delta < 0 ? ` ⚠ ${t('barely capped')}` : ''}`, minor: !matters });
    }
    for (const l of ch.lines || []) items.push({ cls: l.delta > 0 ? 'pos' : 'neg', html: `${esc(t(l.label))} ${n(l.from)} → <b>${n(l.to)}</b> <span class="dim">(${sg(l.delta)})</span>` });
    if (!items.length && !(opts.risks && opts.risks.length)) return opts.empty ? `<div class="charch dim">${t('No change to your totals.')}</div>` : '';
    const shown = opts.compact ? items.filter((x) => !x.minor).slice(0, 4) : items;
    const losses = (ch.res || []).filter((r) => r.from != null && r.delta < 0 && r.under && (r.el !== 'chaos' || !r.wasUnder));
    const banner = window.resLossBanner && losses.length && !opts.noBanner ? window.resLossBanner(losses) : '';
    const otherRisks = (opts.risks || []).filter((x) => !/(?:res|\{0\} res) (?:drops below|goes further under) the cap/.test(sourceText(x)) && !/\{0\} would be only /.test(sourceText(x)));
    const risk = banner + (otherRisks.length ? `<div class="risks">⚠ ${displayList(otherRisks).map((x) => esc(t(x))).join(' · ')}</div>` : '');
    if (!shown.length) return risk;
    return `${risk}<div class="charch"><span class="dim" title="${esc(t('Totals from your saved gear; resistances use the totals from Path of Building / My gear'))}">${t('If you equip it:')}</span> ${shown.map((x) => `<span class="cc ${x.cls}">${x.html}</span>`).join('')}</div>`;
  };

  // The whole item, drawn the way the game draws its tooltip: name, base type,
  // properties, requirements, then every mod top to bottom. Advanced copies also
  // say which affix a mod is, so those lines get a "Prefix T2" / "Suffix T3" badge.
  const AFFIX_LABEL = { implicit: 'Implicit', prefix: 'Prefixes', suffix: 'Suffixes', explicit: 'Mods', enchant: 'Enchant', rune: 'Rune', fractured: 'Fractured', desecrated: 'Desecrated', crafted: 'Crafted', essence: 'Essence', unknown: 'No data' };
  // a crafted mod says so instead of "prefix"/"suffix": that is the useful part about it
  const affixOf = (l) => {
    const k = l.affix && l.affix.kind;
    if (l.affix && l.affix.crafted) return 'crafted';
    if (k === 'prefix' || k === 'suffix' || k === 'essence' || k === 'unknown') return k;
    return l.tag || 'explicit';
  };
  const modText = (s) => esc(window.gdText ? window.gdText(s) : s).replace(/([+\u2212-]?\d+(?:\.\d+)?%?)/g, '<b>$1</b>');
  // "121% increased Evasion and Energy Shield" is one line on the item but two stats: show both.
  const DEFENCE_WORDS = { armour: 'Armour', evasion: 'Evasion', 'evasion rating': 'Evasion', 'energy shield': 'Energy Shield', ward: 'Ward' };
  function splitDefence(text) {
    const m = /^(\d+(?:\.\d+)?)%\s+increased\s+(.+?)\s*$/i.exec(String(text || ''));
    if (!m) return null;
    const words = m[2].split(/\s*,\s*|\s+and\s+/i).map((x) => x.trim().toLowerCase());
    if (words.length < 2) return null;
    const keys = words.map((w) => DEFENCE_WORDS[w]);
    if (keys.some((k) => !k)) return null;
    return { value: m[1], keys };
  }
  // inside the item tooltip everything is game text: Traditional, whatever the UI language
  const tw = (s, ...a) => (window.i18n && window.i18n.tIn ? window.i18n.tIn('zh-TW', s, ...a) : t(s, ...a));
  // English needs "2 prefixes"; Chinese doesn't ("2 個前綴"), so the plural sits in the key
  const plural = () => (window.i18n && window.i18n.getLang() === 'en' ? 'es' : '');
  const rarityClass = (r) => (/unique/i.test(r || '') ? 'unique' : /rare/i.test(r || '') ? 'rare' : /magic/i.test(r || '') ? 'magic' : 'normal');

  // opts.showHead: draw name + base type (off when the caller already shows them)
  window.itemTooltipHtml = function (item, opts) {
    opts = opts || {};
    if (!item) return '';
    const lines = item.lines || [];
    const prop = lines.filter((l) => l.tag === 'base' || l.tag === 'prop');
    const req = lines.filter((l) => l.tag === 'req');
    const modLines = lines.filter((l) => ['implicit', 'explicit', 'enchant', 'rune', 'fractured', 'desecrated', 'crafted'].includes(l.tag));
    // the game lists a rare's mods in roll order: show every prefix above every suffix, but keep
    // implicit / enchant / rune lines where they were
    const mods = [];
    let run = [];
    const flush = () => {
      // prefixes first, then suffixes, and a mod the bundled data can't place last
      const rank = (l) => { const k = l.affix && l.affix.kind; return k === 'suffix' ? 1 : k === 'unknown' ? 2 : 0; };
      run.sort((a, b) => rank(a) - rank(b));
      mods.push(...run);
      run = [];
    };
    for (const l of modLines) { if (l.tag === 'explicit') run.push(l); else { flush(); mods.push(l); } }
    flush();
    const flags = lines.filter((l) => l.tag === 'flag');
    const part = [];
    if (opts.showHead !== false) {
      const name = window.gdName ? window.gdName(item.name || '') : item.name || '';
      const base = item.baseType && item.baseType !== item.name ? (window.gdName ? window.gdName(item.baseType) : item.baseType) : '';
      part.push(`<div class="it-head"><span class="it-name">${esc(name)}</span>${base ? `<span class="it-base">${esc(base)}</span>` : ''}</div>`);
    }
    if (item.itemClass || item.itemLevel) part.push(`<div class="it-meta">${esc(tw(item.itemClass || ''))}${item.itemLevel ? ` · ilvl ${item.itemLevel}` : ''}</div>`);
    // Quality sits above the item level in the game's tooltip. The text you copy in game doesn't
    // always carry it (gear imported from Path of Building doesn't), so add it when it's missing.
    if (Number.isFinite(item.quality) && item.quality > 0 && !prop.some((l) => /^Quality/i.test(l.text))) {
      prop.unshift({ text: `${tw('Quality')}: +${item.quality}%`, tag: 'prop' });
    }
    if (prop.length) part.push(`<div class="it-block it-props">${prop.map((l) => `<div class="it-line">${esc(window.gdText ? window.gdText(l.text) : l.text)}</div>`).join('')}</div>`);
    if (req.length) part.push(`<div class="it-block it-reqs">${req.map((l) => `<div class="it-line">${esc(window.gdText ? window.gdText(l.text) : l.text)}</div>`).join('')}</div>`);
    if (mods.length) {
      // the game wraps a long mod over two lines and the parser keeps them apart; a line that
      // starts in lower case continues the one before it ("… can be Allocated" / "without …")
      const rows = [];
      for (const l of mods) {
        const prev = rows[rows.length - 1];
        const next = String(l.text || '').trim();
        if (prev && /[a-z]$/.test(String(prev.text || '').trim()) && /^[a-z]/.test(next)) {
          prev.text = `${String(prev.text).trim()} ${next}`;
        } else {
          rows.push({ text: l.text, src: l });
        }
      }
      // one affix can print several lines (a hybrid rolls two stats): only its first line carries
      // the badge, so a body armour with three prefixes doesn't look like it has four
      const shownAffix = new Set();
      part.push(`<div class="it-block it-mods">${rows.map(({ text: rowText, src: l }) => {
        const kind = affixOf(l);
        // inferred affixes carry the game's mod id; an advanced copy (Ctrl+Alt+C) shares one object
        // between the lines of a mod, so either works as the key
        const affixRef = l.affix && (l.affix.id || l.affix);
        const continued = !!(affixRef && shownAffix.has(affixRef));
        if (affixRef) shownAffix.add(affixRef);
        const beyond = !!(l.affix && l.affix.beyond);
        const tier = l.affix && l.affix.tier ? ` T${l.affix.tier}${beyond ? '*' : ''}` : '';
        const affixName = l.affix && l.affix.name ? (window.gdName ? window.gdName(l.affix.name) : l.affix.name) : '';
        const title = kind === 'unknown'
          ? (l.affix && l.affix.reason === 'overflow'
            ? t('This mod matched the affix data, but all 3 prefixes / 3 suffixes are already taken')
            : l.affix && l.affix.reason === 'range'
              ? t('The roll is outside every tier in the affix data (a newer league, or a quality boosted value)')
              : t('The bundled affix data has no such mod (a newer game patch, most likely)'))
          : affixName ? `${affixName}${beyond ? ` · ${t('beyond the bundled affix data')}` : ''}` : '';
        // When two affixes raise the same stat the game prints their rolls added together
        // ("254% increased Physical Damage"). Such a line is listed apart here, one line per
        // affix, each with the roll its own range allows.
        const badge = continued ? '<span class="affix cont"></span>'
          : kind === 'explicit' ? ''
            : `<span class="affix ${esc(kind)}"${title ? ` title="${esc(title)}"` : ''}>${esc(tw(AFFIX_LABEL[kind] || 'Mods'))}${tier}</span>`;
        // the badge already says where the mod comes from, so drop the trailing "(enchant)"
        let text = (badge && !continued) ? String(rowText).replace(/\s*[（(][^（()）]*[）)]\s*$/, '') : rowText;
        const zh = (s) => (window.gdText ? window.gdText(s) : s);
        const mrg = l.affix && l.affix.merged && l.affix.merged[0];
        if (mrg && mrg.splitRange) {
          // this line: the plain affix's own half of the added-up number
          text = zh(text).replace(/-?\d+(?:\.\d+)?/, `${mrg.splitRange[0]}–${mrg.splitRange[1]}`);
        }
        const ofm = l.affix && l.affix.ofMerged;
        if (ofm && ofm.range) {
          // the hybrid's line: its own roll, plus the half the game folded into the line above
          const half = zh(ofm.from).replace(/-?\d+(?:\.\d+)?/, `${ofm.range[0]}–${ofm.range[1]}`);
          text = `${half}、${zh(text)}`;
        }
        // A hybrid mod ("121% increased Evasion and Energy Shield") is one affix that rolls two
        // stats: list each stat on its own line, the first one carrying the prefix/suffix badge.
        const split = splitDefence(text);
        if (split) {
          const gameText = window.gdText ? window.gdText(text) !== text : false;
          return split.keys.map((k, i) => {
            const part = gameText
              ? `${tw('Increased')}${split.value}%${tw(k)}`
              : `${split.value}% increased ${k}`;
            const slot = i === 0 ? badge : '<span class="affix cont"></span>';
            return `<div class="it-mod ${esc(kind)}${i ? ' cont' : ''}">${slot}<span class="it-text">${modText(part)}</span></div>`;
          }).join('');
        }
        return `<div class="it-mod ${esc(kind)}">${badge}<span class="it-text">${modText(text)}</span></div>`;
      }).join('')}</div>`);
    }
    if (flags.length) part.push(`<div class="it-block it-flags">${flags.map((l) => `<div class="it-line">${esc(window.gdText ? window.gdText(l.text) : l.text)}</div>`).join('')}</div>`);
    if (item.affixes && item.affixes.inferred) part.push(`<div class="it-note">${esc(tw('Prefix/suffix and tiers are inferred from the item level'))}${mods.some((l) => l.affix && l.affix.merged) ? ` ${esc(tw('Where the game adds two affixes into one line they are listed apart here, each with the roll its range allows'))}` : ''}${mods.some((l) => l.affix && l.affix.beyond) ? ` ${esc(tw('Lines marked * roll higher than the bundled affix data; the tier shown is the highest known one'))}` : ''}</div>`);
    if (item.affixes && item.affixes.known && (item.affixes.openPrefix || item.affixes.openSuffix)) {
      part.push(`<div class="it-open">${t('Open: {0} prefix{1}, {2} suffix{3} – craftable', item.affixes.openPrefix, plural(), item.affixes.openSuffix, plural())}</div>`);
    }
    return `<div class="itemtip ${rarityClass(item.rarity)}">${part.join('<div class="it-sep"></div>')}</div>`;
  };

  // Big red warning for resistances an item drops off (or further under) the cap.
  // rows: [{ el, from, to, max }] (PoB) or the app's own res rows ({ label, from, to, cap })
  window.resLossBanner = function (rows) {
    if (!rows || !rows.length) return '';
    const txt = rows.map((r) => {
      const raw = r.el || String(r.label || '').replace(/ res$/, '');
      const el = raw.charAt(0).toUpperCase() + raw.slice(1);
      const max = r.max || r.cap || 75;
      const from = Math.round(r.from); const to = Math.round(r.to);
      return `<b>${esc(window.i18n ? window.i18n.t(el) : el)}</b> ${Math.min(from, max)}% → <b>${to}%</b> <span>(${to - Math.min(from, max)} ${from >= max ? t('off the cap') : t('further under the cap')})</span>`;
    }).join(' · ');
    return `<div class="res-loss-banner">${t('⚠ LOSES RESISTANCE: ')}${txt}</div>`;
  };
  // the same for an item that costs a big part of your damage (e.g. a ring without your minion mods)
  window.dmgLossBanner = function (d) {
    if (!d) return '';
    const n = (v) => (v >= 1000 ? Math.round(v).toLocaleString('en') : Math.round(v));
    return `<div class="res-loss-banner">${t('⚠ LOSES DAMAGE: ')}<b>${d.minion ? t('Minion DPS') : t('DPS')} ${n(d.from)} → ${n(d.to)}</b> <span>(${t(' ({0}%: it doesn\'t have the damage mods your item gives)', `−${Math.abs(d.pct)}`)}</span></div>`;
  };

  // Path of Building's verdict: what the item really does to your build
  //   p: pobverdict.judge() output; opts: { pending, error, compact }
  window.pobBlock = function (p, opts) {
    opts = opts || {};
    if (opts.pending && !p) return `<div class="pob dim"><span class="pob-tag">PoB</span> <span class="spinner"></span> ${t('Checking with Path of Building…')}</div>`;
    if (!p) return opts.error ? `<div class="pob dim"><span class="pob-tag">PoB</span> ${esc(displayText(opts.error))}</div>` : '';
    const n = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en') : Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
    const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
    const pc = (v) => (v == null ? '' : `<b class="${v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'dim'}">${sgn(v)}${Math.abs(Math.round(v * 10) / 10)}%</b>`);
    const dl = (label, d) => (d ? `<span class="cc ${d.delta > 0 ? 'pos' : 'neg'}">${label} ${n(d.from)} → <b>${n(d.to)}</b></span>` : '');
    const dmgName = p.dpsKey === 'MinionDPS' ? t('Minion DPS') : t('DPS');
    const head = `<span class="pob-tag" title="${esc(t('Calculated by Path of Building with your build'))}">PoB</span>
      <span class="pob-main">${p.noDamage ? `<span class="dim" title="${esc(t('Your main skill in Path of Building deals no damage. Set your damage skill as the main skill in PoB and import again.'))}">${t('no damage to compare')}</span>` : `${dmgName} ${pc(p.dps && p.dps.pct)}`} · ${t('Effective HP')} ${pc(p.ehp && p.ehp.pct)}${p.resFirst && p.resGain ? ` · <span title="${esc(t('Resistance points toward your cap (Priorities: cap resistances first)'))}">${t('res toward cap')} <b class="${p.resGain > 0 ? 'pos' : 'neg'}">${p.resGain > 0 ? '+' : '−'}${Math.abs(p.resGain)}</b></span>` : ''}</span>`;
    const res = (p.res || []).filter((r) => r.capped !== r.wasCapped || !r.capped || Math.round(r.from) !== Math.round(r.to)).map((r) => {
      const bad = r.wasCapped && !r.capped; const good = !r.wasCapped && r.capped;
      return `<span class="cc ${bad || (!r.capped && r.to < r.from) ? 'neg warn' : good || r.to > r.from ? 'pos' : 'dim'}">${esc(t(r.el))} ${t('res')} ${Math.round(r.from)}% → <b>${Math.round(r.to)}%</b>${bad ? ` ⚠ ${t('off the cap')}` : good ? ` ✓ ${t('capped')}` : !r.capped ? ` (${t('under cap')})` : ''}</span>`;
    }).join('');
    const parts = [dl(t('ES'), p.es), dl(t('Life'), p.life), dl(t('Spirit'), p.spirit), dl(t('Mana'), p.mana), res].filter(Boolean);
    // resistance losses get their own banner, above everything else
    const lossBanner = opts.noBanner ? '' : window.resLossBanner(p.resLoss) + window.dmgLossBanner(p.dmgLoss);
    const capLine = p.resCapped && p.resCapped.length ? `<div class="res-cap">${t('✓ Caps your {0} resistance', esc(p.resCapped.join(' and ').toLowerCase()))}</div>` : '';
    const other = (p.breaks || []).filter((b) => !/res (drops off|goes further under)|^(Minion damage|Damage) drops|^\{0\} drops /.test(sourceText(b)));
    const risk = other.length ? `<div class="risks">⚠ ${displayList(other).map(esc).join(' · ')}</div>` : '';
    return `${lossBanner}${capLine}<div class="pob">${head}</div>${risk}${parts.length ? `<div class="charch">${opts.compact ? parts.slice(0, 5).join('') : parts.join('')}</div>` : ''}`;
  };

  // Gear score block: "78 A · for your build · yours 56 (+22)" + why? details
  window.gearBlock = function (g, yours, idSuffix) {
    if (!g) return '';
    if (g.unique) return `<div class="gear dim">${t('Gear score: uniques aren\'t rated (their mods are fixed).')}</div>`;
    const diff = yours != null ? g.score - yours : null;
    const cmp = diff == null ? '' : ` · ${t('yours {0} ({1})', yours, `<b class="${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}">(${diff > 0 ? '+' : ''}${diff})</b>`)}`;
    const contrib = (g.contributions || []).slice(0, 8).map((c) => `<div class="gc"><span>${esc(t(c.label))}${c.source === 'socket' ? t(' (rune)') : ''}</span><span class="dim">${t('{0}% roll', c.quality)}</span><b>+${c.points}</b></div>`).join('');
    const detail = `<div class="dim gs-one">${t('How good this item is for your build in this slot (100 = about the best it can roll). Points per stat:')}</div>${contrib}${g.missing && g.missing.length ? `<div class="note">${t('Missing: {0}', displayList(g.missing).map(esc).join(', '))}</div>` : ''}${g.wasted && g.wasted.length ? `<div class="dim">${t('Not useful to your build: {0}', displayList(g.wasted).map(esc).join(', '))}</div>` : ''}${g.resNote && g.resNote.length ? `<div class="dim">${g.resNote.map((note) => esc(displayText(note))).join(' ')}</div>` : ''}`;
    return `<div class="gear"><span class="gs g-${esc(g.grade)}" title="${esc(g.buildName || '')}">${g.score} ${esc(g.grade)}</span>
      <span>${t('Gear score')}${cmp}</span> <button class="link gear-why" data-why="${idSuffix || 'x'}">${t('why?')}</button></div>
      <div class="gear-detail hidden" data-whybox="${idSuffix || 'x'}">${detail}</div>`;
  };
  // The plain-language explanation of the gear score, shown in the results window,
  // the popup's "why?" and on the Build & stats page.
  window.gearExplainHtml = function (opts) {
    opts = opts || {};
    return `<div class="gs-explain">
      ${opts.pobOn ? `<p class="note">${t('Your Path of Building build is loaded, so verdicts come from Path of Building (the change to your damage, effective HP and resistances). The gear score below is a rough guide shown alongside, and is used for anything PoB can\'t check (e.g. jewels).')}</p>` : ''}
      <p><b>${t('Gear score (0–100)')}</b> ${t('is how good an item is for your build, in that slot. 100 is about the best that slot can roll for you: your build\'s most important stats there, at top rolls.')}</p>
      <ul>
        <li><b>${t('How it\'s worked out:')}</b> ${t('every stat your build cares about counts by how important it is (Build & stats page) × how good the roll is. A 50% roll of an important stat beats a perfect roll of a minor one.')}</li>
        <li><b>${t('What doesn\'t count:')}</b> ${t('stats your build doesn\'t use, stats you\'ve ignored, and resistance past your cap. Rune bonuses count half, because you can swap runes. Conditional mods ("…if you\'ve Hit Recently") count a bit less.')}</li>
        <li><b>${t('Grades:')}</b> <span class="gs g-S">S</span> 85+ <span class="gs g-A">A</span> 70+ <span class="gs g-B">B</span> 55+ <span class="gs g-C">C</span> 40+ <span class="gs g-D">D</span> ${t('below.')} ${t('Uniques aren\'t rated.')}</li>
        <li><b>${t('The verdict')}</b> ${t('compares it with what you wear in that slot (for rings, charms and jewels, your weakest one):')}
          <span class="vchip up">${t('UPGRADE')}</span> ${t('+6 or more')} ·
          <span class="vchip up">${t('SMALL UPGRADE')}</span> ${t('+3 to +5')} ·
          <span class="vchip same">${t('SIDEGRADE')}</span> ${t('within 2')} ·
          <span class="vchip down">${t('DOWNGRADE')}</span> ${t('−3 or worse')} ·
          <span class="vchip risky">${t('UPGRADE, BUT…')}</span> ${t('better, but it costs Spirit, drops a resistance below the cap, or loses minion levels')} ·
          <span class="vchip down">${t('LOSES RESISTANCE')}</span> ${t('a resistance drops off the cap, or further under it')} ·
          <span class="vchip down">${t('LOSES DAMAGE')}</span> ${t('your damage drops (when Never lose damage is on); both go to the bottom of the results.')}</li>
        ${opts.pobOn
    ? `<li><b>${t('The verdicts use your whole build.')}</b> ${t('Path of Building knows your passive tree, skill gems and Configuration, so the verdict and the PoB line under each listing show the real change to your damage, effective HP and resistances{0}.', opts.where ? `. ${t('The gear score is tuned on the {0}', opts.where)}` : '')}</li>`
    : `<li><b>${t('It isn\'t a damage calculator.')}</b> ${t('It doesn\'t know your passive tree or skill gems. Check If you equip it under each listing for what changes on your character{0}. Add your Path of Building build on My gear for exact verdicts.', opts.where ? `, and tune what each stat is worth on the ${opts.where}` : '')}</li>`}
      </ul></div>`;
  };

  // "Why this score?": points per stat for this item next to yours, so a +9 is easy to read.
  window.gearCompareHtml = function (g, ge) {
    if (!g) return '';
    const mine = new Map(); const theirs = new Map();
    const roll = new Map();
    for (const c of g.contributions || []) { mine.set(c.label, (mine.get(c.label) || 0) + c.points); roll.set(c.label, Math.max(roll.get(c.label) || 0, c.quality || 0)); }
    for (const c of (ge && ge.contributions) || []) theirs.set(c.label, (theirs.get(c.label) || 0) + c.points);
    const labels = [...new Set([...mine.keys(), ...theirs.keys()])]
      .map((l) => ({ l, a: mine.get(l) || 0, b: theirs.get(l) || 0 }))
      .sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b) || y.a - x.a).slice(0, 10);
    const r1 = (v) => Math.round(v * 10) / 10;
    const rows = labels.map(({ l, a, b }) => {
      const d = r1(a - b);
      return `<tr><td>${esc(l)}${roll.get(l) ? ` <span class="dim">${roll.get(l)}% ${t('roll')}</span>` : ''}</td><td class="r">${r1(a) || '–'}</td>${ge ? `<td class="r dim">${r1(b) || '–'}</td><td class="r ${d > 0 ? 'pos' : d < 0 ? 'neg' : 'dim'}">${d > 0 ? '+' : ''}${d || '0'}</td>` : ''}</tr>`;
    }).join('');
    const scale = g.ideal ? ` ${t('Points are out of {0} for a perfect item here, then scaled to 100.', Math.round(g.ideal))}` : '';
    return `<div class="dim gs-one">${t('How good this item is for your build in this slot (0–100).{0}', scale)}</div>
      <table class="gs-table"><tr><th>${t('Stat')}</th><th class="r">${t('This')}</th>${ge ? `<th class="r">${t('Yours')}</th><th class="r">±</th>` : ''}</tr>${rows || `<tr><td class="dim" colspan="4">${t('None of its stats count for your build in this slot.')}</td></tr>`}</table>
      ${g.missing && g.missing.length ? `<div class="note">${t('Missing: {0}', esc(g.missing.join(', ')))}</div>` : ''}
      ${g.wasted && g.wasted.length ? `<div class="dim">${t('Not useful to your build: {0}', esc(g.wasted.join(', ')))}</div>` : ''}
      ${g.resNote && g.resNote.length ? `<div class="dim">${g.resNote.map((note) => esc(displayText(note))).join(' ')}</div>` : ''}
      <button class="link gs-help">${t('What is the gear score?')}</button>`;
  };

  window.bindGearWhy = function (root) {
    root.querySelectorAll('.gs-help').forEach((b) => b.addEventListener('click', () => {
      if (window.showGearHelp) window.showGearHelp(); else if (window.api.openSettingsTab) window.api.openSettingsTab('build');
    }));
    root.querySelectorAll('.gear-why').forEach((b) => b.addEventListener('click', () => {
      const box = root.querySelector(`[data-whybox="${b.dataset.why}"]`);
      if (box) box.classList.toggle('hidden');
      if (window.__popupResize) window.__popupResize();
    }));
  };

  // Price with the other unit alongside: "180 ex (0.26 div)" / "3 div (2,089 ex)"
  window.dualPrice = function (amount, currency, divineRate) {
    const a = Number(amount);
    if (!divineRate || !Number.isFinite(a)) return '';
    if (currency === 'divine') return `${Math.round(a * divineRate).toLocaleString()} ex`;
    if (currency === 'exalted') return `${Math.round((a / divineRate) * 100) / 100} div`;
    return '';
  };

  // the number in carved type, the words after it in plain text ("+26.8%" + "for your build")
  function scoreHtml(label) {
    if (!label) return '';
    const m = String(label).match(/^([+\-−]?[\d.,]+%?)\s*(.*)$/);
    return m ? `<span class="score">${esc(m[1])}${m[2] ? ` <small>${esc(m[2])}</small>` : ''}</span>` : `<span class="score">${esc(label)}</span>`;
  }

  function pointsLabel(r) {
    // a loss verdict with a positive score would read like an upgrade: the banner says what it costs
    if (r.scoreMode === 'pob') return r.delta == null || ((r.verdict === 'dmgloss' || r.verdict === 'resloss') && r.delta > 0) ? '' : `${r.delta > 0 ? '+' : ''}${r.delta}% ${t('for your build')}`;
    if (r.scoreMode === 'gear') {
      if (r.delta == null) return '';
      return `${r.delta > 0 ? '+' : ''}${r.delta} ${t('gear score')}`;
    }
    const pct = r.pct == null ? '' : ` (${fmt(r.pct)}%)`;
    return `${fmt(r.delta)}${pct}`;
  }

  // Popup / test view. Compact by default: item, verdict, gear score, top
  // changes and two buttons; "More" shows everything else.
  window.renderComparison = function (el, r, opts) {
    opts = opts || {};
    const ui = (r && r.ui) || {};
    document.body.classList.toggle('cb', !!ui.colorblind);
    if (!r || !r.ok) {
      const reason = r && r.reason ? displayText(r.reason) : t('Nothing to show.');
      el.innerHTML = `<div class="card ${r && r.loading ? 'loading' : ''}">${opts.closable ? '<button class="x" id="closeBtn" title="' + t('Close') + '">×</button>' : ''}
        <div class="note">${r && r.loading ? '<span class="spinner"></span> ' : ''}${esc(reason)}</div></div>`;
      const c0 = el.querySelector('#closeBtn');
      if (c0) c0.addEventListener('click', () => window.api.close());
      return;
    }
    const it = r.item;
    const notes = Array.isArray(r.notes) ? r.notes : [];
    const unique = /unique/i.test(it.rarity || '');
    const v = VERDICT[r.verdict] || VERDICT.same;
    const rarity = (it.rarity || '').toLowerCase();
    const full = opts.expanded || ui.detail === 'full';
    const gearMode = r.scoreMode === 'gear' || r.scoreMode === 'pob';
    // jewels judged by PoB: the search is for your tree's sockets, starting from this jewel
    const target = it.slot === 'Jewel' && r.pob && r.pob.socket && it.id ? { itemId: it.id } : ['Ring', 'Charm', 'Jewel'].includes(it.slot) ? it.slot : r.targetSlot;
    const budget = r.budgetLabel ? ' ' + r.budgetLabel.replace(/ \(.*\)$/, '') : '';

    const rowCls = (row) => {
      const useful = gearMode ? row.useful > 0 : row.weight !== 0;
      if (!useful) return 'unweighted';
      return row.diff > 0 ? 'pos' : 'neg';
    };
    const top = r.rows.filter((row) => (gearMode ? row.useful > 0 : row.weight)).slice(0, 4)
      .map((row) => `<span class="chg ${rowCls(row)}">${esc(label(row.key, row.diff))}</span>`).join('');

    const rows = r.rows.map((row) => `<tr class="${rowCls(row)}">
        <td class="stat" title="${esc(row.key)}">${esc(label(row.key, row.diff))}
          <span class="fromto">${esc(fmt(row.oldValue).replace('+', ''))} → ${esc(fmt(row.newValue).replace('+', ''))}</span></td>
        ${gearMode ? '' : `<td class="w"><input class="weight" type="number" step="0.1" value="${row.weight || ''}" placeholder="0" data-key="${esc(row.key)}" title="${t('Weight for this stat')}"></td>
        <td class="imp">${row.weight ? esc(fmt(row.impact)) : ''}</td>`}
        <td class="ig"><button class="ignore" data-key="${esc(row.key)}" title="${t('Ignore this stat (hide it from the score and from searches)')}">⊘</button></td>
      </tr>`).join('');

    const g = r.gear;
    const yours = r.gearEquipped && r.gearEquipped.score != null ? r.gearEquipped.score : null;
    const gearChip = g && g.score != null ? `<span class="gs g-${esc(g.grade)}" title="${t('Gear score for {0}', esc(g.buildName || t('your build')))}">${g.score} ${esc(g.grade)}</span>` : '';
    const gearLine = !g || r.pob ? '' : g.unrated === 'unidentified' ? `<div class="dim">${t('Unidentified – identify it to see its gear score.')}</div>`
      : g.unique ? '' : `<div class="gear">${gearChip}<span>${t('gear score')}${yours != null ? ` · ${t('yours {0}', yours)}` : ''}</span> <button class="link gear-why" data-why="p">${t('why?')}</button></div>
        <div class="gear-detail hidden" data-whybox="p">${window.gearCompareHtml(g, r.isEquipped ? null : r.gearEquipped)}</div>`;

    const emptySlot = !r.replacing.length && !r.isEquipped;
    const craft = it.affixes && it.affixes.known && !unique ? `<div class="craft">${it.affixes.openPrefix || it.affixes.openSuffix
      ? t('Open: {0} prefix{1}, {2} suffix{3} – craftable', it.affixes.openPrefix, plural(), it.affixes.openSuffix, plural())
      : t('All 6 affixes taken')}</div>` : '';

    const primary = unique
      ? `<button class="find" id="priceFind">${t('What\'s it worth?')}</button><button id="likeFind" title="${t('This unique on the trade site, cheapest first')}">${t('Find cheaper copies')}</button>`
      : `${r.replacing.length ? `<button class="find" id="quickFind" title="${t('Listings that score higher for your build than your equipped {0}', esc(r.targetSlot))}">${t('Find upgrades')}${esc(budget)}</button>`
        : `<button class="find" id="likeFind" title="${t('Listings with this item\'s stats')}">${t('Find items like this')}${esc(budget)}</button>`}
         <button id="priceFind" title="${t('What similar items sell for')}">${t('What\'s it worth?')}</button>`;

    const lossRows = r.isEquipped ? [] : r.pob ? (r.pob.resLoss || []) : ((r.character && r.character.res) || []).filter((x) => x.from != null && x.delta < 0 && x.under && (x.el !== 'chaos' || !x.wasUnder));
    const dmgLoss = !r.isEquipped && r.pob ? r.pob.dmgLoss : null;
    const lossBanner = window.resLossBanner(lossRows) + window.dmgLossBanner(dmgLoss);
    el.innerHTML = `
      <div class="card ${lossRows.length || dmgLoss ? 'res-loss' : ''}">
        ${opts.closable ? '<button class="x" id="closeBtn" title="' + t('Close') + '">×</button>' : ''}
        <div class="name ${esc(rarity)}">${esc(window.gdName ? window.gdName(it.name || '') : it.name || '')}</div>
        <div class="meta">${it.baseType && it.baseType !== it.name ? `${esc(window.gdName ? window.gdName(it.baseType) : it.baseType)} · ` : ''}${esc(t(it.itemClass || ''))}${it.itemLevel ? ` · ilvl ${it.itemLevel}` : ''}</div>
        ${unique && !r.pob ? `<div class="verdict same"><span class="badge">${t('UNIQUE')}</span>${r.replacing.length && !r.isEquipped ? `<span class="dim">${t('vs')} ${esc(r.replacing.join(' + '))}</span>` : ''}</div>
          <div class="dim">${r.pobPending ? t('Checking with Path of Building…') : t("Uniques have fixed mods, so there's no gear score – check its price, or compare the changes below.")}</div>`
          : `<div class="verdict ${v.cls}">
          <span class="badge">${t(v.text)}</span>
          ${r.isEquipped || emptySlot ? '' : scoreHtml(pointsLabel(r))}
          ${r.isEquipped ? '' : r.replacing.length ? `<span class="dim">${t('vs')} ${esc(r.replacing.join(' + '))}</span>` : `<span class="dim">${esc(t(r.targetSlot))} ${t('slot is empty')}</span>`}
        </div>`}
        ${lossBanner}
        ${gearLine}
        ${craft}
        ${r.isEquipped ? `<div class="note">${t('This is your equipped {0}.', esc(r.targetSlot))}</div>` : ''}
        ${top && !r.isEquipped ? `<div class="chgs">${top}</div>` : ''}
        ${r.pobNudge && !r.isEquipped ? '<div class="dim small">' + t('For exact verdicts, paste your Path of Building export on My gear.') + '</div>' : ''}
        ${r.isEquipped ? '' : r.pob || r.pobPending || r.pobError ? window.pobBlock(r.pob, { pending: r.pobPending, error: r.pobError, compact: !full, noBanner: true }) : window.characterBlock(r.character, { compact: !full, risks: r.risks, noBanner: true })}
        ${notes.filter((n) => !/^Nothing saved/.test(sourceText(n)) || !emptySlot).filter((n) => full || /unidentified|two-handed/i.test(sourceText(n))).map((n) => `<div class="note">${esc(displayText(n))}</div>`).join('')}
        ${emptySlot ? `<div class="actions">${equipButtons(r)}</div>` : ''}
        <div class="note" id="findMsg"></div>
        <button class="link more" id="moreBtn">${full ? t('Less ▴') : t('More ▾')}</button>
        <div class="more-box ${full ? '' : 'hidden'}" id="moreBox">
          ${r.ignoring && r.ignoring.length ? `<div class="dim">${t('Ignoring: {0}', esc(r.ignoring.join(', ')))} <button class="link" id="ignoreChange">${t('change')}</button></div>` : ''}
          ${!full ? notes.filter((n) => !/unidentified|two-handed/i.test(sourceText(n))).map((n) => `<div class="note">${esc(displayText(n))}</div>`).join('') : ''}
          ${r.isEquipped ? '' : rows ? `<table class="rows"><thead><tr><th>${t('Change')}</th>${gearMode ? '' : '<th>' + t('Weight') + '</th><th>' + t('Score') + '</th>'}<th></th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="note">' + t('No stat differences.') + '</div>'}
          ${window.itemTooltipHtml ? `<div class="mods-block">${window.itemTooltipHtml(it)}</div>` : ''}
          ${r.isEquipped || emptySlot ? '' : `<div class="actions">${equipButtons(r)}</div>`}
          <div class="actions">
            ${opts.closable ? '<button class="link" id="settingsBtn">' + t('Settings') + '</button>' : ''}
          </div>
        </div>
      </div>`;

    const resize = () => opts.onResize && opts.onResize();
    const msgEl = () => el.querySelector('#findMsg');
    const run = (btn, fn, busy) => btn && btn.addEventListener('click', async () => {
      btn.disabled = true; msgEl().innerHTML = `<span class="spinner"></span> ${busy}`;
      resize();
      const res = await fn();
      btn.disabled = false;
      window.showSearchResult(msgEl(), res);
      resize();
    });
    const ref = it.id ? { itemId: it.id } : '__last';
    run(el.querySelector('#quickFind'), () => window.api.quickFind(target, 'upgrade'), t('Searching the trade site…'));
    run(el.querySelector('#sameFind'), () => window.api.quickFind(target, 'similar'), t('Searching the trade site…'));
    run(el.querySelector('#weightFind'), () => window.api.quickFind(target, 'weights'), t('Searching the trade site…'));
    run(el.querySelector('#likeFind'), () => window.api.quickFind(ref, 'similar'), t('Searching the trade site…'));
    run(el.querySelector('#likeFind2'), () => window.api.quickFind(ref, 'similar'), t('Searching the trade site…'));
    run(el.querySelector('#craftFind'), () => window.api.quickFind(ref, 'craft'), t('Looking for craftable bases…'));
    run(el.querySelector('#priceFind'), () => window.api.priceCheck(ref), t('Checking prices…'));
    window.__popupResize = opts.onResize || null;
    window.bindGearWhy(el);
    const mb = el.querySelector('#moreBtn');
    if (mb) mb.addEventListener('click', () => {
      const box = el.querySelector('#moreBox');
      box.classList.toggle('hidden');
      mb.textContent = box.classList.contains('hidden') ? t('More ▾') : t('Less ▴');
      if (opts.onToggle) opts.onToggle(!box.classList.contains('hidden'));
      resize();
    });
    const cf = el.querySelector('#customFind');
    if (cf) cf.addEventListener('click', () => window.api.findUpgrade(ref));
    const ic = el.querySelector('#ignoreChange');
    if (ic) ic.addEventListener('click', () => window.api.openSettingsTab && window.api.openSettingsTab('search'));
    el.querySelectorAll('button.ignore').forEach((b) => b.addEventListener('click', async () => {
      const st = await window.api.getState();
      const rules = (st.settings.ignoreStats || []).filter((x) => x.key !== b.dataset.key);
      rules.push({ key: b.dataset.key, mode: 'ignore' });
      await window.api.setIgnore(rules); // the popup re-renders itself
      if (opts.onChange) opts.onChange();
    }));
    el.querySelectorAll('input.weight').forEach((inp) => {
      inp.addEventListener('change', () => window.api.setWeight(inp.dataset.key, inp.value).then(() => opts.onChange && opts.onChange()));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    });
    el.querySelectorAll('button.equip').forEach((b) => {
      b.addEventListener('click', async () => {
        await window.api.equip(b.dataset.slot, it.id ? { itemId: it.id } : (opts.itemText || null));
        b.textContent = t('Saved as {0} ✓', b.dataset.slot);
        b.disabled = true;
        if (opts.onChange) opts.onChange();
      });
    });
    const c = el.querySelector('#closeBtn');
    if (c) c.addEventListener('click', () => window.api.close());
    const s = el.querySelector('#settingsBtn');
    if (s) s.addEventListener('click', () => window.api.openSettings());
  };

})();
