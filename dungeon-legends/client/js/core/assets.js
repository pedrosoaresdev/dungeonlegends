// Carregamento do spritesheet 0x72 (CC0) + cache de versões tingidas/silhuetas.

export class Assets {
  constructor() {
    this.image = null;
    this.sprites = {};
    this.cache = new Map();
    this.content = null;
  }

  async load(onProgress = () => {}) {
    onProgress(0.1, "Lendo atlas...");
    const atlas = await fetchJson("assets/sprites/atlas.json");
    this.sprites = atlas.sprites;
    onProgress(0.35, "Carregando sprites...");
    this.image = await loadImage("assets/sprites/" + atlas.image);
    onProgress(0.7, "Carregando conteúdo...");
    this.content = await fetchJson("data/content.json");
    onProgress(1, "Pronto!");
  }

  has(name) {
    return !!this.sprites[name];
  }

  /** Retorna o descritor do sprite; aceita "knight_m" + "idle" -> knight_m_idle_anim. */
  get(name) {
    const s = this.sprites[name];
    if (!s) throw new Error("Sprite inexistente: " + name);
    return s;
  }

  anim(base, state) {
    const key = `${base}_${state}_anim`;
    if (this.sprites[key]) return key;
    if (this.sprites[`${base}_idle_anim`]) return `${base}_idle_anim`;
    if (this.sprites[`${base}_anim`]) return `${base}_anim`;
    return base;
  }

  frameCount(name) {
    return this.get(name).frames;
  }

  /**
   * Desenha um frame com âncora no centro-inferior (pés) em (x, y).
   * opts: { frame, flip, scale, alpha, tint, white, rotation, anchorY }
   */
  draw(ctx, name, x, y, opts = {}) {
    const s = this.get(name);
    const frame = (opts.frame ?? 0) % s.frames;
    const scale = opts.scale ?? 1;
    const w = s.w * scale;
    const h = s.h * scale;
    let src = this.image;
    let sx = s.x + frame * s.w;
    let sy = s.y;
    if (opts.white || opts.tint) {
      src = this.tinted(name, frame, opts.white ? "#ffffff" : opts.tint, opts.white ? 1 : opts.tintAmount ?? 0.55);
      sx = 0;
      sy = 0;
    }
    ctx.save();
    if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
    ctx.translate(Math.round(x), Math.round(y));
    if (opts.rotation) ctx.rotate(opts.rotation);
    if (opts.flip) ctx.scale(-1, 1);
    const ay = opts.anchorY ?? 1;
    ctx.drawImage(src, sx, sy, s.w, s.h, -w / 2, -h * ay, w, h);
    ctx.restore();
  }

  /** Desenha ancorado no canto superior esquerdo (para tiles). */
  drawTile(ctx, name, x, y, frame = 0) {
    const s = this.get(name);
    ctx.drawImage(this.image, s.x + (frame % s.frames) * s.w, s.y, s.w, s.h, x, y, s.w, s.h);
  }

  tinted(name, frame, color, amount) {
    const key = `${name}|${frame}|${color}|${amount}`;
    let c = this.cache.get(key);
    if (c) return c;
    const s = this.get(name);
    c = document.createElement("canvas");
    c.width = s.w;
    c.height = s.h;
    const g = c.getContext("2d");
    g.drawImage(this.image, s.x + frame * s.w, s.y, s.w, s.h, 0, 0, s.w, s.h);
    g.globalCompositeOperation = "source-atop";
    g.globalAlpha = amount;
    g.fillStyle = color;
    g.fillRect(0, 0, s.w, s.h);
    this.cache.set(key, c);
    return c;
  }

  /** Gera um dataURL ampliado (ícones nítidos para a interface HTML). */
  iconURL(name, scale = 3, frame = 0) {
    const key = `icon|${name}|${scale}|${frame}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const s = this.get(name);
    const c = document.createElement("canvas");
    c.width = s.w * scale;
    c.height = s.h * scale;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(this.image, s.x + frame * s.w, s.y, s.w, s.h, 0, 0, c.width, c.height);
    const url = c.toDataURL();
    this.cache.set(key, url);
    return url;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Falha ao carregar ${url} (${res.status})`);
  return res.json();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Falha ao carregar imagem " + src));
    img.src = src;
  });
}
