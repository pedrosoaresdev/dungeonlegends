// Geração procedural de masmorras + renderização em camada estática pré-renderizada.

import { RNG } from "../core/math.js";

export const TILE = 16;
export const VOID = 0;
export const FLOOR = 1;
export const WALL = 2;

const FLOOR_VARIANTS = ["floor_2", "floor_3", "floor_4", "floor_5", "floor_6", "floor_7", "floor_8"];
const BANNERS = ["wall_banner_red", "wall_banner_blue", "wall_banner_green", "wall_banner_yellow"];

export class Dungeon {
  /**
   * @param {object} opts { seed, act, floor, isBoss, assets }
   */
  constructor({ seed, act, floor, isBoss, assets }) {
    this.rng = new RNG(seed);
    this.seed = seed;
    this.act = act;
    this.floor = floor;
    this.isBoss = isBoss;
    this.assets = assets;
    this.rooms = [];
    this.chests = [];
    this.spikes = [];
    this.fountains = [];
    this.decor = [];
    this.spawns = [];
    this.exit = null;
    this.bossSpawn = null;

    if (isBoss) this.#generateBossArena();
    else this.#generateFloor();

    this.#buildWalls();
    this.explored = new Uint8Array(this.w * this.h);
    this.static = this.#renderStatic();
  }

  idx(tx, ty) {
    return ty * this.w + tx;
  }

  tileAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return VOID;
    return this.tiles[ty * this.w + tx];
  }

  isSolidTile(tx, ty) {
    return this.tileAt(tx, ty) !== FLOOR;
  }

  isSolidAt(px, py) {
    return this.isSolidTile(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  /** Testa se uma caixa (centro x,y, meia-largura r) colide com paredes. */
  boxCollides(x, y, r) {
    const x0 = Math.floor((x - r) / TILE);
    const x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE);
    const y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.isSolidTile(tx, ty)) return true;
    return false;
  }

  /** Linha de visão simples por amostragem. */
  lineOfSight(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(d / 6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isSolidAt(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  }

  randomFloorInRoom(room, margin = 1) {
    for (let i = 0; i < 40; i++) {
      const tx = this.rng.int(room.x + margin, room.x + room.w - 1 - margin);
      const ty = this.rng.int(room.y + margin, room.y + room.h - 1 - margin);
      if (this.tileAt(tx, ty) === FLOOR) return { tx, ty, x: tx * TILE + 8, y: ty * TILE + 8 };
    }
    return { tx: room.cx, ty: room.cy, x: room.cx * TILE + 8, y: room.cy * TILE + 8 };
  }

  // ------------------------------------------------------------------
  // Geração
  // ------------------------------------------------------------------
  #alloc(w, h) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
  }

  #carveRect(x, y, w, h) {
    for (let ty = y; ty < y + h; ty++)
      for (let tx = x; tx < x + w; tx++) if (tx > 0 && ty > 1 && tx < this.w - 1 && ty < this.h - 1) this.tiles[ty * this.w + tx] = FLOOR;
  }

  #carveCorridor(ax, ay, bx, by, width) {
    const horizontalFirst = this.rng.chance(0.5);
    const half = Math.floor(width / 2);
    const hLine = (y, x0, x1) => this.#carveRect(Math.min(x0, x1) - half, y - half, Math.abs(x1 - x0) + width, width);
    const vLine = (x, y0, y1) => this.#carveRect(x - half, Math.min(y0, y1) - half, width, Math.abs(y1 - y0) + width);
    if (horizontalFirst) {
      hLine(ay, ax, bx);
      vLine(bx, ay, by);
    } else {
      vLine(ax, ay, by);
      hLine(by, ax, bx);
    }
  }

  #generateFloor() {
    const rng = this.rng;
    this.#alloc(72, 52);
    const target = rng.int(9, 12) + Math.min(3, this.act);
    let attempts = 0;
    while (this.rooms.length < target && attempts++ < 600) {
      const w = rng.int(7, 13);
      const h = rng.int(6, 10);
      const x = rng.int(2, this.w - w - 3);
      const y = rng.int(3, this.h - h - 3);
      const room = { x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) };
      const overlaps = this.rooms.some((r) => x < r.x + r.w + 3 && x + w + 3 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y);
      if (!overlaps) this.rooms.push(room);
    }
    // ordena por distância da sala inicial para dar sensação de progressão
    const first = this.rooms[0];
    this.rooms.sort((a, b) => Math.hypot(a.cx - first.cx, a.cy - first.cy) - Math.hypot(b.cx - first.cx, b.cy - first.cy));
    for (const r of this.rooms) this.#carveRect(r.x, r.y, r.w, r.h);

    // conecta cada sala à sala mais próxima já conectada (árvore geradora) + alguns laços
    const connected = [this.rooms[0]];
    for (let i = 1; i < this.rooms.length; i++) {
      const r = this.rooms[i];
      let best = connected[0];
      let bestD = Infinity;
      for (const c of connected) {
        const d = Math.hypot(c.cx - r.cx, c.cy - r.cy);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      this.#carveCorridor(best.cx, best.cy, r.cx, r.cy, rng.pick([2, 3, 3]));
      connected.push(r);
    }
    for (let i = 0; i < 2; i++) {
      const a = rng.pick(this.rooms);
      const b = rng.pick(this.rooms);
      if (a !== b) this.#carveCorridor(a.cx, a.cy, b.cx, b.cy, 2);
    }

    const start = this.rooms[0];
    const last = this.rooms[this.rooms.length - 1];
    this.start = { x: start.cx * TILE + 8, y: start.cy * TILE + 8 };
    this.exit = { tx: last.cx, ty: last.cy, x: last.cx * TILE + 8, y: last.cy * TILE + 8 };
    start.safe = true;
    last.isExit = true;

    // spawns de inimigos (exceto sala inicial)
    const density = 2 + Math.min(4, this.act) * 0.6 + this.floor * 0.5;
    for (let i = 1; i < this.rooms.length; i++) {
      const r = this.rooms[i];
      const n = Math.max(1, Math.round((r.w * r.h) / 40 + rng.range(-1, 1) + density * 0.5));
      for (let k = 0; k < n; k++) {
        const p = this.randomFloorInRoom(r, 1);
        this.spawns.push({ ...p, room: i });
      }
    }
    // portador da chave: elite na sala mais distante (que não seja a de saída)
    const keyRoom = this.rooms[Math.max(1, this.rooms.length - 2)];
    this.keySpawn = this.randomFloorInRoom(keyRoom, 2);

    // baús
    const chestRooms = rng.shuffle(this.rooms.slice(1, -1)).slice(0, rng.int(2, 4));
    for (const r of chestRooms) {
      const p = this.randomFloorInRoom(r, 1);
      this.chests.push({ ...p, mimic: rng.chance(0.12 + this.act * 0.02) });
    }
    // armadilhas de espinhos
    const spikeCount = rng.int(4, 8) + this.act * 2;
    for (let i = 0; i < spikeCount; i++) {
      const r = this.rooms[rng.int(1, this.rooms.length - 1)];
      const p = this.randomFloorInRoom(r, 1);
      if (Math.abs(p.tx - this.exit.tx) + Math.abs(p.ty - this.exit.ty) > 2) this.spikes.push({ tx: p.tx, ty: p.ty, phase: rng.range(0, 3) });
    }
  }

  #generateBossArena() {
    this.#alloc(52, 34);
    const start = { x: 3, y: 13, w: 8, h: 7 };
    const arena = { x: 18, y: 4, w: 30, h: 26 };
    for (const r of [start, arena]) {
      r.cx = r.x + Math.floor(r.w / 2);
      r.cy = r.y + Math.floor(r.h / 2);
      this.rooms.push(r);
      this.#carveRect(r.x, r.y, r.w, r.h);
    }
    this.#carveCorridor(start.cx, start.cy, arena.cx, arena.cy, 3);
    // pilares dentro da arena (cobertura)
    const pillars = [
      [arena.x + 6, arena.y + 6],
      [arena.x + arena.w - 7, arena.y + 6],
      [arena.x + 6, arena.y + arena.h - 7],
      [arena.x + arena.w - 7, arena.y + arena.h - 7],
    ];
    this.pillars = pillars;
    for (const [px, py] of pillars) this.tiles[py * this.w + px] = VOID;
    start.safe = true;
    arena.isArena = true;
    this.arena = arena;
    this.start = { x: start.cx * TILE + 8, y: start.cy * TILE + 8 };
    this.bossSpawn = { x: (arena.cx + 4) * TILE, y: arena.cy * TILE };
    this.exit = null; // aparece quando o chefe morre
    this.exitPending = { tx: arena.cx, ty: arena.cy, x: arena.cx * TILE + 8, y: arena.cy * TILE + 8 };
  }

  #buildWalls() {
    const { w, h, tiles } = this;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (tiles[y * w + x] !== VOID) continue;
        let nearFloor = false;
        for (let dy = -1; dy <= 1 && !nearFloor; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && tiles[ny * w + nx] === FLOOR) {
              nearFloor = true;
              break;
            }
          }
        if (nearFloor) tiles[y * w + x] = WALL;
      }
    // faces de parede com decoração
    for (let y = 0; y < h - 1; y++)
      for (let x = 0; x < w; x++) {
        if (tiles[y * w + x] === WALL && tiles[(y + 1) * w + x] === FLOOR) {
          const r = this.rng.next();
          if (r < 0.05) this.fountains.push({ tx: x, ty: y, color: this.rng.chance(0.5) ? "red" : "blue", t: this.rng.range(0, 3) });
          else if (r < 0.1) this.decor.push({ tx: x, ty: y, sprite: this.rng.pick(BANNERS) });
          else if (r < 0.13) this.decor.push({ tx: x, ty: y, sprite: this.rng.pick(["wall_hole_1", "wall_hole_2", "wall_goo"]) });
        }
      }
  }

  // ------------------------------------------------------------------
  // Renderização estática
  // ------------------------------------------------------------------
  #renderStatic() {
    const A = this.assets;
    const c = document.createElement("canvas");
    c.width = this.w * TILE;
    c.height = this.h * TILE;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#0b0810";
    g.fillRect(0, 0, c.width, c.height);
    const t = (x, y) => this.tileAt(x, y);

    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const px = x * TILE;
        const py = y * TILE;
        const tile = t(x, y);
        if (tile === FLOOR) {
          const name = this.rng.chance(0.82) ? "floor_1" : this.rng.pick(FLOOR_VARIANTS);
          A.drawTile(g, name, px, py);
          // sombra sob paredes
          if (t(x, y - 1) === WALL) {
            g.fillStyle = "rgba(0,0,0,0.35)";
            g.fillRect(px, py, TILE, 4);
          }
        }
      }

    // paredes
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (t(x, y) !== WALL && t(x, y) !== VOID) continue;
        const px = x * TILE;
        const py = y * TILE;
        if (t(x, y + 1) === FLOOR && t(x, y) !== VOID) {
          A.drawTile(g, "wall_mid", px, py);
          A.drawTile(g, "wall_top_mid", px, py - TILE);
        } else if (t(x, y) === VOID && t(x, y + 1) === FLOOR) {
          // pilar dentro da arena
          A.drawTile(g, "wall_mid", px, py);
          A.drawTile(g, "wall_top_mid", px, py - TILE);
        }
        if (t(x, y) === WALL) {
          if (t(x + 1, y) === FLOOR) A.drawTile(g, "wall_side_mid_left", px, py);
          if (t(x - 1, y) === FLOOR) A.drawTile(g, "wall_side_mid_right", px, py);
          if (t(x, y - 1) === FLOOR) A.drawTile(g, "wall_top_mid", px, py - 12);
        }
      }

    for (const d of this.decor) A.drawTile(g, d.sprite, d.tx * TILE, d.ty * TILE);
    if (this.exit) A.drawTile(g, "floor_ladder", this.exit.tx * TILE, this.exit.ty * TILE);

    // tingimento do bioma
    const act = this.assets.content.acts[this.act - 1];
    if (act?.tint) {
      g.globalCompositeOperation = "source-atop";
      g.globalAlpha = 0.28;
      g.fillStyle = act.tint;
      g.fillRect(0, 0, c.width, c.height);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    return c;
  }

  /** Revela o mapa (névoa de guerra) ao redor de um ponto. */
  reveal(px, py, radiusTiles = 7) {
    const cx = Math.floor(px / TILE);
    const cy = Math.floor(py / TILE);
    for (let y = cy - radiusTiles; y <= cy + radiusTiles; y++)
      for (let x = cx - radiusTiles; x <= cx + radiusTiles; x++) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radiusTiles * radiusTiles) this.explored[y * this.w + x] = 1;
      }
  }

  /** Abre a escada de saída (usado quando o chefe é derrotado). */
  openExit() {
    if (this.exit || !this.exitPending) return;
    this.exit = this.exitPending;
    const g = this.static.getContext("2d");
    this.assets.drawTile(g, "floor_ladder", this.exit.tx * TILE, this.exit.ty * TILE);
  }

  /**
   * Campo de fluxo (BFS) a partir do jogador — inimigos seguem o gradiente,
   * contornando paredes sem custo de A* por inimigo.
   */
  computeFlowField(px, py, maxDist = 40) {
    if (!this.flow) this.flow = new Int16Array(this.w * this.h);
    const flow = this.flow;
    flow.fill(-1);
    const sx = Math.floor(px / TILE);
    const sy = Math.floor(py / TILE);
    if (this.isSolidTile(sx, sy)) return;
    const queue = new Int32Array(this.w * this.h);
    let head = 0;
    let tail = 0;
    flow[sy * this.w + sx] = 0;
    queue[tail++] = sy * this.w + sx;
    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % this.w;
      const cy = (cur / this.w) | 0;
      const d = flow[cur];
      if (d >= maxDist) continue;
      const nb = [cur - 1, cur + 1, cur - this.w, cur + this.w];
      const nx = [cx - 1, cx + 1, cx, cx];
      const ny = [cy, cy, cy - 1, cy + 1];
      for (let i = 0; i < 4; i++) {
        if (nx[i] < 0 || ny[i] < 0 || nx[i] >= this.w || ny[i] >= this.h) continue;
        const n = nb[i];
        if (flow[n] !== -1 || this.tiles[n] !== FLOOR) continue;
        flow[n] = d + 1;
        queue[tail++] = n;
      }
    }
  }

  /** Direção (vetor) a seguir no campo de fluxo a partir de (x,y). */
  flowDirection(x, y) {
    if (!this.flow) return null;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const here = this.flow[ty * this.w + tx];
    if (here <= 0) return null;
    let best = here;
    let bx = 0;
    let by = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
      const v = this.flow[ny * this.w + nx];
      if (v < 0) continue;
      // evita cortar quinas na diagonal
      if (dx && dy && (this.isSolidTile(tx + dx, ty) || this.isSolidTile(tx, ty + dy))) continue;
      if (v < best) {
        best = v;
        bx = dx;
        by = dy;
      }
    }
    if (!bx && !by) return null;
    const tx2 = (tx + bx) * TILE + 8;
    const ty2 = (ty + by) * TILE + 8;
    const l = Math.hypot(tx2 - x, ty2 - y) || 1;
    return { x: (tx2 - x) / l, y: (ty2 - y) / l, dist: here };
  }
}
