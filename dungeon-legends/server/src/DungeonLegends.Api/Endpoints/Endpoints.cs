using System.Reflection;
using DungeonLegends.Api.Infrastructure;
using DungeonLegends.Application.Abstractions;
using DungeonLegends.Application.Contracts;
using DungeonLegends.Application.Services;
using DungeonLegends.Domain.Entities;
using DungeonLegends.Domain.Rules;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace DungeonLegends.Api.Endpoints;

public static class EndpointMappings
{
    private static readonly string Version =
        typeof(EndpointMappings).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "1.0.0";

    /// <summary>Índice navegável da API (substitui o Swagger sem dependências NuGet).</summary>
    public static void MapApiIndex(this IEndpointRouteBuilder app) =>
        app.MapGet("/api", (EndpointDataSource sources) => Results.Ok(new
        {
            name = "Dungeon Legends API",
            version = Version,
            endpoints = sources.Endpoints.OfType<RouteEndpoint>()
                .Where(e => e.RoutePattern.RawText?.StartsWith("/api", StringComparison.Ordinal) == true)
                .Select(e => $"{string.Join(",", e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? ["GET"])} {e.RoutePattern.RawText}")
                .Distinct()
                .Order(),
        }));

    public static void MapHealthEndpoints(this IEndpointRouteBuilder app) =>
        app.MapGet("/api/health", async (HealthCheckService health, CancellationToken ct) =>
        {
            var report = await health.CheckHealthAsync(ct);
            var body = new
            {
                status = report.Status.ToString(),
                version = Version,
                time = DateTimeOffset.UtcNow,
                checks = report.Entries.ToDictionary(e => e.Key, e => new { status = e.Value.Status.ToString(), e.Value.Description }),
            };
            return report.Status == HealthStatus.Healthy ? Results.Ok(body) : Results.Json(body, statusCode: 503);
        }).WithTags("Sistema");

    public static void MapContentEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api").WithTags("Conteúdo");
        g.MapGet("/content", (IContentProvider c) => Results.Ok(c.Content));
        g.MapGet("/daily", (IClock clock) => Results.Ok(DailyChallengeGenerator.For(DateOnly.FromDateTime(clock.UtcNow.UtcDateTime))));
        g.MapGet("/stats", (LeaderboardService s, CancellationToken ct) => s.GlobalStatsAsync(ct));
    }

    public static void MapPlayerEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/players").WithTags("Jogadores");

        g.MapPost("/", async (RegisterPlayerRequest req, PlayerService players, CancellationToken ct) =>
        {
            var created = await players.RegisterAsync(req, ct);
            return Results.Created($"/api/players/{created.Id}", created);
        }).RequireRateLimiting(RateLimits.Strict);

        g.MapGet("/{playerId:guid}", (Guid playerId, PlayerService players, CancellationToken ct) => players.GetProfileAsync(playerId, ct))
            .AddEndpointFilter<PlayerAuthFilter>();
    }

    public static void MapRunEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/runs").WithTags("Partidas");

        g.MapPost("/", async (StartRunRequest req, HttpContext http, RunService runs, CancellationToken ct) =>
        {
            var started = await runs.StartAsync(PlayerAuthFilter.Current(http), req, ct);
            return Results.Created($"/api/runs/{started.RunId}", started);
        }).AddEndpointFilter<PlayerAuthFilter>().RequireRateLimiting(RateLimits.Strict);

        g.MapPost("/{runId:guid}/finish", (Guid runId, RunSummary summary, HttpContext http, RunService runs, CancellationToken ct) =>
            runs.FinishAsync(PlayerAuthFilter.Current(http), runId, summary, ct))
            .AddEndpointFilter<PlayerAuthFilter>().RequireRateLimiting(RateLimits.Strict);

        g.MapGet("/{runId:guid}", (Guid runId, RunService runs, CancellationToken ct) => runs.GetDetailsAsync(runId, ct));
    }

    public static void MapSaveEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/saves/{playerId:guid}").WithTags("Saves").AddEndpointFilter<PlayerAuthFilter>();

        g.MapGet("/", (HttpContext http, SaveService saves, CancellationToken ct) => saves.GetAsync(PlayerAuthFilter.Current(http), ct));

        g.MapPut("/", (SaveGame save, HttpContext http, SaveService saves, CancellationToken ct) => saves.PutAsync(PlayerAuthFilter.Current(http), save, ct));

        g.MapDelete("/", async (HttpContext http, SaveService saves, CancellationToken ct) =>
            await saves.DeleteAsync(PlayerAuthFilter.Current(http), ct) ? Results.NoContent() : Results.NotFound());
    }

    public static void MapLeaderboardEndpoints(this IEndpointRouteBuilder app) =>
        app.MapGet("/api/leaderboard", (LeaderboardService board, CancellationToken ct, int top = 10, string? heroClass = null, bool daily = false, bool unique = true) =>
            board.GetAsync(new LeaderboardQuery(top, heroClass, daily, unique), ct))
            .WithTags("Ranking");
}
