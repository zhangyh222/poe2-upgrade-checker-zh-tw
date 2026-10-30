'use strict';
/* global window, document */

// Character page: everything Path of Building calculates for your character (yours and your
// minions'), with the gear you copied in game, plus what the app itself knows.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const n0 = (v) => (isNum(v) ? Math.round(v).toLocaleString('en') : '–');
  const n1 = (v) => (isNum(v) ? (Math.round(v * 10) / 10).toLocaleString('en') : '–');
  const big = (v) => (!isNum(v) ? '–' : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : n0(v));
  const pct = (v) => (isNum(v) ? `${n1(v)}%` : '–');
  const row = (k, v, hint, src) => (v == null || v === '–' ? ''
    : `<tr${src ? ` class="has-src" data-src="${esc(src)}" data-src-label="${esc(k)}"` : ''}><td>${esc(k)}${hint ? ` <small>${esc(hint)}</small>` : ''}</td><td>${v}</td></tr>`);
  const card = (title, body, extra) => (body ? `<div class="card-p ${extra || ''}"><h3>${esc(title)}</h3>${body}</div>` : '');
  const table = (rows) => { const r = rows.filter(Boolean).join(''); return r ? `<table class="kv">${r}</table>` : ''; };
  const SLOT_ORDER = ['Weapon', 'Offhand', 'Helmet', 'Body Armour', 'Gloves', 'Boots', 'Amulet', 'Ring 1', 'Ring 2', 'Belt'];
  const POB_SLOT = { Weapon: 'Weapon 1', Offhand: 'Weapon 2', 'Weapon 2': 'Weapon 1 Swap', 'Offhand 2': 'Weapon 2 Swap' };
  const t = (s, ...a) => (window.i18n ? window.i18n.t(s, ...a) : (a.length ? s.replace(/\{(\d+)\}/g, (_, i) => (a[Number(i)] != null ? a[Number(i)] : '')) : s));
  // game data (skill, passive and item names) from PoB's zh_TW catalogs
  const gn = (s) => (window.gdName ? window.gdName(s) : s);
  const gdText = (s) => (window.gdText ? window.gdText(s) : s);
  const displayError = (value) => value && typeof value === 'object'
    ? t(value.key || '', ...(Array.isArray(value.args) ? value.args : []))
    : t(String(value == null ? '' : value));

  let busy = false;
  let lastState = null; // the last state we drew, for the small edits made from this page
  let again = null; // a render asked for while one runs: do it straight after, not never
  async function render(refresh) {
    if (busy) { again = again || !!refresh; return; }
    busy = true;
    const body = $('#charBody');
    try {
      const [st, d] = await Promise.all([window.api.getState(), window.api.pobSheet(!!refresh)]);
      const prof = (st.profiles || []).find((p) => p.active);
      lastState = st;
      $('#charTitle').textContent = prof ? prof.name : t('Character');
      body.innerHTML = d.sheet ? sheetHtml(d, st) : noPobHtml(d, st);
      srcCache.clear();
      closeHover();
      if (d.sheet) wireSources(body);
      $('#charSub').textContent = d.sheet
        ? (t('Calculated by Path of Building with your build')
          + (d.sheet.overridden && d.sheet.overridden.length ? ' ' + t('and the {0} item{1} you copied in game', d.sheet.overridden.length, d.sheet.overridden.length === 1 ? '' : 's') : '')
          + (d.at ? ' · ' + new Date(d.at).toLocaleTimeString() : '')
          + '.' + (d.error ? ' ' + t("Couldn't recalculate just now: {0}", displayError(d.error)) : ''))
        : t('Add your Path of Building build on My gear to see your full character sheet.');
      $('#charRefresh').classList.toggle('hidden', !d.on);
      // the weapon set the page is calculated on: switching it re-runs Path of Building
      const wbar = $('#charWset');
      if (d.sheet && d.on) {
        const cur = d.sheet.weaponSwap ? 2 : 1;
        const sets = d.sheet.weaponSets || [];
        wbar.innerHTML = [1, 2].map((n) => {
          const info = sets.find((x) => x.set === n) || {};
          const name = (info.main && info.main.name) || '';
          const pts = isNum(info.points) ? `${info.points} ${t('set-only passives')}` : '';
          return `<button type="button" data-wset-global="${n}" class="${n === cur ? 'on' : ''}" title="${esc([name, pts].filter(Boolean).join(' · '))}">${esc(t('Weapon set {0}', n))}</button>`;
        }).join('');
        wbar.classList.remove('hidden');
      } else {
        wbar.classList.add('hidden');
      }
      // widths set here: the page's security policy doesn't allow inline styles
      body.querySelectorAll('[data-w]').forEach((e) => { e.style.width = `${Number(e.dataset.w) || 0}%`; });
      body.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => document.querySelector(`.tabs button[data-tab="${b.dataset.goto}"]`).click()));
    } catch (err) {
      body.innerHTML = `<div class="card-p">${t("Couldn't load your character: {0}", displayError(err.message || err))}</div>`;
    } finally {
      busy = false;
      if (again !== null) { const r = again; again = null; render(r); }
    }
  }

  function resBars(list, ci) {
    return list.map((r) => {
      const el = String(r.el).toLowerCase();
      if (el === 'chaos' && ci) return `<div class="resbar chaos ok has-src" data-src="ChaosResist" data-src-label="${t('Chaos')}"><div class="rl"><span>${t('Chaos')}</span><b>${t('immune')}</b></div><div class="track"><div class="fill" data-w="100"></div></div><div class="dim small">${t("Chaos Inoculation – chaos resistance doesn't matter.")}</div></div>`;
      const max = r.max || 75; const v = isNum(r.value) ? r.value : null;
      const under = v != null && v < max - 0.5;
      const over = isNum(r.over) && r.over > 0 ? ` <small class="dim">(${n0(r.total)}%, ${n0(r.over)} ${t('over the cap')})</small>` : '';
      return `<div class="resbar ${el} ${under ? 'under' : 'ok'} has-src" data-src="${el[0].toUpperCase() + el.slice(1)}Resist" data-src-label="${t(r.el)}"><div class="rl"><span>${esc(t(r.el))}</span><span><b>${v == null ? '–' : n0(v)}%</b> / ${n0(max)}%${over}${under ? ` <small>${n0(max - v)} ${t('short')}</small>` : ''}</span></div><div class="track"><div class="fill" data-w="${v == null ? 0 : Math.max(0, Math.min(100, (v / max) * 100))}"></div></div></div>`;
    }).join('');
  }

  function sheetHtml(d, st) {
    const s = d.sheet; const p = s.player || {}; const m = s.minion; const ci = !!p.ChaosInoculation || (isNum(p.Life) && p.Life <= 1);
    const minionMain = m && isNum(m.CombinedDPS) && m.CombinedDPS > 0;
    const playerDps = Math.max(p.FullDPS || 0, p.CombinedDPS || 0, p.TotalDPS || 0);
    const tags = [
      s.mainSkill ? `<span class="char-tag">${t('Main skill')}: ${esc(gn(s.mainSkill))}</span>` : '',
      ci ? `<span class="char-tag good">${t('Chaos Inoculation')}</span>` : '',
      ...(s.tree && s.tree.keystones ? s.tree.keystones.filter((k) => k !== 'Chaos Inoculation').map((k) => `<span class="char-tag">${esc(gn(k))}</span>`) : []),
    ].join('');
    const tiles = [
      minionMain ? [t('Minion DPS'), big(m.CombinedDPS)] : null,
      playerDps > 0 ? [minionMain ? t('Your DPS') : t('DPS'), big(playerDps), 'CombinedDPS'] : null,
      [t('Effective HP'), big(p.TotalEHP)],
      isNum(p.EnergyShield) && p.EnergyShield > 0 ? [t('Energy Shield'), n0(p.EnergyShield), 'EnergyShield'] : null,
      !ci ? [t('Life'), n0(p.Life), 'Life'] : null,
      [t('Mana'), n0(p.Mana), 'Mana'],
      [t('Spirit free'), `${n0(p.SpiritUnreserved)} <small class="dim tile-sub">/ ${n0(p.Spirit)}</small>`, 'Spirit', t('Spirit')],
      isNum(p.MovementSpeedMod) ? [t('Movement speed'), `${p.MovementSpeedMod >= 1 ? '+' : ''}${n0((p.MovementSpeedMod - 1) * 100)}%`, 'MovementSpeed'] : null,
    ].filter(Boolean).map(([k, v, src, label]) => `<div class="tile${src ? ' has-src' : ''}"${src ? ` data-src="${esc(src)}" data-src-label="${esc(label || k)}"` : ''}><b>${v}</b><span>${esc(k)}</span></div>`).join('');
    const hero = `<div class="card-p"><div class="char-hero"><div class="who">${esc(gn(s.ascendancy || s.className) || t('Your character'))}<small>${esc(s.ascendancy && s.className ? gn(s.className) + ' · ' : '')}${t('Level')} ${esc(s.level || '?')}${s.tree && s.tree.points ? ` · ${s.tree.points} ${t('passive points')}` : ''}</small></div><div class="char-tags">${tags}</div></div><div class="char-big">${tiles}</div></div>`;

    const mres = m ? ['Fire', 'Cold', 'Lightning', 'Chaos'].map((el) => `${t(el)} ${isNum(m[`${el}Resist`]) ? `${n0(m[`${el}Resist`])}%` : '–'}`).join(' / ') : null;
    const minionCard = m ? card(m.name ? `${t('Minions')} – ${gn(m.name)}` : t('Minions'), table([
      row(t('DPS'), big(m.CombinedDPS || m.TotalDPS)),
      row(t('Average hit'), big(m.AverageHit)),
      isNum(m.Speed) && m.Speed > 0 ? row(t('Uses per second'), n1(m.Speed), isNum(m.Cooldown) && m.Cooldown > 0 ? t('with the cooldown') : '') : '',
      isNum(m.CastRate) && m.CastRate > 0 && !(isNum(m.Speed) && Math.abs(m.CastRate - m.Speed) < 0.05) ? row(t('Cast rate'), `${n1(m.CastRate)}/s`, t('without the cooldown')) : '',
      isNum(m.Cooldown) && m.Cooldown > 0 ? row(t('Cooldown'), `${n1(m.Cooldown)} s`) : '',
      row(t('Critical hit chance'), pct(m.CritChance)),
      row(t('Critical damage'), isNum(m.CritMultiplier) ? `×${n1(m.CritMultiplier)}` : null),
      row(t('Hit chance'), pct(m.HitChance)),
      isNum(m.AreaOfEffectRadiusMetres) ? row(t('Area radius'), `${n1(m.AreaOfEffectRadiusMetres)} m`) : '',
      row(t('Life'), n0(m.Life)),
      isNum(m.EnergyShield) && m.EnergyShield > 0 ? row(t('Energy Shield'), n0(m.EnergyShield)) : '',
      isNum(m.Armour) && m.Armour > 0 ? row(t('Armour'), n0(m.Armour), isNum(m.PhysicalDamageReduction) ? `${n0(m.PhysicalDamageReduction)}% ${t('phys. reduction')}` : '') : '',
      isNum(m.Evasion) && m.Evasion > 0 ? row(t('Evasion'), n0(m.Evasion)) : '',
      row(t('Effective HP'), n0(m.TotalEHP)),
      row(t('Resistances'), mres, t('fire / cold / lightning / chaos')),
    ])) : '';

    const offence = playerDps > 0 || !minionMain ? card(minionMain ? t('Your own damage') : t('Offence'), table([
      row(t('Full DPS'), big(p.FullDPS), null, 'FullDPS'), row(t('Main skill DPS'), big(p.CombinedDPS || p.TotalDPS), null, 'CombinedDPS'), isNum(p.TotalDotDPS) && p.TotalDotDPS > 0 ? row(t('Damage over time'), big(p.TotalDotDPS)) : '',
      row(t('Average hit'), big(isNum(p.AverageHit) ? p.AverageHit : p.AverageDamage), null, 'AverageHit'), isNum(p.Speed) && p.Speed > 0 ? row(t('Uses per second'), n1(p.Speed)) : '',
      row(t('Critical hit chance'), pct(p.CritChance), null, 'CritChance'), row(t('Critical damage'), isNum(p.CritMultiplier) ? `×${n1(p.CritMultiplier)}` : null, null, 'CritMultiplier'),
      row(t('Hit chance'), pct(p.HitChance)), row(t('Accuracy'), n0(p.Accuracy)),
    ])) : '';

    const defence = card(t('Defences'), table([
      row(t('Effective HP'), n0(p.TotalEHP)),
      isNum(p.EnergyShield) && p.EnergyShield > 0 ? row(t('Energy Shield'), n0(p.EnergyShield), isNum(p.EnergyShieldRecharge) ? t('recharges {0}/s after {1} s', n0(p.EnergyShieldRecharge), n1(p.EnergyShieldRechargeDelay)) : '', 'EnergyShield') : '',
      ci ? row(t('Life'), '1', t('Chaos Inoculation'), 'Life') : row(t('Life'), n0(p.Life), isNum(p.LifeRegenRecovery) && p.LifeRegenRecovery > 0 ? t('regenerates {0}/s', n1(p.LifeRegenRecovery)) : '', 'Life'),
      isNum(p.Ward) && p.Ward > 0 ? row(t('Ward'), n0(p.Ward), null, 'Ward') : '',
      row(t('Armour'), n0(p.Armour), isNum(p.PhysicalDamageReduction) && p.PhysicalDamageReduction > 0 ? `${n0(p.PhysicalDamageReduction)}% ${t('phys. reduction')}` : '', 'Armour'),
      row(t('Evasion'), n0(p.Evasion), isNum(p.EvadeChance) ? `${n0(p.EvadeChance)}% ${t('chance to evade')}` : '', 'Evasion'),
      isNum(p.DeflectChance) && p.DeflectChance > 0 ? row(t('Deflect chance'), pct(p.DeflectChance)) : '',
      row(t('Block chance'), isNum(p.BlockChance) ? `${n0(p.BlockChance)}%${isNum(p.BlockChanceMax) ? ` <small>${t('of {0}%', n0(p.BlockChanceMax))}</small>` : ''}` : null, null, 'BlockChance'),
      isNum(p.SpellBlockChance) && p.SpellBlockChance > 0 ? row(t('Spell block chance'), pct(p.SpellBlockChance)) : '',
      row(t('Stun threshold'), n0(p.StunThreshold), null, 'StunThreshold'), row(t('Ailment threshold'), n0(p.AilmentThreshold)),
    ]));

    const res = card(t('Resistances'), resBars(s.res || [], ci) + (d.resists && d.resists.source === 'game' ? `<div class="dim small">${t('From Path of Building. Your typed-in character sheet numbers are on My gear.')}</div>` : ''));

    const hit = (v) => (v === null || v === undefined ? (ci ? 'immune' : '–') : n0(v));
    const maxHit = card(t('Biggest hit you can take'), table([
      row(t('Physical'), hit(p.PhysicalMaximumHitTaken), null, 'PhysicalMaximumHitTaken'),
      row(t('Fire'), hit(p.FireMaximumHitTaken), null, 'FireMaximumHitTaken'),
      row(t('Cold'), hit(p.ColdMaximumHitTaken), null, 'ColdMaximumHitTaken'),
      row(t('Lightning'), hit(p.LightningMaximumHitTaken), null, 'LightningMaximumHitTaken'),
      row(t('Chaos'), ci ? t('immune') : hit(p.ChaosMaximumHitTaken), null, ci ? null : 'ChaosMaximumHitTaken'),
    ]) + `<div class="dim small">${t('From full energy shield / life, after your resistances and mitigation.')} ${t('Click a damage type to see how it is calculated and where it comes from.')}</div>`);

    const spPct = isNum(p.Spirit) && p.Spirit > 0 && isNum(p.SpiritReserved) ? Math.min(100, (p.SpiritReserved / p.Spirit) * 100) : 0;
    const resources = card(t('Spirit & mana'), `<div class="resbar spiritbar has-src" data-src="Spirit" data-src-label="${t('Spirit')}"><div class="rl"><span>${t('Spirit')}</span><span><b>${n0(p.SpiritReserved)}</b> ${t('reserved of')} ${n0(p.Spirit)} · <b class="${isNum(p.SpiritUnreserved) && p.SpiritUnreserved < 0 ? 'neg' : 'pos'}">${n0(p.SpiritUnreserved)}</b> ${t('free')}</span></div><div class="track"><div class="fill" data-w="${spPct}"></div></div></div>` + table([
      row(t('Mana'), n0(p.Mana), isNum(p.ManaUnreserved) && p.ManaUnreserved !== p.Mana ? `${n0(p.ManaUnreserved)} ${t('unreserved')}` : '', 'Mana'),
      row(t('Mana regeneration'), isNum(p.ManaRegenRecovery) ? `${n1(p.ManaRegenRecovery)}/s` : null, null, 'ManaRegenRecovery'),
    ]));

    const attr = (k, label) => { const have = p[k]; const need = p[`Req${k}`]; const ok = !isNum(need) || have >= need; return row(label, `<b class="${ok ? '' : 'neg'}">${n0(have)}</b>${isNum(need) && need > 0 ? ` <small>${t('needs {0}', n0(need))}</small>` : ''}`, null, k); };
    // each charge type opens its own breakdown: the extra charges come from gear and passives
    const chargeRows = [['Power', t('Power charges')], ['Frenzy', t('Frenzy charges')], ['Endurance', t('Endurance charges')]]
      .filter(([c]) => isNum(p[`${c}ChargesMax`]))
      .map(([c, label]) => row(label, n0(p[`${c}ChargesMax`]), null, `${c}ChargesMax`));    const misc = card(t('Attributes & more'), table([
      attr('Str', t('Strength')), attr('Dex', t('Dexterity')), attr('Int', t('Intelligence')),
      isNum(p.MovementSpeedMod) ? row(t('Movement speed'), `${p.MovementSpeedMod >= 1 ? '+' : ''}${n0((p.MovementSpeedMod - 1) * 100)}%`, null, 'MovementSpeed') : '',
      ...chargeRows,
      isNum(p.PresenceRadiusMetres) ? row(t('Presence radius'), `${n1(p.PresenceRadiusMetres)} m`) : '',
      isNum(p.TotalCompanionLife) && p.TotalCompanionLife > 0 ? row(t('Companion life'), n0(p.TotalCompanionLife)) : '',
    ]));

    // skills: one line per skill group, the main one first and highlighted (duplicates PoB keeps for
    // item-granted skills are left out)
    const seen = new Set();
    const keyOf = (g) => g.key || (() => { const act = (g.gems || []).filter((x) => !x.support); return (act.length ? act : g.gems || []).map((x) => x.name).join('|'); })();
    const profileId = ((st.profiles || []).find((p) => p.active) || {}).id || 'main';
    const weaponSets = (st.settings && st.settings.skillWeaponSets) || {};
    // a skill socketed in a weapon slot exists once per weapon set, and the two copies differ
    // (one of them is the inactive set), so those are kept apart
    const inSet = new Set((s.skills || []).filter((g) => g.weaponSet).map(keyOf));
    const groups = (s.skills || []).filter((g) => {
      const key = keyOf(g);
      if (!g.weaponSet && inSet.has(key)) return false; // the copy that just came with the item
      const k = `${key}#${g.weaponSet || 0}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0));
    // "主" for the skill's own gem, "辅" for supports, "精" for persistent (Spirit) skills.
    // A skill socketed inside another one is not the headline: it goes on the gem line below,
    // together with the supports.
    const gemTag = (x) => (x.support ? ['GemSupport', 'sup'] : x.spirit ? ['GemSpirit', 'spirit'] : ['GemActive', 'act']);
    const gemBadge = (x) => { const [key, cls] = gemTag(x); return `<i class="gt gt-${cls}" title="${esc(t(key))}">${esc(t(key))}</i>`; };
    // clicking a gem copies its name (handy for the trade site or a build guide)
    const gemName = (x) => `<span class="gem has-copy" data-copy="${esc(gn(x.name))}" title="${esc(t('Click to copy the name'))}">${gemBadge(x)}${esc(gn(x.name))}</span>`;
    const skills = groups.length ? card(t('Skills ({0})', groups.length), groups.map((g) => {
      const act = g.gems.filter((x) => !x.support);
      const extra = act.slice(1); // socketed inside the main skill, not the headline
      const sup = g.gems.filter((x) => x.support);
      const primary = act[0];
      const line = primary
        ? `${gemBadge(primary)}${esc(gn(primary.name))} <small class="dim">${primary.level ? t('lvl {0}', primary.level) : ''}${primary.quality ? ` · ${primary.quality}%` : ''}</small>`
        : esc(gn(g.label));
      const rest = [...extra, ...sup].map(gemName).join(' · ');
      const mainStar = g.main ? ` <span class="char-tag main-star" title="${esc(t('Main skill'))}">★</span>` : '';
      // Which weapon set the skill uses. PoB only knows it for a skill socketed in a weapon slot (a
      // weapon's own skill); for the rest it is picked here, and the damage panel is calculated on it.
      const skillKey = keyOf(g);
      const manual = (weaponSets || {})[`${profileId}|${skillKey}`] || '';
      const known = g.weaponSet ? String(g.weaponSet) : '';
      const value = known || manual;
      const setsOf = (v) => (v === '12' ? [1, 2] : v ? [Number(v)] : []);
      const setOff = known && g.inActiveSet === false;
      const setTag = known
        ? setsOf(known).map((n) => ` <span class="char-tag wset wset-${n}${setOff ? ' off' : ''}" title="${esc(setOff
          ? t('Weapon set {0} (not the active set)', n)
          : t('Weapon set {0}', n))}">${esc(t('Weapon set {0}', n))}</span>`).join('')
        : ` <select class="wset-sel${value ? ' on' : ''}" data-wset="${esc(skillKey)}" title="${esc(t('Weapon set'))}">`
          + `<option value=""${value ? '' : ' selected'}>${esc(t('Weapon set'))}</option>`
          + `<option value="1"${value === '1' ? ' selected' : ''}>${esc(t('Weapon set {0}', 1))}</option>`
          + `<option value="2"${value === '2' ? ' selected' : ''}>${esc(t('Weapon set {0}', 2))}</option>`
          + `<option value="12"${value === '12' ? ' selected' : ''}>${esc(t('Both weapon sets'))}</option>`
          + `</select>`;
      // clicking a skill's name opens its own damage breakdown (PoB is asked for that skill, on the
      // weapon set you marked it with – PoB itself only holds one set at a time)
      const srcSet = value === '1' || value === '2' ? `@${value}` : '';
      const src = g.id != null ? ` class="sk has-src" data-src="SkillDPS#${g.id}${srcSet}" data-src-label="${esc(primary ? gn(primary.name) : gn(g.label))}" title="${esc(t('Damage breakdown for this skill'))}"` : ' class="sk"';
      return `<div class="skill-group ${g.main ? 'main' : ''} ${g.enabled && g.inActiveSet !== false ? '' : 'off'}"><div${src}>${line}${mainStar}${setTag}${g.enabled ? '' : ` <small class="dim">${t('(disabled)')}</small>`}</div>${rest ? `<div class="gems">${rest}</div>` : ''}</div>`;
    }).join('')) : '';

    // the passive tree has its own page: nothing to repeat here
    const over = new Set(s.overridden || []);
    const gs = st.gearScores || {};
    const gear = card(t('Gear'), table(SLOT_ORDER.map((slot) => {
      const it = (st.equipped || {})[slot]; const pobName = (s.gear || {})[POB_SLOT[slot] || slot];
      const name = it ? it.name : pobName; if (!name) return '';
      const g = gs[slot];
      return row(t(slot), `${esc(gn(name))}${over.has(POB_SLOT[slot] || slot) ? ` <small>${t('copied in game')}</small>` : it && it.fromPob ? ` <small>${t('from PoB')}</small>` : ''}${g && g.score != null ? ` <span class="gs g-${esc(g.grade)}">${g.score} ${esc(g.grade)}</span>` : ''}`);
    })) + (s.sockets && s.sockets.length ? `<h4 class="small">${t('Jewel sockets on your tree')}</h4>${table(s.sockets.map((j) => row(/^Socket #(\d+)$/.test(j.label) ? t('Socket #{0}', j.label.slice(8)) : j.label,
      j.jewel
        ? `${esc(gn(j.jewel))}${j.baseType && j.baseType !== j.jewel ? ` <small class="dim">${esc(gn(j.baseType))}</small>` : ''}${(j.mods || []).length ? `<div class="dim small jewel-mods">${j.mods.map((m) => esc(gdText(m))).join(' · ')}</div>` : ''}`
        : `<span class="neg">${t('empty')}</span>`)))}` : '')
      + '<div class="row"><button class="link" data-goto="gear">' + t('Change gear on My gear →') + '</button></div>');

    // three groups of related cards, each stacked without gaps: what you deal, what you survive,
    // what you wear and how you're built
    const stack = (cls, title, parts) => { const inner = parts.filter(Boolean).join(''); return inner ? `<section class="char-stack ${cls}"><h4 class="char-group">${esc(title)}</h4>${inner}</section>` : ''; };
    return `${hero}<div class="char-cols">${stack('s-off', t('Offence'), [minionCard, offence, skills])}${stack('s-def', t('Defence'), [defence, res, maxHit, resources])}${stack('s-build', t('Gear & build'), [gear, misc])}</div>`;
  }

  function noPobHtml(d, st) {
    const why = !d.hasBuild ? t('Paste your Path of Building export on <b>My gear</b> and this page shows your whole character: damage (or your minions\'), defences, resistances against the cap, the biggest hits you can take, Spirit, attributes, skills and passive tree.')
      : !d.enabled ? t('Path of Building is switched off on My gear (Judge items with Path of Building). Switch it on to see your character sheet.') : !d.available ? t('The Path of Building engine isn\'t included with this copy of the app.') : t('Path of Building isn\'t available right now.');
    const rs = d.resists;
    const res = rs ? card(t('Resistances (from My gear)'), resBars(['fire', 'cold', 'lightning', 'chaos'].filter((el) => rs[el] != null).map((el) => ({ el: el[0].toUpperCase() + el.slice(1), value: Math.min(rs[el], (rs.caps && rs.caps[el]) || rs.cap || 75), total: rs[el], over: rs[el] - ((rs.caps && rs.caps[el]) || rs.cap || 75), max: (rs.caps && rs.caps[el]) || rs.cap || 75 })), false)) : '';
    const gs = st.gearScores || {};
    const gear = card(t('Gear'), table(SLOT_ORDER.map((slot) => { const it = (st.equipped || {})[slot]; const g = gs[slot]; return it ? row(t(slot), `${esc(gn(it.name))}${g && g.score != null ? ` <span class="gs g-${esc(g.grade)}">${g.score} ${esc(g.grade)}</span>` : ''}`) : ''; })));
    return `<div class="card-p"><h3>${t('Your character sheet')}</h3><div class="help">${why}</div><div class="row"><button class="primary" data-goto="gear">${t('Go to My gear')}</button></div></div><div class="grid g-cards">${res}${gear}</div>`;
  }

  // ---- where a stat comes from: PoB's own modifier list ----
  // Hover shows a bubble here; clicking opens a small always-on-top window that stays
  // on screen (and can be dragged) even when the app is minimised. Several can be open.
  // panels that draw a formula table need more room than a plain list of modifiers
  const WIDE_STAT = (s) => /MaximumHitTaken$|DPS$|AverageHit$|^MovementSpeed$|^SkillDPS#/.test(String(s));
  const srcCache = new Map();
  let hoverPop = null; let hoverStat = null; let hoverToken = 0;
  let hideTimer = null; let hoverTimer = null;

  function hideHoverSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (hoverPop) hoverPop.classList.add('hidden'); }, 180);
  }

  function closeHover() {
    clearTimeout(hideTimer); clearTimeout(hoverTimer);
    hoverStat = null;
    if (hoverPop) hoverPop.classList.add('hidden');
  }

  function ensureHover() {
    if (hoverPop) return hoverPop;
    hoverPop = document.createElement('div');
    hoverPop.className = 'src-pop hidden';
    hoverPop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    hoverPop.addEventListener('mouseleave', () => hideHoverSoon());
    // a stat listed inside the bubble ("what the number is built from") opens its own panel
    hoverPop.addEventListener('click', (ev) => {
      const el = ev.target.closest ? ev.target.closest('.src-in[data-src]') : null;
      if (!el) return;
      ev.stopPropagation();
      const r = el.getBoundingClientRect();
      const target = el.dataset.src;
      window.api.toggleStatPanel({
        stat: target,
        label: el.dataset.srcLabel || '',
        x: Math.round(window.screenX + r.right + 12),
        y: Math.round(window.screenY + r.top),
        width: WIDE_STAT(target) ? 470 : 400,
      });
    });
    document.body.appendChild(hoverPop);
    return hoverPop;
  }

  function placeHover(el, anchor) {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth || 360; const h = el.offsetHeight || 200;
    let left = r.right + 12;
    if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - 12);
    let top = r.top;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    el.style.left = `${Math.round(left)}px`; el.style.top = `${Math.round(top)}px`;
  }

  async function loadSources(stat) {
    if (srcCache.has(stat)) return srcCache.get(stat);
    let data;
    try { data = await window.api.pobSources(stat); } catch (err) { data = { ok: false, error: String((err && err.message) || err) }; }
    srcCache.set(stat, data);
    return data;
  }

  async function showHover(stat, el, label) {
    const pop = ensureHover();
    const token = ++hoverToken;
    hoverStat = stat;
    pop.dataset.stat = stat;
    pop.innerHTML = window.StatPanel.html(label, null, { hint: true, bare: true });
    pop.classList.remove('hidden');
    placeHover(pop, el);
    const close = pop.querySelector('.src-close');
    if (close) close.addEventListener('click', () => closeHover());
    const data = await loadSources(stat);
    if (token !== hoverToken || hoverStat !== stat) return;
    pop.innerHTML = window.StatPanel.html(label, data, { hint: true, bare: true });
    const close2 = pop.querySelector('.src-close');
    if (close2) close2.addEventListener('click', () => closeHover());
  }

  function wireSources(root) {
    root.querySelectorAll('.has-src').forEach((el) => {
      const stat = el.dataset.src; const label = el.dataset.srcLabel || '';
      el.addEventListener('mouseenter', () => {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
          // don't pop the damage bubble while the weapon-set dropdown is in use
          const sel = el.querySelector('.wset-sel');
          if (sel && sel.matches(':hover')) return;
          showHover(stat, el, label);
        }, 200);
      });
      el.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); hideHoverSoon(); });
      el.addEventListener('click', (ev) => {
        // the weapon-set control inside the skill's title is its own
        if (ev.target.closest && ev.target.closest('.wset-sel, [data-wset]')) return;
        ev.stopPropagation();
        closeHover();
        const r = el.getBoundingClientRect();
        // screen coordinates: the floating panel is its own window, not part of the page
        window.api.toggleStatPanel({
          stat, label,
          x: Math.round(window.screenX + r.right + 12),
          y: Math.round(window.screenY + r.top),
          width: WIDE_STAT(stat) ? 470 : undefined,
        });
      });
    });
  }

  // clicking a gem copies its name; a tick next to it says it worked
  function flashCopied(el) {
    el.classList.add('copied');
    let mark = el.querySelector('.copy-mark');
    if (!mark) {
      mark = document.createElement('i');
      mark.className = 'copy-mark';
      mark.textContent = '✓';
      el.appendChild(mark);
    }
    clearTimeout(el._copyTimer);
    el._copyTimer = setTimeout(() => {
      el.classList.remove('copied');
      if (mark.parentNode) mark.parentNode.removeChild(mark);
    }, 1100);
  }

  // The weapon set of a skill you socketed yourself isn't in the build, so it is picked from a
  // dropdown: 1 / 2 / both / not set.
  document.addEventListener('change', async (ev) => {
    const el = ev.target.closest ? ev.target.closest('.wset-sel') : null;
    if (!el || !lastState) return;
    const pid = ((lastState.profiles || []).find((p) => p.active) || {}).id || 'main';
    const key = `${pid}|${el.dataset.wset}`;
    const all = { ...((lastState.settings || {}).skillWeaponSets || {}) };
    if (el.value) all[key] = el.value; else delete all[key];
    await window.api.setSetting('skillWeaponSets', all);
    render(false);
  });
  // the dropdown sits inside the skill's own click/tooltip area: keep it to itself
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest ? ev.target.closest('.wset-sel') : null;
    if (el) ev.stopPropagation();
  }, true);

  // the weapon set the whole character page is calculated on
  $('#charWset').addEventListener('click', async (ev) => {
    const b = ev.target.closest ? ev.target.closest('[data-wset-global]') : null;
    if (!b || b.classList.contains('on')) return;
    ev.stopPropagation();
    const n = Number(b.dataset.wsetGlobal);
    b.parentNode.classList.add('busy');
    const r = await window.api.pobWeaponSet(n);
    $('#charWset').classList.remove('busy');
    if (r && r.ok) render(true);
  });

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest ? ev.target.closest('.has-copy') : null;
    if (!el) return;
    ev.stopPropagation();
    window.api.copyText(el.dataset.copy || '');
    flashCopied(el);
  });

  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeHover(); });
  // leaving the character page hides the hover bubble (floating windows stay)
  document.querySelectorAll('.tabs button[data-tab]').forEach((b) => {
    if (b.dataset.tab !== 'char') b.addEventListener('click', closeHover);
  });

  document.querySelector('.tabs button[data-tab="char"]').addEventListener('click', () => render(false));
  $('#charRefresh').addEventListener('click', () => render(true));
  // keep it current while it's open (gear copied, build changed, character switched)
  window.api.onChanged(() => { if ($('#tab-char').classList.contains('active')) render(false); });
  if (window.i18n && window.i18n.onChange) window.i18n.onChange(() => { if ($('#tab-char').classList.contains('active')) render(false); });
  if (window.api && window.api.onLang) window.api.onLang((lang) => { if (window.i18n) window.i18n.setLangLocal(lang); });
  window.renderCharacter = render;
})();
