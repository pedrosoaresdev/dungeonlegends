using DungeonLegends.Domain.Entities;

namespace DungeonLegends.Application.Contracts;

// ---------- Jogadores ----------
public sealed record RegisterPlayerRequest(string? Name);

/// <summary>O token só é devolvido uma vez, no cadastro.</summary>
public sealed record RegisterPlayerResponse(Guid Id, string Name, string Token);

public sealed record PlayerProfileResponse(
    Guid Id,
    string Name,
    DateTimeOffset CreatedAt,
    PlayerStats Stats,
    IReadOnlyList<RunHistoryItem> RecentRuns);

public sealed record RunHistoryItem(Guid RunId, string HeroClass, long Score, int FloorsCleared, bool Victory, bool Flagged, DateTimeOffset? FinishedAt);

// ---------- Partidas ----------
public sealed record StartRunRequest(Guid PlayerId, string? HeroClass, bool Daily = false);

public sealed record StartRunResponse(Guid RunId, uint Seed, DailyModifier? Modifier, string? DailyDate);

public sealed record FinishRunResponse(Guid RunId, long Score, int? Rank, bool Flagged, IReadOnlyList<string> Flags, bool PersonalBest);

public sealed record RunDetailsResponse(
    Guid RunId,
    string PlayerName,
    string HeroClass,
    string Status,
    DateTimeOffset StartedAt,
    DateTimeOffset? FinishedAt,
    RunSummary? Summary,
    long Score,
    bool Flagged,
    bool Daily);

// ---------- Ranking ----------
public sealed record LeaderboardQuery(int Top = 10, string? HeroClass = null, bool DailyOnly = false, bool UniquePlayers = true);

public sealed record LeaderboardEntry(
    int Rank,
    string Name,
    string HeroClass,
    long Score,
    int FloorsCleared,
    int Level,
    bool Victory,
    long TimeMs,
    DateTimeOffset Date);

public sealed record LeaderboardResponse(IReadOnlyList<LeaderboardEntry> Entries, int TotalRuns);

// ---------- Estatísticas globais ----------
public sealed record GlobalStatsResponse(
    int Players,
    int RunsFinished,
    int Victories,
    long TotalKills,
    long TotalGold,
    string? MostPlayedClass,
    IReadOnlyDictionary<string, double> WinRateByClass);
