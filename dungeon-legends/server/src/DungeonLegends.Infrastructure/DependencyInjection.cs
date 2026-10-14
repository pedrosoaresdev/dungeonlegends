using DungeonLegends.Application.Abstractions;
using DungeonLegends.Application.Services;
using DungeonLegends.Infrastructure.Content;
using DungeonLegends.Infrastructure.Persistence;
using DungeonLegends.Infrastructure.Security;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace DungeonLegends.Infrastructure;

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

public static class DependencyInjection
{
    /// <summary>Registra repositórios, serviços de aplicação e infraestrutura.</summary>
    public static IServiceCollection AddDungeonLegends(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<StorageOptions>(configuration.GetSection(StorageOptions.Section));

        services.AddSingleton<IClock, SystemClock>();
        services.AddSingleton<IContentProvider, EmbeddedContentProvider>();
        services.AddSingleton<ITokenService, TokenService>();
        services.AddSingleton<DataContext>();
        services.AddSingleton<IPlayerRepository, JsonPlayerRepository>();
        services.AddSingleton<IRunRepository, JsonRunRepository>();
        services.AddSingleton<ISaveRepository, JsonSaveRepository>();

        services.AddScoped<PlayerService>();
        services.AddScoped<RunService>();
        services.AddScoped<SaveService>();
        services.AddScoped<LeaderboardService>();
        return services;
    }
}
