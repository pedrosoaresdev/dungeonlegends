using DungeonLegends.Domain.Common;
using DungeonLegends.Domain.Rules;
using DungeonLegends.Infrastructure.Content;

namespace DungeonLegends.Tests;

/// <summary>
/// Os valores de referência foram gerados executando o código JavaScript do cliente
/// (client/js/core/math.js e client/js/systems/rules.js), garantindo paridade exata.
/// </summary>
public class ParityWithClientTests
{
    [Fact]
    public void SeededRandom_matches_javascript_mulberry32()
    {
        var rng = new SeededRandom(12345);
        Assert.Equal(0.979728267761, rng.NextDouble(), 12);
        Assert.Equal(0.306752264500, rng.NextDouble(), 12);
        Assert.Equal(0.484205421526, rng.NextDouble(), 12);
    }

    [Theory]
    [InlineData("daily-2026-10-14", 1758957059u)]
    [InlineData("Dungeon Legends", 1863176607u)]
    public void Fnv1a_matches_javascript_hashString(string text, uint expected) =>
        Assert.Equal(expected, StringHash.Fnv1a(text));

    [Theory]
    [InlineData(1, 30)]
    [InlineData(2, 38)]
    [InlineData(5, 81)]
    [InlineData(10, 277)]
    public void XpCurve_matches_client(int level, int expected) =>
        Assert.Equal(expected, ProgressionRules.XpForLevel(Samples.Content.Rules, level));

    [Fact]
    public void Score_for_victory_matches_client()
    {
        var s = Samples.Summary(floors: 15, kills: 420, bosses: 5, gold: 3210, level: 24, timeMs: 1_500_000, victory: true);
        Assert.Equal(51723, ScoreCalculator.Compute(Samples.Content.Rules.Score, s));
    }

    [Fact]
    public void Score_for_defeat_matches_client()
    {
        var s = Samples.Summary(floors: 4, kills: 88, bosses: 1, gold: 400, level: 9, timeMs: 600_000);
        Assert.Equal(7300, ScoreCalculator.Compute(Samples.Content.Rules.Score, s));
    }
}

public class ScoreCalculatorTests
{
    [Fact]
    public void Faster_victory_scores_more()
    {
        var rules = Samples.Content.Rules.Score;
        var fast = ScoreCalculator.Compute(rules, Samples.Summary(floors: 15, bosses: 5, victory: true, timeMs: 900_000));
        var slow = ScoreCalculator.Compute(rules, Samples.Summary(floors: 15, bosses: 5, victory: true, timeMs: 4_000_000));
        Assert.True(fast > slow);
    }

    [Fact]
    public void Time_bonus_never_negative()
    {
        var rules = Samples.Content.Rules.Score;
        // acima de 2x o tempo "par" o bônus zera — e nunca fica negativo
        var verySlow = ScoreCalculator.Compute(rules, Samples.Summary(floors: 15, bosses: 5, victory: true, timeMs: 99_000_000));
        var evenSlower = ScoreCalculator.Compute(rules, Samples.Summary(floors: 15, bosses: 5, victory: true, timeMs: 500_000_000));
        Assert.Equal(verySlow, evenSlower);
        Assert.True(verySlow > rules.VictoryBonus);
    }

    [Theory]
    [InlineData(0.5, 1)]
    [InlineData(1.5, 2)]
    [InlineData(2.5, 3)]
    [InlineData(2.4999, 2)]
    public void JsRound_rounds_half_up_like_javascript(double v, long expected) =>
        Assert.Equal(expected, ScoreCalculator.JsRound(v));
}

public class DailyChallengeTests
{
    [Fact]
    public void Same_date_gives_same_challenge()
    {
        var a = DailyChallengeGenerator.For(new DateOnly(2026, 10, 14));
        var b = DailyChallengeGenerator.For(new DateOnly(2026, 10, 14));
        Assert.Equal(a, b);
        Assert.Equal("2026-10-14", a.Date);
        Assert.Equal(1758957059u, a.Seed);
    }

    [Fact]
    public void Different_dates_give_different_seeds()
    {
        var seeds = Enumerable.Range(0, 60)
            .Select(i => DailyChallengeGenerator.For(new DateOnly(2026, 1, 1).AddDays(i)).Seed)
            .ToHashSet();
        Assert.Equal(60, seeds.Count);
    }

    [Fact]
    public void All_modifiers_are_used_over_time()
    {
        var used = Enumerable.Range(0, 365)
            .Select(i => DailyChallengeGenerator.For(new DateOnly(2026, 1, 1).AddDays(i)).Modifier.Id)
            .ToHashSet();
        Assert.Equal(DailyChallengeGenerator.Modifiers.Count, used.Count);
    }
}

public class RunValidatorTests
{
    private static readonly DateTimeOffset T0 = new(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Legit_run_has_no_flags()
    {
        var run = Samples.Run(T0);
        var flags = RunValidator.Validate(Samples.Content, run, Samples.Summary(), T0.AddMinutes(10));
        Assert.Empty(flags);
    }

    [Fact]
    public void Game_time_longer_than_real_time_is_flagged()
    {
        var run = Samples.Run(T0);
        var flags = RunValidator.Validate(Samples.Content, run, Samples.Summary(timeMs: 3_600_000), T0.AddMinutes(5));
        Assert.Contains(flags, f => f.Contains("Tempo de jogo", StringComparison.Ordinal));
    }

    [Fact]
    public void Speedhack_is_flagged()
    {
        var run = Samples.Run(T0);
        var flags = RunValidator.Validate(Samples.Content, run, Samples.Summary(floors: 10, timeMs: 20_000, kills: 10, level: 3), T0.AddMinutes(30));
        Assert.Contains(flags, f => f.Contains("rápido demais", StringComparison.Ordinal));
    }

    [Fact]
    public void Fake_victory_is_flagged()
    {
        var run = Samples.Run(T0);
        var flags = RunValidator.Validate(Samples.Content, run, Samples.Summary(floors: 3, victory: true), T0.AddHours(1));
        Assert.Contains(flags, f => f.Contains("Vitória", StringComparison.Ordinal));
    }

    [Fact]
    public void Boss_kills_without_reaching_arena_are_flagged()
    {
        var run = Samples.Run(T0);
        var flags = RunValidator.Validate(Samples.Content, run, Samples.Summary(floors: 1, bosses: 1), T0.AddHours(1));
        Assert.Contains(flags, f => f.Contains("chefes", StringComparison.Ordinal));
    }

    [Fact]
    public void Real_victory_is_accepted()
    {
        var total = Samples.Content.TotalFloors;
        var run = Samples.Run(T0);
        var s = Samples.Summary(floors: total, kills: 500, bosses: Samples.Content.Acts.Count, gold: 4000, level: 22, timeMs: 2_400_000, victory: true, act: 5);
        Assert.Empty(RunValidator.Validate(Samples.Content, run, s, T0.AddHours(1)));
    }

    [Fact]
    public void Wrong_seed_throws_validation_error()
    {
        var run = Samples.Run(T0, seed: 1);
        var ex = Assert.Throws<ValidationException>(() => RunValidator.Validate(Samples.Content, run, Samples.Summary(seed: 2), T0.AddHours(1)));
        Assert.True(ex.Errors.ContainsKey("Seed"));
    }

    [Fact]
    public void Wrong_class_throws_validation_error()
    {
        var run = Samples.Run(T0, heroClass: "elf");
        Assert.Throws<ValidationException>(() => RunValidator.Validate(Samples.Content, run, Samples.Summary(heroClass: "knight"), T0.AddHours(1)));
    }
}

public class SaveValidatorTests
{
    [Fact]
    public void Valid_save_passes() => SaveValidator.Validate(Samples.Content, Samples.ValidSave());

    [Fact]
    public void Too_many_perks_for_level_fails()
    {
        var save = Samples.ValidSave();
        save.Hero.Perks["might"] = 5;
        var ex = Assert.Throws<ValidationException>(() => SaveValidator.Validate(Samples.Content, save));
        Assert.True(ex.Errors.ContainsKey("hero.perks"));
    }

    [Fact]
    public void Unknown_weapon_fails()
    {
        var save = Samples.ValidSave();
        save.Hero.Weapon.Id = "weapon_excalibur_hack";
        Assert.Throws<ValidationException>(() => SaveValidator.Validate(Samples.Content, save));
    }

    [Fact]
    public void Attack_bonus_requires_shop_purchases()
    {
        var save = Samples.ValidSave();
        save.Hero.Bonus.Atk = 9;
        Assert.Throws<ValidationException>(() => SaveValidator.Validate(Samples.Content, save));
        save.Run.ShopBought["elixir_atk"] = 3;
        SaveValidator.Validate(Samples.Content, save);
    }

    [Fact]
    public void Floors_cleared_must_match_position()
    {
        var save = Samples.ValidSave();
        save.Run.FloorsCleared = 7;
        var ex = Assert.Throws<ValidationException>(() => SaveValidator.Validate(Samples.Content, save));
        Assert.True(ex.Errors.ContainsKey("run.floorsCleared"));
    }

    [Fact]
    public void Xp_above_level_threshold_fails()
    {
        var save = Samples.ValidSave();
        save.Hero.Xp = 10_000;
        Assert.Throws<ValidationException>(() => SaveValidator.Validate(Samples.Content, save));
    }

    [Fact]
    public void Dead_hero_cannot_be_saved()
    {
        var save = Samples.ValidSave();
        save.Hero.Hp = 0;
        Assert.Throws<ValidationException>(() => SaveValidator.Validate(Samples.Content, save));
    }
}

public class ContentTests
{
    [Fact]
    public void Embedded_content_loads_and_is_consistent()
    {
        var c = EmbeddedContentProvider.Load();
        Assert.Equal(4, c.Classes.Count);
        Assert.Equal(5, c.Acts.Count);
        Assert.Equal(c.Acts.Sum(a => a.Floors + 1), c.TotalFloors);
        Assert.All(c.Acts, a => Assert.Contains(c.Bosses, b => b.Id == a.Boss));
    }

    [Fact]
    public void Absolute_floor_counts_boss_arenas()
    {
        var c = Samples.Content;
        Assert.Equal(1, c.AbsoluteFloor(1, 1));
        Assert.Equal(c.Acts[0].Floors + 2, c.AbsoluteFloor(2, 1));
    }

    [Fact]
    public void Broken_content_is_rejected()
    {
        var c = Samples.Content with { Acts = [Samples.Content.Acts[0] with { Boss = "nao_existe" }] };
        var ex = Assert.Throws<InvalidOperationException>(() => EmbeddedContentProvider.Validate(c));
        Assert.Contains("nao_existe", ex.Message, StringComparison.Ordinal);
    }
}
