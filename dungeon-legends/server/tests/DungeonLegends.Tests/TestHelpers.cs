using DungeonLegends.Application.Abstractions;
using DungeonLegends.Domain.Content;
using DungeonLegends.Domain.Entities;
using DungeonLegends.Infrastructure.Content;
using DungeonLegends.Infrastructure.Persistence;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace DungeonLegends.Tests;

/// <summary>Relógio controlável para testes.</summary>
public sealed class FakeClock(DateTimeOffset start) : IClock
{
    public DateTimeOffset UtcNow { get; private set; } = start;

    public void Advance(TimeSpan by) => UtcNow += by;
}

public sealed class StaticContent : IContentProvider
{
    public GameContent Content { get; } = EmbeddedContentProvider.Load();
}

/// <summary>Pasta temporária apagada ao final do teste.</summary>
public sealed class TempDir : IDisposable
{
    public TempDir() => Directory.CreateDirectory(Path);

    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "dl-tests-" + Guid.NewGuid().ToString("N"));

    public DataContext CreateContext() =>
        new(Options.Create(new StorageOptions { DataDirectory = Path }), NullLogger<DataContext>.Instance);

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (IOException)
        {
            // arquivos podem estar em uso em alguns sistemas; não falha o teste
        }
    }
}

public static class Samples
{
    public static readonly GameContent Content = EmbeddedContentProvider.Load();

    public static GameRun Run(DateTimeOffset startedAt, string heroClass = "knight", uint seed = 42, DailyModifier? modifier = null) => new()
    {
        Id = Guid.NewGuid(),
        PlayerId = Guid.NewGuid(),
        PlayerName = "Teste",
        HeroClass = heroClass,
        Seed = seed,
        StartedAt = startedAt,
        Modifier = modifier,
    };

    public static RunSummary Summary(
        int floors = 3, int kills = 40, int bosses = 0, int gold = 200, int level = 5,
        long timeMs = 400_000, bool victory = false, uint seed = 42, string heroClass = "knight", int act = 1, int floor = 4) =>
        new(heroClass, floors, kills, bosses, gold, level, timeMs, victory, act, floor, seed);

    public static SaveGame ValidSave(Guid? runId = null, uint seed = 42) => new()
    {
        Version = 1,
        HeroClass = "knight",
        Run = new SaveRun { RunId = runId, Seed = seed, Act = 1, Floor = 2, FloorsCleared = 1, Kills = 10, TimeMs = 60_000 },
        Hero = new SaveHero
        {
            Level = 3,
            Xp = 10,
            Gold = 80,
            Hp = 100,
            Perks = new() { ["might"] = 1, ["swift"] = 1 },
            Potions = new HeroPotions { Hp = 2, Mp = 1 },
            Weapon = new WeaponRef { Id = "weapon_knight_sword" },
        },
    };
}
