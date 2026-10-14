// Classe base para tudo que se move e colide com a masmorra.

export class Entity {
  constructor(game, x, y, r = 5) {
    this.game = game;
    this.x = x;
    this.y = y;
    this.r = r;
    this.vx = 0;
    this.vy = 0;
    this.kx = 0; // knockback
    this.ky = 0;
    this.dead = false;
    this.flash = 0;
    this.animT = Math.random() * 10;
    this.facing = 1;
    this.z = 0; // altura visual (pulos)
  }

  /** Move com colisão separada por eixo (desliza nas paredes). */
  moveBy(dx, dy) {
    const d = this.game.dungeon;
    // subdivide movimentos grandes para não atravessar paredes
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4) || 1;
    const sx = dx / steps;
    const sy = dy / steps;
    let hitX = false;
    let hitY = false;
    for (let i = 0; i < steps; i++) {
      if (!hitX) {
        if (!d.boxCollides(this.x + sx, this.y, this.r)) this.x += sx;
        else hitX = true;
      }
      if (!hitY) {
        if (!d.boxCollides(this.x, this.y + sy, this.r)) this.y += sy;
        else hitY = true;
      }
    }
    return { hitX, hitY };
  }

  applyKnockback(dt) {
    if (Math.abs(this.kx) + Math.abs(this.ky) < 1) {
      this.kx = this.ky = 0;
      return;
    }
    this.moveBy(this.kx * dt, this.ky * dt);
    const damp = Math.pow(0.0008, dt);
    this.kx *= damp;
    this.ky *= damp;
  }

  knock(angle, force) {
    this.kx += Math.cos(angle) * force;
    this.ky += Math.sin(angle) * force;
  }

  drawShadow(ctx, w = this.r * 2 + 4) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(Math.round(this.x), Math.round(this.y), w / 2, w / 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
