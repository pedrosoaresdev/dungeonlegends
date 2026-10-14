using DungeonLegends.Domain.Common;
using DungeonLegends.Domain.Content;
using DungeonLegends.Domain.Entities;

namespace DungeonLegends.Domain.Rules;

/// <summary>
/// Antitrapaça: verifica a plausibilidade do resumo de uma partida.
/// Erros estruturais lançam <see cref="ValidationException"/>; suspeitas
/// retornam "flags" — a partida é registrada, mas fica fora do ranking.
/// </summary>
public static class RunValidator
{
    /// <summary>Tolerância para diferenças de relógio/latência entre cliente e servidor.</summary>
    public static readonly TimeSpan ClockTolerance = TimeSpan.FromSeconds(15);

    public static IReadOnlyList<string> Validate(GameContent content, GameRun run, RunSummary s, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(run);
        ArgumentNullException.ThrowIfNull(s);

        var total = content.TotalFloors;
        new ValidationBuilder()
            .Require(s.HeroClass == run.HeroClass, nameof(s.HeroClass), "Classe diferente da partida iniciada.")
            .Require(s.Seed == run.Seed, nameof(s.Seed), "Semente diferente da fornecida pelo servidor.")
            .InRange(s.FloorsCleared, 0, total, nameof(s.FloorsCleared))
            .InRange(s.Kills, 0, 100_000, nameof(s.Kills))
            .InRange(s.BossesKilled, 0, content.Acts.Count, nameof(s.BossesKilled))
            .InRange(s.GoldEarned, 0, 10_000_000, nameof(s.GoldEarned))
            .InRange(s.Level, 1, content.Rules.MaxLevel, nameof(s.Level))
            .InRange(s.TimeMs, 0, (long)TimeSpan.FromDays(7).TotalMilliseconds, nameof(s.TimeMs))
            .InRange(s.Act, 1, content.Acts.Count, nameof(s.Act))
            .ThrowIfInvalid();

        var ac = content.Rules.AntiCheat;
        var flags = new List<string>();
        var floorsSeen = s.FloorsCleared + 1;

        var realElapsed = now - run.StartedAt;
        if (TimeSpan.FromMilliseconds(s.TimeMs) > realElapsed + ClockTolerance)
            flags.Add($"Tempo de jogo ({s.TimeMs / 1000}s) maior que o tempo real desde o início ({(int)realElapsed.TotalSeconds}s).");

        if (s.TimeMs / 1000.0 < s.FloorsCleared * ac.MinSecondsPerFloor)
            flags.Add($"Andares concluídos rápido demais ({s.FloorsCleared} em {s.TimeMs / 1000}s).");

        if (s.Kills > floorsSeen * ac.MaxKillsPerFloor)
            flags.Add($"Abates acima do possível ({s.Kills} em {floorsSeen} andares).");

        var goldCap = floorsSeen * ac.MaxGoldPerFloor * (run.Modifier?.GoldMult ?? 1) * 2;
        if (s.GoldEarned > goldCap)
            flags.Add($"Ouro acima do possível ({s.GoldEarned} > {goldCap:0}).");

        // cada fase tem (floors + 1) andares; chefes só podem ser mortos ao alcançar a arena
        var bossFloorsReached = 0;
        var acc = 0;
        foreach (var act in content.Acts)
        {
            acc += act.Floors + 1;
            if (s.FloorsCleared >= acc - 1) bossFloorsReached++;
        }
        if (s.BossesKilled > bossFloorsReached)
            flags.Add("Mais chefes derrotados do que arenas alcançadas.");

        if (s.Victory && (s.FloorsCleared != total || s.BossesKilled != content.Acts.Count))
            flags.Add("Vitória declarada sem concluir a campanha.");

        var maxLevelPlausible = Math.Min(content.Rules.MaxLevel, 3 + (floorsSeen * 3));
        if (s.Level > maxLevelPlausible)
            flags.Add($"Nível {s.Level} improvável para {floorsSeen} andares.");

        return flags;
    }
}
