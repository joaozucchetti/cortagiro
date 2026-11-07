// Cortagiro — UI, input, audio graph and visualizations.
(function () {
  const { EXH, DEF, PRESETS, presetConfig } = RoncoData;
  const C = EngineCore;
  const $ = id => document.getElementById(id);
  const cl = (x, a, b) => (x < a ? a : x > b ? b : x);
  const css = getComputedStyle(document.documentElement);
  const COL = {};
  ['bg', 'panel', 'panel2', 'plate', 'line', 'line2', 'ink', 'dim', 'faint', 'acc', 'amber', 'red', 'green', 'violet'].forEach(k => (COL[k] = css.getPropertyValue('--' + k).trim()));
  const BANKC = [COL.acc, COL.amber, COL.green, COL.violet];
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const FONT = { disp: css.getPropertyValue('--f-disp'), mono: css.getPropertyValue('--f-mono'), body: css.getPropertyValue('--f-body') };

  function store(key, val) { try { if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null'); localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; } }

  // ---------- language ----------
  const nav = (navigator.language || 'pt').slice(0, 2);
  let lang = store('ronco.lang') || (nav === 'es' ? 'es' : nav === 'en' ? 'en' : 'pt');
  let I, nf0, nf1, nf2;
  function setLang(l) {
    lang = l; I = RoncoI18n[l];
    nf0 = new Intl.NumberFormat(I.locale, { maximumFractionDigits: 0 });
    nf1 = new Intl.NumberFormat(I.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    nf2 = new Intl.NumberFormat(I.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.documentElement.lang = I.locale;
    store('ronco.lang', l);
  }
  setLang(lang);
  const tx = v => (typeof v === 'object' ? v[lang] : v);
  const locE = s => I.eWords.reduce((a, [f, t]) => a.split(f).join(t), s);

  // ---------- state ----------
  let P = presetConfig(PRESETS[0]);
  let presetId = PRESETS[0].id;
  const last = store('ronco.last.v3');
  if (last && last.P) { P = Object.assign({}, DEF, last.P, { autoshift: true }); presetId = last.id || null; }
  let customs = store('ronco.custom') || [];
  let L = C.buildLayout(P), M = C.engineModel(P);
  let ctx = null, node = null, nodes = {};
  const S = { rpm: 0, thr: 0, boost: 0, v: 0, gear: 1, drive: true, vtec: false, cut: false, pops: 0, bov: 0, T: 0, Pw: 0, state: 'off', fb: false, launch: false, als: false, spool: 0 };
  let dispRpm = 0, popFlash = 0, bovFlash = 0, lastPops = 0, lastBov = 0;
  let thrUser = 0, fullHeld = false, pedalDrag = false, lastWheel = 0, thrMode = 'spring', sentThr = -1;
  let vizPh = 0, slow = 0.025, gCat = 'all';
  const gyro = { on: false, got: false, base: null, armed: true, lastBlip: 0 };

  // ---------- settings schema (structure only; text lives in i18n.js) ----------
  const pct = v => Math.round(v * 100) + '%';
  const MICS = ['outside', 'exhaust', 'bay', 'cabin'], ENVS = ['open', 'city', 'track', 'parking', 'garage', 'tunnel', 'canyon'];
  const SECTIONS = [
    { id: 'essential', open: true, items: [
      { k: 'layout', type: 'seg', opts: ['inline', 'v', 'flat', 'w', 'rotary'] },
      { k: 'cyl', type: 'range', min: 1, max: 16, step: 1, f: v => v + ' ' + (P.layout === 'rotary' ? I.w.rotor : I.w.cyl)[v > 1 ? 1 : 0] },
      { k: 'disp', type: 'range', min: 0.05, max: 8.5, step: 0.05, f: v => nf2.format(v) + ' L' },
      { k: 'strokes', type: 'seg', opts: [4, 2], show: p => p.layout !== 'rotary' },
      { k: 'induction', type: 'select', opts: ['na', 'turbo', 'twin', 'roots', 'centri'], lab: () => I.ind },
      { k: 'intake', type: 'seg', opts: ['airbox', 'cai', 'itb'] },
      { k: 'intakeVol', type: 'range', min: 0, max: 1, step: 0.01, f: pct },
      { k: 'exhaust', type: 'select', opts: Object.keys(EXH), lab: () => I.exh },
      { k: 'routing', type: 'seg', opts: ['merged', 'dual', 'xpipe'] },
    ] },
    { id: 'crank', items: [
      { k: 'crank', type: 'select', opts: ['even', 'cross', 'bigbang', 'shared'], show: p => p.cyl > 1 && p.layout !== 'rotary' },
      { k: 'vAngle', type: 'range', min: 15, max: 180, step: 1, f: v => v + '°', show: p => p.layout === 'v' || p.layout === 'w' },
    ] },
    { id: 'head', items: [
      { k: 'valves', type: 'range', min: 2, max: 5, step: 1, f: v => v + ' ' + I.w.valves, show: p => p.layout !== 'rotary' && p.strokes === 4 },
      { k: 'cam', type: 'range', min: 0, max: 1, step: 0.01, f: v => I.w.cam[Math.min(3, Math.floor(v * 4))] + ' · ' + pct(v) },
      { k: 'vtec', type: 'toggle', show: p => p.layout !== 'rotary' },
      { k: 'vtecRpm', type: 'range', min: 2500, max: 15000, step: 100, f: v => nf0.format(v) + ' rpm', show: p => p.vtec && p.layout !== 'rotary' },
    ] },
    { id: 'rpm', items: [
      { k: 'idle', type: 'range', min: 400, max: 5000, step: 50, f: v => nf0.format(v) + ' rpm' },
      { k: 'redline', type: 'range', min: 2500, max: 20000, step: 100, f: v => nf0.format(v) + ' rpm' },
      { k: 'limiter', type: 'seg', opts: ['hard', 'soft', 'none'] },
      { k: 'flywheel', type: 'range', min: 0.1, max: 3, step: 0.05, f: v => I.w.fly[v < 0.5 ? 0 : v < 1.3 ? 1 : 2] + ' · ' + nf2.format(v) + '×' },
    ] },
    { id: 'boost', items: [
      { k: 'boost', type: 'range', min: 0.2, max: 3, step: 0.05, f: v => nf2.format(v) + ' bar', show: p => p.induction !== 'na' },
      { k: 'turboSize', type: 'range', min: 0, max: 1, step: 0.01, f: v => I.w.tsize[v < 0.35 ? 0 : v < 0.7 ? 1 : 2] + ' · ' + pct(v), show: p => p.induction === 'turbo' || p.induction === 'twin' },
      { k: 'bov', type: 'seg', opts: ['bov', 'flutter', 'recirc'], show: p => p.induction === 'turbo' || p.induction === 'twin' },
      { k: 'whistle', type: 'range', min: 0, max: 1, step: 0.01, f: pct, show: p => p.induction !== 'na' },
      { k: 'als', type: 'toggle', show: p => p.induction === 'turbo' || p.induction === 'twin' },
    ] },
    { id: 'exhaust', items: [
      { k: 'headerLen', type: 'range', min: 0.2, max: 1.5, step: 0.01, f: v => nf2.format(v) + ' m', ex: 1 },
      { k: 'unequal', type: 'range', min: 0, max: 1, step: 0.01, f: pct },
      { k: 'pipeLen', type: 'range', min: 0.4, max: 5, step: 0.05, f: v => nf2.format(v) + ' m', ex: 1 },
      { k: 'resonance', type: 'range', min: 0, max: 0.95, step: 0.01, f: pct, ex: 1 },
      { k: 'muffler', type: 'range', min: 0, max: 1, step: 0.01, f: pct, ex: 1 },
      { k: 'rasp', type: 'range', min: 0, max: 1, step: 0.01, f: pct, ex: 1 },
      { k: 'pops', type: 'range', min: 0, max: 1, step: 0.01, f: pct },
    ] },
    { id: 'mech', items: [
      { k: 'rough', type: 'range', min: 0, max: 1, step: 0.01, f: pct },
      { k: 'mech', type: 'range', min: 0, max: 1, step: 0.01, f: pct },
      { k: 'gearWhine', type: 'range', min: 0, max: 1, step: 0.01, f: pct },
    ] },
    { id: 'car', items: [
      { k: 'gears', type: 'range', min: 4, max: 8, step: 1, f: v => v + ' ' + I.w.gears },
      { k: 'mass', type: 'range', min: 150, max: 2600, step: 10, f: v => nf0.format(v) + ' kg' },
      { k: 'autoshift', type: 'toggle' },
      { k: 'flySpeed', type: 'range', min: 60, max: 400, step: 5, f: v => v + ' km/h' },
    ] },
    { id: 'sound', items: [
      { k: 'wind', type: 'range', min: 0, max: 1, step: 0.01, f: pct, show: p => p.mic === 'cabin' },
      { k: 'drive', type: 'range', min: 0, max: 1, step: 0.01, f: pct },
      { k: 'width', type: 'range', min: 0, max: 1, step: 0.01, f: pct },
      { k: 'volume', type: 'range', min: 0, max: 1, step: 0.01, f: pct },
    ] },
  ];
  const SOUND_KEYS = ['mic', 'env', 'wet', 'wind', 'drive', 'width', 'volume'];
  const ITEMS = {};
  SECTIONS.forEach(s => s.items.forEach(it => (ITEMS[it.k] = it)));
  const optLabel = (it, v) => (it.lab ? it.lab()[v] : I.it[it.k].o[v]);

  function buildRail() {
    const rail = $('rail');
    const openState = [...rail.querySelectorAll('details')].map(d => d.open);
    rail.innerHTML = '';
    SECTIONS.forEach((sec, si) => {
      const d = document.createElement('details');
      d.open = openState.length ? openState[si] : !!sec.open;
      d.innerHTML = `<summary>${I.sec[sec.id]}</summary>`;
      sec.items.forEach(it => {
        const T = I.it[it.k];
        const row = document.createElement('div');
        row.className = 'ctl2'; row.id = 'row-' + it.k;
        const id = 'c-' + it.k;
        const q = T.info ? `<button type="button" class="q" aria-expanded="false" aria-controls="i-${it.k}" aria-label="?">?</button>` : '';
        if (it.type === 'toggle') {
          row.innerHTML = `<div class="ctl-h"><label class="switch" for="${id}">${T.l}</label>${q}<input type="checkbox" id="${id}" class="sw"></div>`;
          row.querySelector('input').addEventListener('change', e => setParam(it.k, e.target.checked));
        } else {
          row.innerHTML = `<div class="ctl-h"><label for="${id}" id="lb-${it.k}">${T.l}</label>${q}<output id="o-${it.k}"></output></div>`;
          if (it.type === 'range') {
            const inp = document.createElement('input');
            Object.assign(inp, { type: 'range', id, min: it.min, max: it.max, step: it.step });
            inp.addEventListener('input', () => setParam(it.k, parseFloat(inp.value)));
            row.appendChild(inp);
          } else if (it.type === 'select') {
            const sel = document.createElement('select');
            sel.id = id;
            sel.innerHTML = it.opts.map(o => `<option value="${o}">${optLabel(it, o)}</option>`).join('');
            sel.addEventListener('change', () => setParam(it.k, sel.value));
            row.appendChild(sel);
          } else {
            const g = document.createElement('div');
            g.className = 'seg'; g.id = id; g.setAttribute('role', 'group');
            it.opts.forEach(o => {
              const b = document.createElement('button');
              b.type = 'button'; b.textContent = optLabel(it, o); b.dataset.v = String(o);
              b.addEventListener('click', () => setParam(it.k, o));
              g.appendChild(b);
            });
            row.appendChild(g);
          }
        }
        if (T.od) row.insertAdjacentHTML('beforeend', `<p class="desc" id="d-${it.k}"></p>`);
        if (T.info) {
          const box = document.createElement('p');
          box.className = 'info'; box.id = 'i-' + it.k; box.hidden = true; box.textContent = T.info;
          row.appendChild(box);
          const btn = row.querySelector('.q');
          btn.addEventListener('click', e => {
            e.preventDefault();
            box.hidden = !box.hidden;
            btn.setAttribute('aria-expanded', String(!box.hidden));
            btn.classList.toggle('on', !box.hidden);
          });
        }
        d.appendChild(row);
      });
      if (I.empty[sec.id]) d.insertAdjacentHTML('beforeend', `<p class="note" id="empty-${sec.id}">${I.empty[sec.id]}</p>`);
      rail.appendChild(d);
    });
  }

  function syncRail() {
    Object.values(ITEMS).forEach(it => {
      const v = P[it.k];
      $('row-' + it.k).hidden = it.show ? !it.show(P) : false;
      const el = $('c-' + it.k);
      if (it.type === 'toggle') el.checked = !!v;
      else if (it.type === 'range') { el.value = v; el.style.setProperty('--pct', ((v - it.min) / (it.max - it.min) * 100) + '%'); }
      else if (it.type === 'select') el.value = v;
      else el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(v)));
      const o = $('o-' + it.k);
      if (o) o.textContent = it.f ? it.f(v) : '';
      const od = I.it[it.k].od;
      if (od) $('d-' + it.k).textContent = od[String(v)] || '';
    });
    SECTIONS.forEach(sec => { const n = $('empty-' + sec.id); if (n) n.hidden = sec.items.some(it => !$('row-' + it.k).hidden); });
    $('lb-cyl').textContent = P.layout === 'rotary' ? I.it.cyl.l2 : I.it.cyl.l;
  }

  // ---------- sound strip (the most-used sound choices, kept in view) ----------
  function buildSoundBar() {
    const mk = (id, key, opts) => {
      const g = $(id); g.innerHTML = '';
      opts.forEach(o => { const b = document.createElement('button'); b.type = 'button'; b.dataset.v = o; b.textContent = I.it[key].o[o]; b.addEventListener('click', () => setParam(key, o)); g.appendChild(b); });
    };
    mk('sbMic', 'mic', MICS); mk('sbEnv', 'env', ENVS);
    $('sbMicL').textContent = I.it.mic.l; $('sbEnvL').textContent = I.it.env.l; $('sbWetL').textContent = I.it.wet.l;
  }
  function syncSoundBar() {
    $('sbMic').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === P.mic));
    $('sbEnv').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === P.env));
    $('sbMicD').textContent = I.it.mic.od[P.mic]; $('sbEnvD').textContent = I.it.env.od[P.env];
    $('sbWet').value = P.wet; $('sbWet').style.setProperty('--pct', P.wet * 100 + '%'); $('sbWetO').textContent = pct(P.wet);
  }
  $('sbWet').addEventListener('input', e => setParam('wet', parseFloat(e.target.value)));

  function normalize() {
    if (P.layout === 'rotary') P.cyl = cl(P.cyl, 1, 4);
    if (P.layout === 'flat' && P.cyl % 2) P.cyl = Math.max(2, P.cyl - 1);
    if (P.idle > P.redline * 0.6) P.idle = Math.round(P.redline * 0.6 / 50) * 50;
  }

  function setParam(k, v) {
    P[k] = v;
    if (k === 'exhaust' && v !== 'custom') Object.keys(EXH[v]).forEach(x => { if (x !== 'l') P[x] = EXH[v][x]; });
    if (ITEMS[k] && ITEMS[k].ex) P.exhaust = 'custom';
    normalize();
    if (!SOUND_KEYS.includes(k)) presetId = null;
    applyConfig(k);
  }

  function applyConfig(changed) {
    L = C.buildLayout(P); M = C.engineModel(P);
    syncRail(); syncSoundBar(); renderPlate();
    if (!$('gov').hidden && gTab === 'engines') renderGarage();
    if (node) node.port.postMessage({ type: 'params', p: P });
    if (ctx && (changed === undefined || changed === 'env')) setEnv();
    if (ctx) { nodes.wet.gain.value = ENV_IR[P.env].wet * P.wet * 2; nodes.dry.gain.value = ENV_IR[P.env].dry; nodes.master.gain.value = P.volume * 2.2; }
    store('ronco.last.v3', { P, id: presetId });
  }

  // ---------- flags and body-type pictograms ----------
  const FLAGS = {
    jp: '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#bc002d"/>',
    it: '<rect width="10" height="20" fill="#009246"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ce2b37"/>',
    fr: '<rect width="10" height="20" fill="#0055a4"/><rect x="10" width="10" height="20" fill="#fff"/><rect x="20" width="10" height="20" fill="#ef4135"/>',
    de: '<rect width="30" height="7" fill="#000"/><rect y="6.6" width="30" height="6.8" fill="#dd0000"/><rect y="13.3" width="30" height="6.7" fill="#ffce00"/>',
    gb: '<rect width="30" height="20" fill="#012169"/><path d="M0 0L30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0L30 20M30 0L0 20" stroke="#c8102e" stroke-width="1.4"/><path d="M15 0V20M0 10H30" stroke="#fff" stroke-width="6"/><path d="M15 0V20M0 10H30" stroke="#c8102e" stroke-width="3.4"/>',
    us: '<rect width="30" height="20" fill="#fff"/>' + [0, 2, 4, 6, 8, 10, 12].map(i => `<rect y="${(i * 20 / 13).toFixed(2)}" width="30" height="${(20 / 13).toFixed(2)}" fill="#b22234"/>`).join('') + '<rect width="12" height="10.77" fill="#3c3b6e"/>' + [[2, 2], [5, 2], [8, 2], [3.5, 4.5], [6.5, 4.5], [2, 7], [5, 7], [8, 7], [3.5, 9]].map(([x, y]) => `<circle cx="${x + 0.6}" cy="${y}" r="0.55" fill="#fff"/>`).join(''),
    br: '<rect width="30" height="20" fill="#009c3b"/><path d="M15 2.6L27 10L15 17.4L3 10Z" fill="#ffdf00"/><circle cx="15" cy="10" r="4.4" fill="#002776"/><path d="M10.7 9.1Q15 7.9 19.4 10.5" stroke="#fff" stroke-width="0.8" fill="none"/>',
    int: [0, 1, 2, 3].map(r => [0, 1, 2, 3, 4, 5].map(c => `<rect x="${c * 5}" y="${r * 5}" width="5" height="5" fill="${(r + c) % 2 ? '#18191b' : '#fff'}"/>`).join('')).join(''),
  };
  const COUNTRY = {
    pt: { jp: 'Japão', it: 'Itália', fr: 'França', de: 'Alemanha', gb: 'Reino Unido', us: 'Estados Unidos', br: 'Brasil', int: 'Competição' },
    es: { jp: 'Japón', it: 'Italia', fr: 'Francia', de: 'Alemania', gb: 'Reino Unido', us: 'Estados Unidos', br: 'Brasil', int: 'Competición' },
    en: { jp: 'Japan', it: 'Italy', fr: 'France', de: 'Germany', gb: 'United Kingdom', us: 'United States', br: 'Brazil', int: 'Racing' },
  };
  const flagSVG = c => `<svg class="flag" viewBox="0 0 30 20" role="img" aria-label="${COUNTRY[lang][c]}"><title>${COUNTRY[lang][c]}</title>${FLAGS[c]}</svg>`;
  // Generic side-view silhouettes by body type (front to the right). Not drawings of specific models.
  const BODY = {
    super: { d: 'M5 31C5 27 9 25 18 24L40 20C50 13 60 11 70 12C80 13 88 17 96 21L110 25C114 26 115 28 115 32Z', w: [27, 95] },
    gt: { d: 'M5 31C5 26 8 24 14 23L30 22C36 15 44 12 54 12C62 12 68 15 74 20L104 23C112 24 115 27 115 32Z', w: [24, 96] },
    muscle: { d: 'M4 32V25C4 23 6 22 10 22L28 21C34 15 40 13 52 13C60 13 64 15 70 21L110 22C114 22 116 24 116 27V32Z', w: [24, 96] },
    hatch: { d: 'M6 32V22C6 18 8 14 14 13L44 11C52 11 58 15 64 20L106 23C112 24 114 27 114 32Z', w: [24, 94] },
    sedan: { d: 'M4 32V25C4 23 6 22 10 22L26 21C32 15 38 12 48 12H66C72 12 76 16 82 21L110 23C114 23 116 25 116 28V32Z', w: [24, 96] },
    roadster: { d: 'M6 32C6 26 9 24 16 24L50 23L56 15H58V22L104 23C111 24 114 27 114 32Z', w: [26, 94] },
    bubble: { d: 'M8 32C8 24 14 22 22 22C26 14 40 8 58 8C76 8 88 14 96 22C106 22 112 25 112 32Z', w: [26, 94] },
    proto: { d: 'M3 31C3 27 6 25 14 24L44 22C50 16 56 14 62 14C70 14 74 17 78 22L112 24C116 25 117 28 117 31ZM4 17H18V23H14V20H4Z', w: [22, 98] },
    f1: { d: 'M14 31L22 26L44 25L52 18H60L64 24L100 27L114 28V31ZM4 15H16V30H12V18H4ZM102 31H118V34H102Z', w: [22, 98], r: 8 },
    rally: { d: 'M5 32V24C5 21 8 20 12 20L30 19C36 13 42 11 54 11H62C68 11 72 14 78 20L108 22C113 23 115 26 115 32ZM4 14H22V17H4Z', w: [25, 95] },
    bike: { d: 'M30 31L46 19L60 17L74 12L86 14L92 22H80L70 26L50 28Z', w: [28, 92], r: 9 },
    cruiser: { d: 'M28 31L44 24L52 20H68L74 16H80L84 22L94 31L84 28H56ZM80 16L84 8H89', w: [26, 96], r: 9 },
  };
  function thumbSVG(body) {
    const b = BODY[body] || BODY.gt, r = b.r || 7;
    const wheels = b.w.map(x => `<circle cx="${x}" cy="${39 - r}" r="${r}" fill="${COL.ink}"/><circle cx="${x}" cy="${39 - r}" r="${r * 0.42}" fill="${COL.plate}"/>`).join('');
    return `<svg class="thumb" viewBox="0 0 120 42" aria-hidden="true"><line x1="0" y1="39.5" x2="120" y2="39.5" stroke="${COL.line2}"/><path d="${b.d}" fill="${COL.ink}" stroke="${COL.ink}" stroke-width="1.2" stroke-linejoin="round"/>${wheels}</svg>`;
  }
  const PH = window.RoncoPhotos || {};
  function photoHTML(id, alt, fallback) {
    const ph = PH[id];
    return ph ? `<img src="${ph.src}" alt="" loading="lazy" decoding="async">` : `<div class="noimg">${fallback || ''}</div>`;
  }
  const bodyOf = c => c.layout === 'rotary' ? 'gt' : c.cyl <= 2 && c.disp < 2 ? 'bike' : c.redline > 11000 ? 'f1' : c.cyl >= 10 ? 'super' : 'gt';

  // ---------- engine plate ----------
  const allPresets = () => PRESETS.map(p => ({ ...p, mine: false })).concat(customs.map(p => ({ ...p, cat: 'mine', mine: true })));
  function layoutTag(p) {
    if (p.layout === 'rotary') return p.cyl + ' ' + I.w.rotor[p.cyl > 1 ? 1 : 0];
    if (p.layout === 'flat') return I.lay.flat + ' ' + p.cyl;
    const t = { inline: 'I', v: 'V', w: 'W' }[p.layout] + p.cyl;
    return p.layout === 'v' ? t + ' ' + p.vAngle + '°' : t;
  }
  function renderPlate() {
    const pr = allPresets().find(p => p.id === presetId);
    const flag = pr && pr.flag;
    const ph = pr && PH[pr.id];
    $('plPhoto').innerHTML = photoHTML(pr && pr.id, '', layoutTag(P));
    if (ph) { const a = document.createElement('a'); a.className = 'credit'; a.href = ph.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '© ' + ph.artist + ' · ' + ph.license; $('plPhoto').appendChild(a); }
    $('plEyebrow').innerHTML = (flag ? flagSVG(flag) : '') + `<span></span>`;
    $('plEyebrow').lastChild.textContent = pr ? [flag ? COUNTRY[lang][flag] : null, ['race', 'moto', 'mine'].includes(pr.cat) ? I.cats[pr.cat] : null].filter(Boolean).join(' · ') : I.ui.custom;
    const h = pr && RoncoHistory[pr.id];
    const st = $('plStory');
    $('btnStory').hidden = !h;
    if (!h) { st.hidden = true; $('btnStory').setAttribute('aria-expanded', 'false'); }
    else { st.textContent = h.y + ' — ' + h[lang]; const b = document.createElement('button'); b.type = 'button'; b.textContent = I.ui.allStories; b.addEventListener('click', () => openGarage('history')); st.appendChild(b); }
    $('plName').textContent = pr ? tx(pr.n) : I.ui.custom;
    $('plCode').textContent = pr ? locE(tx(pr.e)) : I.ui.customDesc;
    const chips = [layoutTag(P), nf1.format(P.disp) + ' L', nf0.format(P.redline) + ' rpm', I.ind[P.induction], I.it.intake.o[P.intake], P.vtec && P.layout !== 'rotary' ? 'VTEC' : null, I.ui.order + ' ' + L.order].filter(Boolean);
    $('plChips').innerHTML = chips.map(c => `<span>${c}</span>`).join('');
    $('plPow').innerHTML = `${nf0.format(M.pk.P)}<small>${I.ui.powUnit}</small>`;
    $('plPowR').textContent = '@ ' + nf0.format(Math.round(M.pk.Pr / 50) * 50) + ' rpm';
    $('plTq').innerHTML = `${nf0.format(M.pk.T)}<small>N·m</small>`;
    $('plTqR').textContent = '@ ' + nf0.format(Math.round(M.pk.Tr / 50) * 50) + ' rpm';
    $('garageTxt').textContent = `${I.ui.garage} · ${allPresets().length} ${I.ui.engines}`;
    const ints = [...new Set(L.intervals)];
    $('engMeta').textContent = `${I.ui.intervals} ${ints.length > 3 ? '…' : ints.join('/') + '°'}`;
    $('dynoMeta').textContent = `${nf0.format(M.pk.P)} ${I.ui.powUnit} · ${nf0.format(M.pk.T)} N·m`;
  }

  // ---------- garage ----------
  function cardSpec(p) {
    const c = p.mine ? Object.assign({}, DEF, p.p) : presetConfig(p);
    return { body: bodyOf(c), tag: layoutTag(c), disp: nf1.format(c.disp) + ' L', red: nf0.format(c.redline), pow: nf0.format(C.engineModel(c).pk.P) };
  }
  const specCache = {};
  function renderGarage() {
    const cats = ['all', 'jp', 'eu', 'us', 'br', 'race', 'moto'].concat(customs.length ? ['mine'] : []);
    const all = allPresets();
    $('gCats').innerHTML = cats.map(c => `<button type="button" data-c="${c}" class="${c === gCat ? 'on' : ''}">${I.cats[c]}<small>${c === 'all' ? all.length : all.filter(p => p.cat === c).length}</small></button>`).join('');
    const q = $('gSearch').value.trim().toLowerCase();
    const list = all.filter(p => (gCat === 'all' || p.cat === gCat) && (!q || (tx(p.n) + ' ' + tx(p.e) + ' ' + I.cats[p.cat]).toLowerCase().includes(q)));
    const g = $('gGrid');
    g.innerHTML = '';
    if (!list.length) { g.innerHTML = `<div class="gempty">${I.ui.none}</div>`; return; }
    list.forEach(p => {
      const key = p.id + lang;
      const sp = specCache[key] || (specCache[key] = cardSpec(p));
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'gcard' + (p.id === presetId ? ' on' : '') + (p.mine ? ' mine' : '');
      b.innerHTML = `<span class="ph16">${photoHTML(p.mine ? null : p.id, '', sp.tag)}</span><span class="top2"><span class="ct">${I.cats[p.cat]}</span>${p.flag ? flagSVG(p.flag) : ''}</span><b></b><span class="cc"></span><span class="cs"><span>${sp.tag}</span><span>${sp.disp}</span><span>${sp.red} rpm</span><em>${sp.pow} ${I.ui.powUnit}</em></span>`;
      b.querySelector('b').textContent = tx(p.n);
      b.querySelector('.cc').textContent = locE(tx(p.e));
      b.addEventListener('click', () => { loadPreset(p); closeGarage(); });
      if (p.mine) {
        const x = document.createElement('span');
        x.className = 'del'; x.textContent = I.ui.del;
        x.addEventListener('click', e => { e.stopPropagation(); customs = customs.filter(c => c.id !== p.id); store('ronco.custom', customs); if (gCat === 'mine' && !customs.length) gCat = 'all'; renderGarage(); renderPlate(); });
        b.appendChild(x);
      }
      g.appendChild(b);
    });
  }
  let gTab = 'engines';
  function setTab(t) {
    gTab = t;
    $('gTabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === t));
    const hist = t === 'history';
    $('gTools').hidden = hist; $('gGrid').hidden = hist; $('gSave').hidden = hist;
    $('hTools').hidden = !hist; $('hList').hidden = !hist;
    if (hist) renderHistory(); else renderGarage();
  }
  function renderHistory() {
    const list = PRESETS.filter(p => RoncoHistory[p.id]).sort((a, b) => RoncoHistory[a.id].y - RoncoHistory[b.id].y);
    const box = $('hList');
    box.innerHTML = '';
    list.forEach(p => {
      const h = RoncoHistory[p.id];
      const it = document.createElement('article');
      it.className = 'hitem';
      it.innerHTML = `<div class="yr">${h.y}</div><div class="ph16">${photoHTML(p.id, '', '')}</div><div><h3>${flagSVG(p.flag)}<span></span><small></small></h3><p></p></div><button type="button" class="btn">${I.ui.load}</button>`;
      it.querySelector('h3 span').textContent = tx(p.n);
      it.querySelector('h3 small').textContent = locE(tx(p.e));
      it.querySelector('p').textContent = h[lang];
      it.querySelector('.btn').addEventListener('click', () => { loadPreset(p); closeGarage(); });
      box.appendChild(it);
    });
  }
  function openGarage(tab) { $('gov').hidden = false; setTab(tab === 'history' ? 'history' : 'engines'); if (gTab === 'engines') $('gSearch').focus(); }
  $('gTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.v); });
  function closeGarage() { $('gov').hidden = true; $('btnGarage').focus(); }
  $('btnGarage').addEventListener('click', () => openGarage());
  $('gClose').addEventListener('click', closeGarage);
  $('gov').addEventListener('click', e => { if (e.target === $('gov')) closeGarage(); });
  $('gSearch').addEventListener('input', renderGarage);
  $('gCats').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { gCat = b.dataset.c; renderGarage(); } });
  $('gSave').addEventListener('submit', e => {
    e.preventDefault();
    const n = $('saveName').value.trim();
    if (!n) { $('saveName').focus(); return; }
    const id = 'c' + Date.now();
    customs.push({ id, n, e: `${layoutTag(P)} · ${nf1.format(P.disp)} L`, p: Object.assign({}, P) });
    store('ronco.custom', customs);
    presetId = id; $('saveName').value = ''; gCat = 'mine';
    renderGarage(); renderPlate(); store('ronco.last.v3', { P, id: presetId });
  });

  function loadPreset(pr) {
    const keep = {}; SOUND_KEYS.forEach(k => (keep[k] = P[k]));
    P = Object.assign(pr.mine ? Object.assign({}, DEF, pr.p) : presetConfig(pr), keep);
    presetId = pr.id;
    normalize();
    applyConfig();
  }
  function stepPreset(d) {
    const all = allPresets();
    const i = all.findIndex(p => p.id === presetId);
    loadPreset(all[((i < 0 ? (d > 0 ? -1 : 0) : i) + d + all.length) % all.length]);
  }
  $('btnStory').addEventListener('click', () => {
    const st = $('plStory'); st.hidden = !st.hidden;
    $('btnStory').setAttribute('aria-expanded', String(!st.hidden));
  });
  $('btnPrev').addEventListener('click', () => stepPreset(-1));
  $('btnNext').addEventListener('click', () => stepPreset(1));

  function randomEngine() {
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const rr = (a, b) => a + Math.random() * (b - a);
    const layout = pick(['inline', 'inline', 'v', 'v', 'v', 'flat', 'w', 'rotary']);
    const cyl = { inline: pick([1, 3, 4, 4, 5, 6, 6]), v: pick([2, 6, 8, 8, 10, 12]), flat: pick([2, 4, 6, 6]), w: pick([12, 16]), rotary: pick([2, 3, 4]) }[layout];
    const ext = pick(Object.keys(EXH).filter(k => k !== 'custom' && k !== 'expansion'));
    const ind = pick(['na', 'na', 'na', 'turbo', 'twin', 'roots', 'centri']);
    const redline = layout === 'rotary' ? Math.round(rr(7500, 9800) / 100) * 100 : Math.round(rr(5500, cyl <= 4 ? 10500 : 9500) / 100) * 100;
    P = Object.assign({}, DEF, EXH[ext], {
      exhaust: ext, layout, cyl, vAngle: pick([60, 65, 72, 90, 90, 120]),
      crank: cyl === 8 ? pick(['even', 'cross', 'cross']) : pick(['even', 'even', 'even', 'bigbang']),
      disp: Math.round((layout === 'rotary' ? cyl * 0.65 : cyl * rr(0.3, 0.7)) * 20) / 20,
      valves: pick([2, 4, 4, 5]), cam: Math.round(rr(0.1, 0.95) * 100) / 100,
      vtec: Math.random() < 0.25 && layout !== 'rotary', vtecRpm: Math.round(redline * 0.65 / 100) * 100,
      idle: Math.round(rr(700, 1100) / 50) * 50, redline, flywheel: Math.round(rr(0.3, 1.5) * 20) / 20,
      intake: pick(['airbox', 'cai', 'itb']), intakeVol: rr(0.3, 0.85), induction: ind, boost: rr(0.6, 1.8),
      turboSize: rr(0.2, 0.8), bov: pick(['bov', 'flutter', 'recirc']), als: (ind === 'turbo' || ind === 'twin') && Math.random() < 0.15,
      routing: pick(['merged', 'dual', 'xpipe']), unequal: Math.random() < 0.3 ? rr(0.4, 1) : 0, pops: rr(0, 0.7), rough: rr(0.1, 0.5),
      mic: P.mic, env: P.env, wet: P.wet, volume: P.volume, drive: P.drive, width: P.width,
    });
    delete P.l;
    presetId = null; normalize(); applyConfig();
  }

  // ---------- static text ----------
  function applyLang() {
    document.querySelectorAll('[data-i]').forEach(el => (el.textContent = I.ui[el.dataset.i]));
    $('segLang').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === lang));
    $('gSearch').placeholder = I.ui.search;
    $('saveName').placeholder = I.ui.saveName;
    $('gClose').setAttribute('aria-label', I.ui.close);
    $('btnPrev').setAttribute('aria-label', I.ui.prev); $('btnPrev').title = I.ui.prev;
    $('btnNext').setAttribute('aria-label', I.ui.next); $('btnNext').title = I.ui.next;
    $('slowSel').setAttribute('aria-label', I.ui.slowLabel);
    $('segLang').setAttribute('aria-label', I.ui.lang);
    $('pedal').setAttribute('aria-label', I.ui.pedal);
    $('tPowU').textContent = I.ui.powUnit;
    $('keys').innerHTML = I.keys.map(([k, t]) => `<span>${k.split(' ').map(x => `<kbd>${x}</kbd>`).join('')}${t}</span>`).join('') + '<span class="err" id="err"></span>';
    setStatus();
    buildRail(); syncRail(); buildSoundBar(); syncSoundBar(); renderPlate();
    if (!$('gov').hidden) setTab(gTab);
  }
  $('segLang').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setLang(b.dataset.v); applyLang(); } });

  let toastT = 0;
  function setStatus(msg) {
    const st = $('status');
    clearTimeout(toastT);
    if (msg) { st.textContent = msg; st.classList.add('toast'); toastT = setTimeout(() => setStatus(), 6000); return; }
    st.classList.remove('toast');
    st.innerHTML = '<svg width="12" height="18" viewBox="0 0 12 18" fill="none" stroke="currentColor"><rect x="1" y="1" width="10" height="16" rx="5"/><line x1="6" y1="4" x2="6" y2="8"/></svg>';
    st.appendChild(document.createTextNode(I.ui.wheelHint));
  }
  const showErr = m => { $('err').textContent = m; };

  // ---------- audio ----------
  // Room models: early reflections [delay s, gain], two-band diffuse tail (rt60 low/high), optional flutter echo.
  const ENV_IR = {
    open: { len: 0.6, rtL: 0.35, rtH: 0.12, pre: 0.004, early: [[0.012, 0.35], [0.041, 0.12]], wet: 0.12, dry: 1 },
    city: { len: 1.8, rtL: 1.3, rtH: 0.55, pre: 0.008, early: [[0.021, 0.45], [0.037, 0.32], [0.058, 0.38], [0.083, 0.22], [0.12, 0.18], [0.17, 0.1]], wet: 0.32, dry: 0.95 },
    track: { len: 2.6, rtL: 1.6, rtH: 0.6, pre: 0.01, early: [[0.11, 0.42], [0.135, 0.3], [0.2, 0.16], [0.32, 0.08]], wet: 0.3, dry: 0.95 },
    parking: { len: 3.2, rtL: 2.6, rtH: 1.7, pre: 0.006, early: [[0.009, 0.5], [0.017, 0.45], [0.026, 0.4], [0.034, 0.36], [0.049, 0.3]], wet: 0.55, dry: 0.85 },
    garage: { len: 1.4, rtL: 0.9, rtH: 0.6, pre: 0.003, early: [[0.005, 0.6], [0.011, 0.5], [0.017, 0.45], [0.026, 0.35]], wet: 0.45, dry: 0.9 },
    tunnel: { len: 4.5, rtL: 3.6, rtH: 1.4, pre: 0.012, early: [[0.018, 0.55]], flutter: 0.038, wet: 0.65, dry: 0.8 },
    canyon: { len: 4.2, rtL: 2.2, rtH: 0.7, pre: 0.02, early: [[0.36, 0.5], [0.74, 0.34], [1.18, 0.22], [1.72, 0.13], [2.35, 0.07]], smear: 0.03, wet: 0.42, dry: 0.95 },
  };
  function makeIR(env) {
    const sr = ctx.sampleRate, cfg = ENV_IR[env];
    const n = Math.floor(cfg.len * sr), buf = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lo = 0, prev = 0;
      const p0 = Math.floor(cfg.pre * sr);
      for (let i = p0; i < n; i++) {
        const t = (i - p0) / sr, w = Math.random() * 2 - 1;
        lo += 0.06 * (w - lo);
        const hi = w - prev; prev = w;
        const fade = Math.min(1, t / 0.02);
        d[i] = (lo * 2.2 * Math.exp(-6.9 * t / cfg.rtL) + hi * 0.35 * Math.exp(-6.9 * t / cfg.rtH)) * fade * 0.5;
        if (cfg.flutter && (i - p0) % Math.floor(cfg.flutter * sr * (ch ? 1.03 : 1)) === 0) d[i] += 0.45 * Math.exp(-6.9 * t / cfg.rtL);
      }
      cfg.early.forEach(([dt, a]) => {
        const s0 = Math.floor(dt * sr * (ch ? 1.035 : 1)), w = Math.max(8, Math.floor((cfg.smear || 0.0015) * sr));
        for (let k = 0; k < w && s0 + k < n; k++) d[s0 + k] += a * (Math.random() * 2 - 1) * Math.exp(-k / (w * 0.3));
      });
    }
    return buf;
  }
  function setEnv() { nodes.conv.buffer = makeIR(P.env); }

  // Mobile browsers only allow audio started synchronously inside the tap; iOS also needs the
  // "playback" session so the silent switch does not mute the page.
  let acPending = null;
  function unlockAudio() {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    if (!acPending) acPending = new AudioContext({ latencyHint: 'interactive' });
    acPending.resume();
    const src = acPending.createBufferSource();
    src.buffer = acPending.createBuffer(1, 1, acPending.sampleRate);
    src.connect(acPending.destination); src.start(0);
  }
  async function initAudio() {
    const ac = acPending;
    await ac.audioWorklet.addModule('engine-core.js');
    await ac.audioWorklet.addModule('engine-worklet.js');
    ctx = ac;
    node = new AudioWorkletNode(ctx, 'engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.port.onmessage = e => { if (e.data.type === 'state') Object.assign(S, e.data); };
    node.onprocessorerror = () => showErr(I.ui.procErr);
    const dry = ctx.createGain(), conv = ctx.createConvolver(), wet = ctx.createGain(), comp = ctx.createDynamicsCompressor(), master = ctx.createGain(), an = ctx.createAnalyser();
    comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    an.fftSize = 4096; an.smoothingTimeConstant = 0.55;
    node.connect(dry); node.connect(conv); conv.connect(wet); dry.connect(comp); wet.connect(comp); comp.connect(master); master.connect(an); an.connect(ctx.destination);
    nodes = { dry, conv, wet, comp, master, an, td: new Float32Array(2048), fd: new Float32Array(an.frequencyBinCount) };
    applyConfig();
    sentThr = -1;
  }
  async function ensureAudio() {
    try {
      if (!ctx) await initAudio();
      if (ctx.state === 'suspended') await ctx.resume();
    } catch (e) { showErr(I.ui.audioErr + e.message); throw e; }
  }
  async function power() {
    unlockAudio();
    await ensureAudio();
    node.port.postMessage({ type: S.state === 'off' ? 'start' : 'stop' });
  }
  async function startIfOff() {
    await ensureAudio();
    if (S.state === 'off') node.port.postMessage({ type: 'start' });
  }
  const send = m => { if (node) node.port.postMessage(m); };

  // ---------- gyroscope: tilt forward = throttle, twist sideways = shift, shake = blip ----------
  function onOri(e) {
    if (e.beta == null) return;
    gyro.got = true;
    if (!gyro.base) gyro.base = { b: e.beta, g: e.gamma };
    thrUser = cl((gyro.base.b - e.beta) / 35, 0, 1);
    lastWheel = performance.now();
    const dg = e.gamma - gyro.base.g;
    if (gyro.armed && Math.abs(dg) > 28) { send({ type: 'shift', dir: dg > 0 ? 1 : -1 }); gyro.armed = false; }
    else if (Math.abs(dg) < 12) gyro.armed = true;
  }
  function onMot(e) {
    const a = e.acceleration;
    if (!a || a.x == null) return;
    const m = Math.hypot(a.x, a.y, a.z), now = performance.now();
    if (m > 16 && now - gyro.lastBlip > 450) { send({ type: 'blip' }); gyro.lastBlip = now; }
  }
  function gyroOff() {
    gyro.on = false;
    window.removeEventListener('deviceorientation', onOri);
    window.removeEventListener('devicemotion', onMot);
    $('btnGyro').classList.remove('on');
  }
  async function toggleGyro() {
    if (gyro.on) { gyroOff(); thrUser = 0; setStatus(); return; }
    unlockAudio();
    const DO = window.DeviceOrientationEvent, DM = window.DeviceMotionEvent;
    if (DO && typeof DO.requestPermission === 'function') {
      const r = await DO.requestPermission().catch(() => 'error');
      if (r !== 'granted') { setStatus(r === 'denied' ? I.ui.gyroDenied + ' ' + I.ui.gyroNone : I.ui.gyroNone); return; }
      if (DM && typeof DM.requestPermission === 'function') await DM.requestPermission().catch(() => 'denied');
    }
    await startIfOff();
    Object.assign(gyro, { on: true, got: false, base: null, armed: true });
    window.addEventListener('deviceorientation', onOri);
    window.addEventListener('devicemotion', onMot);
    $('btnGyro').classList.add('on');
    setStatus(I.ui.gyroCal);
    setTimeout(() => {
      if (!gyro.on) return;
      if (gyro.got) setStatus(I.ui.gyroOn);
      else { gyroOff(); setStatus(I.ui.gyroNone); }
    }, 1600);
  }

  // ---------- input ----------
  function onWheel(e) { e.preventDefault(); thrUser = cl(thrUser - e.deltaY * (e.deltaMode === 1 ? 0.045 : 0.0011), 0, 1); lastWheel = performance.now(); }
  $('stage').addEventListener('wheel', onWheel, { passive: false });
  $('eng').addEventListener('wheel', onWheel, { passive: false });

  const pedal = $('pedal');
  function pedalAt(e) { const r = pedal.querySelector('.track').getBoundingClientRect(); thrUser = cl(1 - (e.clientY - r.top) / r.height, 0, 1); lastWheel = performance.now(); }
  pedal.addEventListener('pointerdown', e => { pedalDrag = true; pedal.setPointerCapture(e.pointerId); pedalAt(e); });
  pedal.addEventListener('pointermove', e => { if (pedalDrag) pedalAt(e); });
  pedal.addEventListener('pointerup', () => { pedalDrag = false; });
  pedal.addEventListener('pointercancel', () => { pedalDrag = false; });

  $('btnPower').addEventListener('click', power);
  $('btnStart').addEventListener('click', power);
  $('btnGyro').addEventListener('click', toggleGyro);
  $('btnFly').addEventListener('click', () => send({ type: 'flyby' }));
  $('btnRand').addEventListener('click', randomEngine);
  $('segDrive').addEventListener('click', e => { const b = e.target.closest('button'); if (b) send({ type: 'drive', on: b.dataset.v === 'd' }); });
  $('segThr').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    thrMode = b.dataset.v;
    $('segThr').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
  $('slowSel').addEventListener('change', e => (slow = parseFloat(e.target.value)));

  const held = new Set();
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (e.key === 'Escape' && !$('gov').hidden) { closeGarage(); return; }
    if (t.tagName === 'INPUT' && (t.type === 'text' || t.type === 'search')) return;
    if ((t.tagName === 'INPUT' || t.tagName === 'SELECT') && e.key.startsWith('Arrow')) return;
    if (e.metaKey || e.ctrlKey || e.altKey || !$('gov').hidden) return;
    const k = e.key.toLowerCase();
    if (e.repeat && held.has(k)) { if (k === ' ' || k === 'w' || k === 'arrowup') e.preventDefault(); return; }
    let used = true;
    if (k === ' ' || k === 'w' || k === 'arrowup') fullHeld = true;
    else if (k >= '0' && k <= '9') { thrUser = k === '0' ? 1 : parseInt(k, 10) / 10; lastWheel = performance.now(); }
    else if (k === 'b') send({ type: 'blip' });
    else if (k === 'e' || k === 'arrowright') send({ type: 'shift', dir: 1 });
    else if (k === 'q' || k === 'arrowleft') send({ type: 'shift', dir: -1 });
    else if (k === 'd') send({ type: 'drive', on: !S.drive });
    else if (k === 's' || k === 'arrowdown') send({ type: 'brake', v: 1 });
    else if (k === 'l') send({ type: 'launch', on: true });
    else if (k === 'f') send({ type: 'flyby' });
    else if (k === 'i') power();
    else if (k === 'r') randomEngine();
    else if (k === 'g') openGarage();
    else if (k === '[') stepPreset(-1);
    else if (k === ']') stepPreset(1);
    else used = false;
    if (used) { held.add(k); e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    held.delete(k);
    if (k === ' ' || k === 'w' || k === 'arrowup') { fullHeld = false; e.preventDefault(); }
    else if (k === 's' || k === 'arrowdown') send({ type: 'brake', v: 0 });
    else if (k === 'l') send({ type: 'launch', on: false });
  });
  window.addEventListener('blur', () => { fullHeld = false; send({ type: 'brake', v: 0 }); send({ type: 'launch', on: false }); });

  // ---------- canvases ----------
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  function fit(c) {
    const w = c.clientWidth, h = c.clientHeight, r = dpr();
    if (c.width !== Math.round(w * r) || c.height !== Math.round(h * r)) { c.width = Math.round(w * r); c.height = Math.round(h * r); }
    const g = c.getContext('2d');
    g.setTransform(r, 0, 0, r, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  const tachC = $('tach'), engC = $('eng'), scopeC = $('scope'), specC = $('spec'), dynoC = $('dyno');
  const leds = $('leds');
  for (let i = 0; i < 12; i++) leds.appendChild(document.createElement('i'));
  const ledEls = [...leds.children];

  function drawTach(now) {
    const { g, w, h } = fit(tachC);
    const cx = w / 2, cy = h * 0.52, R = Math.max(40, Math.min(w * 0.46, h * 0.47));
    const mx = Math.ceil(P.redline * 1.1 / 1000) * 1000, A0 = Math.PI * 0.75, SW = Math.PI * 1.5;
    const ang = v => A0 + SW * cl(v / mx, 0, 1);
    g.lineCap = 'butt';
    g.lineWidth = R * 0.08; g.strokeStyle = COL.line;
    g.beginPath(); g.arc(cx, cy, R * 0.93, A0, A0 + SW); g.stroke();
    g.strokeStyle = COL.red; g.globalAlpha = 0.55;
    g.beginPath(); g.arc(cx, cy, R * 0.93, ang(P.redline), A0 + SW); g.stroke();
    g.globalAlpha = 1;
    const a = ang(dispRpm);
    g.strokeStyle = dispRpm > P.redline * 0.97 ? COL.red : COL.ink;
    g.beginPath(); g.arc(cx, cy, R * 0.93, A0, a); g.stroke();
    const major = mx > 12000 ? 2000 : 1000, minor = major / 4;
    g.font = `600 ${Math.round(R * 0.13)}px ${FONT.disp}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let v = 0; v <= mx + 1; v += minor) {
      const t = ang(v), isM = v % major === 0;
      const r0 = R * (isM ? 0.74 : 0.8), r1 = R * 0.86;
      g.strokeStyle = v >= P.redline ? COL.red : isM ? COL.ink : COL.faint;
      g.lineWidth = isM ? 2 : 1;
      g.beginPath(); g.moveTo(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0); g.lineTo(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1); g.stroke();
      if (isM) { g.fillStyle = v >= P.redline ? COL.red : COL.dim; g.fillText(String(v / 1000), cx + Math.cos(t) * R * 0.6, cy + Math.sin(t) * R * 0.6); }
    }
    g.strokeStyle = COL.red; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3); g.lineTo(cx + Math.cos(a) * R * 0.99, cy + Math.sin(a) * R * 0.99); g.stroke();
    g.lineCap = 'butt';
    g.fillStyle = COL.plate; g.beginPath(); g.arc(cx, cy, R * 0.3, 0, Math.PI * 2); g.fill();
    g.strokeStyle = COL.line2; g.lineWidth = 1; g.stroke();
    g.fillStyle = S.cut ? COL.red : COL.ink;
    g.font = `800 ${Math.round(R * 0.36)}px ${FONT.disp}`;
    g.fillText(S.drive ? String(S.gear) : 'N', cx, cy - R * 0.02);
    g.font = `600 ${Math.round(R * 0.085)}px ${FONT.mono}`; g.fillStyle = COL.dim;
    g.fillText(nf0.format(Math.round(dispRpm / 10) * 10) + ' rpm', cx, cy + R * 0.42);
    g.font = `700 ${Math.round(R * 0.16)}px ${FONT.disp}`; g.fillStyle = COL.ink;
    g.fillText(nf0.format(S.v * 3.6), cx, cy + R * 0.6);
    g.font = `500 ${Math.round(R * 0.07)}px ${FONT.body}`; g.fillStyle = COL.faint;
    g.fillText('km/h', cx, cy + R * 0.73);
    g.font = `600 ${Math.round(R * 0.07)}px ${FONT.mono}`;
    g.fillText('×1000 rpm', cx, cy - R * 0.41);
    if (popFlash > 0) { g.fillStyle = `rgba(255,140,40,${popFlash * 0.5})`; g.beginPath(); g.arc(cx, cy, R * 0.28, 0, Math.PI * 2); g.fill(); }
    const lo = P.redline * 0.72, lit = cl((dispRpm - lo) / (P.redline * 0.97 - lo) * 12, 0, 12);
    const blink = S.cut && Math.floor(now / 70) % 2;
    ledEls.forEach((el, i) => { el.className = blink ? 'b' : i < lit ? (i < 4 ? 'g' : i < 8 ? 'a' : 'r') : ''; });
  }

  function drawEngine() {
    const { g, w, h } = fit(engC);
    const rot = L.rotary, revs = L.cycleRevs, two = !rot && P.strokes === 2;
    const clockR = Math.min(h * 0.2, w * 0.17);
    const topH = h - clockR * 2 - 26;
    const B = L.B, Mx = L.M;
    const rowH = Math.min(topH / B, 120);
    const cw = Math.min(46, (w - 24) / Mx);
    const x0 = (w - cw * Mx) / 2;
    const y00 = (topH - rowH * B) / 2 + 6;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    L.cyl.forEach(c => {
      const lp = ((vizPh - c.off) % 1 + 1) % 1;
      const th = lp * revs * Math.PI * 2;
      const x = x0 + c.pos * cw + cw * 0.15, bw = cw * 0.7, y = y00 + c.bank * rowH, hh = rowH * 0.86;
      const col = BANKC[c.bank % 4];
      g.font = `600 10px ${FONT.mono}`;
      if (rot) {
        const cx = x + bw / 2, cy = y + hh / 2, rr = Math.min(bw, hh) * 0.48;
        g.strokeStyle = COL.line2; g.lineWidth = 1.5;
        g.beginPath(); g.ellipse(cx, cy, rr, rr * 0.78, 0, 0, Math.PI * 2); g.stroke();
        const fl = lp < 0.3 ? 1 - lp / 0.3 : 0;
        g.fillStyle = fl > 0 ? `rgba(255,${120 + 100 * fl | 0},40,${0.25 + 0.6 * fl})` : COL.panel2;
        g.beginPath();
        for (let k = 0; k < 3; k++) { const an = th / 3 + k * Math.PI * 2 / 3; const px = cx + Math.cos(an) * rr * 0.68, py = cy + Math.sin(an) * rr * 0.55; k ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.closePath(); g.fill(); g.strokeStyle = col; g.stroke();
        g.fillStyle = COL.dim; g.fillText(c.num, cx, y + hh + 1);
        return;
      }
      const top = y + 4, bore = hh * 0.56, pisH = hh * 0.13;
      const pos = (1 - Math.cos(th)) / 2;
      const py = top + 3 + pos * (bore - pisH - 6);
      let fill = COL.panel2;
      const pw = two ? 0.35 : 0.25;
      if (lp < pw) { const f = 1 - lp / pw; fill = `rgba(255,${130 + 100 * f | 0},40,${0.2 + 0.7 * f})`; }
      else if (lp < (two ? 0.6 : 0.5)) fill = 'rgba(150,160,175,0.25)';
      else if (!two && lp < 0.75) fill = rgba(COL.acc, 0.16);
      g.fillStyle = fill; g.fillRect(x, top, bw, py - top);
      g.strokeStyle = COL.line2; g.lineWidth = 1; g.strokeRect(x + 0.5, top + 0.5, bw - 1, bore);
      g.fillStyle = col; g.fillRect(x + 1.5, py, bw - 3, pisH);
      const crY = top + bore + hh * 0.17, crR = hh * 0.08;
      const pinX = x + bw / 2 + Math.sin(th) * crR, pinY = crY - Math.cos(th) * crR;
      g.strokeStyle = COL.dim; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x + bw / 2, py + pisH); g.lineTo(pinX, pinY); g.stroke();
      g.fillStyle = COL.faint; g.beginPath(); g.arc(pinX, pinY, 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = COL.dim; g.fillText(c.num, x + bw / 2, top + bore + hh * 0.42);
    });
    const cx = clockR + 18, cy = h - clockR - 12;
    g.strokeStyle = COL.line2; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, clockR, 0, Math.PI * 2); g.stroke();
    for (let d = 0; d < L.cycleDeg; d += 90) {
      const t = d / L.cycleDeg * Math.PI * 2 - Math.PI / 2;
      g.beginPath(); g.moveTo(cx + Math.cos(t) * clockR * 0.9, cy + Math.sin(t) * clockR * 0.9); g.lineTo(cx + Math.cos(t) * clockR, cy + Math.sin(t) * clockR); g.stroke();
    }
    g.textBaseline = 'middle';
    L.cyl.forEach(c => {
      const t = c.off * Math.PI * 2 - Math.PI / 2;
      const lp = ((vizPh - c.off) % 1 + 1) % 1, hot = lp < 0.06;
      g.fillStyle = hot ? COL.red : BANKC[c.bank % 4];
      g.beginPath(); g.arc(cx + Math.cos(t) * clockR, cy + Math.sin(t) * clockR, hot ? 5 : 3.5, 0, Math.PI * 2); g.fill();
      if (L.cyl.length <= 12) { g.fillStyle = COL.dim; g.font = `500 9px ${FONT.mono}`; g.fillText(c.num, cx + Math.cos(t) * (clockR + 10), cy + Math.sin(t) * (clockR + 10)); }
    });
    const ht = vizPh * Math.PI * 2 - Math.PI / 2;
    g.strokeStyle = COL.ink; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ht) * clockR * 0.85, cy + Math.sin(ht) * clockR * 0.85); g.stroke();
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    const tx0 = cx + clockR + 24, ty = cy - clockR;
    g.fillStyle = COL.faint; g.font = `600 10px ${FONT.body}`;
    g.fillText(I.ui.clock + ' · ' + L.cycleDeg + '°', tx0, ty + 10);
    g.fillStyle = COL.ink; g.font = `600 12px ${FONT.mono}`;
    g.fillText(L.order.length > 34 ? L.order.slice(0, 33) + '…' : L.order, tx0, ty + 28);
    const ints = [...new Set(L.intervals)];
    g.fillStyle = COL.dim; g.font = `500 11px ${FONT.mono}`;
    g.fillText(I.ui.intervals + ': ' + (ints.length > 4 ? L.intervals.slice(0, 6).join('/') + '…' : ints.join(' / ')) + '°', tx0, ty + 46);
    g.fillText(ints.length === 1 ? I.ui.even : I.ui.uneven, tx0, ty + 62);
    for (let b = 0; b < B && B > 1; b++) {
      g.fillStyle = BANKC[b]; g.fillRect(tx0 + b * 72, ty + 74, 8, 8);
      g.fillStyle = COL.dim; g.fillText(I.ui.bank + ' ' + 'ABCD'[b], tx0 + 12 + b * 72, ty + 82);
    }
  }

  function drawScope() {
    const { g, w, h } = fit(scopeC);
    g.strokeStyle = COL.line; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, h * i / 4); g.lineTo(w, h * i / 4); g.stroke(); }
    for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(w * i / 8, 0); g.lineTo(w * i / 8, h); g.stroke(); }
    if (!ctx) { g.fillStyle = COL.faint; g.font = `500 12px ${FONT.body}`; g.textAlign = 'left'; g.fillText(I.ui.scopeOff, 12, 20); return; }
    const d = nodes.td; nodes.an.getFloatTimeDomainData(d);
    let st = 0;
    for (let i = 1; i < 1024; i++) if (d[i - 1] < 0 && d[i] >= 0) { st = i; break; }
    const span = 1000;
    let pk = 0.05;
    for (let i = 0; i < span; i++) pk = Math.max(pk, Math.abs(d[st + i]));
    g.strokeStyle = COL.acc; g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i < span; i++) { const x = i / span * w, y = h / 2 - d[st + i] / pk * h * 0.42; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    g.fillStyle = COL.faint; g.font = `500 10px ${FONT.mono}`; g.textAlign = 'right';
    g.fillText(nf1.format(span / ctx.sampleRate * 1000) + ' ms', w - 6, h - 6);
  }

  function drawSpec() {
    const { g, w, h } = fit(specC);
    const f0 = 20, f1 = 16000, xf = f => Math.log(f / f0) / Math.log(f1 / f0) * w;
    g.strokeStyle = COL.line; g.lineWidth = 1; g.fillStyle = COL.faint; g.font = `500 10px ${FONT.mono}`; g.textAlign = 'left';
    [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach(f => { const x = xf(f); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); g.fillText(f >= 1000 ? f / 1000 + 'k' : f, x + 3, h - 5); });
    const ff = S.rpm / 60 / L.cycleRevs * P.cyl;
    $('specMeta').textContent = ff > 1 ? `${I.ui.fireHz} ${nf0.format(ff)} Hz` : '';
    if (ff > f0) {
      for (let k = 1; k <= 12; k++) {
        const f = ff * k; if (f > f1) break;
        g.strokeStyle = rgba(COL.amber, k === 1 ? 0.75 : 0.2);
        const x = xf(f); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      }
    }
    if (!ctx) return;
    const d = nodes.fd; nodes.an.getFloatFrequencyData(d);
    const sr = ctx.sampleRate, bins = d.length, y = db => h - cl((db + 110) / 100, 0, 1) * (h - 14);
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 2) {
      const f = f0 * Math.pow(f1 / f0, x / w), b = f / (sr / 2) * bins, bi = Math.floor(b);
      const v = bi + 1 < bins ? d[bi] + (d[bi + 1] - d[bi]) * (b - bi) : -120;
      g.lineTo(x, y(v));
    }
    g.lineTo(w, h); g.closePath();
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, rgba(COL.acc, 0.35)); grd.addColorStop(1, rgba(COL.acc, 0.03));
    g.fillStyle = grd; g.fill();
    g.strokeStyle = COL.acc; g.lineWidth = 1.2; g.stroke();
  }

  function drawDyno() {
    const { g, w, h } = fit(dynoC);
    const pl = 34, pr = 34, pt = 12, pb = 20, cw = w - pl - pr, ch = h - pt - pb;
    const r0 = M.curve[0][0], r1 = M.curve[M.curve.length - 1][0];
    const tMax = M.pk.T * 1.18, pMax = M.pk.P * 1.18;
    const X = r => pl + (r - r0) / (r1 - r0) * cw, YT = t => pt + ch - t / tMax * ch, YP = p => pt + ch - p / pMax * ch;
    g.strokeStyle = COL.line; g.lineWidth = 1; g.font = `500 10px ${FONT.mono}`; g.fillStyle = COL.faint; g.textAlign = 'center';
    const step = P.redline > 12000 ? 4000 : 2000;
    for (let r = Math.ceil(r0 / step) * step; r <= r1; r += step) { const x = X(r); g.beginPath(); g.moveTo(x, pt); g.lineTo(x, pt + ch); g.stroke(); g.fillText(r / 1000 + 'k', x, h - 6); }
    for (let i = 0; i <= 4; i++) {
      const y = pt + ch * i / 4;
      g.beginPath(); g.moveTo(pl, y); g.lineTo(pl + cw, y); g.stroke();
      g.textAlign = 'right'; g.fillStyle = COL.acc; g.fillText(nf0.format(tMax * (1 - i / 4)), pl - 4, y + 3);
      g.textAlign = 'left'; g.fillStyle = COL.amber; g.fillText(nf0.format(pMax * (1 - i / 4)), pl + cw + 4, y + 3);
    }
    if (P.vtec) { g.setLineDash([3, 3]); g.strokeStyle = COL.amber; const x = X(P.vtecRpm); g.beginPath(); g.moveTo(x, pt); g.lineTo(x, pt + ch); g.stroke(); g.setLineDash([]); }
    g.strokeStyle = COL.red; g.globalAlpha = 0.6; const xr = X(P.redline); g.beginPath(); g.moveTo(xr, pt); g.lineTo(xr, pt + ch); g.stroke(); g.globalAlpha = 1;
    const line = (fy, col, idx) => { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); M.curve.forEach((c, i) => { const x = X(c[0]), y = fy(c[idx]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
    line(YT, COL.acc, 1); line(YP, COL.amber, 2);
    g.textAlign = 'left'; g.font = `600 10px ${FONT.body}`;
    g.fillStyle = COL.acc; g.fillText(I.ui.torque, pl + 6, pt + 12);
    g.fillStyle = COL.amber; g.fillText(I.ui.power, pl + 20 + g.measureText(I.ui.torque).width, pt + 12);
    if (S.rpm > r0 * 0.5 && S.state !== 'off') {
      const x = X(cl(S.rpm, r0, r1));
      g.fillStyle = COL.acc; g.beginPath(); g.arc(x, YT(Math.max(0, S.T)), 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = COL.amber; g.beginPath(); g.arc(x, YP(Math.max(0, S.Pw)), 4, 0, Math.PI * 2); g.fill();
    }
  }

  function updateTelem() {
    $('tPow').firstChild.nodeValue = nf0.format(Math.max(0, S.Pw));
    $('tTq').firstChild.nodeValue = nf0.format(Math.max(0, S.T));
    $('tBoost').firstChild.nodeValue = nf2.format(S.boost);
    $('tBoostBar').style.width = (P.induction === 'na' ? 0 : cl(S.boost / P.boost, 0, 1) * 100) + '%';
    $('tFire').firstChild.nodeValue = nf0.format(S.rpm / 60 / L.cycleRevs * P.cyl);
    $('tSpd').firstChild.nodeValue = nf0.format(S.v * 3.6);
    $('lVtec').classList.toggle('on', S.vtec);
    $('lCut').classList.toggle('on', S.cut);
    $('lPop').classList.toggle('on', popFlash > 0.1);
    $('lBov').classList.toggle('on', bovFlash > 0.1 || S.fb);
    $('lBov').textContent = S.fb ? 'FLY-BY' : 'BOV';
    $('lAls').classList.toggle('on', !!S.als);
    const showGyro = gyro.on && !S.launch;
    $('lLc').classList.toggle('on', !!S.launch || gyro.on);
    $('lLc').textContent = showGyro ? I.ui.lampGyro : I.ui.lampLaunch;
    $('lLc').dataset.c = showGyro ? 'gyro' : 'lc';
    const shown = fullHeld ? 1 : thrUser;
    $('pedalFill').style.height = shown * 100 + '%';
    $('pedalOut').textContent = Math.round(shown * 100) + '%';
    pedal.setAttribute('aria-valuenow', Math.round(shown * 100));
    const running = S.state !== 'off';
    $('btnPower').classList.toggle('running', running);
    $('powerTxt').textContent = running ? I.ui.stop : I.ui.start;
    $('starter').hidden = !!ctx;
    $('segDrive').querySelectorAll('button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'd') === S.drive));
  }

  // ---------- loop ----------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    if (thrMode === 'spring' && !gyro.on && !fullHeld && !pedalDrag && now - lastWheel > 220) thrUser = Math.max(0, thrUser - dt * 1.8);
    const t = fullHeld ? 1 : thrUser;
    if (Math.abs(t - sentThr) > 0.002) { send({ type: 'thr', v: t }); sentThr = t; }
    dispRpm += (S.rpm - dispRpm) * Math.min(1, dt * 25);
    if (S.pops !== lastPops) { popFlash = 1; lastPops = S.pops; }
    if (S.bov !== lastBov) { bovFlash = 1; lastBov = S.bov; }
    popFlash = Math.max(0, popFlash - dt * 5); bovFlash = Math.max(0, bovFlash - dt * 2.5);
    vizPh = (vizPh + dt * dispRpm / 60 / L.cycleRevs * slow) % 1;
    drawTach(now); drawEngine(); drawScope(); drawSpec(); drawDyno(); updateTelem();
    requestAnimationFrame(frame);
  }

  normalize();
  applyLang();
  applyConfig();
  requestAnimationFrame(frame);
})();
