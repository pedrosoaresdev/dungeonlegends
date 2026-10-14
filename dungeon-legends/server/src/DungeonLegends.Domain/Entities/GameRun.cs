using System.Text.Json.Serialization;

namespace DungeonLegends.Domain.Entities;

public enum RunStatus
{
    Active,
    Finished,
    Abandoned,
}

/// <summary>
/// Uma partida. A semente é gerada pelo servidor, então as masmorras do jogador
/// são reproduzíveis; o resumo final é validado contra regras de plausibilidade.
/// </summary>
public sealed class GameRun
{
    public required Guid Id { get; init; }
    public required Guid PlayerId { get; init; }
    public required string PlayerName { get; init; }
    public required string HeroClass { get; init; }
    public required uint Seed { get; init; }
    public required DateTimeOffset StartedAt { get; init; }
    public bool Daily { get; init; }
    public string? DailyDate { get; init; }
    public DailyModifier? Modifier { get; init; }
    [JsonInclude]
    public RunStatus Status { get; private set; } = RunStatus.Active;
    [JsonInclude]
    public DateTimeOffset? FinishedAt { get; private set; }
    [JsonInclude]
    public RunSummary? Summary { get; private set; }
    [JsonInclude]
    public long Score { get; private set; }
    [JsonInclude]
    public bool Flagged { get; private set; }
    public List<string> Flags { get; init; } = [];

    public void Finish(RunSummary summary, long score, IReadOnlyList<string> flags, DateTimeOffset at)
    {
        if (Status != RunStatus.Active) throw new Common.ConflictException("Esta partida já foi finalizada.");
        Summary = summary;
        Score = score;
        Flags.AddRange(flags);
        Flagged = flags.Count > 0;
        Status = RunStatus.Finished;
        FinishedAt = at;
    }

    public void Abandon(DateTimeOffset at)
    {
        if (Status != RunStatus.Active) return;
        Status = RunStatus.Abandoned;
        FinishedAt = at;
    }
}

/// <summary>Resumo enviado pelo cliente ao fim da partida.</summary>
public sealed record RunSummary(
    string HeroClass,
    int FloorsCleared,
    int Kills,
    int BossesKilled,
    int GoldEarned,
    int Level,
    long TimeMs,
    bool Victory,
    int Act,
    int Floor,
    uint Seed);

/// <summary>Modificador do desafio diário (aplicado no cliente, conferido no servidor).</summary>
public sealed record DailyModifier(
    string Id,
    string Name,
    string Description,
    double EnemyHpMult = 1,
    double EnemyAtkMult = 1,
    double GoldMult = 1,
    double XpMult = 1);
