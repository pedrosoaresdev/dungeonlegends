using DungeonLegends.Domain.Content;

namespace DungeonLegends.Domain.Rules;

/// <summary>Curva de experiência e atributos por nível (espelha o cliente).</summary>
public static class ProgressionRules
{
    /// <summary>XP necessário para passar de <paramref name="level"/> para o próximo nível.</summary>
    public static int XpForLevel(GameRules rules, int level)
    {
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentOutOfRangeException.ThrowIfLessThan(level, 1);
        return (int)ScoreCalculator.JsRound(rules.XpBase * Math.Pow(rules.XpGrowth, level - 1));
    }

    /// <summary>XP total acumulado para alcançar <paramref name="level"/> a partir do nível 1.</summary>
    public static long TotalXpToReach(GameRules rules, int level)
    {
        long total = 0;
        for (var l = 1; l < level; l++) total += XpForLevel(rules, l);
        return total;
    }

    /// <summary>Vida máxima base (sem perks/itens) de uma classe em um nível.</summary>
    public static int BaseMaxHp(GameRules rules, HeroClassDef cls, int level)
    {
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(cls);
        return (int)Math.Round(cls.Stats.Hp + ((level - 1) * rules.StatPerLevel.Hp));
    }
}
