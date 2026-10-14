// Projéteis do jogador e dos inimigos.

import { TAU } from "../core/math.js";

const STYLES = {
  fireball: { color: "#ff8a2a", core: "#fff1a8", radius: 4, light: "#ff7a1a" },
  arcane: { color: "#b36bff", core: "#f3e0ff", radius: 3, light: "#9b5bff" },
  knife: { sprite: "weapon_knife", radius: 3, light: null },
  bone: { color: "#e8e2cf", core: "#ffffff", radius: 3, light: null },
  poison: { color: "#5dff4a", core: "#d8ffcf", radius: 3, light: "#3aff2a" },
  fire: { color: "#ff3a1a", core: "#ffd27a", radius: 4, light: "#ff3a1a" },
  ice: { color: "#6fd6ff", core: "#ffffff", radius: 4, light: "#4fbfff" },
};

export class Projectile {
  constructor(game, o) {
    this.game = game;
    this.x = o.x;
    this.y = o.y;
    this.vx = Math.cos(o.angle) * o.speed;
    this.vy = Math.sin(o.angle) * o.speed;
    this.angle = o.angle;
    this.kind = o.kind;
    this.owner = o.owner; // "player" | "enemy"
    this.damage = o.damage;
    this.crit = o.crit || false;
    this.life = o.life ?? 1.5;
    this.pierce = o.pierce ?? 0;
    this.aoe = o.aoe ?? 0;
    this.knock = o.knock ?? 60;
    this.onHit = o.onHit || null;
    this.style = STYLES[o.kind] || STYLES.bone;
    this.radius = o.radius ?? this.style.radius;
    this.hitSet = new Set();
    this.dead = false;
    this.spin = 0;
    this.homing = o.homing ?? 0;
    this.accel = o.accel ?? 0;
  }

  get light() {
    return this.style.light;
  }

  update(dt) {
    const g = this.game;
    this.life -= dt;
    if (this.life <= 0) return this.explode();
    if (this.accel) {
      const s = 1 + this.accel * dt;
      this.vx *= s;
      this.vy *= s;
    }
    if (this.homing && this.owner === "enemy") {
      const p = g.player;
      const desired = Math.atan2(p.y - 6 - this.y, p.x - this.x);
      const cur = Math.atan2(this.vy, this.vx);
      let d = desired - cur;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      const na = cur + Math.max(-this.homing * dt, Math.min(this.homing * dt, d));
      const sp = Math.hypot(this.vx, this.vy);
      this.vx = Math.cos(na) * sp;
      this.vy = Math.sin(na) * sp;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle = Math.atan2(this.vy, this.vx);
    this.spin += dt * 20;
    if (this.style.color && Math.random() < 0.7) g.fx.trail(this.x, this.y, this.style.color, 2, 0.25);

    if (g.dungeon.isSolidAt(this.x, this.y)) return this.explode();

    if (this.owner === "player") {
      for (const e of g.enemies) {
        if (e.dead || this.hitSet.has(e)) continue;
        const rr = e.r + this.radius + 3;
        if ((e.x - this.x) ** 2 + (e.y - e.h * 0.4 - this.y) ** 2 < rr * rr || (e.x - this.x) ** 2 + (e.y - this.y) ** 2 < rr * rr) {
          this.hitSet.add(e);
          if (this.aoe) return this.explode();
          g.damageEnemy(e, this.damage, this.crit, Math.atan2(this.vy, this.vx), this.knock);
          if (this.pierce-- <= 0) {
            this.dead = true;
            return;
          }
        }
      }
    } else {
      const p = g.player;
      const rr = p.r + this.radius + 2;
      if ((p.x - this.x) ** 2 + (p.y - 6 - this.y) ** 2 < rr * rr) {
        g.damagePlayer(this.damage, Math.atan2(this.vy, this.vx), this.onHit);
        this.explode();
      }
    }
  }

  explode() {
    if (this.dead) return;
    this.dead = true;
    const g = this.game;
    if (this.style.color) g.fx.burst(this.x, this.y, this.style.color, 8, 60, 0.35);
    if (this.aoe && this.owner === "player") {
      g.fx.ring(this.x, this.y, this.aoe, this.style.color, 0.3, 2);
      g.fx.burst(this.x, this.y, this.style.core, 14, 120, 0.4);
      g.audio.play("explosion");
      for (const e of g.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - this.x, e.y - this.y);
        if (d < this.aoe + e.r) g.damageEnemy(e, this.damage * (d < this.aoe * 0.5 ? 1 : 0.7), this.crit, Math.atan2(e.y - this.y, e.x - this.x), this.knock);
      }
    }
  }

  draw(ctx) {
    if (this.style.sprite) {
      this.game.assets.draw(ctx, this.style.sprite, this.x, this.y, { rotation: this.angle + Math.PI / 2, anchorY: 0.5 });
      return;
    }
    if (this.kind === "bone") {
      ctx.save();
      ctx.translate(Math.round(this.x), Math.round(this.y));
      ctx.rotate(this.spin);
      ctx.fillStyle = this.style.color;
      ctx.fillRect(-4, -1, 8, 2);
      ctx.fillRect(-5, -2, 2, 4);
      ctx.fillRect(3, -2, 2, 4);
      ctx.restore();
      return;
    }
    ctx.fillStyle = this.style.color;
    ctx.beginPath();
    ctx.arc(Math.round(this.x), Math.round(this.y), this.radius, 0, TAU);
    ctx.fill();
    ctx.fillStyle = this.style.core;
    ctx.beginPath();
    ctx.arc(Math.round(this.x), Math.round(this.y), this.radius * 0.5, 0, TAU);
    ctx.fill();
  }
}
