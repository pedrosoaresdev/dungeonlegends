// Núcleo do jogo: máquina de estados, laço principal, mundo, combate e progressão.

import { Assets } from "./core/assets.js";
import { Input } from "./core/input.js";
import { AudioEngine } from "./core/audio.js";
import { RNG, clamp, lerp, TAU } from "./core/math.js";
import { Dungeon, TILE } from "./world/dungeon.js";
import { Player } from "./entities/player.js";
import { Enemy, Boss } from "./entities/enemy.js";
import { Pickup } from "./entities/pickup.js";
import { Effects } from "./entities/effects.js";
import { UI } from "./ui/ui.js";
import { Api } from "./net/api.js";
import { computeScore, absoluteFloor, totalFloors } from "./systems/rules.js";

export const VIEW_W = 480;
export const VIEW_H = 270;
const SAVE_VERSION = 1;

const DEFAULT_SETTINGS = { sfx: 0.6, music: 0.35, autoAim: false, shake: true, fps: false, apiUrl: "" };

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.light = document.createElement("canvas");
    this.light.width = VIEW_W;
    this.light.height = VIEW_H;
    this.lctx = this.light.getContext("2d");

    this.assets = new Assets();
    this.input = new Input(canvas, VIEW_W, VIEW_H);
    this.audio = new AudioEngine();
    this.api = new Api();
    this.fx = new Effects();
    this.ui = new UI(this);
    this.camera = { x: 0, y: 0 };
    this.shakeT = 0;
    this.shakeMag = 0;
    this.hitStop = 0;
    this.state = "loading";
    this.time = 0;
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.chests = [];
    this.levelQueue = 0;
    this.fpsAcc = { frames: 0, t: 0 };

    this.settings = { ...DEFAULT_SETTINGS, ...readJson("dl.settings") };
    this.audio.volumes.sfx = this.settings.sfx;
    this.audio.volumes.music = this.settings.music;
    if (this.settings.apiUrl) this.api.setBaseUrl(this.settings.apiUrl);
    this.settings.apiUrl = this.api.baseUrl;

    window.addEventListener("keydown", () => this.audio.unlock(), { once: true });
    window.addEventListener("pointerdown", () => this.audio.unlock(), { once: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.state === "play") this.pause();
    });
  }

  get content() {
    return this.assets.content;
  }

  // =================================================================
  // Inicialização
  // =================================================================
  async init() {
    await this.assets.load((p, t) => this.ui.setLoading(p, t));
    this.ui.bindSettings(this.settings, (k, v) => this.changeSetting(k, v));
    this.demo = new Dungeon({ seed: 1337, act: 1, floor: 1, isBoss: false, assets: this.assets });
    this.demoT = 0;
    this.state = "menu";
    await this.toTitle();
    requestAnimationFrame((t) => this.loop(t));
  }

  async toTitle() {
    this.state = "menu";
    this.ui.hideHud();
    this.audio.playMusic(5);
    const online = await this.api.connect();
    this.ui.setApiStatus(online, this.api.baseUrl);
    const save = await this.api.load();
    this.ui.setupTitle({ hasSave: !!save, playerName: this.api.player?.name, needsName: !this.api.hasPlayer });
    this.ui.history = [];
    this.ui.show("title", { remember: false });
  }

  changeSetting(key, value) {
    this.settings[key] = value;
    if (key === "sfx" || key === "music") this.audio.setVolume(key, value);
    if (key === "apiUrl") {
      this.api.setBaseUrl(value || "http://localhost:5080");
      this.api.connect().then((on) => this.ui.setApiStatus(on, this.api.baseUrl));
    }
    if (key === "fps") document.getElementById("fps").classList.toggle("hidden", !value);
    writeJson("dl.settings", this.settings);
  }

  // =================================================================
  // Ações dos menus
  // =================================================================
  async onAction(action, data = {}) {
    switch (action) {
      case "new":
      case "daily": {
        if (!(await this.ensurePlayer())) return;
        this.pendingDaily = action === "daily" ? await this.api.daily() : null;
        if (action === "daily" && !this.pendingDaily) {
          this.ui.toast("Desafio diário indisponível (API offline)", "#ffae5a");
          return;
        }
        this.ui.buildClassSelect(this.pendingDaily);
        this.ui.show("class");
        break;
      }
      case "continue":
        await this.continueGame();
        break;
      case "choose-class":
        await this.startRun(data.classId, this.pendingDaily);
        break;
      case "story-continue":
        clearInterval(this.ui.typeTimer);
        this.loadFloor();
        break;
      case "leaderboard":
        this.ui.showLeaderboard(this.api.leaderboard(10), this.api.player?.name);
        break;
      case "settings":
        this.ui.show("settings");
        break;
      case "help":
        this.ui.show("help");
        break;
      case "back": {
        const prev = this.ui.back();
        if (prev === "title") this.ui.setupTitle({ hasSave: !!this.api.localSave(), playerName: this.api.player?.name, needsName: !this.api.hasPlayer });
        break;
      }
      case "resume":
        this.resume();
        break;
      case "quit":
        await this.saveCheckpoint();
        await this.toTitle();
        break;
      case "title":
        await this.toTitle();
        break;
      case "shop-leave":
        this.leaveShop();
        break;
    }
  }

  async ensurePlayer() {
    if (this.api.hasPlayer) return true;
    const name = this.ui.typedName;
    if (!name) {
      this.ui.toast("Digite seu nome de herói primeiro!", "#ffae5a");
      document.getElementById("player-name").focus();
      return false;
    }
    try {
      await this.api.register(name);
      return true;
    } catch (e) {
      this.ui.toast(e.message || "Nome inválido", "#ff4a5a");
      return false;
    }
  }

  // =================================================================
  // Partida
  // =================================================================
  async startRun(classId, daily) {
    const cls = this.content.classes.find((c) => c.id === classId);
    const started = await this.api.startRun(classId, !!daily);
    this.levelQueue = 0;
    this.deathCause = null;
    this.run = {
      runId: started.runId,
      seed: started.seed >>> 0,
      heroClass: classId,
      act: 1,
      floor: 1,
      kills: 0,
      bossesKilled: 0,
      goldEarned: 0,
      timeMs: 0,
      floorsCleared: 0,
      daily: !!daily,
      modifier: started.modifier || daily?.modifier || null,
      shopBought: {},
    };
    this.player = new Player(this, 0, 0, cls);
    if (this.run.modifier?.id === "glass") {
      this.player.bonus.atk += 6;
      this.player.bonus.maxHp -= Math.round(this.player.stats.maxHp * 0.4);
      this.player.recompute();
      this.player.hp = this.player.stats.maxHp;
    }
    this.ui.showStory(this.content.acts[0]);
  }

  async continueGame() {
    const save = await this.api.load();
    if (!save || save.version !== SAVE_VERSION) {
      this.ui.toast("Save incompatível ou inexistente", "#ff4a5a");
      return;
    }
    const cls = this.content.classes.find((c) => c.id === save.heroClass);
    this.run = { ...save.run, heroClass: save.heroClass, shopBought: save.run.shopBought || {} };
    this.player = new Player(this, 0, 0, cls, save);
    this.loadFloor();
  }

  get act() {
    return this.content.acts[this.run.act - 1];
  }

  get isBossFloor() {
    return this.run.floor > this.act.floors;
  }

  difficulty() {
    const abs = absoluteFloor(this.content, this.run.act, this.run.floor);
    const m = this.run.modifier || {};
    return {
      hpMult: (1 + (abs - 1) * 0.13) * (m.enemyHpMult || 1),
      atkMult: (1 + (abs - 1) * 0.075) * (m.enemyAtkMult || 1),
    };
  }

  loadFloor() {
    const run = this.run;
    const floorSeed = (run.seed + run.act * 1009 + run.floor * 7919) >>> 0;
    this.rng = new RNG(floorSeed ^ 0x9e3779b9);
    this.dungeon = new Dungeon({ seed: floorSeed, act: run.act, floor: run.floor, isBoss: this.isBossFloor, assets: this.assets });
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.chests = [];
    this.fx.clear();
    this.boss = null;
    this.bossAwake = false;
    this.exitHint = 0;
    this.player.x = this.dungeon.start.x;
    this.player.y = this.dungeon.start.y;
    this.player.hasKey = false;
    this.player.kx = this.player.ky = 0;
    this.player.poisonT = 0;
    this.flowT = 0;
    this.camera.x = this.player.x - VIEW_W / 2;
    this.camera.y = this.player.y - VIEW_H / 2;

    const d = this.dungeon;
    const diff = this.difficulty();
    const pool = this.act.enemies.map((id) => this.content.enemies.find((e) => e.id === id));
    if (!d.isBoss) {
      for (const s of d.spawns) {
        // inimigos "difíceis" do pool ficam mais comuns em andares mais profundos
        const idx = Math.min(pool.length - 1, Math.floor(Math.pow(this.rng.next(), 1.4 - run.floor * 0.15) * pool.length));
        const def = pool[idx];
        this.spawnEnemy(def, s.x, s.y, { ...diff, elite: this.rng.chance(0.07 + run.act * 0.01) });
      }
      const keyDef = this.rng.pick(pool);
      this.spawnEnemy(keyDef, d.keySpawn.x, d.keySpawn.y, { ...diff, elite: true, keyHolder: true });
      for (const c of d.chests) {
        if (c.mimic) this.spawnEnemy(this.mimicDef(), c.x, c.y, { ...diff, mimic: true });
        else this.chests.push({ x: c.x, y: c.y, opened: false, openT: 0 });
      }
    } else if (run.bossesKilled >= run.act) {
      // save feito logo após derrotar o chefe: a escada já está aberta
      d.openExit();
    } else {
      const def = this.content.bosses.find((b) => b.id === this.act.boss);
      this.boss = new Boss(this, d.bossSpawn.x, d.bossSpawn.y, def, { hpMult: this.run.modifier?.enemyHpMult || 1, atkMult: this.run.modifier?.enemyAtkMult || 1 });
      this.boss.state = "sleep";
      this.enemies.push(this.boss);
    }

    this.state = "play";
    this.ui.hideScreens();
    this.ui.setupHud(this.player);
    this.ui.hideBoss();
    this.audio.playMusic(this.act.music, false);
    this.ui.banner(d.isBoss ? "Covil do Chefe" : `${this.act.name}`, d.isBoss ? this.act.subtitle : `${this.act.subtitle} · Andar ${run.floor}`);
    if (this.run.modifier && run.floor === 1 && run.act === 1) this.ui.toast(`Desafio: ${this.run.modifier.name}`, "#ffd23a");
    this.saveCheckpoint();
  }

  mimicDef() {
    const a = this.run.act;
    return { id: "mimic", name: "Mímico", sprite: "chest_mimic_open", hp: 70 + a * 25, atk: 10 + a * 4, speed: 95, xp: 25 * a, gold: 40 * a, ai: "chaser" };
  }

  // =================================================================
  // Laço principal
  // =================================================================
  loop(t) {
    const now = t / 1000;
    let dt = Math.min(1 / 30, now - (this.lastT ?? now));
    this.lastT = now;
    this.input.poll();

    if (this.input.pressed("mute")) {
      const m = this.audio.toggleMute();
      this.ui.toast(m ? "Som desligado (M)" : "Som ligado (M)");
    }

    if (this.state === "play") {
      if (this.input.pressed("pause")) this.pause();
      else if (this.hitStop > 0) this.hitStop -= dt;
      else this.update(dt);
    } else if (this.state === "paused" && this.input.pressed("pause")) this.resume();
    else if (this.state === "dying") {
      this.deathT -= dt;
      this.fx.update(dt);
      if (this.deathT <= 0) this.showGameOver();
    }

    this.time += dt;
    this.render(dt);
    this.input.endFrame();

    if (this.settings.fps) {
      this.fpsAcc.frames++;
      this.fpsAcc.t += dt;
      if (this.fpsAcc.t >= 0.5) {
        document.getElementById("fps").textContent = `${Math.round(this.fpsAcc.frames / this.fpsAcc.t)} FPS · ${this.enemies.length} inimigos`;
        this.fpsAcc = { frames: 0, t: 0 };
      }
    }
    requestAnimationFrame((tt) => this.loop(tt));
  }

  update(dt) {
    const p = this.player;
    const d = this.dungeon;
    this.run.timeMs += dt * 1000;

    p.update(dt);
    this.#updateStatusEffects(dt);

    // campo de fluxo para perseguição
    this.flowT -= dt;
    if (this.flowT <= 0) {
      this.flowT = 0.25;
      d.computeFlowField(p.x, p.y, 45);
    }

    // acorda o chefe ao entrar na arena
    if (this.boss && !this.bossAwake && d.arena && p.x > (d.arena.x + 2) * TILE) this.wakeBoss();
    if (this.boss && this.boss.state === "sleep") this.boss.animT += dt;

    for (const e of this.enemies) if (!e.dead && e.state !== "sleep") e.update(dt);
    for (const pr of this.projectiles) if (!pr.dead) pr.update(dt);
    for (const pk of this.pickups) if (!pk.dead) pk.update(dt);
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.projectiles = this.projectiles.filter((pr) => !pr.dead);
    this.pickups = this.pickups.filter((pk) => !pk.dead);
    if (this.boss) this.ui.updateBoss(this.boss);

    for (const c of this.chests) if (c.opened && c.openT < 1) c.openT += dt * 6;
    for (const f of d.fountains) f.t += dt;

    this.#updateSpikes(dt);
    this.#handleInteractions();

    d.reveal(p.x, p.y, 8);
    this.fx.update(dt);
    this.#updateCamera(dt);
    this.ui.updateHud(this);
    if (Math.floor(this.time * 10) !== this.lastMini) {
      this.lastMini = Math.floor(this.time * 10);
      this.ui.drawMinimap(this);
    }
    if (p.hp <= 0) this.playerDied();
  }

  #updateStatusEffects(dt) {
    const p = this.player;
    if (p.poisonT > 0) {
      p.poisonT -= dt;
      p.poisonTick = (p.poisonTick || 0) - dt;
      if (p.poisonTick <= 0) {
        p.poisonTick = 0.5;
        const dmg = Math.max(1, Math.round(p.stats.maxHp * 0.012));
        p.hp -= dmg;
        this.fx.text(p.x, p.y - 20, dmg, "#7dff4a");
        this.fx.burst(p.x, p.y - 8, "#5dff4a", 4, 30, 0.4);
        if (p.hp <= 0) this.deathCause = "Envenenado";
      }
    }
    if (p.slowT > 0 && Math.random() < 0.3) this.fx.trail(p.x + (Math.random() - 0.5) * 10, p.y - Math.random() * 16, "#9be7ff", 1, 0.4);
  }

  #updateSpikes() {
    const p = this.player;
    const ptx = Math.floor(p.x / TILE);
    const pty = Math.floor(p.y / TILE);
    for (const s of this.dungeon.spikes) {
      const phase = (this.time + s.phase) % 3;
      s.frame = phase < 2 ? 0 : phase < 2.15 ? 1 : phase < 2.8 ? 3 : 2;
      if (s.frame === 3 && s.tx === ptx && s.ty === pty && p.iframes <= 0) {
        this.deathCause = "Espetado por uma armadilha";
        this.damagePlayer(8 + this.run.act * 5, -Math.PI / 2, null);
      }
    }
  }

  #handleInteractions() {
    const p = this.player;
    this.prompt = null;
    // arma no chão
    let best = null;
    let bestD = 18;
    for (const pk of this.pickups) {
      if (pk.type !== "weapon" || pk.age < 0.3) continue;
      const dd = Math.hypot(pk.x - p.x, pk.y - p.y);
      if (dd < bestD) {
        bestD = dd;
        best = pk;
      }
    }
    if (best) {
      const w = best.data.weapon;
      const r = this.content.rarities[w.rarity];
      const diff = w.power - p.weapon.power;
      this.prompt = { x: best.x, y: best.y - 22, text: `[E] ${w.name} ATQ ${diff >= 0 ? "+" : ""}${diff}`, color: r.color };
      if (this.input.pressed("interact")) {
        this.pickups.push(new Pickup(this, p.x, p.y, "weapon", { weapon: p.weapon }));
        p.weapon = w;
        p.recompute();
        best.dead = true;
        this.audio.play("pickup");
        this.ui.toast(`Equipado: ${w.name} (${r.name})`, r.color);
      }
      return;
    }
    // baús
    for (const c of this.chests) {
      if (c.opened || Math.hypot(c.x - p.x, c.y - p.y) > 20) continue;
      this.prompt = { x: c.x, y: c.y - 18, text: "[E] Abrir", color: "#ffd23a" };
      if (this.input.pressed("interact")) this.openChest(c);
      return;
    }
    // escada
    const ex = this.dungeon.exit;
    if (ex && Math.hypot(ex.x - p.x, ex.y - p.y) < 16) {
      const can = this.dungeon.isBoss || p.hasKey;
      this.prompt = { x: ex.x, y: ex.y - 14, text: can ? "[E] Descer" : "Precisa da chave!", color: can ? "#5dff6a" : "#ff4a5a" };
      if (this.input.pressed("interact")) {
        if (can) this.nextFloor();
        else this.audio.play("denied");
      }
    }
  }

  #updateCamera(dt) {
    const p = this.player;
    const d = this.dungeon;
    // olha um pouco na direção da mira
    const look = 18;
    const tx = p.x + Math.cos(p.aim) * look - VIEW_W / 2;
    const ty = p.y - 8 + Math.sin(p.aim) * look - VIEW_H / 2;
    const k = 1 - Math.pow(0.0005, dt);
    this.camera.x = lerp(this.camera.x, tx, k);
    this.camera.y = lerp(this.camera.y, ty, k);
    const mw = d.w * TILE;
    const mh = d.h * TILE;
    this.camera.x = mw < VIEW_W ? (mw - VIEW_W) / 2 : clamp(this.camera.x, 0, mw - VIEW_W);
    this.camera.y = mh < VIEW_H ? (mh - VIEW_H) / 2 : clamp(this.camera.y, -16, mh - VIEW_H);
    if (this.shakeT > 0) this.shakeT -= dt;
  }

  shake(mag, time) {
    if (!this.settings.shake) return;
    if (mag >= this.shakeMag || this.shakeT <= 0) {
      this.shakeMag = mag;
      this.shakeT = time;
    }
  }

  // =================================================================
  // Renderização
  // =================================================================
  render() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#050307";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    if (this.state === "menu" || this.state === "loading" || !this.dungeon) {
      this.#renderDemo(ctx);
      return;
    }

    let sx = 0;
    let sy = 0;
    if (this.shakeT > 0) {
      sx = (Math.random() - 0.5) * this.shakeMag * 2;
      sy = (Math.random() - 0.5) * this.shakeMag * 2;
    }
    const cx = Math.round(this.camera.x + sx);
    const cy = Math.round(this.camera.y + sy);
    const d = this.dungeon;
    const A = this.assets;

    ctx.save();
    ctx.translate(-cx, -cy);
    ctx.drawImage(d.static, cx, cy, VIEW_W, VIEW_H, cx, cy, VIEW_W, VIEW_H);

    // elementos animados do cenário
    const inView = (x, y, m = 32) => x > cx - m && x < cx + VIEW_W + m && y > cy - m && y < cy + VIEW_H + m;
    for (const f of d.fountains) {
      const x = f.tx * TILE;
      const y = f.ty * TILE;
      if (!inView(x, y)) continue;
      const fr = Math.floor(f.t * 6);
      A.drawTile(ctx, "wall_fountain_top", x, y - TILE);
      A.drawTile(ctx, `wall_fountain_mid_${f.color}_anim`, x, y, fr);
      A.drawTile(ctx, `wall_fountain_basin_${f.color}_anim`, x, y + TILE, fr);
    }
    for (const s of d.spikes) {
      if (inView(s.tx * TILE, s.ty * TILE)) A.drawTile(ctx, "floor_spikes_anim", s.tx * TILE, s.ty * TILE, s.frame || 0);
    }
    if (d.exit) {
      const glow = 0.3 + Math.sin(this.time * 4) * 0.2;
      ctx.fillStyle = this.player.hasKey || d.isBoss ? `rgba(93,255,106,${glow})` : `rgba(255,210,58,${glow * 0.6})`;
      ctx.fillRect(d.exit.tx * TILE - 1, d.exit.ty * TILE - 1, TILE + 2, TILE + 2);
      A.drawTile(ctx, "floor_ladder", d.exit.tx * TILE, d.exit.ty * TILE);
    }

    this.fx.drawGround(ctx);

    for (const c of this.chests) {
      if (!inView(c.x, c.y)) continue;
      const frame = c.opened ? Math.min(2, Math.floor(c.openT * 3)) : 0;
      A.draw(ctx, c.opened && c.empty ? "chest_empty_open_anim" : "chest_full_open_anim", c.x, c.y + 4, { frame });
    }
    for (const pk of this.pickups) if (inView(pk.x, pk.y)) pk.draw(ctx);

    // entidades ordenadas por profundidade (y)
    const list = this.enemies.filter((e) => inView(e.x, e.y, 60));
    list.push(this.player);
    list.sort((a, b) => a.y - b.y);
    for (const e of list) if (!(e === this.player && this.state === "dying" && this.deathT < 1.2)) e.draw(ctx);

    for (const pr of this.projectiles) if (inView(pr.x, pr.y)) pr.draw(ctx);
    this.fx.draw(ctx);
    ctx.restore();

    this.#renderLighting(cx, cy);

    ctx.save();
    ctx.translate(-cx, -cy);
    this.fx.drawTexts(ctx);
    if (this.prompt) this.#drawPrompt(ctx, this.prompt);
    ctx.restore();

    this.#drawCrosshair(ctx);
  }

  #renderLighting(cx, cy) {
    const L = this.lctx;
    const d = this.dungeon;
    const p = this.player;
    const ambient = d.isBoss ? 0.62 : this.act.ambient * 0.9;
    L.globalCompositeOperation = "source-over";
    L.clearRect(0, 0, VIEW_W, VIEW_H);
    L.fillStyle = `rgba(4,2,10,${ambient})`;
    L.fillRect(0, 0, VIEW_W, VIEW_H);
    L.globalCompositeOperation = "destination-out";
    const hole = (x, y, r, a = 1) => {
      const gx = x - cx;
      const gy = y - cy;
      if (gx < -r || gy < -r || gx > VIEW_W + r || gy > VIEW_H + r) return;
      const g = L.createRadialGradient(gx, gy, 0, gx, gy, r);
      g.addColorStop(0, `rgba(0,0,0,${a})`);
      g.addColorStop(0.55, `rgba(0,0,0,${a * 0.75})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      L.fillStyle = g;
      L.beginPath();
      L.arc(gx, gy, r, 0, TAU);
      L.fill();
    };
    const flicker = 1 + Math.sin(this.time * 9) * 0.03 + Math.sin(this.time * 23) * 0.02;
    hole(p.x, p.y - 8, 135 * flicker);
    for (const f of d.fountains) hole(f.tx * TILE + 8, f.ty * TILE + 12, 64 * flicker, 0.85);
    if (d.exit) hole(d.exit.x, d.exit.y, 46, 0.8);
    for (const pr of this.projectiles) if (pr.light) hole(pr.x, pr.y, 34, 0.7);
    for (const e of this.enemies) if (e.isBoss || e.keyHolder) hole(e.x, e.y - e.h / 2, e.isBoss ? 90 : 40, 0.6);
    for (const pk of this.pickups) if (pk.type === "weapon" || pk.type === "key") hole(pk.x, pk.y, 22, 0.6);
    this.ctx.drawImage(this.light, 0, 0);

    // brilho colorido aditivo
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const glow = (x, y, r, color, a) => {
      const gx = x - cx;
      const gy = y - cy;
      if (gx < -r || gy < -r || gx > VIEW_W + r || gy > VIEW_H + r) return;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      g.addColorStop(0, hexA(color, a));
      g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
    };
    for (const f of d.fountains) glow(f.tx * TILE + 8, f.ty * TILE + 14, 48 * flicker, f.color === "red" ? "#ff4a1a" : "#2a8aff", 0.22);
    for (const pr of this.projectiles) if (pr.light) glow(pr.x, pr.y, 22, pr.light, 0.35);
    glow(p.x, p.y - 8, 60, "#ffb35a", 0.07);
    ctx.restore();
  }

  #renderDemo(ctx) {
    if (!this.demo) return;
    const d = this.demo;
    this.demoT += 1 / 60;
    const mw = d.w * TILE - VIEW_W;
    const mh = d.h * TILE - VIEW_H;
    const cx = Math.round(mw / 2 + Math.sin(this.demoT * 0.05) * mw * 0.45);
    const cy = Math.round(mh / 2 + Math.cos(this.demoT * 0.037) * mh * 0.4);
    ctx.drawImage(d.static, cx, cy, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
    for (const f of d.fountains) {
      const x = f.tx * TILE - cx;
      const y = f.ty * TILE - cy;
      if (x < -16 || y < -32 || x > VIEW_W || y > VIEW_H) continue;
      const fr = Math.floor(this.demoT * 6);
      this.assets.drawTile(ctx, "wall_fountain_top", x, y - TILE);
      this.assets.drawTile(ctx, `wall_fountain_mid_${f.color}_anim`, x, y, fr);
      this.assets.drawTile(ctx, `wall_fountain_basin_${f.color}_anim`, x, y + TILE, fr);
    }
    const L = this.lctx;
    L.globalCompositeOperation = "source-over";
    L.clearRect(0, 0, VIEW_W, VIEW_H);
    L.fillStyle = "rgba(4,2,10,0.8)";
    L.fillRect(0, 0, VIEW_W, VIEW_H);
    L.globalCompositeOperation = "destination-out";
    const lx = VIEW_W / 2 + Math.sin(this.demoT * 0.7) * 140;
    const ly = VIEW_H / 2 + Math.cos(this.demoT * 0.5) * 60;
    const g = L.createRadialGradient(lx, ly, 0, lx, ly, 170);
    g.addColorStop(0, "rgba(0,0,0,0.85)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    L.fillStyle = g;
    L.fillRect(0, 0, VIEW_W, VIEW_H);
    for (const f of d.fountains) {
      const x = f.tx * TILE - cx + 8;
      const y = f.ty * TILE - cy + 12;
      const gg = L.createRadialGradient(x, y, 0, x, y, 60);
      gg.addColorStop(0, "rgba(0,0,0,0.8)");
      gg.addColorStop(1, "rgba(0,0,0,0)");
      L.fillStyle = gg;
      L.fillRect(x - 60, y - 60, 120, 120);
    }
    ctx.drawImage(this.light, 0, 0);
  }

  #drawPrompt(ctx, pr) {
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    const w = ctx.measureText(pr.text).width + 8;
    const x = Math.round(pr.x);
    const y = Math.round(pr.y);
    ctx.fillStyle = "rgba(8,5,12,0.85)";
    ctx.fillRect(x - w / 2, y - 9, w, 12);
    ctx.fillStyle = pr.color;
    ctx.fillText(pr.text, x, y);
  }

  #drawCrosshair(ctx) {
    if (this.state !== "play" || this.settings.autoAim || this.input.usingPad) return;
    const { x, y } = this.input.mouse;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(Math.round(x) + 0.5, Math.round(y) + 0.5, 4, 0, TAU);
    ctx.moveTo(x - 7, y + 0.5);
    ctx.lineTo(x - 3, y + 0.5);
    ctx.moveTo(x + 3, y + 0.5);
    ctx.lineTo(x + 7, y + 0.5);
    ctx.stroke();
  }

  // =================================================================
  // Mundo / combate
  // =================================================================
  nearestEnemy(x, y, maxDist, requireLos = false) {
    let best = null;
    let bestD = maxDist;
    for (const e of this.enemies) {
      if (e.dead || e.dormant || e.state === "sleep") continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bestD && (!requireLos || this.dungeon.lineOfSight(x, y - 6, e.x, e.y - 6))) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  rngShuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  findSpotNear(x, y, radius, entityR = 6) {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * TAU;
      const r = radius * (0.6 + Math.random() * 0.4);
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (!this.dungeon.boxCollides(px, py, entityR)) return { x: px, y: py };
    }
    return this.dungeon.boxCollides(x, y, entityR) ? null : { x, y };
  }

  spawnEnemy(def, x, y, mods = {}) {
    if (!def) return null;
    const diff = mods.hpMult ? {} : this.difficulty();
    const e = new Enemy(this, x, y, def, { ...diff, ...mods });
    if (this.dungeon.boxCollides(e.x, e.y, e.r)) {
      const spot = this.findSpotNear(x, y, 24, e.r);
      if (!spot) return null;
      e.x = spot.x;
      e.y = spot.y;
    }
    this.enemies.push(e);
    return e;
  }

  wakeBoss() {
    this.bossAwake = true;
    this.boss.state = "intro";
    this.boss.stateT = 1.6;
    this.audio.play("bossRoar");
    this.audio.playMusic(this.act.music, true);
    this.shake(6, 1.0);
    this.ui.banner(this.boss.def.name, "CHEFE");
    this.ui.showBoss(this.boss);
  }

  onBossPhase() {
    this.ui.toast("O chefe ficou furioso!", "#ff4a4a");
  }

  damageEnemy(e, amount, crit, angle, knock = 80) {
    if (e.dead || e.dormant || e.state === "sleep") return;
    const p = this.player;
    const dmg = Math.max(1, Math.round(amount));
    e.hp -= dmg;
    e.flash = 0.1;
    e.hpBarT = 3;
    e.aggro = true;
    const resist = e.isBoss ? 0.08 : e.elite ? 0.6 : 1;
    if (e.state !== "charge") e.knock(angle, knock * resist);
    this.fx.text(e.x, e.y - e.h - 2, crit ? dmg + "!" : dmg, crit ? "#ffd23a" : "#ffffff", crit);
    this.fx.burst(e.x, e.y - e.h * 0.4, e.def.ai === "exploder" || e.def.id === "swampy" ? "#5dff4a" : "#c0182a", crit ? 10 : 5, crit ? 110 : 70, 0.4);
    this.audio.play(crit ? "crit" : "hit");
    if (crit) this.hitStop = 0.035;
    if (p.stats.lifesteal > 0) p.hp = Math.min(p.stats.maxHp, p.hp + dmg * p.stats.lifesteal);
    if (e.hp <= 0) this.killEnemy(e);
  }

  killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    const run = this.run;
    const p = this.player;
    const m = run.modifier || {};
    run.kills++;
    this.fx.burst(e.x, e.y - e.h / 2, "#ffffff", 8, 90, 0.35);
    this.fx.burst(e.x, e.y - e.h / 2, "#7a1020", 12, 70, 0.6, 2, 120);
    this.audio.play("enemyDie");
    p.addXp(Math.round(e.xp * (m.xpMult || 1)));
    this.dropGold(e.x, e.y, e.gold);
    if (Math.random() < 0.07) this.pickups.push(new Pickup(this, e.x, e.y, "hp"));
    if (Math.random() < 0.06) this.pickups.push(new Pickup(this, e.x, e.y, "mp"));
    const weaponChance = e.isBoss ? 1 : e.mimic ? 0.8 : e.elite ? 0.4 : 0.025;
    if (Math.random() < weaponChance) this.dropWeapon(e.x, e.y, e.isBoss ? "epic" : e.elite || e.mimic ? "rare" : null);
    if (e.keyHolder) {
      this.pickups.push(new Pickup(this, e.x, e.y, "key"));
      this.ui.toast("O Elite deixou cair a CHAVE!", "#ffd23a");
    }
    if (e.def.ai === "splitter" && !e.mini) {
      for (let i = 0; i < 2; i++) this.spawnEnemy(e.def, e.x + (i ? 6 : -6), e.y, { mini: true, hpMult: e.maxHp / e.def.hp });
    }
    if (e.isBoss) this.bossDefeated(e);
  }

  bossDefeated(boss) {
    const run = this.run;
    run.bossesKilled++;
    this.shake(10, 1.2);
    this.audio.play("explosion");
    for (let i = 0; i < 6; i++) setTimeout(() => this.fx.burst(boss.x + (Math.random() - 0.5) * 40, boss.y - 20 + (Math.random() - 0.5) * 30, i % 2 ? "#ffd23a" : "#ff5a2a", 30, 160, 0.8, 3), i * 150);
    this.ui.hideBoss();
    for (const e of this.enemies) if (!e.dead && e !== boss) this.killEnemy(e);
    this.projectiles = this.projectiles.filter((p) => p.owner === "player");
    this.dropGold(boss.x, boss.y, boss.gold);
    for (let i = 0; i < 2; i++) this.pickups.push(new Pickup(this, boss.x, boss.y, "hp"));
    this.audio.playMusic(this.act.music, false);
    if (run.act >= this.content.acts.length) {
      this.ui.banner("VITÓRIA!", boss.def.name + " foi derrotado");
      this.audio.play("victory");
      setTimeout(() => this.victory(), 3500);
    } else {
      this.dungeon.openExit();
      this.ui.banner("CHEFE DERROTADO!", "A escada para a próxima fase se abriu");
      this.audio.play("levelup");
    }
  }

  dropGold(x, y, amount) {
    const mult = this.player.stats.goldMult * (this.run.modifier?.goldMult || 1);
    let total = Math.round(amount * mult * (0.8 + Math.random() * 0.4));
    const coins = Math.min(12, Math.max(1, Math.ceil(total / 5)));
    for (let i = 0; i < coins; i++) {
      const v = i === coins - 1 ? total : Math.floor(total / (coins - i));
      total -= v;
      if (v > 0) this.pickups.push(new Pickup(this, x, y - 4, "coin", { value: v }));
    }
  }

  rollWeapon(minRarity = null) {
    const act = this.run.act;
    const order = ["common", "rare", "epic", "legendary"];
    const minIdx = minRarity ? order.indexOf(minRarity) : 0;
    const entries = Object.entries(this.content.rarities)
      .filter(([id, r]) => order.indexOf(id) >= minIdx && act >= r.minAct)
      .map(([id, r]) => ({ item: id, weight: r.weight * (id === "legendary" || id === "epic" ? 1 + act * 0.3 : 1) }));
    const rarity = (entries.length ? this.rng.weighted(entries) : minRarity) || "common";
    const options = this.content.weapons.filter((w) => w.rarity === rarity);
    return this.rng.pick(options);
  }

  dropWeapon(x, y, minRarity) {
    const w = this.rollWeapon(minRarity);
    if (!w) return;
    this.pickups.push(new Pickup(this, x, y, "weapon", { weapon: w }));
    if (w.rarity === "epic" || w.rarity === "legendary") this.fx.ring(x, y, 30, this.content.rarities[w.rarity].color, 0.6, 2);
  }

  openChest(c) {
    c.opened = true;
    this.audio.play("chest");
    this.fx.burst(c.x, c.y - 6, "#ffd23a", 20, 90, 0.6);
    this.dropGold(c.x, c.y, 25 + this.run.act * 18);
    if (Math.random() < 0.45) this.dropWeapon(c.x, c.y, Math.random() < 0.3 ? "rare" : null);
    if (Math.random() < 0.4) this.pickups.push(new Pickup(this, c.x, c.y, Math.random() < 0.6 ? "hp" : "mp"));
    setTimeout(() => (c.empty = true), 600);
  }

  collect(pk) {
    const p = this.player;
    switch (pk.type) {
      case "coin":
        p.gold += pk.data.value;
        this.run.goldEarned += pk.data.value;
        this.audio.play("coin");
        break;
      case "hp":
        p.heal(Math.round(p.stats.maxHp * 0.15));
        this.audio.play("potion");
        break;
      case "mp":
        p.mana = Math.min(p.stats.maxMana, p.mana + p.stats.maxMana * 0.4);
        this.fx.text(p.x, p.y - 24, "+MANA", "#6fb7ff");
        this.audio.play("potion");
        break;
      case "key":
        p.hasKey = true;
        this.audio.play("levelup");
        this.ui.toast("Chave obtida! Encontre a escada ▼", "#ffd23a");
        break;
    }
  }

  damagePlayer(raw, angle, onHit, source = null) {
    if (this.state !== "play") return;
    const p = this.player;
    const dealt = p.takeDamage(raw);
    if (dealt <= 0) return;
    this.fx.text(p.x, p.y - 22, dealt, "#ff4a5a", dealt > p.stats.maxHp * 0.15);
    this.fx.burst(p.x, p.y - 8, "#ff2a3a", 8, 80, 0.4);
    this.audio.play("hurt");
    this.shake(3, 0.15);
    p.knock(angle, 110);
    if (onHit === "slow") p.slowT = 2;
    if (onHit === "poison") p.poisonT = 3;
    if (source && !source.dead && p.stats.thorns > 0) this.damageEnemy(source, dealt * p.stats.thorns + p.stats.atk * 0.3, false, angle + Math.PI, 40);
    if (source && p.shieldT > 0 && !source.dead) this.damageEnemy(source, p.stats.atk * 0.8, false, angle + Math.PI, 120);
    if (source) this.deathCause = `Derrotado por ${source.def.name}`;
  }

  // =================================================================
  // Progressão
  // =================================================================
  onLevelUp() {
    this.audio.play("levelup");
    this.fx.ring(this.player.x, this.player.y - 8, 50, "#ffd23a", 0.6, 3);
    this.fx.burst(this.player.x, this.player.y - 8, "#ffd23a", 30, 120, 0.8, 2, -40);
    this.fx.text(this.player.x, this.player.y - 30, "LEVEL UP!", "#ffd23a", true);
    this.levelQueue++;
    if (this.state === "play") setTimeout(() => this.showNextPerk(), 450);
  }

  showNextPerk() {
    if (this.levelQueue <= 0 || this.state !== "play") return;
    const p = this.player;
    const avail = this.content.perks.filter((k) => (p.perks[k.id] || 0) < k.max);
    if (!avail.length) {
      this.levelQueue = 0;
      return;
    }
    const choices = this.rngShuffle(avail)
      .slice(0, 3)
      .map((k) => ({ ...k, current: p.perks[k.id] || 0 }));
    this.state = "levelup";
    this.ui.showPerks(p.level - this.levelQueue + 1, choices, (perk) => {
      this.ui.clearPerkKeys();
      p.perks[perk.id] = (p.perks[perk.id] || 0) + 1;
      if (perk.id === "vitality") {
        p.recompute();
        p.hp = p.stats.maxHp;
      }
      p.recompute();
      this.levelQueue--;
      this.audio.play("pickup");
      this.ui.toast(`${perk.icon} ${perk.name}`, "#ffd23a");
      this.state = "play";
      this.ui.hideScreens();
      this.lastT = undefined;
      if (this.levelQueue > 0) setTimeout(() => this.showNextPerk(), 200);
    });
  }

  nextFloor() {
    const run = this.run;
    this.audio.play("stairs");
    run.floorsCleared++;
    const wasBoss = this.isBossFloor;
    if (wasBoss) {
      if (run.act >= this.content.acts.length) return this.victory();
      this.openShop();
      return;
    }
    run.floor++;
    this.loadFloor();
  }

  // ---------------- loja ----------------
  openShop() {
    const p = this.player;
    this.state = "shop";
    p.hp = p.stats.maxHp;
    p.mana = p.stats.maxMana;
    this.ui.hideHud();
    this.audio.playMusic(5);
    this.refreshShop();
  }

  shopItems() {
    const bought = this.run.shopBought;
    return this.content.shop.map((it) => {
      const n = bought[it.id] || 0;
      const scale = it.id.startsWith("potion") ? 1 + n * 0.25 : 1 + n * 0.6;
      return { ...it, price: Math.round(it.price * scale * (1 + (this.run.act - 1) * 0.15)) };
    });
  }

  refreshShop() {
    this.ui.showShop(this.shopItems(), this.player.gold, (it) => this.buy(it));
  }

  buy(it) {
    const p = this.player;
    if (p.gold < it.price) return this.audio.play("denied");
    p.gold -= it.price;
    this.run.shopBought[it.id] = (this.run.shopBought[it.id] || 0) + 1;
    switch (it.id) {
      case "potion_hp":
        p.potions.hp++;
        break;
      case "potion_mp":
        p.potions.mp++;
        break;
      case "elixir_atk":
        p.bonus.atk += 3;
        break;
      case "elixir_def":
        p.bonus.def += 2;
        break;
      case "heart":
        p.bonus.maxHp += 25;
        break;
      case "mystery": {
        const w = this.rollWeapon(Math.random() < 0.25 ? "epic" : "rare");
        const r = this.content.rarities[w.rarity];
        if (w.power > p.weapon.power) {
          p.weapon = w;
          this.ui.toast(`Nova arma: ${w.name} (${r.name})!`, r.color);
        } else {
          p.gold += Math.round(it.price * 0.6);
          this.ui.toast(`${w.name} é pior que sua arma. Vendida de volta.`, r.color);
        }
        break;
      }
    }
    p.recompute();
    p.hp = p.stats.maxHp;
    this.audio.play("coin");
    this.refreshShop();
  }

  leaveShop() {
    const run = this.run;
    run.act++;
    run.floor = 1;
    this.state = "story";
    this.ui.showStory(this.act);
  }

  // ---------------- pausa ----------------
  pause() {
    if (this.state !== "play") return;
    this.state = "paused";
    const p = this.player;
    const s = p.stats;
    this.ui.statsSheet("#pause-stats", [
      ["Classe", p.cls.name],
      ["Nível", p.level],
      ["Ataque", Math.round(s.atk * s.dmgMult)],
      ["Defesa", Math.round(s.def)],
      ["Crítico", Math.round(s.crit * 100) + "%"],
      ["Vel. ataque", s.attackRate.toFixed(2) + "/s"],
      ["Arma", p.weapon.name],
      ["Abates", this.run.kills],
    ]);
    this.ui.history = [];
    this.ui.show("pause", { remember: false });
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "play";
    this.ui.hideScreens();
    this.lastT = undefined;
  }

  // ---------------- fim de jogo ----------------
  playerDied() {
    if (this.state !== "play") return;
    this.state = "dying";
    this.deathT = 2.2;
    const p = this.player;
    this.fx.burst(p.x, p.y - 8, "#ff2a3a", 40, 140, 1, 3);
    this.fx.burst(p.x, p.y - 8, "#ffffff", 20, 100, 0.6);
    this.audio.play("gameover");
    this.audio.stopMusic();
    this.shake(8, 0.6);
  }

  summary(victory) {
    const p = this.player;
    return {
      heroClass: this.run.heroClass,
      floorsCleared: victory ? totalFloors(this.content) : this.run.floorsCleared,
      kills: this.run.kills,
      bossesKilled: this.run.bossesKilled,
      goldEarned: this.run.goldEarned,
      level: p.level,
      timeMs: Math.round(this.run.timeMs),
      victory,
      act: this.run.act,
      floor: this.run.floor,
      seed: this.run.seed,
    };
  }

  async finishRun(victory) {
    const s = this.summary(victory);
    const local = computeScore(this.content.rules, s);
    await this.api.deleteSave();
    const res = await this.api.finishRun(this.run.runId, s, local);
    const t = Math.round(s.timeMs / 1000);
    const rows = [
      ["Classe", this.player.cls.name],
      ["Nível", s.level],
      ["Andares", s.floorsCleared],
      ["Abates", s.kills],
      ["Chefes", s.bossesKilled],
      ["Ouro", s.goldEarned],
      ["Tempo", `${Math.floor(t / 60)}m${String(t % 60).padStart(2, "0")}s`],
      ["Modo", this.run.daily ? "Diário" : res.offline ? "Offline" : "Online"],
    ];
    return { rows, score: res.score ?? local, rank: res.rank };
  }

  async showGameOver() {
    this.state = "gameover";
    this.ui.hideHud();
    const data = await this.finishRun(false);
    this.ui.showEnd("gameover", { ...data, cause: this.deathCause || "Sua lenda termina aqui." });
  }

  async victory() {
    if (this.state === "victory") return;
    this.state = "victory";
    this.run.floorsCleared = totalFloors(this.content);
    this.ui.hideHud();
    this.audio.playMusic(5);
    const data = await this.finishRun(true);
    this.ui.showEnd("victory", data);
  }

  async saveCheckpoint() {
    if (!this.run || !this.player || this.player.hp <= 0) return;
    const { shopBought, ...runRest } = this.run;
    await this.api.save({
      version: SAVE_VERSION,
      heroClass: this.run.heroClass,
      run: { ...runRest, shopBought: { ...shopBought }, timeMs: Math.round(this.run.timeMs) },
      hero: this.player.toSave(),
    });
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

function writeJson(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignora */
  }
}
