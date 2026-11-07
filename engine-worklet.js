// Procedural engine: per-cylinder exhaust/intake pulses -> pipe waveguides -> muffler, plus turbo, pops, mechanics, physics.
const C = globalThis.EngineCore;
const TAU = Math.PI * 2;
let SEED = 0x2545f491 | 0;
function rn() { SEED ^= SEED << 13; SEED ^= SEED >>> 17; SEED ^= SEED << 5; return (SEED >>> 0) / 4294967296; }
function rs() { return rn() * 2 - 1; }
function cl(x, a, b) { return x < a ? a : x > b ? b : x; }
function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

class BQ {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(type, f, Q, db) {
    f = cl(f, 10, sampleRate * 0.45);
    const w = TAU * f / sampleRate, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * Q), A = Math.pow(10, (db || 0) / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'pk') { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    else if (type === 'ls') {
      const sq = 2 * Math.sqrt(A) * al;
      b0 = A * ((A + 1) - (A - 1) * cs + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cs); b2 = A * ((A + 1) - (A - 1) * cs - sq);
      a0 = (A + 1) + (A - 1) * cs + sq; a1 = -2 * ((A - 1) + (A + 1) * cs); a2 = (A + 1) + (A - 1) * cs - sq;
    } else throw new Error('filtro desconhecido: ' + type);
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
}

// Feedback comb = pipe with a reflecting end and a damped (low-passed) round trip.
class Pipe {
  constructor(size) { this.buf = new Float32Array(size); this.m = size - 1; this.w = 0; this.d = 8; this.g = 0; this.c = 0.5; this.s = 0; }
  run(x) {
    const di = this.d | 0, fr = this.d - di, m = this.m;
    const a = this.buf[(this.w - di) & m], b = this.buf[(this.w - di - 1) & m];
    this.s += this.c * (a + (b - a) * fr - this.s);
    const y = x + this.g * this.s;
    this.buf[this.w] = y; this.w = (this.w + 1) & m;
    return y;
  }
}

const MIC = {
  outside: { ex: 1.0, inn: 0.45, mech: 0.3, tur: 0.6, lp: 12500, shelf: 0, ground: true },
  exhaust: { ex: 1.0, inn: 0.32, mech: 0.16, tur: 0.45, lp: 16000, shelf: 0 },
  bay: { ex: 0.42, inn: 1.15, mech: 1.0, tur: 1.0, lp: 10000, shelf: 0 },
  cabin: { ex: 0.85, inn: 0.55, mech: 0.22, tur: 0.35, lp: 1500, shelf: 8 },
};

class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.P = null;
    this.rpm = 0; this.phase = 0; this.state = 'off'; this.crankT = 0;
    this.uThr = 0; this.thr = 0; this.map = 0; this.eff = 0; this.idleI = 0; this.blipT = 0;
    this.cutting = false; this.cutP = 0; this.Te = 0; this.lim = 7000;
    this.boost = 0; this.spool = 0; this.bovArm = 0; this.bovEnv = 0; this.bovA = 0; this.bovT = 0; this.flEnv = 0; this.flPh = 0; this.gate = 0;
    this.driveOn = true; this.gear = 1; this.v = 0; this.locked = false; this.shiftT = 0; this.shiftDir = 0; this.brake = 0; this.launch = false; this.autoT = 0;
    this.vtecB = 0; this.lope = 0;
    this.pops = Array.from({ length: 12 }, () => ({ on: false, t: 0, a: 0, b: 0, tau: 1 }));
    this.popCount = 0; this.bovCount = 0; this.crackT = 0; this.prevThrC = 0;
    this.popHP = [new BQ(), new BQ()];
    this.gBuf = [new Float32Array(1024), new Float32Array(1024)]; this.gW = 0;
    this.wl = [0, 0, 0, 0]; this.gust = 0; this.gustV = 0; this.roadF = [new BQ(), new BQ()]; this.tireF = [new BQ(), new BQ()];
    this.nzl = 0; this.prevEx = 0;
    this.whPh = 0; this.tw1 = 0; this.tw2 = 0; this.stPh = 0; this.gwPh = 0;
    this.pipe = [new Pipe(8192), new Pipe(8192)];
    this.head = [new Pipe(1024), new Pipe(1024)];
    this.muf = [[new BQ(), new BQ()], [new BQ(), new BQ()]];
    this.drone = [new BQ(), new BQ()];
    this.turbLP = [new BQ(), new BQ()];
    this.dc = [new BQ(), new BQ()];
    this.inPipe = new Pipe(1024); this.inF1 = new BQ(); this.inF2 = new BQ(); this.inDC = new BQ();
    this.rushF = new BQ(); this.tickF = new BQ(); this.blk1 = new BQ(); this.blk2 = new BQ();
    this.whF = new BQ(); this.bovF = new BQ(); this.flF = new BQ(); this.gateF = new BQ(); this.stF = new BQ();
    this.micLP = [new BQ(), new BQ()]; this.micSh = [new BQ(), new BQ()];
    this.fbBuf = new Float32Array(1 << 17); this.fbW = 0; this.fb = false; this.fbT = 0; this.fbV = 55; this.fbSpan = 3; this.fbLP = [0, 0];
    this.blk = 0;
    this.port.onmessage = e => this.msg(e.data);
  }

  msg(d) {
    switch (d.type) {
      case 'params': this.setParams(d.p); break;
      case 'thr': this.uThr = cl(d.v, 0, 1); break;
      case 'start': if (this.state === 'off') { this.state = 'crank'; this.crankT = 0; } break;
      case 'stop': this.state = 'off'; break;
      case 'blip': this.blipT = 0.16; break;
      case 'shift': this.shift(d.dir); break;
      case 'drive':
        this.driveOn = d.on; this.locked = false;
        if (d.on && this.v < 2) this.gear = 1;
        break;
      case 'brake': this.brake = d.v; break;
      case 'launch': this.launch = d.on; break;
      case 'flyby':
        this.fb = true;
        this.fbV = this.driveOn && this.v > 8 ? this.v : this.P.flySpeed / 3.6;
        this.fbSpan = 140 / this.fbV; this.fbT = -this.fbSpan;
        break;
      default: throw new Error('mensagem desconhecida: ' + d.type);
    }
  }

  setParams(p) {
    const sr = sampleRate;
    const first = !this.P;
    this.P = p;
    this.L = C.buildLayout(p);
    this.M = C.engineModel(p);
    const L = this.L, N = p.cyl;
    this.N = N; this.cycleRevs = L.cycleRevs;
    if (first || !this.off || this.off.length !== N) {
      this.off = new Float32Array(N); this.exB = new Uint8Array(N); this.hd = new Float32Array(N); this.hdPh = new Float32Array(N);
      this.lastP = new Float32Array(N).fill(0.999); this.amp = new Float32Array(N); this.inA = new Float32Array(N); this.jit = new Float32Array(N);
    }
    const cHot = 480;
    L.cyl.forEach((c, i) => {
      this.off[i] = c.off;
      this.exB[i] = L.B === 1 ? (N >= 4 ? (c.pos < N / 2 ? 0 : 1) : 0) : c.bank % 2;
      const len = p.headerLen * (1 + p.unequal * 1.4 * hash(i + c.bank * 7));
      this.hd[i] = len / cHot;
    });
    // pulse shape tables: low cam and high cam (VTEC) profiles
    const rot = L.rotary, two = p.strokes === 2 && !rot;
    const sharpBase = cl(0.22 + (p.valves - 2) * 0.07 + p.cam * 0.25 + (rot ? 0.35 : 0) + (two ? 0.2 : 0), 0, 1);
    this.tabLo = this.makeTab(sharpBase);
    this.tabHi = this.makeTab(p.vtec ? cl(sharpBase + 0.22, 0, 1) : sharpBase);
    this.w0 = rot ? 0.42 : two ? 0.38 : 0.25 + p.cam * 0.07;
    this.w1 = p.vtec ? this.w0 + 0.04 : this.w0;
    this.iStart = rot || two ? 0.45 : 0.3; this.iDur = rot || two ? 0.35 : 0.3;
    this.inTab = new Float32Array(1025);
    for (let i = 0; i <= 1024; i++) { const s = Math.sin(Math.PI * i / 1024); this.inTab[i] = s * s; }

    for (let b = 0; b < 2; b++) {
      const len = p.pipeLen * (b ? 1.043 : 1);
      this.pipe[b].d = cl(2 * len / cHot * sr, 4, 8000); this.pipe[b].g = -p.resonance * 0.9; this.pipe[b].c = 0.2 + 0.55 * (1 - p.muffler);
      this.head[b].d = cl(2 * p.headerLen * (b ? 1.07 : 1) / cHot * sr, 2, 1000); this.head[b].g = 0.42 * p.resonance; this.head[b].c = 0.6;
      const fc = 650 * Math.pow(24, 1 - p.muffler);
      this.muf[b][0].set('lp', fc, 0.7); this.muf[b][1].set('lp', fc * 1.4, 0.6);
      this.drone[b].set('pk', cHot / (4 * p.pipeLen) * 1.6 + 40, 1.4, p.resonance * 7 * (1 - p.muffler * 0.5));
      this.turbLP[b].set('lp', 2600, 0.7);
      this.dc[b].set('hp', 24, 0.7);
    }
    const runner = p.intake === 'itb' ? 0.24 : p.intake === 'cai' ? 0.55 : 0.9;
    this.inPipe.d = cl(2 * runner / 343 * sr, 2, 1000); this.inPipe.g = p.intake === 'itb' ? 0.6 : 0.4; this.inPipe.c = 0.7;
    if (p.intake === 'itb') { this.inF1.set('hp', 170, 0.7); this.inF2.set('pk', 1900, 1.0, 7); }
    else if (p.intake === 'cai') { this.inF1.set('lp', 2600, 0.7); this.inF2.set('pk', 420, 1.2, 5); }
    else { this.inF1.set('lp', 760, 0.7); this.inF2.set('pk', 160, 1.4, 6); }
    this.inDC.set('hp', 30, 0.7);
    this.rushF.set('bp', 1300, 0.7); this.tickF.set('bp', 4800, 2.5); this.blk1.set('bp', 650, 4); this.blk2.set('bp', 1750, 5);
    this.bovF.set('hp', 1700, 0.7); this.flF.set('bp', 950, 1.4); this.gateF.set('bp', 2600, 1.2); this.stF.set('bp', 520, 2);
    const mic = MIC[p.mic];
    for (let k = 0; k < 2; k++) {
      this.micLP[k].set('lp', mic.lp, 0.7); this.micSh[k].set('ls', 140, 0.7, mic.shelf);
      this.popHP[k].set('hp', 110, 0.7); this.roadF[k].set('lp', 170, 0.8); this.tireF[k].set('bp', 850, 1.1);
    }
    this.ratios = this.M.ratios; this.final = this.M.final; this.Tcap = 1.6 * this.M.pk.T;
    if (this.gear > this.ratios.length) this.gear = this.ratios.length;
    this.cylScale = (0.45 + 0.9 * Math.sqrt(p.disp / N)) / Math.sqrt(N) * 3.0;
    this.port.postMessage({ type: 'ready' });
  }

  makeTab(sharp) {
    const t = new Float32Array(1025), a = 1.4 - 1.05 * sharp, sp = 0.15 + 0.65 * sharp;
    let mx = 0;
    for (let i = 0; i <= 1024; i++) {
      const x = i / 1024;
      const v = Math.pow(x, a) * Math.pow(1 - x, 1.6) * 2.6 + sp * Math.exp(-x * 26) * (1 - x);
      t[i] = v; if (v > mx) mx = v;
    }
    for (let i = 0; i <= 1024; i++) t[i] /= mx;
    return t;
  }

  shift(dir) {
    if (!this.driveOn || this.shiftT > 0) return;
    const ng = this.gear + dir;
    if (ng < 1 || ng > this.ratios.length) return;
    this.gear = ng; this.shiftT = dir > 0 ? 0.11 : 0.17; this.shiftDir = dir; this.locked = false;
  }

  resist(v) { return 0.5 * 1.2 * 0.65 * v * v + (v > 0.05 ? 0.013 * this.P.mass * 9.81 : 0) + (v > 0.05 ? this.brake * this.P.mass * 9 : 0); }

  bovFire(a) {
    const t = this.P.bov;
    if (t === 'flutter') { this.flEnv = Math.min(1.4, a); }
    else { this.bovEnv = 1; this.bovA = a * (t === 'recirc' ? 0.25 : 1); this.bovT = 0; }
    this.bovCount++;
  }

  physics(n) {
    const P = this.P, M = this.M, sub = 4, dt = n / sampleRate / sub;
    for (let k = 0; k < sub; k++) {
      let tgt = this.uThr;
      if (this.blipT > 0) { this.blipT -= dt; tgt = Math.max(tgt, 0.75); }
      if (this.shiftT > 0 && this.shiftDir < 0) tgt = Math.max(tgt, 0.55);
      if (this.launch && this.v < 1.5) tgt = 1;
      this.thr += (tgt - this.thr) * Math.min(1, dt * 30);
      if (this.prevThrC > 0.5 && this.thr < 0.15 && this.rpm > P.redline * 0.42) this.crackT = 0.35 + P.pops * 1.3;
      this.prevThrC = this.thr;
      this.crackT = Math.max(0, this.crackT - dt);
      const running = this.state === 'run';
      let idleThr = 0;
      if (running) {
        const e = (P.idle - this.rpm) / P.idle;
        this.idleI = cl(this.idleI + e * dt * 2, -0.02, 0.25);
        idleThr = cl(0.025 + e * 1.2 + this.idleI, 0, 0.5);
      }
      const eff = Math.max(this.thr, idleThr);
      this.eff = eff;
      const launchLim = this.launch && this.v < 1.5;
      const lim = launchLim ? P.redline * 0.6 : P.redline;
      this.lim = lim;
      if (P.limiter === 'hard' || launchLim) {
        if (this.rpm > lim) this.cutting = true;
        else if (this.rpm < lim - Math.max(120, lim * 0.025)) this.cutting = false;
        this.cutP = this.cutting ? 1 : 0;
      } else if (P.limiter === 'soft') {
        this.cutP = cl((this.rpm - lim * 0.985) / (lim * 0.03), 0, 1);
        this.cutting = this.cutP > 0.4;
      } else { this.cutP = 0; this.cutting = false; }
      this.upCut = this.shiftT > 0 && this.shiftDir > 0;
      this.map += (eff - this.map) * Math.min(1, dt * 14);
      const r = this.rpm / P.redline;

      if (M.turbo) {
        this.als = P.als && running && this.thr < 0.12 && this.rpm > P.idle * 1.3;
        let tg = C.sstep(M.sp0 * 0.7, M.sp1, this.rpm) * cl(this.map * 1.25, 0, 1);
        if (this.als) tg = Math.max(tg, 0.85);
        if (!running) tg = 0;
        const tau = tg > this.spool ? (0.2 + P.turboSize * 1.4) * (P.induction === 'twin' ? 0.75 : 1) : 1.6;
        this.spool += (tg - this.spool) * Math.min(1, dt / tau);
        const bt = P.boost * Math.pow(this.spool, 1.4) * cl((this.als ? 0.65 : this.map) * 1.3, 0, 1);
        this.boost += (bt - this.boost) * Math.min(1, dt * 10);
        if (this.thr > 0.45 && this.boost > 0.25 * P.boost) this.bovArm = Math.max(this.bovArm, this.boost / P.boost);
        if (this.bovArm > 0 && this.thr < 0.15) { this.bovFire(this.bovArm); this.bovArm = 0; }
        this.gate += ((this.boost > P.boost * 0.93 && this.map > 0.8 ? 1 : 0) - this.gate) * Math.min(1, dt * 8);
      } else {
        this.als = false;
        if (P.induction === 'roots') this.boost = P.boost * (0.8 + 0.2 * r) * this.map;
        else if (P.induction === 'centri') this.boost = P.boost * Math.min(1, r * r * 1.1) * this.map;
        else this.boost = 0;
        this.spool = P.induction === 'na' ? 0 : cl(r, 0, 1.2);
      }

      const vt = P.vtec && this.rpm > P.vtecRpm && this.map > 0.3 ? 1 : 0;
      this.vtecB += (vt - this.vtecB) * Math.min(1, dt * 25);

      let Te = 0;
      if (running && !this.upCut) {
        Te = M.nat(this.rpm, this.vtecB) * (1 + 0.8 * this.boost) * Math.pow(this.map, 0.9) * (1 - this.cutP);
      }
      if (this.state === 'crank') {
        this.crankT += dt;
        Te = (30 + P.disp * 35) * cl(1 - this.rpm / 320, 0, 1);
        if (this.crankT > 0.6) {
          Te += M.nat(Math.max(this.rpm, P.idle), 0) * 0.35;
          if (this.rpm > P.idle * 0.75) { this.state = 'run'; this.idleI = 0.1; }
        }
      }
      this.Te = Te;
      const rf = this.rpm / 6000;
      const Tf = P.disp * (4 + 8 * rf + 5 * rf * rf) * (this.L.rotary ? 0.7 : 1) * Math.min(1, this.rpm / 60);
      const J = (0.05 + 0.035 * P.disp) * P.flywheel;
      let we = this.rpm * TAU / 60;

      if (!this.driveOn) {
        we += (Te - Tf) / J * dt;
        this.v = Math.max(0, this.v - this.resist(this.v) / P.mass * dt);
      } else {
        const ratio = this.ratios[this.gear - 1] * this.final, rw = 0.32, m = P.mass;
        const ww = this.v / rw * ratio, wIdle = P.idle * TAU / 60;
        const clutchIn = this.shiftT > 0;
        const Fres = this.resist(this.v);
        if (this.locked) {
          if (clutchIn || ww < wIdle * 0.85) this.locked = false;
          else {
            const Jeff = J + m * rw * rw / (ratio * ratio);
            we = ww + (Te - Tf - Fres * rw / ratio) / Jeff * dt;
            this.v = Math.max(0, we / ratio * rw);
          }
        }
        if (!this.locked) {
          const cap = clutchIn ? 0 : this.Tcap * (ww < wIdle ? cl((we - wIdle * 0.8) / (wIdle * 0.7), 0, 1) : 1);
          const slip = we - ww;
          const Tc = slip > 0 ? cap : -cap;
          we += (Te - Tf - Tc) / J * dt;
          this.v = Math.max(0, this.v + (Tc * ratio / rw - Fres) / m * dt);
          const ww2 = this.v / rw * ratio;
          if (!clutchIn && cap > 0 && (we - ww2) * slip <= 0 && ww2 >= wIdle * 0.85) { this.locked = true; we = ww2; }
        }
      }
      if (we < 0) we = 0;
      this.rpm = we * 60 / TAU;
      if (running && this.rpm < P.idle * 0.3) this.state = 'off';
      if (this.shiftT > 0) this.shiftT = Math.max(0, this.shiftT - dt);
      this.autoT = Math.max(0, this.autoT - dt);
      if (P.autoshift && this.driveOn && this.shiftT === 0 && this.locked && this.autoT === 0) {
        if (this.rpm > P.redline * 0.965 && this.gear < this.ratios.length) { this.shift(1); this.autoT = 0.6; }
        else if (this.gear > 1 && this.rpm < P.redline * 0.4) {
          const nr = this.rpm * this.ratios[this.gear - 2] / this.ratios[this.gear - 1];
          if (nr < P.redline * 0.8) { this.shift(-1); this.autoT = 0.6; }
        }
      }
    }
  }

  maybePop(i, prob, big) {
    const fr = this.rpm / 60 / this.cycleRevs * this.N;
    if (rn() >= prob * Math.min(1, 45 / Math.max(1, fr))) return;
    const v = this.pops.find(o => !o.on);
    if (!v) return;
    const sr = sampleRate;
    v.on = true; v.b = this.exB[i]; v.t = -Math.floor((0.002 + rn() * 0.03) * sr);
    v.big = big;
    v.a = big ? 1.2 + rn() * 1.3 : 0.22 + rn() * 0.5;
    v.tau = (big ? 0.0025 + rn() * 0.005 : 0.0004 + rn() * 0.0011) * sr;
    v.th = big ? 1 : 0.15; v.f = 55 + rn() * 65;
    v.end = big ? 0.14 * sr : v.tau * 9;
    this.popCount++;
  }

  cycle(i) {
    const P = this.P;
    let a;
    const running = this.state === 'run';
    const overrun = running && this.eff < 0.03 && this.rpm > P.idle * 1.4;
    if (this.state === 'off') a = this.rpm > 30 ? 0.07 : 0;
    else if (this.state === 'crank') a = this.crankT > 0.6 ? 0.25 + rn() * 0.5 : 0.07;
    else if (this.upCut || (this.cutP > 0 && rn() < this.cutP)) {
      a = 0.06;
      if (this.upCut) this.maybePop(i, Math.min(1, P.pops * 1.6), true);
      else this.maybePop(i, P.pops * 0.5, rn() < 0.6);
    } else if (this.als) {
      a = 0.14;
      this.maybePop(i, 0.35 + 0.5 * P.pops, rn() < 0.55);
    } else if (overrun) {
      a = 0.08;
      const crack = this.crackT > 0;
      this.maybePop(i, P.pops * (crack ? 1.0 : 0.15) * cl(this.rpm / P.redline + 0.2, 0, 1) * (this.boost > 0.3 ? 1.3 : 1), rn() < (crack ? 0.18 : 0.35));
    } else {
      a = 0.3 + 0.7 * Math.pow(this.map, 0.7);
      a *= 1 + 0.35 * this.boost;
      const lope = P.cam * P.cam * cl(1 - (this.rpm - P.idle) / (P.idle * 2.2), 0, 1) * (this.L.rotary ? 1.4 : 1);
      const g = (rs() + rs() + rs()) / 1.7;
      a *= Math.max(0.05, 1 + g * (P.rough * 0.22 + lope * 0.55) + this.lope);
      this.lope = 0;
      if (rn() < lope * 0.09) { a *= 0.22; this.lope = 0.6 * lope; }
    }
    this.amp[i] = a * this.cylScale;
    this.inA[i] = (0.1 + 0.9 * this.map) * (running || this.state === 'crank' ? 1 : 0.3);
    this.jit[i] = rs() * P.rough * 0.004;
  }

  process(inputs, outputs) {
    const out = outputs[0], OL = out[0], OR = out[1] || out[0], n = OL.length;
    if (!this.P) { OL.fill(0); if (OR !== OL) OR.fill(0); return true; }
    this.physics(n);
    const P = this.P, N = this.N, sr = sampleRate;
    const rpm = this.rpm, rate = rpm / 60 / this.cycleRevs, inc = rate / sr;
    for (let i = 0; i < N; i++) this.hdPh[i] = this.hd[i] * rate;
    const off = this.off, hdPh = this.hdPh, jit = this.jit, lastP = this.lastP, amp = this.amp, inA = this.inA, exB = this.exB;
    const vb = this.vtecB, w = this.w0 + (this.w1 - this.w0) * vb, invW = 1024 / w;
    const iS = this.iStart, iD = this.iDur, invI = 1024 / iD;
    const tabLo = this.tabLo, tabHi = this.tabHi, itab = this.inTab;
    const rasp = P.rasp * 2.2, r = cl(rpm / P.redline, 0, 1.3);
    const route = P.routing === 'dual' ? [1, 0, 0, 1] : P.routing === 'xpipe' ? [0.68, 0.32, 0.32, 0.68] : [0.5, 0.5, 0.5, 0.5];
    const mic = MIC[P.mic];
    const mufG = 1 - 0.45 * P.muffler;
    const turbo = this.M.turbo;
    const inG = P.intakeVol * (1 + 0.9 * vb) * (P.intake === 'itb' ? 1.3 : P.intake === 'cai' ? 1 : 0.75) * 0.8;
    const rushA = P.intakeVol * this.map * Math.pow(r, 1.5) * 0.12 * (1 + vb * 0.6);
    const tickA = P.mech * (0.25 + 0.04 * P.valves) * (this.L.rotary ? 0.2 : 1) * 0.9;
    const blkA = P.mech * 0.7;
    // turbo / supercharger tones
    const twF = 1800 + 9500 * this.spool, twA = turbo ? P.whistle * Math.pow(this.spool, 1.6) * (0.25 + 0.75 * this.map) * 0.05 : 0;
    if (turbo) this.whF.set('bp', twF, 7);
    const sc = P.induction === 'roots' || P.induction === 'centri';
    const scF = P.induction === 'roots' ? rpm / 60 * 14 : rpm / 60 * 75;
    const scA = sc ? P.whistle * (0.2 + 0.8 * this.map) * r * 0.05 : 0;
    const gwA = this.driveOn && this.locked ? P.gearWhine * (0.25 + this.map) * r * 0.035 : 0;
    const gwF = rpm / 60 * 23;
    const gateA = turbo ? this.gate * P.whistle * 0.05 : 0;
    const crank = this.state === 'crank' && this.rpm < 400;
    const stF = 160 + rpm * 1.3;
    const width = P.width;
    const pre = 1 + P.drive * 3, post = 0.5 / Math.tanh(pre * 0.5);
    const popG = (0.5 + 0.6 * Math.sqrt(P.disp / N)) * 0.9, popDirect = 0.55 * (1 - P.muffler * 0.55);
    const ground = !!mic.ground, gD0 = Math.round(0.0031 * sr), gD1 = Math.round(0.0036 * sr);
    const cabin = P.mic === 'cabin', spd = this.v;
    const windA = cabin ? P.wind * Math.min(1.2, Math.pow(spd / 45, 2)) * 0.22 : 0;
    const roadA = cabin ? P.wind * Math.min(1, spd / 25) * 0.35 : 0;
    const windC = cl(0.004 + spd * 0.0009, 0.004, 0.12);
    let ph = this.phase;

    for (let s = 0; s < n; s++) {
      ph += inc; if (ph >= 1) ph -= 1;
      const nz = rs();
      this.nzl += 0.35 * (nz - this.nzl);
      const nzH = nz - this.nzl;
      let bA = 0, bB = 0, ins = 0, tick = 0;
      for (let i = 0; i < N; i++) {
        let p = ph - off[i] - hdPh[i] - jit[i];
        p -= Math.floor(p);
        const lp = lastP[i];
        if (p < lp - 0.5) this.cycle(i);
        if (lp < w && p >= w) tick += tickA;
        lastP[i] = p;
        if (p < w) {
          const x = p * invW, xi = x | 0, fr = x - xi;
          let v = tabLo[xi] + (tabLo[xi + 1] - tabLo[xi]) * fr;
          if (vb > 0.002) v += (tabHi[xi] + (tabHi[xi + 1] - tabHi[xi]) * fr - v) * vb;
          const e = v * amp[i] * (1 + rasp * nzH);
          if (exB[i]) bB += e; else bA += e;
        }
        const q = p - iS;
        if (q >= 0 && q < iD) ins -= itab[(q * invI) | 0] * inA[i];
      }
      let pA = 0, pB = 0;
      for (let k = 0; k < 12; k++) {
        const o = this.pops[k];
        if (!o.on) continue;
        if (o.t < 0) { o.t++; continue; }
        const tt = o.t / sr;
        const spike = o.t < 14 ? 1 - o.t / 14 : 0;
        const v = o.a * (spike * 1.6 + Math.exp(-o.t / o.tau) * nz * 1.2 + o.th * Math.sin(TAU * o.f * tt) * Math.exp(-tt / 0.028)) * popG;
        if (o.b) pB += v; else pA += v;
        if (++o.t > o.end) o.on = false;
      }
      bA += pA * 0.6; bB += pB * 0.6;
      // exhaust chains
      const inA0 = route[0] * bA + route[1] * bB, inB0 = route[2] * bA + route[3] * bB;
      let ex0 = this.head[0].run(inA0); ex0 = this.pipe[0].run(ex0 * 0.6);
      ex0 = this.muf[0][1].run(this.muf[0][0].run(ex0)); ex0 = this.drone[0].run(ex0);
      let ex1 = this.head[1].run(inB0); ex1 = this.pipe[1].run(ex1 * 0.6);
      ex1 = this.muf[1][1].run(this.muf[1][0].run(ex1)); ex1 = this.drone[1].run(ex1);
      if (turbo) { ex0 = this.turbLP[0].run(ex0) * 0.72; ex1 = this.turbLP[1].run(ex1) * 0.72; }
      ex0 = this.dc[0].run(ex0) * mufG + this.popHP[0].run(route[0] * pA + route[1] * pB) * popDirect;
      ex1 = this.dc[1].run(ex1) * mufG + this.popHP[1].run(route[2] * pA + route[3] * pB) * popDirect;
      // intake
      let inn = this.inPipe.run(ins * inG + this.rushF.run(nz) * rushA);
      inn = this.inDC.run(this.inF2.run(this.inF1.run(inn)));
      // mechanical
      const exSum = bA + bB, dEx = exSum - this.prevEx; this.prevEx = exSum;
      let mech = this.tickF.run(tick * (0.5 + nzH)) + (this.blk1.run(dEx) + this.blk2.run(dEx) * 0.7) * blkA;
      if (crank) {
        this.stPh += stF / sr; if (this.stPh > 1) this.stPh -= 1;
        mech += (Math.sin(TAU * this.stPh) * 0.06 + this.stF.run(nz) * 0.05) * (0.6 + 0.4 * Math.sin(TAU * ph * N));
      }
      if (gwA > 0) { this.gwPh += gwF / sr; if (this.gwPh > 1) this.gwPh -= 1; mech += Math.sin(TAU * this.gwPh) * gwA; }
      // turbo / blower
      let tur = 0;
      if (twA > 0) {
        this.tw1 += twF / sr; if (this.tw1 > 1) this.tw1 -= 1;
        this.tw2 += twF * 1.031 / sr; if (this.tw2 > 1) this.tw2 -= 1;
        tur += (Math.sin(TAU * this.tw1) + (P.induction === 'twin' ? 0.8 * Math.sin(TAU * this.tw2) : 0)) * twA + this.whF.run(nz) * twA * 2.5;
      }
      if (scA > 0) {
        this.whPh += scF / sr; if (this.whPh > 1) this.whPh -= 1;
        tur += (Math.sin(TAU * this.whPh) + 0.35 * Math.sin(2 * TAU * this.whPh)) * scA;
      }
      if (this.bovEnv > 0.0005) {
        this.bovT++;
        const att = 1 - Math.exp(-this.bovT / (0.004 * sr));
        tur += this.bovF.run(nz) * this.bovEnv * att * this.bovA * 0.5;
        this.bovEnv *= 1 - 1 / (0.22 * sr);
      }
      if (this.flEnv > 0.0005) {
        const lf = 11 + 16 * this.flEnv;
        this.flPh += lf / sr; if (this.flPh > 1) this.flPh -= 1;
        const m = Math.pow(0.5 + 0.5 * Math.sin(TAU * this.flPh), 3);
        tur += this.flF.run(nz) * this.flEnv * m * 0.55;
        this.flEnv *= 1 - 1 / (0.45 * sr);
      }
      if (gateA > 0.0005) tur += this.gateF.run(nz) * gateA;
      // mic mix
      const c = inn * mic.inn + mech * mic.mech + tur * mic.tur;
      let Lr = ex0 * mic.ex + c, Rr = ex1 * mic.ex + c;
      const mid = (Lr + Rr) * 0.5, side = (Lr - Rr) * 0.5 * width;
      Lr = mid + side; Rr = mid - side;
      if (ground) {
        const gb0 = this.gBuf[0], gb1 = this.gBuf[1], gw = this.gW;
        gb0[gw] = Lr; gb1[gw] = Rr;
        Lr -= 0.32 * gb0[(gw - gD0) & 1023]; Rr -= 0.32 * gb1[(gw - gD1) & 1023];
        this.gW = (gw + 1) & 1023;
      }
      Lr = this.micSh[0].run(this.micLP[0].run(Lr));
      Rr = this.micSh[1].run(this.micLP[1].run(Rr));
      if (windA + roadA > 0.0001) {
        this.gustV += (rs() * 0.5 - this.gustV) * 0.0002; this.gust = cl(this.gust + this.gustV * 0.002, -0.6, 0.6);
        const n1 = rs(), n2 = rs();
        this.wl[0] += windC * (n1 - this.wl[0]); this.wl[1] += windC * (this.wl[0] - this.wl[1]);
        this.wl[2] += windC * (n2 - this.wl[2]); this.wl[3] += windC * (this.wl[2] - this.wl[3]);
        const wg = windA * (1 + this.gust) * 6;
        Lr += this.wl[1] * wg + (this.roadF[0].run(n1) * 2.2 + this.tireF[0].run(n2) * 0.35) * roadA;
        Rr += this.wl[3] * wg + (this.roadF[1].run(n2) * 2.2 + this.tireF[1].run(n1) * 0.35) * roadA;
      }
      Lr = Math.tanh(Lr * pre * 0.5) * post; Rr = Math.tanh(Rr * pre * 0.5) * post;
      // fly-by: doppler via variable delay, distance gain, pan, air absorption
      if (this.fb) {
        const m = (Lr + Rr) * 0.5;
        this.fbBuf[this.fbW] = m;
        this.fbT += 1 / sr;
        const x = this.fbV * this.fbT, h = 7, dist = Math.sqrt(x * x + h * h);
        const d = dist / 343 * sr, di = d | 0, fr = d - di, mk = this.fbBuf.length - 1;
        const a0 = this.fbBuf[(this.fbW - di) & mk], a1 = this.fbBuf[(this.fbW - di - 1) & mk];
        const sig = (a0 + (a1 - a0) * fr) * (h + 3) / (dist + 3) * 1.25;
        const lpc = cl(1 / (1 + dist / 25), 0.05, 1);
        const pan = x / dist;
        this.fbLP[0] += lpc * (sig * Math.sqrt((1 - pan) / 2) - this.fbLP[0]);
        this.fbLP[1] += lpc * (sig * Math.sqrt((1 + pan) / 2) - this.fbLP[1]);
        const edge = Math.min(1, (this.fbT + this.fbSpan) * 6, (this.fbSpan - this.fbT) * 6);
        Lr = Lr * (1 - edge) + this.fbLP[0] * 1.41 * edge;
        Rr = Rr * (1 - edge) + this.fbLP[1] * 1.41 * edge;
        if (this.fbT > this.fbSpan) this.fb = false;
      } else this.fbBuf[this.fbW] = (Lr + Rr) * 0.5;
      this.fbW = (this.fbW + 1) & (this.fbBuf.length - 1);
      OL[s] = Lr; OR[s] = Rr;
    }
    this.phase = ph;
    if (++this.blk >= 10) {
      this.blk = 0;
      const powCv = this.Te * this.rpm / 9549 * 1.36;
      this.port.postMessage({
        type: 'state', rpm: this.rpm, thr: this.thr, eff: this.eff, map: this.map, boost: this.boost, spool: this.spool,
        v: this.v, gear: this.gear, drive: this.driveOn, vtec: this.vtecB > 0.5, cut: this.cutting || this.upCut,
        pops: this.popCount, bov: this.bovCount, T: this.Te, Pw: powCv, state: this.state, fb: this.fb, launch: this.launch && this.v < 1.5,
        als: this.als, lim: this.lim,
      });
    }
    return true;
  }
}
registerProcessor('engine', EngineProcessor);
