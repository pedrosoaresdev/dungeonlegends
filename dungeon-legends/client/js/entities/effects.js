// Partículas, números de dano, ondas de choque e avisos (telegraphs).

import { TAU } from "../core/math.js";

export class Effects {
  constructor() {
    this.particles = [];
    this.texts = [];
    this.rings = [];
    this.telegraphs = [];
    this.slashes = [];
  }

  clear() {
    this.particles.length = this.texts.length = this.rings.length = this.telegraphs.length = this.slashes.length = 0;
  }

  burst(x, y, color, count = 10, speed = 80, life = 0.5, size = 2, gravity = 0) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.6 + Math.random() * 0.6), max: life, color, size, gravity });
    }
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
  }

  trail(x, y, color, size = 2, life = 0.3) {
    this.particles.push({ x, y, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, life, max: life, color, size, gravity: 0 });
  }

  text(x, y, str, color = "#fff", big = false) {
    this.texts.push({ x: x + (Math.random() - 0.5) * 6, y, str: String(str), color, life: big ? 1.1 : 0.8, max: big ? 1.1 : 0.8, big, vy: big ? -38 : -30 });
  }

  ring(x, y, radius, color = "#fff", life = 0.35, width = 2) {
    this.rings.push({ x, y, radius, color, life, max: life, width });
  }

  slash(x, y, angle, radius, arc, color = "#fff") {
    this.slashes.push({ x, y, angle, radius, arc, color, life: 0.14, max: 0.14 });
  }

  /** Aviso visual de ataque (círculo ou linha) que preenche até `duration`. */
  telegraph(t) {
    this.telegraphs.push({ ...t, time: 0 });
  }

  update(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= 0.92;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const s of this.slashes) s.life -= dt;
    this.slashes = this.slashes.filter((s) => s.life > 0);
    for (const t of this.telegraphs) t.time += dt;
    this.telegraphs = this.telegraphs.filter((t) => t.time < t.duration);
  }

  drawGround(ctx) {
    for (const t of this.telegraphs) {
      const k = t.time / t.duration;
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.35 * k;
      ctx.strokeStyle = t.color || "#ff3b3b";
      ctx.fillStyle = t.color || "#ff3b3b";
      if (t.kind === "circle") {
        ctx.globalAlpha = 0.18;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius * k, 0, TAU);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius, 0, TAU);
        ctx.stroke();
      } else if (t.kind === "line") {
        ctx.translate(t.x, t.y);
        ctx.rotate(t.angle);
        ctx.globalAlpha = 0.2;
        ctx.fillRect(0, -t.width / 2, t.length, t.width);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(0, -t.width / 2, t.length * k, t.width);
      }
      ctx.restore();
    }
  }

  draw(ctx) {
    for (const s of this.slashes) {
      const k = s.life / s.max;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3 * k + 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, s.angle - s.arc / 2, s.angle + s.arc / 2);
      ctx.stroke();
      ctx.globalAlpha = k * 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius * 0.7, s.angle - s.arc / 2.4, s.angle + s.arc / 2.4);
      ctx.stroke();
      ctx.restore();
    }
    for (const r of this.rings) {
      const k = 1 - r.life / r.max;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius * (0.2 + 0.8 * k), 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  drawTexts(ctx) {
    ctx.textAlign = "center";
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
      ctx.font = t.big ? "10px 'Press Start 2P', monospace" : "8px 'Press Start 2P', monospace";
      ctx.fillStyle = "#000";
      ctx.fillText(t.str, Math.round(t.x) + 1, Math.round(t.y) + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, Math.round(t.x), Math.round(t.y));
    }
    ctx.globalAlpha = 1;
  }
}
