'use strict';
/* global window, document, location, fetch */

// A stat's sources in their own frameless, always-on-top window: it stays on screen
// (and keeps its place) while the main window is minimised or hidden, and you can
// drag it by its title bar. Close it with the × or the Escape key.
(function () {
  const root = document.getElementById('root');
  const params = new URLSearchParams(location.search);
  const stat = params.get('stat') || '';
  const label = params.get('label') || '';
  const t = (s, ...a) => (window.i18n ? window.i18n.t(s, ...a) : s);
  let token = 0;

  // ---- size ----
  // The window hugs its content. With more than a handful of modifiers the list is laid
  // out in two columns, so the window also gets wider instead of very tall.
  const baseWidth = Number(params.get('w')) || 380;
  const wideWidth = 680;
  let twoCols = false;

  // ---- zoom ----
  // Ctrl+wheel, the − / + buttons in the title bar, or Ctrl+0 to reset. Saved for every panel.
  const ZOOM_KEY = 'poe2uc-panelzoom';
  const ZMIN = 0.75;
  const ZMAX = 1.8;
  const ZSTEP = 0.1;
  let zoom = Number(localStorage.getItem(ZOOM_KEY)) || 1;
  zoom = Math.min(ZMAX, Math.max(ZMIN, zoom));

  function applyZoom() {
    document.documentElement.style.zoom = String(zoom);
    // the title bar (and the − / + buttons in it) keeps its size, so the controls stay where
    // they were and stay clickable at every zoom level
    const head = root.querySelector('.src-head');
    if (head) head.style.zoom = String(1 / zoom);
    const v = root.querySelector('.src-zoom-v');
    if (v) v.textContent = `${Math.round(zoom * 100)}%`;
  }

  function setZoom(value) {
    const next = Math.min(ZMAX, Math.max(ZMIN, Math.round(value * 100) / 100));
    if (Math.abs(next - zoom) < 0.001) return;
    zoom = next;
    try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch (_) { /* ignore */ }
    applyZoom();
    fit();
  }

  function zoomControls() {
    const head = root.querySelector('.src-head');
    if (!head || head.querySelector('.src-zoom')) return;
    const box = document.createElement('span');
    box.className = 'src-zoom';
    const button = (text, value, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.z = String(value);
      b.textContent = text;
      b.title = title;
      return b;
    };
    box.appendChild(button('−', -1, t('Smaller')));
    const value = document.createElement('span');
    value.className = 'src-zoom-v';
    value.dataset.z = '0';
    value.textContent = `${Math.round(zoom * 100)}%`;
    value.title = t('Reset the size');
    box.appendChild(value);
    box.appendChild(button('+', 1, t('Bigger')));
    head.insertBefore(box, head.querySelector('.src-close') || null);
  }

  async function render() {
    const mine = ++token;
    let data;
    try { data = await window.api.pobSources(stat); } catch (err) { data = { ok: false, error: String((err && err.message) || err) }; }
    if (mine !== token) return;
    root.innerHTML = window.StatPanel.html(label, data, { pinned: true, window: true });
    root.querySelector('.src-close').addEventListener('click', () => window.close());
    twoCols = !!(data && data.ok && (data.groups || []).length >= 10);
    zoomControls();
    applyZoom();
    fit();
  }

  // a stat inside this panel ("what the number is built from") opens its own panel next to it
  root.addEventListener('click', (ev) => {
    const zoomBtn = ev.target.closest ? ev.target.closest('[data-z]') : null;
    if (zoomBtn) {
      ev.stopPropagation();
      const step = Number(zoomBtn.dataset.z);
      setZoom(step === 0 ? 1 : zoom + step * ZSTEP);
      return;
    }
    const el = ev.target.closest ? ev.target.closest('.src-in[data-src]') : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const target = el.dataset.src;
    window.api.toggleStatPanel({
      stat: target,
      label: el.dataset.srcLabel || '',
      x: Math.round(window.screenX + r.right + 12),
      y: Math.round(window.screenY + r.top),
      width: /MaximumHitTaken$|DPS$|AverageHit$|^MovementSpeed$|^SkillDPS#/.test(target) ? 470 : 400,
    });
  });

  // the window hugs its content: ask the main process to resize it
  let fitTimer = null;
  function fit() {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      const h = Math.ceil(document.body.getBoundingClientRect().height + 2);
      const w = Math.ceil((twoCols ? wideWidth : baseWidth) * zoom);
      if (window.api.fitStatPanel) window.api.fitStatPanel(h, w);
    }, 30);
  }

  // The wheel always zooms, however tall the panel is (a two-column breakdown is taller than
  // one column, and it used to swallow the wheel as scrolling). Shift+wheel scrolls instead.
  document.addEventListener('wheel', (ev) => {
    if (ev.shiftKey) return;
    if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
    ev.preventDefault();
    setZoom(zoom + (ev.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { window.close(); return; }
    if (!(ev.ctrlKey || ev.metaKey)) return;
    if (ev.key === '0') { ev.preventDefault(); setZoom(1); }
    if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); setZoom(zoom + ZSTEP); }
    if (ev.key === '-') { ev.preventDefault(); setZoom(zoom - ZSTEP); }
  });

  if (window.api && window.api.onLang) window.api.onLang((lang) => {
    if (window.i18n) window.i18n.setLangLocal(lang);
    render();
  });
  if (window.api && window.api.onSourcesRefresh) window.api.onSourcesRefresh(render);
  if (window.i18n && window.i18n.onChange) window.i18n.onChange(render);
  applyZoom();
  render();
})();
