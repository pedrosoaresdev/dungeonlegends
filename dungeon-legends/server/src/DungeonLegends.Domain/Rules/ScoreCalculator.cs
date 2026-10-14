using DungeonLegends.Domain.Content;
using DungeonLegends.Domain.Entities;

namespace DungeonLegends.Domain.Rules;

/// <summary>
/// Pontuação oficial. Espelha <c>computeScore</c> de <c>client/js/systems/rules.js</c>,
/// mas o valor do servidor é o que vale no ranking.
/// </summary>
public static class ScoreCalculator
{
    public static long Compute(ScoreRules rules, RunSummary s)
    {
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(s);

        var floors = Math.Max(0, s.FloorsCleared);
        var seconds = Math.Max(1.0, s.TimeMs / 1000.0);
        var parSeconds = Math.Max(1, floors) * (double)rules.TimeBonusSecondsPerFloor;
        var timeFactor = Math.Clamp(1 - (seconds / (parSeconds * 2)), 0, 1);
        var timeBonus = s.Victory ? JsRound(rules.TimeBonusMax * timeFactor) : 0;

        var total =
            (floors * (double)rules.PerFloor) +
            (Math.Max(0, s.Kills) * (double)rules.PerKill) +
            (Math.Max(0, s.BossesKilled) * (double)rules.PerBoss) +
            (Math.Max(0, s.GoldEarned) * (double)rules.PerGold) +
            (Math.Max(1, s.Level) * (double)rules.PerLevel) +
            (s.Victory ? rules.VictoryBonus : 0) +
            timeBonus;

        return JsRound(total);
    }

    /// <summary>Arredondamento igual ao <c>Math.round</c> do JavaScript (meio para cima).</summary>
    public static long JsRound(double v) => (long)Math.Floor(v + 0.5);
}
