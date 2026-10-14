using System.Globalization;
using DungeonLegends.Domain.Entities;

namespace DungeonLegends.Domain.Rules;

public sealed record DailyChallenge(string Date, uint Seed, DailyModifier Modifier);

/// <summary>
/// Gera o desafio diário de forma determinística a partir da data (UTC):
/// todos os jogadores enfrentam as mesmas masmorras e o mesmo modificador no dia.
/// </summary>
public static class DailyChallengeGenerator
{
    public static readonly IReadOnlyList<DailyModifier> Modifiers =
    [
        new("horde", "Horda Implacável", "Inimigos com +50% de vida, mas +50% de XP.", EnemyHpMult: 1.5, XpMult: 1.5),
        new("goldrush", "Febre do Ouro", "Ouro em dobro, mas inimigos causam +25% de dano.", EnemyAtkMult: 1.25, GoldMult: 2),
        new("glass", "Canhão de Vidro", "+6 de ataque e -40% de vida máxima. Não erre a esquiva!"),
        new("brutal", "Modo Brutal", "Inimigos com +30% de vida e dano. XP x1.6.", EnemyHpMult: 1.3, EnemyAtkMult: 1.3, XpMult: 1.6),
        new("blessed", "Bênção dos Antigos", "XP x2 e ouro x1.5. Uma boa noite para subir de nível.", GoldMult: 1.5, XpMult: 2),
    ];

    public static DailyChallenge For(DateOnly date)
    {
        var key = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var seed = StringHash.Fnv1a("daily-" + key);
        var rng = new SeededRandom(seed);
        var modifier = rng.Pick(Modifiers);
        return new DailyChallenge(key, seed, modifier);
    }
}
