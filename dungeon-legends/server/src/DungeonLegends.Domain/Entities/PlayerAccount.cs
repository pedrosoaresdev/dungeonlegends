namespace DungeonLegends.Domain.Entities;

/// <summary>Conta de jogador. O token nunca é armazenado em texto puro, apenas seu hash.</summary>
public sealed class PlayerAccount
{
    public required Guid Id { get; init; }
    public required string Name { get; set; }
    public required string TokenHash { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset LastSeenAt { get; set; }
    public PlayerStats Stats { get; init; } = new();
}

public sealed class PlayerStats
{
    public int RunsStarted { get; set; }
    public int RunsFinished { get; set; }
    public int Victories { get; set; }
    public long TotalKills { get; set; }
    public long TotalGold { get; set; }
    public long BestScore { get; set; }
    public int DeepestFloor { get; set; }
    public Dictionary<string, int> RunsByClass { get; init; } = new(StringComparer.Ordinal);

    public void RegisterFinishedRun(RunSummary summary, long score)
    {
        RunsFinished++;
        if (summary.Victory) Victories++;
        TotalKills += summary.Kills;
        TotalGold += summary.GoldEarned;
        BestScore = Math.Max(BestScore, score);
        DeepestFloor = Math.Max(DeepestFloor, summary.FloorsCleared);
    }
}
