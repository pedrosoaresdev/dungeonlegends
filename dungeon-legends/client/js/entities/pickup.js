// Itens no chão: moedas, orbes de vida/mana, armas e a chave do andar.

export class Pickup {
  constructor(game, x, y, type, data = {}) {
    this.game = game;
    this.x = x;
    this.y = y;
    this.type = type; // coin | hp | mp | weapon | key
    this.data = data;
    this.dead = false;
    this.t = Math.random() * 10;
    this.age = 0;
    // pequeno "pulo" ao surgir
    const a = Math.random() * Math.PI * 2;
    const s = 30 + Math.random() * 50;
    this.vx = Math.cos(a) * s;
    this.vy = Math.sin(a) * s;
    this.z = 0;
    this.vz = 70 + Math.random() * 40;
  }

  get autoCollect() {
    return this.type === "coin" || this.type === "hp" || this.type === "mp" || this.type === "key";
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.age += dt;
    // física do surgimento
    if (this.vz !== 0 || this.z > 0) {
      this.z += this.vz * dt;
      this.vz -= 300 * dt;
      if (this.z <= 0) {
        this.z = 0;
        this.vz = Math.abs(this.vz) > 40 ? -this.vz * 0.4 : 0;
      }
    }
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    if (!g.dungeon.isSolidAt(nx, this.y)) this.x = nx;
    else this.vx = -this.vx;
    if (!g.dungeon.isSolidAt(this.x, ny)) this.y = ny;
    else this.vy = -this.vy;
    this.vx *= Math.pow(0.02, dt);
    this.vy *= Math.pow(0.02, dt);

    if (!this.autoCollect || this.age < 0.35) return;
    const p = g.player;
    const dx = p.x - this.x;
    const dy = p.y - 4 - this.y;
    const d = Math.hypot(dx, dy);
    const magnet = 34 + p.stats.magnet;
    if (d < magnet) {
      const pull = (1 - d / magnet) * 380 + 60;
      this.x += (dx / d) * pull * dt;
      this.y += (dy / d) * pull * dt;
    }
    if (d < 8) {
      this.dead = true;
      g.collect(this);
    }
  }

  draw(ctx) {
    const A = this.game.assets;
    const bob = this.type === "weapon" || this.type === "key" ? Math.sin(this.t * 3) * 2 : 0;
    const y = this.y - this.z - bob;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(Math.round(this.x - 3), Math.round(this.y), 6, 2);
    switch (this.type) {
      case "coin":
        A.draw(ctx, "coin_anim", this.x, y + 2, { frame: Math.floor(this.t * 8) });
        break;
      case "hp":
        A.draw(ctx, "flask_red", this.x, y + 2);
        break;
      case "mp":
        A.draw(ctx, "flask_blue", this.x, y + 2);
        break;
      case "key": {
        // chave desenhada em pixels (não existe no spritesheet)
        ctx.save();
        ctx.translate(Math.round(this.x), Math.round(y - 4));
        ctx.fillStyle = "#ffd23a";
        ctx.fillRect(-5, -2, 4, 4);
        ctx.fillRect(-1, -1, 7, 2);
        ctx.fillRect(4, 1, 2, 2);
        ctx.fillRect(2, 1, 1, 2);
        ctx.fillStyle = "#0b0810";
        ctx.fillRect(-4, -1, 2, 2);
        ctx.restore();
        break;
      }
      case "weapon": {
        const rarity = this.game.content.rarities[this.data.weapon.rarity];
        ctx.save();
        ctx.globalAlpha = 0.35 + Math.sin(this.t * 4) * 0.15;
        ctx.fillStyle = rarity.color;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, 9, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        A.draw(ctx, this.data.weapon.id, this.x, y, { rotation: Math.PI / 4, anchorY: 0.75 });
        break;
      }
    }
  }
}
