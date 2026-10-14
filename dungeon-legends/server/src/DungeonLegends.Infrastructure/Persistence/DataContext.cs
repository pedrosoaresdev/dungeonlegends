using System.Text.Json;
using System.Text.Json.Serialization;
using DungeonLegends.Domain.Entities;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace DungeonLegends.Infrastructure.Persistence;

public sealed class StorageOptions
{
    public const string Section = "Storage";

    /// <summary>Pasta onde ficam players.json, runs.json e saves.json.</summary>
    public string DataDirectory { get; set; } = "App_Data";
}

/// <summary>Agrupa as coleções persistidas. Registrado como singleton.</summary>
public sealed class DataContext : IDisposable
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    public DataContext(IOptions<StorageOptions> options, ILogger<DataContext> logger)
    {
        var dir = Path.GetFullPath(options.Value.DataDirectory);
        DataDirectory = dir;
        Players = new JsonFileStore<PlayerAccount>(dir, "players", JsonOptions, logger);
        Runs = new JsonFileStore<GameRun>(dir, "runs", JsonOptions, logger);
        Saves = new JsonFileStore<SaveGame>(dir, "saves", JsonOptions, logger);
    }

    public string DataDirectory { get; }
    public JsonFileStore<PlayerAccount> Players { get; }
    public JsonFileStore<GameRun> Runs { get; }
    public JsonFileStore<SaveGame> Saves { get; }

    public void Dispose()
    {
        Players.Dispose();
        Runs.Dispose();
        Saves.Dispose();
    }
}
