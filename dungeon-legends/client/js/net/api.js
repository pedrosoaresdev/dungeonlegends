// Cliente da API C# (DungeonLegends.Api). O jogo funciona 100% offline:
// se a API não responder, saves e ranking ficam no localStorage.

const LS = {
  player: "dl.player",
  save: "dl.save",
  board: "dl.localBoard",
  apiUrl: "dl.apiUrl",
};

export const DEFAULT_API_URL = "http://localhost:5080";

export class Api {
  constructor() {
    this.baseUrl = localStorage.getItem(LS.apiUrl) || DEFAULT_API_URL;
    this.online = false;
    this.player = readJson(LS.player);
    this.version = null;
  }

  setBaseUrl(url) {
    this.baseUrl = url.replace(/\/+$/, "");
    localStorage.setItem(LS.apiUrl, this.baseUrl);
  }

  async #req(method, path, body, { timeout = 3000, auth = false } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const headers = { "Content-Type": "application/json" };
      if (auth && this.player?.token) {
        headers["X-Player-Token"] = this.player.token;
        headers["X-Player-Id"] = this.player.id;
      }
      const res = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (res.status === 204) return null;
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.detail || data?.title || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.errors = data?.errors;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Testa a conexão com a API. */
  async connect() {
    try {
      const info = await this.#req("GET", "/api/health", null, { timeout: 1500 });
      this.online = info?.status === "Healthy" || info?.status === "ok";
      this.version = info?.version;
      if (this.online && this.player) {
        // garante que o jogador existe nesse servidor
        try {
          await this.#req("GET", `/api/players/${this.player.id}`, null, { auth: true });
        } catch (e) {
          if (e.status === 404 || e.status === 401) this.player = null;
        }
      }
    } catch {
      this.online = false;
    }
    return this.online;
  }

  get hasPlayer() {
    return !!this.player;
  }

  async register(name) {
    name = (name || "").trim().slice(0, 16) || "Herói";
    if (this.online) {
      try {
        this.player = await this.#req("POST", "/api/players", { name });
        writeJson(LS.player, this.player);
        return this.player;
      } catch (e) {
        if (e.status === 400 || e.status === 409) throw e;
        this.online = false;
      }
    }
    this.player = { id: "local-" + crypto.randomUUID(), name, token: null, local: true };
    writeJson(LS.player, this.player);
    return this.player;
  }

  async startRun(classId, daily = false) {
    if (this.online && this.player && !this.player.local) {
      try {
        return await this.#req("POST", "/api/runs", { playerId: this.player.id, heroClass: classId, daily }, { auth: true });
      } catch (e) {
        console.warn("API startRun falhou, usando modo offline:", e.message);
      }
    }
    return { runId: null, seed: (Math.random() * 2 ** 32) >>> 0, offline: true, modifier: null };
  }

  /** Envia o resumo da partida. O servidor recalcula a pontuação e valida. */
  async finishRun(runId, summary, localScore) {
    let result = null;
    if (runId && this.online) {
      try {
        result = await this.#req("POST", `/api/runs/${runId}/finish`, summary, { auth: true });
      } catch (e) {
        console.warn("API finishRun falhou:", e.message);
      }
    }
    const entry = {
      name: this.player?.name || "Herói",
      heroClass: summary.heroClass,
      score: result?.score ?? localScore,
      floorsCleared: summary.floorsCleared,
      victory: summary.victory,
      level: summary.level,
      date: new Date().toISOString(),
    };
    const board = readJson(LS.board) || [];
    board.push(entry);
    board.sort((a, b) => b.score - a.score);
    writeJson(LS.board, board.slice(0, 20));
    return result || { score: localScore, rank: board.indexOf(entry) + 1, offline: true };
  }

  async leaderboard(top = 10) {
    if (this.online) {
      try {
        const data = await this.#req("GET", `/api/leaderboard?top=${top}`);
        return { online: true, entries: data.entries };
      } catch {
        /* cai no local */
      }
    }
    return { online: false, entries: (readJson(LS.board) || []).slice(0, top) };
  }

  async daily() {
    if (!this.online) return null;
    try {
      return await this.#req("GET", "/api/daily");
    } catch {
      return null;
    }
  }

  // ---------------- saves ----------------
  localSave() {
    return readJson(LS.save);
  }

  async save(data) {
    data.savedAt = new Date().toISOString();
    writeJson(LS.save, data);
    if (this.online && this.player && !this.player.local) {
      try {
        await this.#req("PUT", `/api/saves/${this.player.id}`, data, { auth: true });
      } catch (e) {
        console.warn("Save remoto rejeitado:", e.message, e.errors || "");
      }
    }
  }

  async load() {
    const local = this.localSave();
    if (this.online && this.player && !this.player.local) {
      try {
        const remote = await this.#req("GET", `/api/saves/${this.player.id}`, null, { auth: true });
        if (remote && (!local || new Date(remote.savedAt) >= new Date(local.savedAt))) return remote;
      } catch {
        /* sem save remoto */
      }
    }
    return local;
  }

  async deleteSave() {
    localStorage.removeItem(LS.save);
    if (this.online && this.player && !this.player.local) {
      try {
        await this.#req("DELETE", `/api/saves/${this.player.id}`, null, { auth: true });
      } catch {
        /* ignora */
      }
    }
  }
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeJson(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* armazenamento indisponível */
  }
}
