// Interface HTML: HUD, telas, cartas de perks, loja, ranking, opções.

const $ = (sel) => document.querySelector(sel);

export class UI {
  constructor(game) {
    this.game = game;
    this.current = "loading";
    this.history = [];
    this.hudCache = {};
    this.previewTimers = [];
    this.stage = $("#stage");
    this.#fitStage();
    window.addEventListener("resize", () => this.#fitStage());

    // delegação de cliques em botões com data-action
    $("#screens").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn || btn.disabled) return;
      this.game.audio.unlock();
      this.game.audio.play("select");
      this.game.onAction(btn.dataset.action, btn.dataset);
    });
  }

  #fitStage() {
    const s = Math.min(window.innerWidth / 480, window.innerHeight / 270);
    document.documentElement.style.setProperty("--px", s + "px");
  }

  // ------------------------------------------------------------------
  // Telas
  // ------------------------------------------------------------------
  show(id, { remember = true } = {}) {
    if (remember && this.current && this.current !== id) this.history.push(this.current);
    if (this.history.length > 10) this.history.shift();
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    if (id) {
      const el = $("#screen-" + id);
      el.classList.add("active");
      const first = el.querySelector("button.primary:not(:disabled), button:not(:disabled), .card, .perk");
      if (first && id !== "title") setTimeout(() => first.focus({ preventScroll: true }), 50);
    }
    this.current = id;
  }

  back() {
    const prev = this.history.pop() || "title";
    this.show(prev, { remember: false });
    return prev;
  }

  hideScreens() {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    this.current = null;
  }

  setLoading(p, text) {
    $("#load-fill").style.width = Math.round(p * 100) + "%";
    $("#load-text").textContent = text;
  }

  setApiStatus(online, url) {
    const el = $("#api-status");
    el.className = "status " + (online ? "on" : "off");
    el.textContent = online ? `● Servidor C# online (${url}) — ranking global ativo` : "● Modo offline — saves e ranking locais (rode a API C# para o modo online)";
    $("#btn-daily").disabled = !online;
  }

  setupTitle({ hasSave, playerName, needsName }) {
    $("#btn-continue").disabled = !hasSave;
    $("#name-row").classList.toggle("hidden", !needsName);
    if (playerName) $("#player-name").value = playerName;
  }

  get typedName() {
    return $("#player-name").value.trim();
  }

  // ------------------------------------------------------------------
  // Seleção de classe com sprites animados
  // ------------------------------------------------------------------
  buildClassSelect(daily) {
    const g = this.game;
    const A = g.assets;
    const grid = $("#class-grid");
    grid.innerHTML = "";
    this.previewTimers.forEach(clearInterval);
    this.previewTimers = [];
    const info = $("#daily-info");
    info.classList.toggle("hidden", !daily);
    if (daily) info.innerHTML = `Desafio do dia <b class="gold">${daily.date}</b>: ${daily.modifier.name} — ${daily.modifier.description}`;

    const maxOf = (k) => Math.max(...g.content.classes.map((c) => c.stats[k]));
    for (const cls of g.content.classes) {
      const card = document.createElement("div");
      card.className = "card";
      card.tabIndex = 0;
      card.style.setProperty("--c", cls.color);
      const cv = document.createElement("canvas");
      cv.width = 40;
      cv.height = 48;
      const stat = (label, key) => `<span>${label}</span><i style="width:${Math.round((cls.stats[key] / maxOf(key)) * 100)}%"></i>`;
      card.innerHTML = `<h3>${cls.name}</h3>`;
      card.appendChild(cv);
      card.insertAdjacentHTML(
        "beforeend",
        `<p>${cls.description}</p><div class="ab">★ ${cls.ability.name}</div>
         <div class="statrow">${stat("VIDA", "hp")}${stat("ATQ", "atk")}${stat("DEF", "def")}${stat("VEL", "speed")}</div>`
      );
      const ctx = cv.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      let f = 0;
      const anim = A.anim(cls.sprite, "run");
      const draw = () => {
        ctx.clearRect(0, 0, 40, 48);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(12, 42, 16, 3);
        ctx.save();
        ctx.scale(2, 2);
        A.draw(ctx, anim, 10, 22, { frame: f++ });
        A.draw(ctx, cls.startWeapon, 15, 18, { rotation: 0.6, anchorY: 0.85 });
        ctx.restore();
      };
      draw();
      this.previewTimers.push(setInterval(draw, 110));
      const choose = () => {
        g.audio.unlock();
        g.audio.play("select");
        g.onAction("choose-class", { classId: cls.id });
      };
      card.addEventListener("click", choose);
      card.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && choose());
      grid.appendChild(card);
    }
  }

  // ------------------------------------------------------------------
  // História (efeito máquina de escrever)
  // ------------------------------------------------------------------
  showStory(act) {
    $("#story-sub").textContent = act.subtitle;
    $("#story-title").textContent = act.name;
    const el = $("#story-text");
    el.textContent = "";
    clearInterval(this.typeTimer);
    let i = 0;
    this.typeTimer = setInterval(() => {
      el.textContent = act.story.slice(0, ++i);
      if (i % 3 === 0) this.game.audio.play("select");
      if (i >= act.story.length) clearInterval(this.typeTimer);
    }, 28);
    this.show("story", { remember: false });
  }

  // ------------------------------------------------------------------
  // Perks
  // ------------------------------------------------------------------
  showPerks(level, perks, onPick) {
    $("#lvl-number").textContent = level;
    const grid = $("#perk-grid");
    grid.innerHTML = "";
    perks.forEach((p, i) => {
      const btn = document.createElement("button");
      btn.className = "perk";
      btn.innerHTML = `<div class="icon">${p.icon}</div><h3>${p.name}</h3><p>${p.desc}</p><small>Nível ${p.current + 1}/${p.max} · tecla ${i + 1}</small>`;
      btn.addEventListener("click", () => onPick(p));
      grid.appendChild(btn);
    });
    this.perkKeys = (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= perks.length) onPick(perks[n - 1]);
    };
    window.addEventListener("keydown", this.perkKeys);
    this.show("levelup", { remember: false });
  }

  clearPerkKeys() {
    if (this.perkKeys) window.removeEventListener("keydown", this.perkKeys);
    this.perkKeys = null;
  }

  // ------------------------------------------------------------------
  // Loja
  // ------------------------------------------------------------------
  showShop(items, gold, onBuy) {
    const A = this.game.assets;
    $("#shop-gold").textContent = gold;
    const grid = $("#shop-grid");
    grid.innerHTML = "";
    for (const it of items) {
      const btn = document.createElement("button");
      btn.className = "shop-item";
      btn.disabled = gold < it.price || it.soldOut;
      const sprite = A.has(it.sprite) ? it.sprite : "flask_big_red";
      btn.innerHTML = `<img src="${A.iconURL(sprite, 3)}" alt="" /><h3>${it.name}</h3><p>${it.desc}</p><b>${it.soldOut ? "ESGOTADO" : it.price + " ouro"}</b>`;
      btn.addEventListener("click", () => onBuy(it));
      grid.appendChild(btn);
    }
    if (this.current !== "shop") this.show("shop", { remember: false });
  }

  // ------------------------------------------------------------------
  // HUD
  // ------------------------------------------------------------------
  setupHud(player) {
    const A = this.game.assets;
    $("#hud-portrait").src = A.iconURL(A.anim(player.sprite, "idle"), 4);
    $("#hud-coin").src = A.iconURL("coin_anim", 4);
    $("#hud-flask-hp").src = A.iconURL("flask_big_red", 3);
    $("#hud-flask-mp").src = A.iconURL("flask_big_blue", 3);
    $("#hud-ability-name").textContent = player.cls.ability.name;
    this.hudCache = {};
    $("#hud").classList.remove("hidden");
  }

  hideHud() {
    $("#hud").classList.add("hidden");
    $("#bossbar").classList.add("hidden");
    $("#vignette").classList.remove("low");
  }

  #set(id, prop, value) {
    if (this.hudCache[id + prop] === value) return;
    this.hudCache[id + prop] = value;
    const el = document.getElementById(id);
    if (prop === "text") el.textContent = value;
    else if (prop === "width") el.style.width = value;
    else if (prop === "src") el.src = value;
    else if (prop === "html") el.innerHTML = value;
  }

  updateHud(game) {
    const p = game.player;
    const s = p.stats;
    const hpPct = Math.max(0, p.hp / s.maxHp) * 100;
    this.#set("hud-hp", "width", hpPct.toFixed(1) + "%");
    this.#set("hud-hp-trail", "width", hpPct.toFixed(1) + "%");
    this.#set("hud-hp-text", "text", `${Math.max(0, Math.ceil(p.hp))}/${s.maxHp}`);
    this.#set("hud-mp", "width", ((p.mana / s.maxMana) * 100).toFixed(1) + "%");
    this.#set("hud-mp-text", "text", `${Math.floor(p.mana)}/${s.maxMana}`);
    this.#set("hud-xp", "width", ((p.xp / p.xpToNext) * 100).toFixed(1) + "%");
    this.#set("hud-level", "text", String(p.level));
    this.#set("hud-gold", "text", String(p.gold));
    this.#set("hud-pot-hp", "text", String(p.potions.hp));
    this.#set("hud-pot-mp", "text", String(p.potions.mp));
    this.#set("hud-weapon", "src", game.assets.iconURL(p.weapon.id, 3));
    const act = game.content.acts[game.run.act - 1];
    this.#set("hud-act", "text", `${act.subtitle}: ${act.name}`);
    this.#set("hud-floor", "text", game.dungeon.isBoss ? "Covil do Chefe" : `Andar ${game.run.floor}/${act.floors}`);
    this.#set("hud-kills", "text", `☠ ${game.run.kills}`);
    const keyEl = document.getElementById("hud-key");
    if (this.hudCache.key !== p.hasKey) {
      this.hudCache.key = p.hasKey;
      keyEl.classList.toggle("has", p.hasKey);
      keyEl.classList.toggle("hidden", game.dungeon.isBoss);
    }
    const ab = document.getElementById("skill-ability");
    const abPct = Math.max(0, p.abilityCd / (p.cls.ability.cooldown * s.cdMult));
    ab.querySelector(".cd").style.setProperty("--cd", (100 - abPct * 100).toFixed(0) + "%");
    ab.classList.toggle("ready", abPct <= 0 && p.mana >= p.cls.ability.cost);
    const dash = document.getElementById("skill-dash");
    dash.querySelector(".cd").style.setProperty("--cd", (100 - Math.max(0, p.dashCd / 0.75) * 100).toFixed(0) + "%");
    document.getElementById("vignette").classList.toggle("low", hpPct < 25);

    let obj;
    if (game.dungeon.isBoss) obj = game.boss && !game.boss.dead ? `Derrote <b>${game.boss.def.name}</b>` : "Desça pela <b>escada</b> [E]";
    else obj = p.hasKey ? "Você tem a chave! Encontre a <b>escada</b> (▼ no mapa) e aperte [E]" : "Derrote o <b>Elite Dourado</b> para obter a chave do andar";
    this.#set("hud-objective", "html", obj);
  }

  // ------------------------------------------------------------------
  // Minimapa
  // ------------------------------------------------------------------
  drawMinimap(game) {
    const cv = document.getElementById("minimap");
    const ctx = cv.getContext("2d");
    const d = game.dungeon;
    const scale = Math.min(cv.width / d.w, cv.height / d.h);
    const ox = (cv.width - d.w * scale) / 2;
    const oy = (cv.height - d.h * scale) / 2;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < d.h; y++)
      for (let x = 0; x < d.w; x++) {
        const i = y * d.w + x;
        if (!d.explored[i]) continue;
        const t = d.tiles[i];
        if (t === 1) ctx.fillStyle = "#4a3d5c";
        else if (t === 2) ctx.fillStyle = "#1f1729";
        else continue;
        ctx.fillRect(ox + x * scale, oy + y * scale, Math.ceil(scale), Math.ceil(scale));
      }
    const dot = (wx, wy, color, size = 2) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(ox + (wx / 16) * scale - size / 2), Math.round(oy + (wy / 16) * scale - size / 2), size, size);
    };
    if (d.exit && d.explored[d.exit.ty * d.w + d.exit.tx]) dot(d.exit.x, d.exit.y, "#ffd23a", 4);
    for (const c of game.chests) if (!c.opened && d.explored[Math.floor(c.y / 16) * d.w + Math.floor(c.x / 16)]) dot(c.x, c.y, "#c08a3a", 2);
    for (const e of game.enemies) {
      if (e.dead || e.dormant) continue;
      if (Math.hypot(e.x - game.player.x, e.y - game.player.y) > 200 && !e.keyHolder && !e.isBoss) continue;
      dot(e.x, e.y, e.isBoss ? "#ff2a2a" : e.keyHolder ? "#ffd23a" : "#e04a5a", e.isBoss ? 4 : 2);
    }
    const blink = Math.floor(performance.now() / 300) % 2;
    dot(game.player.x, game.player.y, blink ? "#ffffff" : "#5ad1ff", 3);
  }

  // ------------------------------------------------------------------
  // Chefe
  // ------------------------------------------------------------------
  showBoss(boss) {
    $("#boss-name").textContent = boss.def.name;
    $("#bossbar").classList.remove("hidden", "enraged");
    this.updateBoss(boss);
  }

  updateBoss(boss) {
    const pct = Math.max(0, boss.hp / boss.maxHp) * 100 + "%";
    this.#set("boss-fill", "width", pct);
    this.#set("boss-ghost", "width", pct);
    if (boss.phase === 2) $("#bossbar").classList.add("enraged");
  }

  hideBoss() {
    $("#bossbar").classList.add("hidden");
  }

  // ------------------------------------------------------------------
  // Mensagens
  // ------------------------------------------------------------------
  toast(text, color = "#efe6ff") {
    const el = document.createElement("div");
    el.className = "toast";
    el.style.color = color;
    el.textContent = text;
    const box = $("#toasts");
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), 2700);
  }

  banner(title, sub = "") {
    const b = $("#banner");
    $("#banner-title").textContent = title;
    $("#banner-sub").textContent = sub;
    b.classList.add("hidden");
    void b.offsetWidth; // reinicia animação
    b.classList.remove("hidden");
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.add("hidden"), 3000);
  }

  // ------------------------------------------------------------------
  // Fichas de estatísticas / ranking / pausa
  // ------------------------------------------------------------------
  statsSheet(id, rows) {
    $(id).innerHTML = rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join("");
  }

  showEnd(kind, { rows, score, rank, cause }) {
    const pre = kind === "victory" ? "win" : "go";
    this.statsSheet(`#${pre}-stats`, rows);
    $(`#${pre}-score`).textContent = score.toLocaleString("pt-BR");
    $(`#${pre}-rank`).textContent = rank ? `(#${rank} no ranking)` : "";
    if (cause) $("#go-cause").textContent = cause;
    this.show(kind === "victory" ? "victory" : "gameover", { remember: false });
  }

  async showLeaderboard(promise, myName) {
    $("#board-body").innerHTML = `<tr><td colspan="6">Carregando...</td></tr>`;
    this.show("leaderboard");
    const { online, entries } = await promise;
    $("#board-source").textContent = online ? "Ranking global (servidor C#)" : "Ranking local (offline)";
    const classNames = Object.fromEntries(this.game.content.classes.map((c) => [c.id, c.name]));
    $("#board-body").innerHTML = entries.length
      ? entries
          .map(
            (e, i) =>
              `<tr class="${e.name === myName ? "me" : ""}"><td>${i + 1}</td><td>${escapeHtml(e.name)}${e.victory ? " 👑" : ""}</td><td>${classNames[e.heroClass] || e.heroClass}</td><td>${e.floorsCleared}</td><td>${e.level}</td><td>${Number(e.score).toLocaleString("pt-BR")}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="6">Nenhuma lenda ainda. Seja a primeira!</td></tr>`;
  }

  bindSettings(settings, onChange) {
    const sfx = $("#set-sfx");
    const music = $("#set-music");
    const aim = $("#set-autoaim");
    const shake = $("#set-shake");
    const fps = $("#set-fps");
    const api = $("#set-api");
    sfx.value = settings.sfx;
    music.value = settings.music;
    aim.checked = settings.autoAim;
    shake.checked = settings.shake;
    fps.checked = settings.fps;
    api.value = settings.apiUrl;
    sfx.oninput = () => onChange("sfx", parseFloat(sfx.value));
    music.oninput = () => onChange("music", parseFloat(music.value));
    aim.onchange = () => onChange("autoAim", aim.checked);
    shake.onchange = () => onChange("shake", shake.checked);
    fps.onchange = () => onChange("fps", fps.checked);
    api.onchange = () => onChange("apiUrl", api.value.trim());
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
