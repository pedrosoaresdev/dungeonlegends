using DungeonLegends.Application.Abstractions;
using DungeonLegends.Application.Contracts;
using DungeonLegends.Domain.Entities;

namespace DungeonLegends.Application.Services;

public sealed class LeaderboardService(IRunRepository runs, IPlayerRepository players, IClock clock)
{
    public const int MaxTop = 100;

    public async Task<LeaderboardResponse> GetAsync(LeaderboardQuery query, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        var top = Math.Clamp(query.Top, 1, MaxTop);
        var valid = await RankedRunsAsync(ct);
        IEnumerable<GameRun> filtered = valid;

        if (!string.IsNullOrWhiteSpace(query.HeroClass))
            filtered = filtered.Where(r => r.HeroClass == query.HeroClass);
        if (query.DailyOnly)
        {
            var today = DateOnly.FromDateTime(clock.UtcNow.UtcDateTime).ToString("yyyy-MM-dd");
            filtered = filtered.Where(r => r.Daily && r.DailyDate == today);
        }
        if (query.UniquePlayers)
            filtered = filtered.GroupBy(r => r.PlayerId).Select(g => Order(g).First());

        var list = Order(filtered).Take(top).ToList();
        var entries = list.Select((r, i) => new LeaderboardEntry(
            i + 1,
            r.PlayerName,
            r.HeroClass,
            r.Score,
            r.Summary!.FloorsCleared,
            r.Summary.Level,
            r.Summary.Victory,
            r.Summary.TimeMs,
            r.FinishedAt ?? r.StartedAt)).ToList();
        return new LeaderboardResponse(entries, valid.Count);
    }

    /// <summary>Posição de uma partida entre todas as partidas válidas (1 = melhor).</summary>
    public async Task<int> RankOfAsync(GameRun run, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(run);
        var valid = await RankedRunsAsync(ct);
        return 1 + valid.Count(r => r.Id != run.Id && Beats(r, run));
    }

    public async Task<GlobalStatsResponse> GlobalStatsAsync(CancellationToken ct = default)
    {
        var finished = await RankedRunsAsync(ct);
        var byClass = finished.GroupBy(r => r.HeroClass).ToList();
        return new GlobalStatsResponse(
            Players: await players.CountAsync(ct),
            RunsFinished: finished.Count,
            Victories: finished.Count(r => r.Summary!.Victory),
            TotalKills: finished.Sum(r => (long)r.Summary!.Kills),
            TotalGold: finished.Sum(r => (long)r.Summary!.GoldEarned),
            MostPlayedClass: byClass.OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault(),
            WinRateByClass: byClass.ToDictionary(g => g.Key, g => Math.Round(g.Count(r => r.Summary!.Victory) / (double)g.Count(), 3)));
    }

    private async Task<List<GameRun>> RankedRunsAsync(CancellationToken ct) =>
        (await runs.ListFinishedAsync(ct)).Where(r => !r.Flagged && r.Summary is not null).ToList();

    private static IOrderedEnumerable<GameRun> Order(IEnumerable<GameRun> runs) =>
        runs.OrderByDescending(r => r.Score).ThenBy(r => r.Summary!.TimeMs).ThenBy(r => r.FinishedAt);

    private static bool Beats(GameRun a, GameRun b) =>
        a.Score > b.Score || (a.Score == b.Score && a.Summary!.TimeMs < b.Summary!.TimeMs);
}
