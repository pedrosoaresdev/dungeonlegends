using DungeonLegends.Api.Infrastructure;
using DungeonLegends.Application.Contracts;
using DungeonLegends.Application.Services;
using DungeonLegends.Domain.Common;
using DungeonLegends.Domain.Entities;
using DungeonLegends.Infrastructure.Persistence;
using DungeonLegends.Infrastructure.Security;

namespace DungeonLegends.Tests;

/// <summary>Testes de ponta a ponta dos casos de uso, usando a persistência real em pasta temporária.</summary>
public sealed class ServiceTests : IDisposable
{
    private readonly TempDir _dir = new();
    private readonly DataContext _db;
    private readonly FakeClock _clock = new(new DateTimeOffset(2026, 10, 14, 12, 0, 0, TimeSpan.Zero));
    private readonly PlayerService _players;
    private readonly RunService _runs;
    private readonly SaveService _saves;
    private readonly LeaderboardService _board;

    public ServiceTests()
    {
        _db = _dir.CreateContext();
        var playerRepo = new JsonPlayerRepository(_db);
        var runRepo = new JsonRunRepository(_db);
        var saveRepo = new JsonSaveRepository(_db);
        var content = new StaticContent();
        _players = new PlayerService(playerRepo, runRepo, new TokenService(), _clock);
        _board = new LeaderboardService(runRepo, playerRepo, _clock);
        _runs = new RunService(runRepo, playerRepo, content, _clock, _board);
        _saves = new SaveService(saveRepo, runRepo, content, _clock);
    }

    public void Dispose()
    {
        _db.Dispose();
        _dir.Dispose();
    }

    private async Task<(PlayerAccount player, string token)> NewPlayer(string name = "Heroina")
    {
        var reg = await _players.RegisterAsync(new RegisterPlayerRequest(name));
        return (await _players.AuthenticateAsync(reg.Id, reg.Token), reg.Token);
    }

    [Fact]
    public async Task Register_then_authenticate_with_token()
    {
        var reg = await _players.RegisterAsync(new RegisterPlayerRequest("  Arthur   Pendragon "));
        Assert.Equal("Arthur Pendragon", reg.Name);
        var player = await _players.AuthenticateAsync(reg.Id, reg.Token);
        Assert.Equal(reg.Id, player.Id);
        await Assert.ThrowsAsync<UnauthorizedException>(() => _players.AuthenticateAsync(reg.Id, "token-falso"));
    }

    [Fact]
    public async Task Token_is_not_stored_in_plain_text()
    {
        var reg = await _players.RegisterAsync(new RegisterPlayerRequest("Segredo"));
        var raw = await File.ReadAllTextAsync(_db.Players.FilePath);
        Assert.DoesNotContain(reg.Token, raw, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("ab")]
    [InlineData("nome_comprido_demais_123")]
    [InlineData("<script>")]
    [InlineData("SuperAdmin")]
    public async Task Invalid_names_are_rejected(string name) =>
        await Assert.ThrowsAsync<ValidationException>(() => _players.RegisterAsync(new RegisterPlayerRequest(name)));

    [Fact]
    public async Task Duplicate_names_conflict_case_insensitive()
    {
        await _players.RegisterAsync(new RegisterPlayerRequest("Merlin"));
        await Assert.ThrowsAsync<ConflictException>(() => _players.RegisterAsync(new RegisterPlayerRequest("MERLIN")));
    }

    [Fact]
    public async Task Full_run_lifecycle_updates_leaderboard_and_stats()
    {
        var (p, _) = await NewPlayer();
        var start = await _runs.StartAsync(p, new StartRunRequest(p.Id, "elf"));
        _clock.Advance(TimeSpan.FromMinutes(20));
        var result = await _runs.FinishAsync(p, start.RunId, Samples.Summary(heroClass: "elf", seed: start.Seed, timeMs: 600_000));

        Assert.False(result.Flagged);
        Assert.Equal(1, result.Rank);
        Assert.True(result.PersonalBest);

        var board = await _board.GetAsync(new LeaderboardQuery());
        var entry = Assert.Single(board.Entries);
        Assert.Equal("Heroina", entry.Name);
        Assert.Equal(result.Score, entry.Score);

        var profile = await _players.GetProfileAsync(p.Id);
        Assert.Equal(1, profile.Stats.RunsFinished);
        Assert.Equal(1, profile.Stats.RunsByClass["elf"]);
    }

    [Fact]
    public async Task Flagged_runs_do_not_enter_leaderboard()
    {
        var (p, _) = await NewPlayer();
        var start = await _runs.StartAsync(p, new StartRunRequest(p.Id, "knight"));
        _clock.Advance(TimeSpan.FromSeconds(30));
        var result = await _runs.FinishAsync(p, start.RunId, Samples.Summary(seed: start.Seed, timeMs: 3_000_000));
        Assert.True(result.Flagged);
        Assert.Null(result.Rank);
        Assert.Empty((await _board.GetAsync(new LeaderboardQuery())).Entries);
    }

    [Fact]
    public async Task Run_cannot_be_finished_twice_or_by_another_player()
    {
        var (a, _) = await NewPlayer("Alice");
        var (b, _) = await NewPlayer("Bruno");
        var start = await _runs.StartAsync(a, new StartRunRequest(a.Id, "wizard"));
        _clock.Advance(TimeSpan.FromMinutes(10));
        var s = Samples.Summary(heroClass: "wizard", seed: start.Seed);

        await Assert.ThrowsAsync<UnauthorizedException>(() => _runs.FinishAsync(b, start.RunId, s));
        await _runs.FinishAsync(a, start.RunId, s);
        await Assert.ThrowsAsync<ConflictException>(() => _runs.FinishAsync(a, start.RunId, s));
    }

    [Fact]
    public async Task Leaderboard_keeps_best_run_per_player_and_orders_by_score()
    {
        var (a, _) = await NewPlayer("Alice");
        var (b, _) = await NewPlayer("Bruno");
        async Task Play(PlayerAccount p, int floors)
        {
            var st = await _runs.StartAsync(p, new StartRunRequest(p.Id, "lizard"));
            _clock.Advance(TimeSpan.FromMinutes(30));
            await _runs.FinishAsync(p, st.RunId, Samples.Summary(heroClass: "lizard", seed: st.Seed, floors: floors, kills: floors * 10, level: 3 + floors, timeMs: floors * 60_000L));
        }
        await Play(a, 2);
        await Play(a, 6);
        await Play(b, 4);

        var board = await _board.GetAsync(new LeaderboardQuery(Top: 10));
        Assert.Equal(["Alice", "Bruno"], board.Entries.Select(e => e.Name));
        Assert.Equal(6, board.Entries[0].FloorsCleared);
        Assert.Equal(3, board.TotalRuns);

        var all = await _board.GetAsync(new LeaderboardQuery(UniquePlayers: false));
        Assert.Equal(3, all.Entries.Count);
    }

    [Fact]
    public async Task Daily_run_uses_server_seed_and_modifier()
    {
        var (p, _) = await NewPlayer();
        var a = await _runs.StartAsync(p, new StartRunRequest(p.Id, "knight", Daily: true));
        var b = await _runs.StartAsync(p, new StartRunRequest(p.Id, "elf", Daily: true));
        Assert.Equal(a.Seed, b.Seed);
        Assert.NotNull(a.Modifier);
        Assert.Equal("2026-10-14", a.DailyDate);
    }

    [Fact]
    public async Task Unknown_class_is_rejected()
    {
        var (p, _) = await NewPlayer();
        await Assert.ThrowsAsync<ValidationException>(() => _runs.StartAsync(p, new StartRunRequest(p.Id, "ninja")));
    }

    [Fact]
    public async Task Saves_round_trip_and_cannot_regress()
    {
        var (p, _) = await NewPlayer();
        var start = await _runs.StartAsync(p, new StartRunRequest(p.Id, "knight"));
        var save = Samples.ValidSave(start.RunId, start.Seed);
        save.Run.Act = 1;
        save.Run.Floor = 3;
        save.Run.FloorsCleared = 2;
        await _saves.PutAsync(p, save);

        var loaded = await _saves.GetAsync(p);
        Assert.Equal(3, loaded.Run.Floor);
        Assert.Equal("weapon_knight_sword", loaded.Hero.Weapon.Id);

        var older = Samples.ValidSave(start.RunId, start.Seed); // andar 2
        await Assert.ThrowsAsync<ConflictException>(() => _saves.PutAsync(p, older));

        Assert.True(await _saves.DeleteAsync(p));
        await Assert.ThrowsAsync<NotFoundException>(() => _saves.GetAsync(p));
    }

    [Fact]
    public async Task Save_with_seed_of_another_run_is_rejected()
    {
        var (p, _) = await NewPlayer();
        var start = await _runs.StartAsync(p, new StartRunRequest(p.Id, "knight"));
        await Assert.ThrowsAsync<ValidationException>(() => _saves.PutAsync(p, Samples.ValidSave(start.RunId, start.Seed + 1)));
    }

    [Fact]
    public async Task Global_stats_aggregate_valid_runs()
    {
        var (p, _) = await NewPlayer();
        var st = await _runs.StartAsync(p, new StartRunRequest(p.Id, "wizard"));
        _clock.Advance(TimeSpan.FromMinutes(15));
        await _runs.FinishAsync(p, st.RunId, Samples.Summary(heroClass: "wizard", seed: st.Seed, kills: 33));
        var stats = await _board.GlobalStatsAsync();
        Assert.Equal(1, stats.Players);
        Assert.Equal(33, stats.TotalKills);
        Assert.Equal("wizard", stats.MostPlayedClass);
    }
}

public class JsonFileStoreTests
{
    [Fact]
    public async Task Data_survives_reopening_the_store()
    {
        using var dir = new TempDir();
        var id = Guid.NewGuid();
        using (var db = dir.CreateContext())
            await db.Players.SetAsync(id.ToString(), new PlayerAccount { Id = id, Name = "Persistente", TokenHash = "x", CreatedAt = DateTimeOffset.UtcNow });

        using var db2 = dir.CreateContext();
        var loaded = await db2.Players.GetAsync(id.ToString());
        Assert.Equal("Persistente", loaded?.Name);
    }

    [Fact]
    public async Task Concurrent_writes_do_not_lose_data()
    {
        using var dir = new TempDir();
        using var db = dir.CreateContext();
        var tasks = Enumerable.Range(0, 50).Select(i =>
        {
            var id = Guid.NewGuid();
            return db.Players.SetAsync(id.ToString(), new PlayerAccount { Id = id, Name = "P" + i, TokenHash = "x", CreatedAt = DateTimeOffset.UtcNow });
        });
        await Task.WhenAll(tasks);
        Assert.Equal(50, await db.Players.CountAsync());
    }

    [Fact]
    public async Task Returned_objects_are_copies()
    {
        using var dir = new TempDir();
        using var db = dir.CreateContext();
        var id = Guid.NewGuid();
        await db.Players.SetAsync(id.ToString(), new PlayerAccount { Id = id, Name = "Original", TokenHash = "x", CreatedAt = DateTimeOffset.UtcNow });
        var copy = await db.Players.GetAsync(id.ToString());
        copy!.Name = "Alterado sem salvar";
        Assert.Equal("Original", (await db.Players.GetAsync(id.ToString()))!.Name);
    }

    [Fact]
    public async Task Corrupted_file_falls_back_to_backup()
    {
        using var dir = new TempDir();
        var id = Guid.NewGuid();
        using (var db = dir.CreateContext())
        {
            await db.Players.SetAsync(id.ToString(), new PlayerAccount { Id = id, Name = "Salvo", TokenHash = "x", CreatedAt = DateTimeOffset.UtcNow });
            await db.Players.SetAsync(Guid.NewGuid().ToString(), new PlayerAccount { Id = Guid.NewGuid(), Name = "Outro", TokenHash = "x", CreatedAt = DateTimeOffset.UtcNow });
            await File.WriteAllTextAsync(db.Players.FilePath, "{ isso não é json");
        }
        using var db2 = dir.CreateContext();
        Assert.Equal("Salvo", (await db2.Players.GetAsync(id.ToString()))?.Name);
    }
}

public class SecurityTests
{
    [Fact]
    public void Tokens_are_unique_and_verifiable()
    {
        var svc = new TokenService();
        var t1 = svc.NewToken();
        var t2 = svc.NewToken();
        Assert.NotEqual(t1, t2);
        Assert.True(t1.Length >= 40);
        Assert.True(svc.Verify(t1, svc.Hash(t1)));
        Assert.False(svc.Verify(t2, svc.Hash(t1)));
        Assert.False(svc.Verify("", svc.Hash(t1)));
    }

    [Theory]
    [InlineData("http://127.0.0.1:5500", true)]
    [InlineData("http://localhost:3000", true)]
    [InlineData("https://evil.example.com", false)]
    [InlineData("https://meujogo.github.io", true)]
    public void Cors_allows_localhost_and_configured_origins(string origin, bool allowed)
    {
        var cors = new CorsSettings { AllowedOrigins = ["https://meujogo.github.io"] };
        Assert.Equal(allowed, cors.IsAllowed(origin));
    }
}
