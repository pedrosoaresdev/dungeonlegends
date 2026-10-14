using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using DungeonLegends.Api.Endpoints;
using DungeonLegends.Api.Infrastructure;
using DungeonLegends.Infrastructure;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------------- serviços
builder.Services.AddDungeonLegends(builder.Configuration);

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    o.SerializerOptions.NumberHandling = JsonNumberHandling.AllowReadingFromString;
});

builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
{
    ctx.ProblemDetails.Extensions["traceId"] = ctx.HttpContext.TraceIdentifier;
    ctx.ProblemDetails.Instance = $"{ctx.HttpContext.Request.Method} {ctx.HttpContext.Request.Path}";
});
builder.Services.AddExceptionHandler<DomainExceptionHandler>();

builder.Services.AddHealthChecks().AddCheck<StorageHealthCheck>("storage");

// CORS: o Live Server do VS Code roda em http://127.0.0.1:5500 por padrão
var corsOptions = builder.Configuration.GetSection("Cors").Get<CorsSettings>() ?? new CorsSettings();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .SetIsOriginAllowed(corsOptions.IsAllowed)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .WithExposedHeaders("Retry-After")
    .SetPreflightMaxAge(TimeSpan.FromHours(1))));

// Rate limiting por IP: protege contra spam de requisições
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        RateLimitPartition.GetFixedWindowLimiter(
            ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 240, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy(RateLimits.Strict, ctx =>
        RateLimitPartition.GetSlidingWindowLimiter(
            ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
            _ => new SlidingWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), SegmentsPerWindow = 6, QueueLimit = 0 }));
    o.OnRejected = async (ctx, ct) =>
    {
        if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retry))
            ctx.HttpContext.Response.Headers.RetryAfter = ((int)retry.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture);
        await Results.Problem(statusCode: 429, title: "Muitas requisições", detail: "Calma, aventureiro! Tente novamente em instantes.")
            .ExecuteAsync(ctx.HttpContext);
    };
});

builder.Services.Configure<ForwardedHeadersOptions>(o => o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);

var app = builder.Build();

// ---------------------------------------------------------------- pipeline
app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseCors();
app.UseRateLimiter();
app.UseMiddleware<RequestTimingMiddleware>();

// valida content.json logo na inicialização (falha rápido se estiver quebrado)
_ = app.Services.GetRequiredService<DungeonLegends.Application.Abstractions.IContentProvider>().Content;

app.MapGet("/", () => Results.Redirect("/api")).ExcludeFromDescription();
app.MapApiIndex();
app.MapHealthEndpoints();
app.MapContentEndpoints();
app.MapPlayerEndpoints();
app.MapRunEndpoints();
app.MapSaveEndpoints();
app.MapLeaderboardEndpoints();

app.Logger.LogInformation("Dungeon Legends API pronta. Dados em: {Dir}",
    app.Services.GetRequiredService<DungeonLegends.Infrastructure.Persistence.DataContext>().DataDirectory);

app.Run();

/// <summary>Exposto para testes de integração (WebApplicationFactory).</summary>
public partial class Program;
