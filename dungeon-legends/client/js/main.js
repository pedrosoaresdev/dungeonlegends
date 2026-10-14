// Ponto de entrada. Abra index.html com o Live Server (Go Live) no VS Code.

import { Game } from "./game.js";

const canvas = document.getElementById("game");
const game = new Game(canvas);

if (location.protocol === "file:") {
  document.getElementById("load-text").textContent =
    "Abra pelo Live Server (Go Live) — navegadores bloqueiam módulos JS via file://";
} else {
  game.init().catch((err) => {
    console.error(err);
    document.getElementById("load-text").textContent = "Erro ao iniciar: " + err.message;
  });
}

// expõe para depuração no console do navegador: window.game
window.game = game;
