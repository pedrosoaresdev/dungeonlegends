using System.Security.Cryptography;
using DungeonLegends.Application.Abstractions;
using DungeonLegends.Application.Contracts;
using DungeonLegends.Domain.Common;
using DungeonLegends.Domain.Entities;
using DungeonLegends.Domain.Rules;

namespace DungeonLegends.Application.Services;

public sealed class RunService(
    IRunRepository runs,
    IPlayerRepository players,
    IContentProvider contentProvider,
    IClock clock,
    LeaderboardService leaderboard)
{
    /// <summary>Tempo máximo para uma partida ativa ser finalizada.</summary>
    public static readonly TimeSpan MaxRunDuration = TimeSpan.FromDays(7);

    public async Task<StartRunResponse> StartAsync(PlayerAccount player, StartRunRequest request, CancellationToken ct = default)
    {
        var content = contentProvider.Content;
        var heroClass = request.HeroClass ?? "";
        if (content.FindClass(heroClass) is null)
            throw new ValidationException("heroClass", $"Classe '{heroClass}' não existe. Opções: {string.Join(", ", content.Classes.Select(c => c.Id))}.");

        uint seed;
        DailyModifier? modifier = null;
        string? dailyDate = null;
        if (request.Daily)
        {
            var daily = DailyChallengeGenerator.For(DateOnly.FromDateTime(clock.UtcNow.UtcDateTime));
            seed = daily.Seed;
            modifier = daily.Modifier;
            dailyDate = daily.Date;
        }
        else
        {
            seed = BitConverter.ToUInt32(RandomNumberGenerator.GetBytes(4));
        }

        var run = new GameRun
        {
            Id = Guid.NewGuid(),
            PlayerId = player.Id,
            PlayerName = player.Name,
            HeroClass = heroClass,
            Seed = seed,
            StartedAt = clock.UtcNow,
            Daily = request.Daily,
            DailyDate = dailyDate,
            Modifier = modifier,
        };
        await runs.AddAsync(run, ct);

        player.Stats.RunsStarted++;
        player.Stats.RunsByClass[heroClass] = player.Stats.RunsByClass.GetValueOrDefault(heroClass) + 1;
        await players.UpdateAsync(player, ct);

        return new StartRunResponse(run.Id, run.Seed, run.Modifier, run.DailyDate);
    }

    /// <summary>Busca a partida garantindo que pertence ao jogador autenticado.</summary>
    public async Task<GameRun> GetOwnedAsync(Guid runId, Guid playerId, CancellationToken ct = default)
    {
        var run = await runs.GetAsync(runId, ct) ?? throw new NotFoundException("Partida", runId);
        if (run.PlayerId != playerId) throw new UnauthorizedException("Esta partida pertence a outro jogador.");
        return run;
    }

    public async Task<FinishRunResponse> FinishAsync(PlayerAccount player, Guid runId, RunSummary summary, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(summary);
        var content = contentProvider.Content;
        var run = await GetOwnedAsync(runId, player.Id, ct);
        if (run.Status != RunStatus.Active) throw new ConflictException("Esta partida já foi finalizada.");
        var now = clock.UtcNow;
        if (now - run.StartedAt > MaxRunDuration) throw new ConflictException("Partida expirada.");

        var flags = RunValidator.Validate(content, run, summary, now);
        var score = ScoreCalculator.Compute(content.Rules.Score, summary);
        var previousBest = player.Stats.BestScore;
        run.Finish(summary, score, flags, now);
        await runs.UpdateAsync(run, ct);

        if (!run.Flagged)
        {
            player.Stats.RegisterFinishedRun(summary, score);
            await players.UpdateAsync(player, ct);
        }

        int? rank = run.Flagged ? null : await leaderboard.RankOfAsync(run, ct);
        return new FinishRunResponse(run.Id, score, rank, run.Flagged, flags, !run.Flagged && score > previousBest);
    }

    public async Task<RunDetailsResponse> GetDetailsAsync(Guid runId, CancellationToken ct = default)
    {
        var run = await runs.GetAsync(runId, ct) ?? throw new NotFoundException("Partida", runId);
        return new RunDetailsResponse(run.Id, run.PlayerName, run.HeroClass, run.Status.ToString(), run.StartedAt, run.FinishedAt, run.Summary, run.Score, run.Flagged, run.Daily);
    }
}
