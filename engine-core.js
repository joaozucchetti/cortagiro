// Shared engine math: used by the page (visuals, dyno) and by the AudioWorklet (sound, physics).
(function (G) {
  function sstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function spreadOrder(M) {
    const T = { 1: [0], 2: [0, 1], 3: [0, 2, 1], 4: [0, 2, 3, 1], 5: [0, 1, 3, 4, 2], 6: [0, 4, 2, 5, 1, 3], 7: [0, 2, 4, 6, 5, 3, 1], 8: [0, 4, 6, 2, 7, 3, 1, 5] };
    if (T[M]) return T[M];
    const a = [];
    for (let i = 0; i < M; i += 2) a.push(i);
    for (let i = M % 2 ? M - 2 : M - 1; i > 0; i -= 2) a.push(i);
    return a;
  }

  // Cylinder geometry + firing offsets (fraction of one combustion cycle).
  function buildLayout(p) {
    const N = p.cyl | 0, lay = p.layout;
    const rotary = lay === 'rotary';
    const cycleRevs = !rotary && p.strokes === 4 ? 2 : 1;
    const cycleDeg = cycleRevs * 360;
    let B;
    if (lay === 'inline' || rotary || N < 2) B = 1;
    else if (lay === 'w') B = N % 4 === 0 && N >= 8 ? 4 : N % 3 === 0 && N >= 6 ? 3 : 2;
    else B = 2;
    const cyl = [];
    for (let j = 0; j < N; j++) cyl.push({ bank: j % B, pos: Math.floor(j / B), off: 0, num: 0 });
    const byBank = Array.from({ length: B }, () => []);
    cyl.forEach(c => byBank[c.bank].push(c));
    let n = 1;
    byBank.forEach(arr => arr.forEach(c => (c.num = n++)));

    const crank = rotary ? 'even' : p.crank;
    const seq = [];
    if (B === 1) spreadOrder(N).forEach(k => seq.push(byBank[0][k]));
    else {
      const base = [0, 1, 1, 0, 1, 0, 0, 1];
      const counters = new Array(B).fill(0);
      for (let k = 0; k < N; k++) {
        let b = crank === 'cross' && B === 2 ? base[k % 8] : k % B;
        if (counters[b] >= byBank[b].length) b = byBank.findIndex((arr, i) => counters[i] < arr.length);
        seq.push(byBank[b][spreadOrder(byBank[b].length)[counters[b]++]]);
      }
    }

    if (crank === 'bigbang' && N > 1) {
      const groups = Math.ceil(N / 2);
      seq.forEach((c, k) => (c.off = Math.floor(k / 2) / groups + (k % 2) * 0.055));
    } else if (crank === 'shared' && B === 2) {
      const A = seq.filter(c => c.bank === 0), Bb = seq.filter(c => c.bank === 1);
      const sh = p.vAngle / cycleDeg + (N === 2 && cycleRevs === 2 ? 0.5 : 0);
      A.forEach((c, k) => (c.off = k / A.length));
      Bb.forEach((c, k) => (c.off = (k / A.length + sh) % 1));
    } else seq.forEach((c, k) => (c.off = k / N));

    const fire = seq.slice().sort((a, b) => a.off - b.off);
    const intervals = fire.map((c, k) => {
      const nx = fire[(k + 1) % fire.length];
      let d = nx.off - c.off;
      if (d <= 0) d += 1;
      return Math.round(d * cycleDeg);
    });
    return { cyl, B, M: Math.ceil(N / B), order: fire.map(c => c.num).join('-'), intervals, cycleRevs, cycleDeg, rotary };
  }

  // Torque model, steady-state boost, dyno curve and gearing.
  function engineModel(p) {
    const rot = p.layout === 'rotary', two = p.strokes === 2 && !rot;
    const spec = rot ? 135 : two ? 120 : 92 + p.cam * 18 + (p.valves - 2) * 5;
    const Tpk = p.disp * spec;
    const peak = 0.48 + p.cam * 0.3, wid = 0.6 - p.cam * 0.22;
    const turbo = p.induction === 'turbo' || p.induction === 'twin';
    const sp0 = p.redline * (0.2 + p.turboSize * 0.33) * (p.induction === 'twin' ? 0.85 : 1);
    const sp1 = sp0 + p.redline * (0.12 + p.turboSize * 0.22);
    function nat(rpm, vt) {
      const r = rpm / p.redline;
      let b = 0.52 + 0.48 * Math.exp(-Math.pow((r - peak) / wid, 2));
      b *= 0.5 + 0.5 * Math.min(1, r / 0.28);
      if (p.vtec) b *= 0.9 + 0.2 * vt;
      if (r > 1) b *= Math.max(0, 1 - (r - 1) * 6);
      return Tpk * b;
    }
    function boostSS(rpm) {
      const r = rpm / p.redline;
      if (turbo) return p.boost * sstep(sp0, sp1, rpm);
      if (p.induction === 'roots') return p.boost * (0.8 + 0.2 * r);
      if (p.induction === 'centri') return p.boost * Math.min(1, r * r * 1.1);
      return 0;
    }
    const curve = [];
    const pk = { T: 0, Tr: 0, P: 0, Pr: 0 };
    for (let i = 0; i <= 80; i++) {
      const rpm = p.idle + (p.redline * 1.02 - p.idle) * i / 80;
      const vt = p.vtec && rpm >= p.vtecRpm ? 1 : 0;
      const T = nat(rpm, vt) * (1 + 0.8 * boostSS(rpm));
      const P = T * rpm / 9549 * 1.36;
      curve.push([rpm, T, P]);
      if (T > pk.T) { pk.T = T; pk.Tr = rpm; }
      if (P > pk.P) { pk.P = P; pk.Pr = rpm; }
    }
    const G = p.gears, first = 3.4, last = G >= 6 ? 0.72 : 0.85;
    const ratios = [];
    for (let k = 0; k < G; k++) ratios.push(first * Math.pow(last / first, Math.pow(k / (G - 1), 0.85)));
    const vmax = Math.cbrt(pk.P / 1.36 * 1000 / (0.5 * 1.2 * 0.65));
    const final = (p.redline * Math.PI * 2 / 60) * 0.32 / (last * vmax * 1.08);
    return { nat, boostSS, sp0, sp1, turbo, curve, pk, Tpk, ratios, final };
  }

  G.EngineCore = { sstep, spreadOrder, buildLayout, engineModel };
})(globalThis);
