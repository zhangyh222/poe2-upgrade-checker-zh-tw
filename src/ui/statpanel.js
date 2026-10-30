'use strict';
/* global window */

// One stat's "where it comes from" panel, as HTML. Used twice: the hover bubble on
// the Character page and the floating always-on-top window you get by clicking.
//
//   window.StatPanel.html(label, data, { pinned, hint, close })
//
// data is PoB's `sources` answer: { ok, stat, total, steps: [...], groups: [...] }.
(function () {
  const t = (s, ...a) => (window.i18n ? window.i18n.t(s, ...a) : (a.length ? String(s).replace(/\{(\d+)\}/g, (_, i) => (a[Number(i)] != null ? a[Number(i)] : '')) : s));
  const gn = (s) => (window.gdName ? window.gdName(s) : s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const n0 = (v) => (isNum(v) ? Math.round(v).toLocaleString('en') : '–');
  const n1 = (v) => (isNum(v) ? (Math.round(v * 10) / 10).toLocaleString('en') : '–');
  const big = (v) => (!isNum(v) ? '–' : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : Math.round(v).toLocaleString('en'));
  const displayError = (value) => (value && typeof value === 'object'
    ? t(value.key || '', ...(Array.isArray(value.args) ? value.args : []))
    : t(String(value == null ? '' : value)));

  const KIND_LABEL = { base: 'Base value', item: 'Equipment', tree: 'Passives', skill: 'Skill', quest: 'Quest', config: 'Config', other: 'Other' };
  const srcVal = (n, suffix) => `${n > 0 ? '+' : ''}${Math.round(n * 10) / 10}${suffix || ''}`;

  // the stats a "biggest hit you can take" number is built from
  const INPUT_LABEL = {
    Life: 'Life', EnergyShield: 'Energy Shield', Mana: 'Mana', Ward: 'Ward', Armour: 'Armour',
    MindOverMatter: 'Damage taken from Mana',
    FireResist: 'Fire resistance', ColdResist: 'Cold resistance', LightningResist: 'Lightning resistance', ChaosResist: 'Chaos resistance',
    FireResistMax: 'Maximum fire resistance', ColdResistMax: 'Maximum cold resistance',
    LightningResistMax: 'Maximum lightning resistance', ChaosResistMax: 'Maximum chaos resistance',
    DamageReductionMax: 'Physical damage reduction cap', EnemyDamageMult: 'Enemy damage',
  };
  const DRAIN_NAME = { Life: 'Life', Mana: 'Mana', Ward: 'Ward', 'Energy Shield': 'Energy Shield', 'Overkill damage': 'Overkill damage' };

  function inputValue(x) {
    if (x.suffix === '%') return `${n1(x.value)}%`;
    if (x.suffix === 'x') return `×${n1(x.value)}`;
    return big(x.value);
  }

  // "100% as Fire" -> "100% 轉為火焰"
  function takenType(s) {
    const m = /^([\d.]+)% as (\w+)$/.exec(String(s || ''));
    return m ? t('{0}% as {1}', m[1], t(m[2])) : String(s || '');
  }

  function formulaHtml(data) {
    const f = data.formula || {};
    const rows = (f.rows || []).map((r) => `<tr><td>${esc(takenType(r.type))}</td><td>${esc(r.pool)}</td><td>${esc(r.incoming)}</td><td>${esc(String(r.multi || '').replace(/^x/, '×'))}</td><td>${esc(r.taken)}</td></tr>`).join('');
    const tbl = rows
      ? `<table class="src-tbl"><thead><tr><th>${esc(t('Taken type'))}</th><th>${esc(t('Pool'))}</th><th>${esc(t('Incoming'))}</th><th>${esc(t('Multiplier'))}</th><th>${esc(t('Damage taken'))}</th></tr></thead><tbody>${rows}</tbody></table>`
      : '';
    const lines = (f.lines || []).map((x) => `<div class="${/^\s/.test(x) ? 'ind' : ''}">${esc(stepText(x, data.stat))}</div>`).join('');
    if (!tbl && !lines) return '';
    return `<div class="src-sec">${esc(t('How it is calculated'))}</div>${tbl}${lines ? `<div class="src-steps">${lines}</div>` : ''}`;
  }

  // the pool and mitigation rows behind the number; each one opens its own sources
  function inputsHtml(data) {
    const list = (data.inputs || []).map((x) => {
      const name = t(INPUT_LABEL[x.key] || x.key);
      const role = x.role === 'pool' ? t('Pool') : x.role === 'mech' ? t('Mechanic') : t('Mitigation');
      const val = `<span class="src-vals"><i>${esc(inputValue(x))}</i></span>`;
      if (!x.stat) {
        return `<div class="src-row inert${x.dim ? ' dim' : ''}"><span class="src-kind k-plain">${esc(role)}</span><span class="src-name">${esc(name)}</span>${val}</div>`;
      }
      return `<button type="button" class="src-row src-in" data-src="${esc(x.stat)}" data-src-label="${esc(name)}" title="${esc(t('Click to see where this comes from'))}"><span class="src-kind ${x.role === 'pool' ? 'k-pool' : x.role === 'mech' ? 'k-mech' : 'k-mit'}">${esc(role)}</span><span class="src-name">${esc(name)}</span>${val}</button>`;
    }).join('');
    if (!list) return '';
    return `<div class="src-sec">${esc(t('What it is built from'))}</div><div class="src-groups">${list}</div>`
      + `<div class="src-hint">${esc(t('Click a stat to open its own sources'))}</div>`;
  }

  const pctVal = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${n1(Math.abs(v))}%`;

  // movement speed: everything adds to or multiplies the 100% you start with
  function moveHtml(data) {
    const m = data.move || {};
    const rows = [[t('Base value'), '100%']];
    if (m.flat) rows.push([t('Added'), pctVal(m.flat)]);
    if (m.inc) rows.push([t('Increased'), pctVal(m.inc)]);
    for (const x of m.more || []) rows.push([t('More'), `×${(1 + x / 100).toFixed(2)}`]);
    if (isNum(m.action) && Math.abs(m.action - 1) > 0.0005) rows.push([t('Action speed'), `×${n1(m.action)}`]);
    rows.push([t('Movement speed'), pctVal(isNum(data.total) ? data.total : 0)]);
    const kv = rows.map(([k, v]) => `<div class="src-kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    return `<div class="src-sec">${esc(t('How it is calculated'))}</div><div class="src-kvs">${kv}</div>`;
  }

  // skill damage: the hit per damage type, then the things that turn it into DPS
  function damageHtml(data, hideMeta) {
    const d = data.damage || {};
    const rows = (d.rows || []).map((r) => `<tr><td>${esc(t(r.type))}</td><td>${n0(r.min)}–${n0(r.max)}</td><td>${n0(r.average)}</td><td>${n1(r.portion)}%</td></tr>`).join('');
    const tbl = rows
      ? `<table class="src-tbl"><thead><tr><th>${esc(t('Damage type'))}</th><th>${esc(t('Range'))}</th><th>${esc(t('Average hit'))}</th><th>${esc(t('Portion'))}</th></tr></thead><tbody>${rows}</tbody></table>`
      : '';
    const bits = [];
    if (!hideMeta && isNum(d.hitChance)) bits.push(`${t('Hit chance')} ${n0(d.hitChance)}%`);
    if (!hideMeta && isNum(d.critChance)) bits.push(`${t('Critical hit chance')} ${n1(d.critChance)}%`);
    if (!hideMeta && isNum(d.critMulti)) bits.push(`${t('Critical damage')} ×${n1(d.critMulti)}`);
    if (!hideMeta && isNum(d.speed)) bits.push(`${t('Uses per second')} ${n1(d.speed)}`);
    if (!hideMeta && isNum(d.dpsMulti) && Math.abs(d.dpsMulti - 1) > 0.0005) bits.push(`${t('DPS multiplier')} ×${n1(d.dpsMulti)}`);
    if (!hideMeta && isNum(d.extra) && d.extra > 0.5 && isNum(d.totalDps)) bits.push(`${t('Skill DPS')} ${big(d.totalDps)} + ${t('Other damage')} ${big(d.extra)}`);
    const none = (!d.rows || !d.rows.length) && !(data.total > 0)
      ? `<div class="dim small">${esc(t('Path of Building works out no damage for this skill (a buff, a mark, or a group whose main gem is a support)'))}</div>`
      : '';
    return (tbl ? `<div class="src-sec">${esc(t('Damage by type'))}</div>${tbl}` : '')
      + (bits.length ? `<div class="src-meta">${bits.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '')
      + none;
  }

  // what the skill itself is: level, tags, damage effectiveness, cost (PoB's own numbers)
  const TAG_LABEL = {
    attack: 'Attack', spell: 'Spell', projectile: 'Projectile', area: 'Area', melee: 'Melee', duration: 'Duration',
    persistent: 'Persistent', aura: 'Aura', herald: 'Herald', minion: 'Minion', guard: 'Guard', travel: 'Travel',
    chaining: 'Chaining', nova: 'Nova', strike: 'Strike', slam: 'Slam', warcry: 'Warcry', curse: 'Curse',
    stages: 'Stages',
    dexterity: 'Dexterity', strength: 'Strength', intelligence: 'Intelligence', repeatable: 'Repeatable', wind: 'Wind',
    buff: 'Buff', fire: 'Fire', cold: 'Cold', lightning: 'Lightning', chaos: 'Chaos', physical: 'Physical',
  };
  function infoHtml(data) {
    const i = data.info;
    if (!i) return '';
    const rows = [];
    if (i.name) rows.push([t('Skill'), gn(i.name)]);
    const lv = [i.level ? `${t('Level')} ${i.level}` : '', i.quality ? `${t('Quality')} ${i.quality}%` : ''].filter(Boolean).join(' · ');
    if (lv) rows.push([t('Gem'), lv]);
    const tags = (i.tags || []).filter((x) => x !== 'grants_active_skill').map((x) => t(TAG_LABEL[x] || x));
    if (tags.length) rows.push([t('Tags'), tags.join(' · ')]);
    if (isNum(i.damageEffectiveness)) rows.push([t('Damage effectiveness'), `${n0(i.damageEffectiveness * 100)}%`]);
    if (isNum(i.attackSpeedMultiplier)) rows.push([t('Attack speed'), `${n0(100 + i.attackSpeedMultiplier)}% ${t('of base')}`]);
    if (isNum(i.cost) && i.cost > 0) rows.push([t('Mana cost'), n0(i.cost)]);
    if (isNum(i.reserved) && i.reserved > 0) rows.push([t('Spirit reserved'), n0(i.reserved)]);
    if (i.slot) rows.push([t('From'), t(i.slot)]);
    // which weapon set the numbers were calculated on: PoB keeps one active set for the whole
    // build, so a skill of the other set is rebuilt on it before reading its damage
    if (data.weaponSet) {
      const w = data.weapons || {};
      const parts = [t('Weapon set {0}', data.weaponSet)];
      if (w.main) parts.push(itemLabel(w.main));
      if (isNum(data.setPoints)) parts.push(t('{0} set-only passives', data.setPoints));
      rows.push([t('Weapon'), parts.join(' · ')]);
      if (w.off) rows.push([t('Offhand'), itemLabel(w.off)]);
    }
    const kv = rows.map(([k, v]) => `<div class="src-kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    return `<div class="src-sec">${esc(t('Skill info'))}</div><div class="src-kvs">${kv}</div>`;
  }

  // critical hit chance / critical damage: base, increased, more, then the cap
  function critHtml(data) {
    const c = data.crit || {};
    const rows = [];
    if (/CritMultiplier$/.test(data.stat || '')) {
      rows.push([t('Base critical damage'), `${isNum(c.base) ? `+${n0(c.base)}%` : '–'}`]);
      rows.push([t('Increased'), pctVal(c.inc || 0)]);
      if (isNum(c.more) && Math.abs(c.more - 1) > 0.0005) rows.push([t('More'), `×${c.more.toFixed(2)}`]);
      if (isNum(c.enemyBase) && Math.abs(c.enemyBase) > 0.01) {
        rows.push([t('Critical damage the enemy takes'), pctVal(c.enemyBase)]);
      }
      rows.push([t('Critical damage'), `×${n1(data.total)}`]);
    } else {
      // a spell starts from the skill's own base crit, an attack from the weapon's (same as PoB)
      rows.push([c.fromWeapon ? t('Weapon base critical chance') : t('Skill base critical chance'), `${n1(c.base)}%`]);
      if (isNum(c.add) && Math.abs(c.add) > 0.001) rows.push([t('Added'), pctVal(c.add)]);
      rows.push([t('Increased'), pctVal(c.inc || 0)]);
      if (isNum(c.more) && Math.abs(c.more - 1) > 0.0005) rows.push([t('More'), `×${c.more.toFixed(2)}`]);
      if (isNum(c.raw)) rows.push([t('Before the cap'), `${n1(c.raw)}%`]);
      if (c.inevitable) rows.push([t('Inevitable Critical Hits'), t('every hit counts as a critical hit')]);
      if (isNum(c.cap)) rows.push([t('Cap'), `${n0(c.cap)}%`]);
      rows.push([t('Critical hit chance'), `${n1(data.total)}%`]);
    }
    const kv = rows.map(([k, v]) => `<div class="src-kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    return `<div class="src-sec">${esc(t('How it is calculated'))}</div><div class="src-kvs">${kv}</div>`;
  }

  // spirit: what it is spent on
  function spiritHtml(data) {
    const list = data.reservations || [];
    if (!list.length) return '';
    const rows = list.map((r) => `<div class="src-row"><span class="src-kind k-skill">${esc(t('Reserved'))}</span><span class="src-name">${esc(gn(r.name))}${r.slot ? ` <small class="dim">${esc(t(r.slot))}</small>` : ''}</span><span class="src-vals"><i>${n0(r.value)}</i></span></div>`).join('');
    const total = isNum(data.reservedTotal) ? data.reservedTotal : 0;
    const max = isNum(data.total) ? data.total : 0;
    const over = total > max + 0.5;
    const line = over
      ? t('{0} reserved in total, more than your {1} – Path of Building shows it capped', n0(total), n0(max))
      : t('{0} of {1} reserved', n0(total), n0(max));
    return `<div class="src-sec">${esc(t('What it is spent on'))}</div><div class="src-groups">${rows}</div>`
      + `<div class="src-kv"><span>${esc(t('Reserved in total'))}</span><b>${esc(n0(total))}</b></div>`
      + `<div class="${over ? 'neg' : 'dim'} small">${esc(line)}</div>`;
  }

  // PoB's own calculation lines, with the few English words it uses translated
  function stepText(line, stat) {
    let s = String(line)
      .replace(/^(Min|Max):\s*/, (m, k) => `${t(k)}: `)
      .replace(/^Base:\s*/, () => `${t('Base')}: `)
      .replace(/^Total:\s*/, () => `${t('Total:')} `)
      .replace(/\((base|increased\/reduced|more\/less)\)/g, (m, k) => t(`(${k})`))
      .replace(/^(\d+) \(base from (Life|Mana|Energy Shield|Ward)\)$/, (m, n, k) => t('{0} (base from {1})', n, t(k)))
      .replace(/^\* ([\d.]+) \(increased threshold\)$/, (m, n) => `× ${n} ${t('(increased threshold)')}`);
    if (/DPS$|AverageHit$|AverageDamage$|^SkillDPS#/.test(String(stat || ''))) {
      s = s.replace(/\s*\((average damage|average hit|attack rate|cast rate|hit rate|trigger rate|DPS multiplier for this skill|quantity multiplier for this skill)\)/g,
        (m, k) => t(`(${k})`))
        .replace(/^x ([\d.]+)/, '× $1');
    }
    if (/ManaRegen/.test(String(stat || ''))) {
      s = s.replace(/^Mana Regeneration:$/, () => `${t('Mana regeneration')}:`)
        .replace(/ per second$/, () => ` ${t('per second')}`);
    }
    if (/MaximumHitTaken$/.test(String(stat || ''))) {
      s = s
        .replace(/^Maximum hit is calculated in reverse\s*-?$/, () => t('Maximum hit is calculated in reverse'))
        .replace(/^from health pools, via damage reductions, to the max hit:$/, () => t('From your health pools, through every mitigation layer, back to the hit size'))
        .replace(/^Such a hit would drain the following resources:$/, () => t('Such a hit would drain'))
        .replace(/^(\d+) \(used pool\)$/, (m, n) => t('{0} (the whole pool)', n))
        .replace(/^\/ ([\d.]+) \(modifiers to damage taken\)$/, (m, n) => t('/ {0} (damage taken modifiers)', n))
        .replace(/^\/ ([\d.]+) \(modifiers to enemy damage\)$/, (m, n) => t('/ {0} (enemy damage modifiers)', n))
        .replace(/^= (\d+) maximum survivable enemy damage( \(approximate\))?$/, (m, n, ap) => t('= {0} survivable enemy hit{1}', n, ap ? t(' (approximate)') : ''))
        .replace(/^(\s*)(\d+) (.+?)(?: \((\d+) remaining\))?$/, (m, sp, n, name, left) => {
          const label = t(DRAIN_NAME[name] || name);
          if (label === name && left == null) return m;
          return `${sp}${n} ${label}${left != null ? t('({0} left)', left) : ''}`;
        });
    }
    return s;
  }

  // "Skysliver, Winged Spear" -> 天銀，翼矛. A rare's own name is randomly generated and the
  // catalogs can't know it ("Kraken Ward"), so those show the translated base type instead.
  const hasZh = (s) => /[\u4e00-\u9fff]/.test(s);
  function itemLabel(s) {
    const raw = String(s || '').replace(/\[[^\]|]*\|([^\]]+)\]/g, '$1');
    // game names first (Traditional Chinese), then the app's own slot words
    const zh = (x) => {
      const g = window.gdName ? window.gdName(x) : x;
      if (g !== x) return g;
      return window.i18n && window.i18n.tIn ? window.i18n.tIn('zh-TW', x) : x;
    };
    const parts = raw.split(', ');
    if (parts.length !== 2) return zh(raw);
    const [own, base] = parts;
    const ownZh = zh(own); const baseZh = zh(base);
    const keep = ownZh !== own ? ownZh : (hasZh(own) ? own : '');
    return keep ? `${keep}，${baseZh}` : baseZh;
  }

  function groupsHtml(data) {
    // a list can hold several jewels of the same base type now that their random names are gone
    const shown = (data.groups || []).map((g) => (g.kind === 'base' || !g.name ? '' : itemLabel(g.name)));
    const counts = new Map();
    shown.forEach((n) => { if (n) counts.set(n, (counts.get(n) || 0) + 1); });
    const numbered = new Map();
    return (data.groups || []).map((g, i) => {
      const vals = [];
      if (g.flat) vals.push(`<i>${srcVal(g.flat, g.suffix)}</i>`);
      if (g.inc) vals.push(`<i>${srcVal(g.inc, '%')}${g.suffix ? '' : ' ' + esc(t('increased'))}</i>`);
      for (const m of g.more || []) vals.push(`<i>×${(1 + m / 100).toFixed(2)} ${esc(t(m < 0 ? 'less' : 'more'))}</i>`);
      const kindLabel = t(KIND_LABEL[g.kind] || 'Other');
      let name = shown[i];
      if (g.kind === 'quest' && name) {
        // "Act 1:Ogham Manor" -> 第 1 章 · 奧格姆宅第
        name = name.replace(/^(Act|Interlude) (\d+):\s*(.+)$/, (m, kind, n, area) => {
          const label = kind === 'Act' ? t('Act {0}', n) : t('Interlude {0}', n);
          return label + ' · ' + (window.gdArea ? window.gdArea(area.trim()) : area.trim());
        });
      }
      if (g.kind === 'base') name = '';
      if (name && counts.get(name) > 1) {
        const n = (numbered.get(name) || 0) + 1;
        numbered.set(name, n);
        name = `${name} ${n}`;
      }
      const tip = g.name && name !== itemLabel(g.name) ? ` title="${esc(String(g.name))}"` : '';
      return `<div class="src-row"><span class="src-kind k-${esc(g.kind)}">${esc(kindLabel)}</span><span class="src-name"${tip}>${esc(name)}</span><span class="src-vals">${vals.join('')}</span></div>`;
    }).join('');
  }

  function html(label, data, opts) {
    opts = opts || {};
    const percent = /Resist|Chance|Threshold|MindOverMatter|MovementSpeed/.test((data && data.stat) || '');
    const total = isNum(data && data.total)
      ? (/CritMultiplier$/.test((data && data.stat) || '') ? `×${n1(data.total)}` : percent ? `${n1(data.total)}%` : big(data.total))
      : '';
    const head = `<div class="src-head"><b>${esc(label)}</b><span class="src-total">${esc(total)}</span>`
      + `<span class="src-pinlabel">${opts.pinned && !opts.window ? esc(t('Pinned')) : ''}</span>`
      + (opts.close === false ? '' : '<button class="src-close" type="button">×</button>')
      + '</div>';
    const wrap = (inner) => (opts.bare ? inner : `<div class="src-pop${opts.pinned ? ' pinned' : ''}${data && (data.kind === 'maxhit' || data.kind === 'damage') ? ' wide' : ''}">${inner}</div>`);
    if (!data || !data.ok) {
      return wrap(head
        + `<div class="src-body"><div class="dim small">${esc(displayError((data && data.error) || '') || t('No breakdown for this stat yet'))}</div></div>`);
    }
    const maxHit = data.kind === 'maxhit' || /MaximumHitTaken$/.test(data.stat || '');
    const inputs = maxHit ? inputsHtml(data) : '';
    // a long list of modifiers reads better in two columns than in one very tall one
    const cols = !!(opts.window && (data.groups || []).length >= 10);
    const groups = groupsHtml(data);
    const steps = (data.steps || []).length
      ? `<div class="src-sec">${esc(t('How it is calculated'))}</div><div class="src-steps">${data.steps.map((x) => `<div>${esc(stepText(x, data.stat))}</div>`).join('')}</div>`
      : '';
    const sources = groups ? `<div class="src-sec">${esc(t('Sources'))}</div><div class="src-groups${cols ? ' cols2' : ''}">${groups}</div>` : '';
    let body;
    if (maxHit) {
      body = formulaHtml(data) + inputs;
    } else if (data.kind === 'damage') {
      // a skill PoB finds no damage for gets its own info, but no "0 x 0 = 0" formula or mod list
      const noDmg = !(data.total > 0) && !((data.damage && data.damage.rows) || []).length;
      body = infoHtml(data) + (noDmg ? '' : steps) + damageHtml(data, noDmg) + (noDmg ? '' : sources);
    } else if (data.kind === 'crit') {
      body = critHtml(data) + steps + sources;
    } else if (data.kind === 'spirit') {
      body = spiritHtml(data) + sources;
    } else if (data.kind === 'move') {
      body = moveHtml(data) + sources;
    } else {
      body = (sources || `<div class="dim small">${esc(t('No breakdown for this stat yet'))}</div>`) + steps;
    }
    body += (opts.hint && !inputs ? `<div class="src-hint">${esc(t('Click to pin this breakdown'))}</div>` : '')
      + `<div class="src-note">${esc(maxHit
        ? t("Path of Building works the number out backwards: the pool that would be emptied, then every multiplier on the way in")
        : t("Sources come from Path of Building's own modifiers; converted or capped values are shown in the calculation above"))}</div>`;
    return wrap(`${head}<div class="src-body">${body}</div>`);
  }

  window.StatPanel = { html, stepText, KIND_LABEL };
})();
