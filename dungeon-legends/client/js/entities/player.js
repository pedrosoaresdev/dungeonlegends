// Herói controlado pelo jogador: atributos, ataques, habilidades, esquiva.

import { Entity } from "./entity.js";
import { Projectile } from "./projectile.js";
import { TAU, angleDiff, clamp } from "../core/math.js";
import { xpForLevel } from "../systems/rules.js";

export class Player extends Entity {
  constructor(game, x, y, classDef, save = null) {
    super(game, x, y, 5);
    this.cls = classDef;
    this.sprite = classDef.sprite;
    this.level = 1;
    this.xp = 0;
    this.gold = 0;
    this.perks = {};
    this.bonus = { atk: 0, def: 0, maxHp: 0 };
    this.potions = { hp: 2, mp: 1 };
    this.weapon = game.content.weapons.find((w) => w.id === classDef.startWeapon) || game.content.weapons[0];

    if (save) Object.assign(this, structuredClone(save.hero));
    this.weapon = game.content.weapons.find((w) => w.id === this.weapon.id) || this.weapon;

    this.recompute();
    this.hp = save?.hero?.hp ? Math.min(save.hero.hp, this.stats.maxHp) : this.stats.maxHp;
    this.mana = this.stats.maxMana;

    this.aim = 0;
    this.attackCd = 0;
    this.abilityCd = 0;
    this.dashCd = 0;
    this.dashT = 0;
    this.dashDir = { x: 1, y: 0 };
    this.iframes = 0;
    this.swingT = 0;
    this.swingDir = 1;
    this.shieldT = 0;
    this.whirlT = 0;
    this.whirlTick = 0;
    this.slowT = 0;
    this.hasKey = false;
    this.moving = false;
    this.ghosts = [];
    this.hurtT = 0;
  }

  /** Recalcula atributos a partir de classe, nível, perks, bônus e arma. */
  recompute() {
    const b = this.cls.stats;
    const r = this.game.content.rules.statPerLevel;
    const p = (id) => this.perks[id] || 0;
    const perkVal = (id) => (this.game.content.perks.find((x) => x.id === id)?.value || 0) * p(id);
    const lv = this.level - 1;
    const prevMax = this.stats?.maxHp;
    this.stats = {
      maxHp: Math.round(b.hp + lv * r.hp + perkVal("vitality") + this.bonus.maxHp),
      maxMana: Math.round(b.mana + p("arcane") * 30),
      atk: b.atk + lv * r.atk + this.bonus.atk + (this.weapon?.power || 0),
      def: b.def + lv * r.def + perkVal("armor") + this.bonus.def,
      speed: b.speed * (1 + perkVal("swift")),
      attackRate: b.attackRate * (1 + perkVal("frenzy")) * (1 + (this.weapon?.speed || 0)),
      crit: Math.min(0.75, b.crit + perkVal("precision")),
      dmgMult: 1 + perkVal("might"),
      lifesteal: perkVal("vampire"),
      thorns: perkVal("thorns"),
      goldMult: 1 + perkVal("greed"),
      multishot: p("multishot"),
      magnet: perkVal("magnet"),
      cdMult: Math.max(0.4, 1 - perkVal("arcane")),
      range: b.range,
    };
    if (prevMax && this.hp !== undefined) this.hp = Math.min(this.hp + Math.max(0, this.stats.maxHp - prevMax), this.stats.maxHp);
  }

  get xpToNext() {
    return xpForLevel(this.game.content.rules, this.level);
  }

  addXp(amount) {
    if (this.level >= this.game.content.rules.maxLevel) return;
    this.xp += amount;
    while (this.xp >= this.xpToNext && this.level < this.game.content.rules.maxLevel) {
      this.xp -= this.xpToNext;
      this.level++;
      this.recompute();
      this.hp = this.stats.maxHp;
      this.mana = this.stats.maxMana;
      this.game.onLevelUp();
    }
  }

  /** Multiplicador de fúria do Berserker: até +80% de dano com pouca vida. */
  get rageMult() {
    return this.cls.id === "lizard" ? 1 + (1 - this.hp / this.stats.maxHp) * 0.8 : 1;
  }

  rollDamage(mult = 1) {
    const crit = Math.random() < this.stats.crit;
    const dmg = this.stats.atk * this.stats.dmgMult * this.rageMult * mult * (crit ? 1.85 : 1) * (0.9 + Math.random() * 0.2);
    return { dmg, crit };
  }

  update(dt) {
    const g = this.game;
    const input = g.input;
    this.animT += dt;
    this.attackCd -= dt;
    this.abilityCd -= dt;
    this.dashCd -= dt;
    this.iframes -= dt;
    this.swingT -= dt;
    this.shieldT -= dt;
    this.slowT -= dt;
    this.hurtT -= dt;
    this.flash -= dt;
    this.mana = Math.min(this.stats.maxMana, this.mana + dt * (4 + this.stats.maxMana * 0.03));

    // ----- mira -----
    const padAim = input.padAim();
    const mouseRecent = performance.now() - input.mouse.lastMove < 4000 && !input.usingPad;
    if (padAim !== null) this.aim = padAim;
    else if (g.settings.autoAim || !mouseRecent) {
      const target = g.nearestEnemy(this.x, this.y, 220, true);
      if (target) this.aim = Math.atan2(target.y - target.h * 0.4 - (this.y - 6), target.x - this.x);
      else if (this.moving) this.aim = Math.atan2(this.lastMove.y, this.lastMove.x);
    } else {
      const wx = input.mouse.x + g.camera.x;
      const wy = input.mouse.y + g.camera.y;
      this.aim = Math.atan2(wy - (this.y - 6), wx - this.x);
    }
    this.facing = Math.cos(this.aim) >= 0 ? 1 : -1;

    // ----- movimento / esquiva -----
    const mv = input.moveVector();
    this.moving = mv.x !== 0 || mv.y !== 0;
    if (this.moving) this.lastMove = { x: mv.x, y: mv.y };
    if (input.pressed("dash") && this.dashCd <= 0) {
      const dir = this.moving ? mv : { x: Math.cos(this.aim), y: Math.sin(this.aim) };
      this.dashDir = dir;
      this.dashT = 0.17;
      this.dashCd = 0.75;
      this.iframes = 0.28;
      g.audio.play("dash");
    }
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.moveBy(this.dashDir.x * 330 * dt, this.dashDir.y * 330 * dt);
      this.ghosts.push({ x: this.x, y: this.y, life: 0.25, frame: Math.floor(this.animT * 10), flip: this.facing < 0 });
    } else {
      let speed = this.stats.speed * (this.whirlT > 0 ? 1.3 : 1) * (this.slowT > 0 ? 0.55 : 1);
      if (this.swingT > 0 && this.cls.attack === "melee") speed *= 0.75;
      this.moveBy(mv.x * speed * dt, mv.y * speed * dt);
    }
    this.applyKnockback(dt);
    for (const gh of this.ghosts) gh.life -= dt;
    this.ghosts = this.ghosts.filter((gh) => gh.life > 0);

    // ----- ataque -----
    if (input.isDown("attack") && this.attackCd <= 0 && this.whirlT <= 0) this.attack();

    // ----- habilidade -----
    if (input.pressed("ability")) this.useAbility();
    if (this.whirlT > 0) this.updateWhirlwind(dt);

    // ----- poções -----
    if (input.pressed("potionHp")) this.drinkPotion("hp");
    if (input.pressed("potionMp")) this.drinkPotion("mp");
  }

  attack() {
    const g = this.game;
    this.attackCd = 1 / this.stats.attackRate;
    const hx = this.x;
    const hy = this.y - 6;
    const ms = this.stats.multishot;
    if (this.cls.attack === "melee") {
      this.swingT = 0.18;
      this.swingDir *= -1;
      const arc = (115 + ms * 30) * (Math.PI / 180);
      const range = this.stats.range + 4 + ms * 4;
      g.fx.slash(hx, hy, this.aim, range - 4, arc, this.cls.color);
      g.audio.play("swing");
      let hits = 0;
      for (const e of g.enemies) {
        if (e.dead || e.dormant) continue;
        const ex = e.x;
        const ey = e.y - e.h * 0.35;
        const d = Math.hypot(ex - hx, ey - hy);
        if (d > range + e.r) continue;
        if (Math.abs(angleDiff(this.aim, Math.atan2(ey - hy, ex - hx))) > arc / 2 + 0.2 && d > e.r + 6) continue;
        const { dmg, crit } = this.rollDamage();
        g.damageEnemy(e, dmg, crit, this.aim, 140);
        hits++;
      }
      // golpes de espada destroem projéteis inimigos
      for (const p of g.projectiles) {
        if (p.owner !== "enemy" || p.dead) continue;
        const d = Math.hypot(p.x - hx, p.y - hy);
        if (d < range && Math.abs(angleDiff(this.aim, Math.atan2(p.y - hy, p.x - hx))) < arc / 2) {
          p.dead = true;
          g.fx.burst(p.x, p.y, "#ffffff", 5, 60, 0.2);
        }
      }
      if (hits) g.shake(1.5, 0.08);
    } else {
      const spell = this.cls.attack === "spell";
      const count = 1 + ms;
      const spread = spell ? 0.16 : 0.12;
      for (let i = 0; i < count; i++) {
        const a = this.aim + (i - (count - 1) / 2) * spread;
        const { dmg, crit } = this.rollDamage(spell ? 1 : 0.85);
        g.projectiles.push(
          new Projectile(g, {
            x: hx + Math.cos(a) * 8,
            y: hy + Math.sin(a) * 8,
            angle: a,
            speed: spell ? 210 : 320,
            kind: spell ? "fireball" : "knife",
            owner: "player",
            damage: dmg,
            crit,
            aoe: spell ? 22 : 0,
            pierce: spell ? 0 : 1,
            life: this.stats.range / (spell ? 210 : 320) + 0.2,
            knock: spell ? 90 : 60,
          })
        );
      }
      this.swingT = 0.12;
      g.audio.play(spell ? "fireball" : "shoot");
    }
  }

  useAbility() {
    const g = this.game;
    const ab = this.cls.ability;
    if (this.abilityCd > 0) return;
    if (this.mana < ab.cost) {
      g.audio.play("denied");
      g.fx.text(this.x, this.y - 26, "SEM MANA", "#6fb7ff");
      return;
    }
    this.mana -= ab.cost;
    this.abilityCd = ab.cooldown * this.stats.cdMult;
    g.audio.play("ability");
    const hx = this.x;
    const hy = this.y - 6;
    switch (ab.id) {
      case "shield": {
        this.shieldT = 3.5;
        g.fx.ring(hx, hy, 60, "#5ad1ff", 0.4, 3);
        g.shake(3, 0.2);
        for (const e of g.enemies) {
          if (e.dead || e.dormant) continue;
          const d = Math.hypot(e.x - hx, e.y - hy);
          if (d < 60 + e.r) {
            const { dmg, crit } = this.rollDamage(1.5);
            g.damageEnemy(e, dmg, crit, Math.atan2(e.y - hy, e.x - hx), 320);
          }
        }
        break;
      }
      case "nova": {
        const radius = 100;
        g.fx.ring(hx, hy, radius, "#c58cff", 0.5, 4);
        g.fx.ring(hx, hy, radius * 0.6, "#ffffff", 0.35, 2);
        g.fx.burst(hx, hy, "#c58cff", 40, 220, 0.6, 3);
        g.audio.play("explosion");
        g.shake(5, 0.3);
        for (const e of g.enemies) {
          if (e.dead || e.dormant) continue;
          const d = Math.hypot(e.x - hx, e.y - hy);
          if (d < radius + e.r) {
            const { dmg, crit } = this.rollDamage(2.8);
            g.damageEnemy(e, dmg, crit, Math.atan2(e.y - hy, e.x - hx), 260);
          }
        }
        for (const p of g.projectiles) if (p.owner === "enemy" && Math.hypot(p.x - hx, p.y - hy) < radius) p.dead = true;
        break;
      }
      case "volley": {
        const n = 16 + this.stats.multishot * 4;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + this.aim;
          const { dmg, crit } = this.rollDamage(0.9);
          g.projectiles.push(new Projectile(g, { x: hx, y: hy, angle: a, speed: 280, kind: "knife", owner: "player", damage: dmg, crit, pierce: 2, life: 0.9 }));
        }
        g.fx.ring(hx, hy, 40, "#7dff8a", 0.3, 2);
        break;
      }
      case "whirlwind": {
        this.whirlT = 2.6;
        this.whirlTick = 0;
        break;
      }
    }
  }

  updateWhirlwind(dt) {
    const g = this.game;
    this.whirlT -= dt;
    this.whirlTick -= dt;
    if (this.whirlTick <= 0) {
      this.whirlTick = 0.16;
      g.audio.play("swing");
      const radius = 38 + this.stats.multishot * 6;
      g.fx.slash(this.x, this.y - 6, this.animT * 18, radius - 6, Math.PI * 1.2, "#ff9b54");
      for (const e of g.enemies) {
        if (e.dead || e.dormant) continue;
        if (Math.hypot(e.x - this.x, e.y - this.y) < radius + e.r) {
          const { dmg, crit } = this.rollDamage(0.65);
          g.damageEnemy(e, dmg, crit, Math.atan2(e.y - this.y, e.x - this.x), 90);
        }
      }
    }
  }

  drinkPotion(kind) {
    const g = this.game;
    if (this.potions[kind] <= 0) {
      g.audio.play("denied");
      return;
    }
    if (kind === "hp" && this.hp >= this.stats.maxHp) return;
    this.potions[kind]--;
    if (kind === "hp") {
      const heal = Math.round(this.stats.maxHp * 0.5);
      this.heal(heal);
    } else {
      this.mana = this.stats.maxMana;
      g.fx.text(this.x, this.y - 26, "MANA!", "#6fb7ff");
    }
    g.audio.play("potion");
    g.fx.burst(this.x, this.y - 8, kind === "hp" ? "#ff4a5a" : "#4a8aff", 16, 60, 0.6, 2, -60);
  }

  heal(amount) {
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + amount);
    const real = Math.round(this.hp - before);
    if (real > 0) this.game.fx.text(this.x, this.y - 24, "+" + real, "#5dff6a");
  }

  /** Retorna o dano efetivamente recebido. */
  takeDamage(raw) {
    if (this.iframes > 0 || this.dashT > 0) return 0;
    let dmg = Math.max(1, raw - this.stats.def * 0.5);
    if (this.shieldT > 0) dmg *= 0.2;
    dmg = Math.round(dmg);
    this.hp -= dmg;
    this.iframes = 0.55;
    this.flash = 0.12;
    this.hurtT = 0.3;
    return dmg;
  }

  draw(ctx) {
    const g = this.game;
    const A = g.assets;
    const anim = A.anim(this.sprite, this.moving || this.dashT > 0 ? "run" : "idle");
    const frame = Math.floor(this.animT * (this.moving ? 10 : 6));

    for (const gh of this.ghosts) A.draw(ctx, anim, gh.x, gh.y, { frame: gh.frame, flip: gh.flip, alpha: gh.life * 2, tint: this.cls.color, tintAmount: 0.8 });

    this.drawShadow(ctx, 12);
    const blink = this.iframes > 0 && this.dashT <= 0 && Math.floor(this.iframes * 20) % 2 === 0;

    // arma atrás quando mirando para cima
    const weaponBehind = Math.sin(this.aim) < -0.3;
    if (weaponBehind) this.drawWeapon(ctx);
    A.draw(ctx, this.flash > 0 ? A.anim(this.sprite, "hit") : anim, this.x, this.y + 1, { frame, flip: this.facing < 0, alpha: blink ? 0.4 : 1, white: this.flash > 0 });
    if (!weaponBehind) this.drawWeapon(ctx);

    if (this.shieldT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(this.animT * 12) * 0.12;
      ctx.strokeStyle = "#7fe3ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y - 9, 14, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawWeapon(ctx) {
    const A = this.game.assets;
    const hx = this.x + this.facing * 3;
    const hy = this.y - 6;
    let rot;
    if (this.whirlT > 0) rot = this.animT * 18;
    else if (this.cls.attack === "melee") {
      const k = this.swingT > 0 ? 1 - this.swingT / 0.18 : 1;
      const from = this.aim - 1.3 * this.swingDir;
      const to = this.aim + 1.3 * this.swingDir;
      rot = this.swingT > 0 ? from + (to - from) * k : this.aim + 0.9 * this.swingDir * -1;
    } else {
      rot = this.aim;
    }
    const recoil = this.swingT > 0 && this.cls.attack !== "melee" ? -2 : 0;
    A.draw(ctx, this.weapon.id, hx + Math.cos(rot) * (3 + recoil), hy + Math.sin(rot) * (3 + recoil), {
      rotation: rot + Math.PI / 2,
      anchorY: 0.85,
    });
  }

  toSave() {
    return {
      level: this.level,
      xp: this.xp,
      gold: this.gold,
      perks: { ...this.perks },
      bonus: { ...this.bonus },
      potions: { ...this.potions },
      weapon: { id: this.weapon.id },
      hp: Math.round(clamp(this.hp, 1, this.stats.maxHp)),
    };
  }
}
