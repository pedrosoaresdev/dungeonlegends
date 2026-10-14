using System.Diagnostics;
using DungeonLegends.Application.Services;
using DungeonLegends.Domain.Common;
using DungeonLegends.Domain.Entities;
using DungeonLegends.Infrastructure.Persistence;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace DungeonLegends.Api.Infrastructure;

public static class RateLimits
{
    public const string Strict = "strict";
}

public sealed class CorsSettings
{
    /// <summary>Origens extras permitidas (ex.: https://seuusuario.github.io).</summary>
    public string[] AllowedOrigins { get; set; } = [];

    /// <summary>Libera qualquer porta em localhost/127.0.0.1 (Live Server, Vite etc.).</summary>
    public bool AllowAnyLocalhost { get; set; } = true;

    public bool IsAllowed(string origin)
    {
        if (AllowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase)) return true;
        if (!AllowAnyLocalhost || !Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return false;
        return uri.IsLoopback || uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase);
    }
}

/// <summary>Converte exceções de domínio em respostas ProblemDetails (RFC 7807).</summary>
public sealed class DomainExceptionHandler(IProblemDetailsService problems, ILogger<DomainExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var http = httpContext;
        var (status, title) = exception switch
        {
            ValidationException => (StatusCodes.Status400BadRequest, "Dados inválidos"),
            NotFoundException => (StatusCodes.Status404NotFound, "Não encontrado"),
            UnauthorizedException => (StatusCodes.Status401Unauthorized, "Não autorizado"),
            ConflictException => (StatusCodes.Status409Conflict, "Conflito"),
            BadHttpRequestException => (StatusCodes.Status400BadRequest, "Requisição malformada"),
            _ => (StatusCodes.Status500InternalServerError, "Erro interno"),
        };
        if (status == 500) logger.LogError(exception, "Erro não tratado em {Path}", http.Request.Path);
        else logger.LogDebug("{Status} {Path}: {Message}", status, http.Request.Path, exception.Message);

        http.Response.StatusCode = status;
        var details = new Microsoft.AspNetCore.Mvc.ProblemDetails
        {
            Status = status,
            Title = title,
            Detail = status == 500 ? "Algo deu errado no servidor." : exception.Message,
        };
        if (exception is ValidationException ve) details.Extensions["errors"] = ve.Errors;
        return await problems.TryWriteAsync(new ProblemDetailsContext { HttpContext = http, ProblemDetails = details, Exception = exception });
    }
}

/// <summary>Verifica se a pasta de dados está acessível para escrita.</summary>
public sealed class StorageHealthCheck(DataContext db) : IHealthCheck
{
    public Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            var probe = Path.Combine(db.DataDirectory, ".health");
            File.WriteAllText(probe, DateTimeOffset.UtcNow.ToString("O"));
            File.Delete(probe);
            return Task.FromResult(HealthCheckResult.Healthy("Armazenamento OK"));
        }
        catch (Exception ex)
        {
            return Task.FromResult(HealthCheckResult.Unhealthy("Pasta de dados sem permissão de escrita", ex));
        }
    }
}

/// <summary>Adiciona o cabeçalho Server-Timing e loga requisições lentas.</summary>
public sealed class RequestTimingMiddleware(RequestDelegate next, ILogger<RequestTimingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext ctx)
    {
        var sw = Stopwatch.StartNew();
        ctx.Response.OnStarting(() =>
        {
            ctx.Response.Headers["Server-Timing"] = $"app;dur={sw.Elapsed.TotalMilliseconds:0.0}";
            return Task.CompletedTask;
        });
        await next(ctx);
        if (sw.ElapsedMilliseconds > 500)
            logger.LogWarning("Requisição lenta: {Method} {Path} levou {Ms} ms", ctx.Request.Method, ctx.Request.Path, sw.ElapsedMilliseconds);
    }
}

/// <summary>
/// Filtro de endpoint que autentica o jogador pelo cabeçalho <c>X-Player-Token</c>.
/// O jogador autenticado fica disponível em <c>HttpContext.Items</c>.
/// </summary>
public sealed class PlayerAuthFilter(PlayerService players) : IEndpointFilter
{
    public const string HeaderName = "X-Player-Token";
    private const string ItemKey = "dl.player";

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var ctx = context;
        var http = ctx.HttpContext;
        var token = http.Request.Headers[HeaderName].ToString();
        var playerId = ResolvePlayerId(ctx);
        if (playerId is null) throw new UnauthorizedException("Não foi possível identificar o jogador.");
        http.Items[ItemKey] = await players.AuthenticateAsync(playerId.Value, token, http.RequestAborted);
        return await next(ctx);
    }

    public static PlayerAccount Current(HttpContext http) =>
        http.Items[ItemKey] as PlayerAccount ?? throw new UnauthorizedException();

    private static Guid? ResolvePlayerId(EndpointFilterInvocationContext ctx)
    {
        var route = ctx.HttpContext.Request.RouteValues;
        if (route.TryGetValue("playerId", out var v) && Guid.TryParse(v?.ToString(), out var id)) return id;
        // corpo com PlayerId (ex.: StartRunRequest)
        foreach (var arg in ctx.Arguments)
        {
            var prop = arg?.GetType().GetProperty("PlayerId");
            if (prop?.GetValue(arg) is Guid g) return g;
        }
        // cabeçalho explícito (ex.: finalizar partida)
        return Guid.TryParse(ctx.HttpContext.Request.Headers["X-Player-Id"].ToString(), out var h) ? h : null;
    }
}
