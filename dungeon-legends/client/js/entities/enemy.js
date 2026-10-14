// Inimigos com IA por comportamento + chefes com padrões de ataque e 2 fases.

import { Entity } from "./entity.js";
import { Projectile } from "./projectile.js";
import { TAU, normalize } from "../core/math.js";

export class Enemy extends Entity {
  /**
   * @param {object} def definição do content.json
   * @param {object} mods { hpMult, atkMult, elite, mini, keyHolder, mimic }
   */
  constructor(game, x, y, def, mods = {}) {
    const A = game.assets;
    const spriteName = A.anim(def.sprite, "idle");
    const s = A.get(spriteName);
    const scale = (def.scale || 1) * (mods.elite ? 1.25 : 1) * (mods.mini ? 0.7 : 1);
    super(game, x, y, Math.max(4, (s.w * scale) / 2 - 3));
    this.def = def;
    this.scale = scale;
    this.w = s.w * scale;
    this.h = s.h * scale;
    this.elite = !!mods.elite;
    this.mini = !!mods.mini;
    this.keyHolder = !!mods.keyHolder;
    this.mimic = !!mods.mimic;
    this.dormant = this.mimic; // mímico parece um baú até você chegar perto
    const hpMult = (mods.hpMult || 1) * (this.elite ? 2.4 : 1) * (this.mini ? 0.35 : 1);
    this.maxHp = Math.round(def.hp * hpMult);
    this.hp = this.maxHp;
    this.atk = def.atk * (mods.atkMult || 1) * (this.elite ? 1.35 : 1);
    this.speed = def.speed * (this.mini ? 1.25 : 1) * (0.9 + Math.random() * 0.2);
    this.xp = Math.round(def.xp * (this.elite ? 3 : 1) * (this.mini ? 0.3 : 1) * (mods.xpMult || 1));
    this.gold = Math.round(def.gold * (this.elite ? 3 : 1) * (this.mini ? 0.3 : 1));
    this.ai = def.ai;
    this.aggro = false;
    this.contactCd = 0;
    this.shootCd = 1 + Math.random() * 1.5;
    this.chargeCd = 1.5 + Math.random();
    this.summonCd = 3 + Math.random() * 2;
    this.state = "idle";
    this.stateT = 0;
    this.chargeDir = { x: 0, y: 0 };
    this.fuse = 0;
    this.moving = false;
    this.hpBarT = 0;
    this.spawnT = mods.spawnAnim ? 0.5 : 0;
    this.summoned = [];
  }

  get isBoss() {
    return false;
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    this.animT += dt;
    this.flash -= dt;
    this.contactCd -= dt;
    this.hpBarT -= dt;
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      return;
    }
    this.applyKnockback(dt);

    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy);

    if (this.dormant) {
      if (d < 26) {
        this.dormant = false;
        this.aggro = true;
        g.audio.play("bossRoar");
        g.fx.text(this.x, this.y - 22, "MÍMICO!", "#ff4a4a", true);
        g.shake(3, 0.2);
      }
      return;
    }

    if (!this.aggro) {
      if (d < 165 && g.dungeon.lineOfSight(this.x, this.y - 4, p.x, p.y - 4)) this.aggro = true;
      else return;
    }
    if (d > 520) {
      this.aggro = false;
      return;
    }

    this.moving = false;
    const los = d < 260 && g.dungeon.lineOfSight(this.x, this.y - 4, p.x, p.y - 4);
    switch (this.ai) {
      case "archer":
        this.aiRanged(dt, d, dx, dy, los, 70, 140);
        break;
      case "summoner":
        this.aiSummoner(dt, d, dx, dy, los);
        break;
      case "charger":
        this.aiCharger(dt, d, dx, dy, los);
        break;
      case "exploder":
        this.aiExploder(dt, d, dx, dy, los);
        break;
      default:
        this.chase(dt, d, dx, dy, los, 1);
    }
    this.facing = dx >= 0 ? 1 : -1;
    this.separate(dt);

    // dano por contato
    const reach = this.r + p.r + 3;
    if (d < reach && this.contactCd <= 0 && this.state !== "fuse") {
      this.contactCd = 0.9;
      const mult = this.state === "charge" ? 1.6 : 1;
      g.damagePlayer(this.atk * mult, Math.atan2(dy, dx), this.def.onHit, this);
    }
  }

  chase(dt, d, dx, dy, los, speedMult) {
    const g = this.game;
    let dir;
    if (los && d < 140) dir = normalize(dx, dy);
    else dir = g.dungeon.flowDirection(this.x, this.y) || normalize(dx, dy);
    if (d > this.r + 8) {
      this.moveBy(dir.x * this.speed * speedMult * dt, dir.y * this.speed * speedMult * dt);
      this.moving = true;
    }
  }

  flee(dt, dx, dy) {
    const dir = normalize(-dx, -dy);
    this.moveBy(dir.x * this.speed * 0.8 * dt, dir.y * this.speed * 0.8 * dt);
    this.moving = true;
  }

  aiRanged(dt, d, dx, dy, los, near, far) {
    if (!los || d > far) this.chase(dt, d, dx, dy, los, 1);
    else if (d < near) this.flee(dt, dx, dy);
    this.shootCd -= dt;
    if (los && d < 230 && this.shootCd <= 0) {
      this.shootCd = 1.7 + Math.random() * 0.8;
      this.shoot(Math.atan2(dy - 6, dx), this.def.projectile || "bone", 125);
      if (this.elite) {
        this.shoot(Math.atan2(dy - 6, dx) + 0.25, this.def.projectile || "bone", 125);
        this.shoot(Math.atan2(dy - 6, dx) - 0.25, this.def.projectile || "bone", 125);
      }
    }
  }

  aiSummoner(dt, d, dx, dy, los) {
    this.aiRanged(dt, d, dx, dy, los, 90, 160);
    this.summonCd -= dt;
    this.summoned = this.summoned.filter((e) => !e.dead);
    if (los && this.summonCd <= 0 && this.summoned.length < 3) {
      this.summonCd = 6;
      const def = this.game.content.enemies.find((e) => e.id === this.def.summon);
      for (let i = 0; i < 2; i++) {
        const e = this.game.spawnEnemy(def, this.x + (Math.random() - 0.5) * 30, this.y + (Math.random() - 0.5) * 30, { mini: false, spawnAnim: true, xpMult: 0.4 });
        if (e) this.summoned.push(e);
      }
      this.game.fx.burst(this.x, this.y - 8, "#b36bff", 20, 80, 0.5);
    }
  }

  aiCharger(dt, d, dx, dy, los) {
    const g = this.game;
    this.chargeCd -= dt;
    if (this.state === "windup") {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.state = "charge";
        this.stateT = 0.45;
      }
      return;
    }
    if (this.state === "charge") {
      this.stateT -= dt;
      const hit = this.moveBy(this.chargeDir.x * 270 * dt, this.chargeDir.y * 270 * dt);
      this.moving = true;
      g.fx.trail(this.x, this.y - 4, "#ffffff", 2, 0.2);
      if (this.stateT <= 0 || hit.hitX || hit.hitY) {
        this.state = "idle";
        this.chargeCd = 2.5 + Math.random();
      }
      return;
    }
    if (los && d < 140 && d > 30 && this.chargeCd <= 0) {
      this.state = "windup";
      this.stateT = 0.55;
      this.chargeDir = normalize(dx, dy);
      g.fx.telegraph({ kind: "line", x: this.x, y: this.y, angle: Math.atan2(dy, dx), length: 125, width: this.r * 2 + 4, duration: 0.55 });
      return;
    }
    this.chase(dt, d, dx, dy, los, 1);
  }

  aiExploder(dt, d, dx, dy, los) {
    const g = this.game;
    if (this.state === "fuse") {
      this.fuse -= dt;
      this.flash = Math.floor(this.fuse * 12) % 2 === 0 ? 0.05 : 0;
      if (this.fuse <= 0) {
        const radius = 40;
        g.fx.ring(this.x, this.y - 4, radius, "#7dff4a", 0.4, 3);
        g.fx.burst(this.x, this.y - 4, "#5dff4a", 30, 160, 0.6, 3);
        g.audio.play("explosion");
        g.shake(4, 0.25);
        if (Math.hypot(g.player.x - this.x, g.player.y - this.y) < radius + g.player.r) g.damagePlayer(this.atk * 2.2, Math.atan2(dy, dx), "poison", this);
        this.hp = 0;
        g.killEnemy(this);
      }
      return;
    }
    if (d < 24) {
      this.state = "fuse";
      this.fuse = 0.7;
      g.fx.telegraph({ kind: "circle", x: this.x, y: this.y, radius: 40, duration: 0.7, color: "#7dff4a" });
      g.audio.play("telegraph");
      return;
    }
    this.chase(dt, d, dx, dy, los, 1.15);
  }

  shoot(angle, kind, speed, opts = {}) {
    const g = this.game;
    g.projectiles.push(
      new Projectile(g, {
        x: this.x + Math.cos(angle) * 6,
        y: this.y - this.h * 0.45 + Math.sin(angle) * 6,
        angle,
        speed,
        kind,
        owner: "enemy",
        damage: this.atk * (opts.dmgMult || 0.9),
        life: opts.life || 3,
        onHit: kind === "ice" ? "slow" : kind === "poison" ? "poison" : null,
        homing: opts.homing || 0,
        accel: opts.accel || 0,
        radius: opts.radius,
      })
    );
  }

  /** Empurra inimigos sobrepostos para que não fiquem empilhados. */
  separate(dt) {
    for (const o of this.game.enemies) {
      if (o === this || o.dead) continue;
      const dx = this.x - o.x;
      const dy = this.y - o.y;
      const min = this.r + o.r;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0.01 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * 0.5;
        this.moveBy(dx * push * Math.min(1, dt * 20), dy * push * Math.min(1, dt * 20));
      }
    }
  }

  draw(ctx) {
    const A = this.game.assets;
    if (this.dormant) {
      A.draw(ctx, "chest_mimic_open_anim", this.x, this.y + 2, { frame: 0 });
      return;
    }
    if (this.mimic) {
      this.drawShadow(ctx, 14);
      A.draw(ctx, "chest_mimic_open_anim", this.x, this.y + 2, { frame: 1 + (Math.floor(this.animT * 8) % 2), white: this.flash > 0, flip: this.facing < 0 });
      this.drawHpBar(ctx);
      return;
    }
    const anim = A.anim(this.def.sprite, this.moving ? "run" : "idle");
    const frame = Math.floor(this.animT * (this.moving ? 10 : 6));
    let alpha = 1;
    if (this.spawnT > 0) alpha = 1 - this.spawnT / 0.5;
    this.drawShadow(ctx, this.w * 0.8);
    const scale = this.scale * (this.state === "fuse" ? 1 + (0.7 - this.fuse) * 0.4 : 1);
    if (this.elite && !this.isBoss) {
      // contorno brilhante de elite
      const glow = this.keyHolder ? "#ffd23a" : "#ff5af0";
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) A.draw(ctx, anim, this.x + ox, this.y + 1 + oy, { frame, flip: this.facing < 0, scale, tint: glow, tintAmount: 1, alpha: 0.85 * alpha });
    }
    const tint = this.flash > 0 ? null : this.def.tint || (this.state === "windup" && Math.floor(this.stateT * 15) % 2 ? "#ffffff" : null);
    A.draw(ctx, anim, this.x, this.y + 1, { frame, flip: this.facing < 0, scale, white: this.flash > 0, tint, tintAmount: 0.45, alpha });
    if (this.keyHolder) {
      const by = this.y - this.h - 6 + Math.sin(this.animT * 4) * 1.5;
      ctx.fillStyle = "#ffd23a";
      ctx.fillRect(Math.round(this.x) - 3, Math.round(by), 3, 3);
      ctx.fillRect(Math.round(this.x), Math.round(by) + 1, 4, 1);
    }
    this.drawHpBar(ctx);
  }

  drawHpBar(ctx) {
    if (this.hpBarT <= 0 || this.isBoss) return;
    const w = Math.max(12, this.w * 0.9);
    const x = Math.round(this.x - w / 2);
    const y = Math.round(this.y - this.h - 4);
    ctx.fillStyle = "#000";
    ctx.fillRect(x - 1, y - 1, w + 2, 4);
    ctx.fillStyle = "#3a0b12";
    ctx.fillRect(x, y, w, 2);
    ctx.fillStyle = this.elite ? "#ff5af0" : "#ff3b4e";
    ctx.fillRect(x, y, Math.max(0, (this.hp / this.maxHp) * w), 2);
  }
}

// =====================================================================
// Chefes
// =====================================================================
export class Boss extends Enemy {
  constructor(game, x, y, def, mods = {}) {
    super(game, x, y, { ...def, scale: def.scale || 1.5, ai: "boss" }, mods);
    this.elite = true;
    this.phase = 1;
    this.patternQueue = [];
    this.state = "intro";
    this.stateT = 1.6;
    this.patternT = 0;
    this.sub = 0;
    this.r = Math.max(10, this.w * 0.32);
    this.alpha = 1;
    this.spiralA = 0;
  }

  get isBoss() {
    return true;
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    this.animT += dt;
    this.flash -= dt;
    this.contactCd -= dt;
    this.applyKnockback(dt);
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy);
    this.facing = dx >= 0 ? 1 : -1;
    this.moving = false;

    if (this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2;
      this.speed *= 1.3;
      g.audio.play("bossRoar");
      g.shake(6, 0.6);
      g.fx.text(this.x, this.y - this.h - 10, "FÚRIA!", "#ff3b3b", true);
      g.fx.ring(this.x, this.y - this.h / 2, 120, "#ff3b3b", 0.6, 4);
      g.onBossPhase(this);
      this.state = "recover";
      this.stateT = 0.8;
    }

    this.stateT -= dt;
    switch (this.state) {
      case "intro":
        if (this.stateT <= 0) this.#nextPattern();
        break;
      case "walk":
        this.chase(dt, d, dx, dy, true, 1);
        if (this.stateT <= 0) this.#nextPattern();
        break;
      case "recover":
        if (this.stateT <= 0) {
          this.state = "walk";
          this.stateT = (this.phase === 2 ? 0.7 : 1.3) + Math.random() * 0.6;
        }
        break;
      default:
        this.#runPattern(dt, d, dx, dy);
    }

    // contato
    if (d < this.r + p.r + 2 && this.contactCd <= 0 && this.alpha > 0.5) {
      this.contactCd = 0.8;
      g.damagePlayer(this.atk * (this.state === "charge" ? 1.5 : 0.8), Math.atan2(dy, dx), null, this);
    }
  }

  #nextPattern() {
    if (!this.patternQueue.length) this.patternQueue = this.game.rngShuffle(this.def.patterns);
    this.state = this.patternQueue.shift();
    this.sub = 0;
    this.patternT = 0;
    const g = this.game;
    const p = g.player;
    switch (this.state) {
      case "slam":
        this.stateT = this.phase === 2 ? 0.75 : 1;
        g.fx.telegraph({ kind: "circle", x: this.x, y: this.y, radius: 78, duration: this.stateT });
        g.audio.play("telegraph");
        break;
      case "charge": {
        this.stateT = this.phase === 2 ? 0.55 : 0.8;
        const a = Math.atan2(p.y - this.y, p.x - this.x);
        this.chargeDir = { x: Math.cos(a), y: Math.sin(a) };
        g.fx.telegraph({ kind: "line", x: this.x, y: this.y, angle: a, length: 260, width: this.r * 2, duration: this.stateT });
        g.audio.play("telegraph");
        this.sub = 0;
        break;
      }
      case "spray":
        this.stateT = 1.4;
        break;
      case "ring":
        this.stateT = 0.6;
        g.fx.telegraph({ kind: "circle", x: this.x, y: this.y - this.h / 2, radius: 26, duration: 0.6, color: "#ffae3a" });
        break;
      case "spiral":
        this.stateT = 2.6;
        break;
      case "summon":
        this.stateT = 0.8;
        break;
      case "blink":
        this.stateT = 1.1;
        break;
    }
  }

  #runPattern(dt, d, dx, dy) {
    const g = this.game;
    const projKind = this.def.projectile || "fire";
    this.patternT += dt;
    switch (this.state) {
      case "slam":
        if (this.stateT <= 0) {
          g.audio.play("slam");
          g.shake(7, 0.35);
          g.fx.ring(this.x, this.y, 78, "#ffcf7a", 0.4, 4);
          g.fx.burst(this.x, this.y, "#9a8a7a", 40, 180, 0.6, 3);
          if (d < 78 + g.player.r) g.damagePlayer(this.atk * 1.6, Math.atan2(dy, dx), null, this);
          if (this.phase === 2) for (let i = 0; i < 12; i++) this.shoot((i / 12) * TAU, projKind, 110);
          this.#recover(0.7);
        }
        break;
      case "charge":
        if (this.sub === 0) {
          if (this.stateT <= 0) {
            this.sub = 1;
            this.stateT = 0.75;
            g.audio.play("bossRoar");
          }
        } else {
          const hit = this.moveBy(this.chargeDir.x * 340 * dt, this.chargeDir.y * 340 * dt);
          this.moving = true;
          g.fx.trail(this.x, this.y - 6, "#ffffff", 3, 0.3);
          if (hit.hitX || hit.hitY) {
            g.shake(8, 0.4);
            g.audio.play("slam");
            g.fx.burst(this.x, this.y, "#9a8a7a", 30, 150, 0.6, 3);
            if (this.phase === 2) for (let i = 0; i < 10; i++) this.shoot((i / 10) * TAU, projKind, 100);
            this.#recover(1.0); // atordoado ao bater na parede
          } else if (this.stateT <= 0) this.#recover(0.5);
        }
        break;
      case "spray": {
        const bursts = this.phase === 2 ? 4 : 3;
        const interval = 1.4 / bursts;
        if (this.patternT >= this.sub * interval && this.sub < bursts) {
          const base = Math.atan2(dy - 6, dx);
          const n = this.phase === 2 ? 7 : 5;
          for (let i = 0; i < n; i++) this.shoot(base + (i - (n - 1) / 2) * 0.18, projKind, 140);
          g.audio.play("shoot");
          this.sub++;
        }
        if (this.stateT <= 0) this.#recover(0.5);
        break;
      }
      case "ring":
        if (this.stateT <= 0) {
          const n = this.phase === 2 ? 24 : 16;
          const off = Math.random() * TAU;
          for (let i = 0; i < n; i++) this.shoot(off + (i / n) * TAU, projKind, 105);
          if (this.phase === 2) setTimeout(() => !this.dead && [...Array(n)].forEach((_, i) => this.shoot(off + ((i + 0.5) / n) * TAU, projKind, 80)), 300);
          g.audio.play("fireball");
          this.#recover(0.6);
        }
        break;
      case "spiral": {
        const rate = this.phase === 2 ? 0.05 : 0.075;
        while (this.sub * rate < this.patternT) {
          this.spiralA += 0.36;
          this.shoot(this.spiralA, projKind, 95);
          if (this.phase === 2) this.shoot(this.spiralA + Math.PI, projKind, 95);
          this.sub++;
        }
        if (this.stateT <= 0) this.#recover(0.6);
        break;
      }
      case "summon":
        if (this.sub === 0 && this.patternT > 0.4) {
          this.sub = 1;
          const def = g.content.enemies.find((e) => e.id === this.def.minion);
          const alive = g.enemies.filter((e) => !e.dead && !e.isBoss).length;
          const n = Math.max(0, Math.min(this.phase === 2 ? 4 : 3, 7 - alive));
          for (let i = 0; i < n; i++) {
            const a = (i / Math.max(1, n)) * TAU;
            g.spawnEnemy(def, this.x + Math.cos(a) * 34, this.y + Math.sin(a) * 34, { spawnAnim: true, xpMult: 0.3 });
          }
          g.fx.ring(this.x, this.y - this.h / 2, 60, "#b36bff", 0.5, 3);
          g.audio.play("bossRoar");
        }
        if (this.stateT <= 0) this.#recover(0.4);
        break;
      case "blink":
        if (this.sub === 0) {
          this.alpha = Math.max(0, 1 - this.patternT / 0.4);
          if (this.patternT >= 0.4) {
            this.sub = 1;
            const spot = g.findSpotNear(g.player.x, g.player.y, 70);
            if (spot) {
              this.x = spot.x;
              this.y = spot.y;
            }
            g.fx.burst(this.x, this.y - 10, "#6fd6ff", 30, 120, 0.5);
          }
        } else {
          this.alpha = Math.min(1, (this.patternT - 0.4) / 0.3);
          if (this.patternT >= 0.75 && this.sub === 1) {
            this.sub = 2;
            for (let i = 0; i < 12; i++) this.shoot((i / 12) * TAU, projKind, 120);
          }
        }
        if (this.stateT <= 0) {
          this.alpha = 1;
          this.#recover(0.4);
        }
        break;
      default:
        this.#recover(0.3);
    }
  }

  #recover(t) {
    this.state = "recover";
    this.stateT = t * (this.phase === 2 ? 0.7 : 1);
  }

  draw(ctx) {
    const A = this.game.assets;
    const anim = A.anim(this.def.sprite, this.moving ? "run" : "idle");
    const frame = Math.floor(this.animT * (this.moving ? 10 : 6));
    ctx.save();
    ctx.globalAlpha = this.alpha;
    this.drawShadow(ctx, this.w * 0.7);
    if (this.phase === 2) {
      const pulse = 0.5 + Math.sin(this.animT * 10) * 0.3;
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) A.draw(ctx, anim, this.x + ox, this.y + 1 + oy, { frame, flip: this.facing < 0, scale: this.scale, tint: "#ff2a2a", tintAmount: 1, alpha: pulse });
    }
    const windup = (this.state === "charge" && this.sub === 0) || this.state === "slam";
    const tint = this.def.tint || (windup && Math.floor(this.animT * 14) % 2 ? "#ffffff" : null);
    A.draw(ctx, anim, this.x, this.y + 1, { frame, flip: this.facing < 0, scale: this.scale, white: this.flash > 0, tint, tintAmount: 0.4 });
    ctx.restore();
  }
}
