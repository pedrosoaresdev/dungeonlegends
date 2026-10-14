// Áudio 100% procedural com WebAudio: efeitos sonoros + trilha chiptune por fase.
// Nenhum arquivo de áudio é necessário.

const SCALES = [
  // [raiz MIDI, intervalos da escala, bpm]
  { root: 45, scale: [0, 2, 3, 5, 7, 8, 10], bpm: 112 }, // Catacumbas — lá menor
  { root: 43, scale: [0, 1, 3, 5, 7, 8, 10], bpm: 96 }, // Pântano — frígio
  { root: 40, scale: [0, 2, 3, 5, 7, 8, 11], bpm: 132 }, // Fortaleza — menor harmônica
  { root: 47, scale: [0, 2, 3, 5, 7, 9, 10], bpm: 104 }, // Cripta — dórico
  { root: 38, scale: [0, 1, 4, 5, 7, 8, 10], bpm: 144 }, // Abismo — frígio dominante
  { root: 50, scale: [0, 2, 4, 7, 9], bpm: 90 }, // Menu / loja — pentatônica
];

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.muted = false;
    this.volumes = { sfx: 0.6, music: 0.35 };
    this.track = -1;
    this.boss = false;
    this.step = 0;
    this.nextNoteTime = 0;
    this.timer = null;
    this.pattern = null;
  }

  /** Precisa ser chamado após um gesto do usuário (política de autoplay). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain.connect(this.master);
    this.applyVolumes();
    // buffer de ruído reutilizável
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.muted ? 0 : 1;
    this.sfxGain.gain.value = this.volumes.sfx;
    this.musicGain.gain.value = this.volumes.music;
  }

  setVolume(kind, v) {
    this.volumes[kind] = v;
    this.applyVolumes();
  }

  toggleMute() {
    this.muted = !this.muted;
    this.applyVolumes();
    return this.muted;
  }

  // ---------- primitivas ----------
  #tone({ type = "square", freq = 440, to = null, dur = 0.12, vol = 0.3, delay = 0, out = this.sfxGain, attack = 0.005 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  #noise({ dur = 0.15, vol = 0.3, filter = 1200, type = "lowpass", delay = 0, sweepTo = null, out = this.sfxGain }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filter, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ---------- efeitos ----------
  play(name) {
    if (!this.ctx || this.muted) return;
    const r = (a, b) => a + Math.random() * (b - a);
    switch (name) {
      case "swing":
        this.#noise({ dur: 0.12, vol: 0.22, filter: 3000, type: "bandpass", sweepTo: 800 });
        break;
      case "shoot":
        this.#tone({ type: "square", freq: r(700, 800), to: 300, dur: 0.1, vol: 0.12 });
        break;
      case "fireball":
        this.#noise({ dur: 0.25, vol: 0.2, filter: 600, sweepTo: 2000 });
        this.#tone({ type: "sawtooth", freq: 200, to: 90, dur: 0.2, vol: 0.08 });
        break;
      case "hit":
        this.#noise({ dur: 0.08, vol: 0.3, filter: 1800 });
        this.#tone({ type: "square", freq: r(180, 220), to: 80, dur: 0.08, vol: 0.15 });
        break;
      case "crit":
        this.#noise({ dur: 0.14, vol: 0.4, filter: 2500 });
        this.#tone({ type: "square", freq: 900, to: 1500, dur: 0.1, vol: 0.12 });
        break;
      case "hurt":
        this.#tone({ type: "sawtooth", freq: 300, to: 90, dur: 0.22, vol: 0.25 });
        break;
      case "enemyDie":
        this.#noise({ dur: 0.25, vol: 0.25, filter: 900, sweepTo: 200 });
        this.#tone({ type: "triangle", freq: 400, to: 60, dur: 0.25, vol: 0.18 });
        break;
      case "coin":
        this.#tone({ type: "square", freq: 988, dur: 0.06, vol: 0.12 });
        this.#tone({ type: "square", freq: 1319, dur: 0.12, vol: 0.12, delay: 0.06 });
        break;
      case "pickup":
        this.#tone({ type: "triangle", freq: 600, to: 1200, dur: 0.15, vol: 0.2 });
        break;
      case "potion":
        [523, 659, 784].forEach((f, i) => this.#tone({ type: "sine", freq: f, dur: 0.15, vol: 0.2, delay: i * 0.05 }));
        break;
      case "levelup":
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.#tone({ type: "square", freq: f, dur: 0.18, vol: 0.14, delay: i * 0.08 }));
        break;
      case "dash":
        this.#noise({ dur: 0.18, vol: 0.2, filter: 400, sweepTo: 3000, type: "bandpass" });
        break;
      case "ability":
        this.#tone({ type: "sawtooth", freq: 110, to: 880, dur: 0.35, vol: 0.18 });
        this.#noise({ dur: 0.4, vol: 0.2, filter: 300, sweepTo: 5000, type: "bandpass" });
        break;
      case "explosion":
        this.#noise({ dur: 0.6, vol: 0.5, filter: 1200, sweepTo: 80 });
        this.#tone({ type: "sine", freq: 120, to: 30, dur: 0.5, vol: 0.4 });
        break;
      case "chest":
        [392, 494, 587, 784].forEach((f, i) => this.#tone({ type: "triangle", freq: f, dur: 0.2, vol: 0.18, delay: i * 0.07 }));
        break;
      case "stairs":
        [784, 659, 523, 392].forEach((f, i) => this.#tone({ type: "square", freq: f, dur: 0.15, vol: 0.12, delay: i * 0.09 }));
        break;
      case "bossRoar":
        this.#tone({ type: "sawtooth", freq: 90, to: 40, dur: 1.2, vol: 0.35, attack: 0.1 });
        this.#noise({ dur: 1.2, vol: 0.35, filter: 500, sweepTo: 100 });
        break;
      case "slam":
        this.#tone({ type: "sine", freq: 80, to: 25, dur: 0.5, vol: 0.5 });
        this.#noise({ dur: 0.4, vol: 0.4, filter: 700, sweepTo: 60 });
        break;
      case "telegraph":
        this.#tone({ type: "square", freq: 220, to: 440, dur: 0.3, vol: 0.08 });
        break;
      case "denied":
        this.#tone({ type: "square", freq: 160, dur: 0.12, vol: 0.12 });
        this.#tone({ type: "square", freq: 120, dur: 0.15, vol: 0.12, delay: 0.1 });
        break;
      case "select":
        this.#tone({ type: "square", freq: 660, dur: 0.05, vol: 0.1 });
        break;
      case "victory":
        [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => this.#tone({ type: "square", freq: f, dur: 0.25, vol: 0.14, delay: i * 0.13 }));
        break;
      case "gameover":
        [392, 370, 349, 330, 262].forEach((f, i) => this.#tone({ type: "triangle", freq: f, dur: 0.4, vol: 0.2, delay: i * 0.25 }));
        break;
      default:
        break;
    }
  }

  // ---------- música (sequenciador com agendamento à frente) ----------
  playMusic(trackIndex, boss = false) {
    if (!this.ctx) return;
    if (this.track === trackIndex && this.boss === boss) return;
    this.track = trackIndex;
    this.boss = boss;
    this.pattern = this.#composePattern(trackIndex, boss);
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    if (!this.timer) this.timer = setInterval(() => this.#schedule(), 25);
  }

  stopMusic() {
    clearInterval(this.timer);
    this.timer = null;
    this.track = -1;
  }

  #composePattern(index, boss) {
    const cfg = SCALES[index % SCALES.length];
    // gerador determinístico: cada fase tem sua própria melodia
    let seed = (index + 1) * 9301 + (boss ? 49297 : 0);
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const progression = boss ? [0, 5, 3, 6] : [0, 3, 4, 0, 5, 3, 6, 4];
    const lead = [];
    const bass = [];
    for (const degree of progression) {
      const chordRoot = cfg.scale[degree % cfg.scale.length];
      for (let s = 0; s < 8; s++) {
        bass.push(s % 2 === 0 ? cfg.root - 12 + chordRoot : s % 4 === 1 ? cfg.root + chordRoot : null);
        if (rnd() < (boss ? 0.8 : 0.6)) {
          const deg = Math.floor(rnd() * cfg.scale.length);
          const oct = rnd() < 0.3 ? 24 : 12;
          lead.push(cfg.root + oct + cfg.scale[deg]);
        } else lead.push(null);
      }
    }
    return { lead, bass, bpm: cfg.bpm * (boss ? 1.2 : 1), drums: boss };
  }

  #schedule() {
    if (!this.ctx || !this.pattern) return;
    const p = this.pattern;
    const stepDur = 60 / p.bpm / 2;
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      const i = this.step % p.lead.length;
      const t = this.nextNoteTime - this.ctx.currentTime;
      if (p.lead[i]) this.#tone({ type: "square", freq: midiToHz(p.lead[i]), dur: stepDur * 0.9, vol: 0.05, delay: t, out: this.musicGain });
      if (p.bass[i]) this.#tone({ type: "triangle", freq: midiToHz(p.bass[i]), dur: stepDur * 1.6, vol: 0.14, delay: t, out: this.musicGain });
      if (i % 4 === 0) this.#noise({ dur: 0.05, vol: p.drums ? 0.12 : 0.05, filter: 150, delay: t, out: this.musicGain });
      if (p.drums && i % 4 === 2) this.#noise({ dur: 0.08, vol: 0.08, filter: 4000, type: "highpass", delay: t, out: this.musicGain });
      this.nextNoteTime += stepDur;
      this.step++;
    }
  }
}
