// Regras compartilhadas com a API C# (ProgressionService / ScoreCalculator).
// Mantenha as fórmulas em sincronia — a API recalcula a pontuação para evitar trapaça.

export function xpForLevel(rules, level) {
  // XP necessário para ir de `level` para `level + 1`
  return Math.round(rules.xpBase * Math.pow(rules.xpGrowth, level - 1));
}

export function totalFloors(content) {
  return content.acts.reduce((s, a) => s + a.floors + 1, 0);
}

/** Índice absoluto do andar (1-based), contando a arena do chefe como andar. */
export function absoluteFloor(content, act, floor) {
  let n = 0;
  for (let i = 0; i < act - 1; i++) n += content.acts[i].floors + 1;
  return n + floor;
}

export function computeScore(rules, s) {
  const sc = rules.score;
  const floors = Math.max(0, s.floorsCleared);
  const seconds = Math.max(1, s.timeMs / 1000);
  const parSeconds = Math.max(1, floors) * sc.timeBonusSecondsPerFloor;
  const timeFactor = Math.max(0, Math.min(1, 1 - seconds / (parSeconds * 2)));
  const timeBonus = s.victory ? Math.round(sc.timeBonusMax * timeFactor) : 0;
  return Math.round(
    floors * sc.perFloor +
      s.kills * sc.perKill +
      s.bossesKilled * sc.perBoss +
      s.goldEarned * sc.perGold +
      s.level * sc.perLevel +
      (s.victory ? sc.victoryBonus : 0) +
      timeBonus
  );
}
