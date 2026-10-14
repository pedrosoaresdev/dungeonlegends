// Entrada unificada: teclado + mouse + gamepad.

const KEYMAP = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  attack: ["KeyJ"],
  dash: ["Space", "ShiftLeft", "ShiftRight"],
  ability: ["KeyQ", "KeyK"],
  interact: ["KeyE", "KeyL"],
  potionHp: ["Digit1"],
  potionMp: ["Digit2"],
  pause: ["Escape", "KeyP"],
  mute: ["KeyM"],
};

export class Input {
  constructor(canvas, logicalW, logicalH) {
    this.canvas = canvas;
    this.w = logicalW;
    this.h = logicalH;
    this.down = new Set();
    this.pressedThisFrame = new Set();
    this.mouse = { x: logicalW / 2, y: logicalH / 2, left: false, right: false, lastMove: 0 };
    this.mousePressed = { left: false, right: false };
    this.pad = null;
    this.padPrev = {};
    this.usingPad = false;

    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
      this.usingPad = false;
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    window.addEventListener("blur", () => {
      this.down.clear();
      this.mouse.left = this.mouse.right = false;
    });

    canvas.addEventListener("mousemove", (e) => this.#updateMouse(e));
    canvas.addEventListener("mousedown", (e) => {
      this.#updateMouse(e);
      if (e.button === 0) {
        this.mouse.left = true;
        this.mousePressed.left = true;
      }
      if (e.button === 2) {
        this.mouse.right = true;
        this.mousePressed.right = true;
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  #updateMouse(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * this.w;
    this.mouse.y = ((e.clientY - r.top) / r.height) * this.h;
    this.mouse.lastMove = performance.now();
    this.usingPad = false;
  }

  /** Lê o gamepad (chamar 1x por frame antes de consultar). */
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) {
      if (p && p.connected) {
        this.pad = p;
        break;
      }
    }
    if (this.pad) {
      const anyInput = this.pad.buttons.some((b) => b.pressed) || this.pad.axes.some((a) => Math.abs(a) > 0.3);
      if (anyInput) this.usingPad = true;
    }
  }

  #padBtn(i) {
    return !!(this.pad && this.pad.buttons[i] && this.pad.buttons[i].pressed);
  }

  #padPressed(i) {
    const now = this.#padBtn(i);
    return now && !this.padPrev[i];
  }

  isDown(action) {
    if (KEYMAP[action]?.some((k) => this.down.has(k))) return true;
    if (action === "attack" && this.mouse.left) return true;
    if (action === "ability" && this.mouse.right) return true;
    if (this.pad) {
      const map = { attack: 7, dash: 0, ability: 2, interact: 3 };
      if (map[action] !== undefined && this.#padBtn(map[action])) return true;
    }
    return false;
  }

  pressed(action) {
    if (KEYMAP[action]?.some((k) => this.pressedThisFrame.has(k))) return true;
    if (action === "attack" && this.mousePressed.left) return true;
    if (action === "ability" && this.mousePressed.right) return true;
    if (this.pad) {
      const map = { dash: 0, ability: 2, interact: 3, potionHp: 4, potionMp: 5, pause: 9, attack: 7 };
      if (map[action] !== undefined && this.#padPressed(map[action])) return true;
    }
    return false;
  }

  /** Vetor de movimento normalizado. */
  moveVector() {
    let x = 0;
    let y = 0;
    if (this.isDown("left")) x -= 1;
    if (this.isDown("right")) x += 1;
    if (this.isDown("up")) y -= 1;
    if (this.isDown("down")) y += 1;
    if (this.pad) {
      const ax = this.pad.axes[0] ?? 0;
      const ay = this.pad.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > 0.2) {
        x = ax;
        y = ay;
      }
    }
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  /** Direção de mira do analógico direito (ou null). */
  padAim() {
    if (!this.pad) return null;
    const ax = this.pad.axes[2] ?? 0;
    const ay = this.pad.axes[3] ?? 0;
    return Math.hypot(ax, ay) > 0.35 ? Math.atan2(ay, ax) : null;
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.mousePressed.left = this.mousePressed.right = false;
    if (this.pad) this.pad.buttons.forEach((b, i) => (this.padPrev[i] = b.pressed));
  }
}
