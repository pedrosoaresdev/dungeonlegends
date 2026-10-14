using DungeonLegends.Application.Abstractions;
using DungeonLegends.Domain.Common;
using DungeonLegends.Domain.Entities;

namespace DungeonLegends.Infrastructure.Persistence;

public sealed class JsonPlayerRepository(DataContext db) : IPlayerRepository
{
    public Task<PlayerAccount?> GetAsync(Guid id, CancellationToken ct = default) => db.Players.GetAsync(id.ToString(), ct);

    public async Task<PlayerAccount?> FindByNameAsync(string name, CancellationToken ct = default)
    {
        var matches = await db.Players.ListAsync(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase), ct);
        return matches.Count > 0 ? matches[0] : null;
    }

    public async Task AddAsync(PlayerAccount player, CancellationToken ct = default)
    {
        if (!await db.Players.AddAsync(player.Id.ToString(), player, ct))
            throw new ConflictException("Jogador já existe.");
    }

    public Task UpdateAsync(PlayerAccount player, CancellationToken ct = default) => db.Players.SetAsync(player.Id.ToString(), player, ct);

    public Task<int> CountAsync(CancellationToken ct = default) => db.Players.CountAsync(ct);
}

public sealed class JsonRunRepository(DataContext db) : IRunRepository
{
    public Task<GameRun?> GetAsync(Guid id, CancellationToken ct = default) => db.Runs.GetAsync(id.ToString(), ct);

    public Task AddAsync(GameRun run, CancellationToken ct = default) => db.Runs.SetAsync(run.Id.ToString(), run, ct);

    public Task UpdateAsync(GameRun run, CancellationToken ct = default) => db.Runs.SetAsync(run.Id.ToString(), run, ct);

    public Task<IReadOnlyList<GameRun>> ListFinishedAsync(CancellationToken ct = default) =>
        db.Runs.ListAsync(r => r.Status == RunStatus.Finished, ct);

    public Task<IReadOnlyList<GameRun>> ListByPlayerAsync(Guid playerId, CancellationToken ct = default) =>
        db.Runs.ListAsync(r => r.PlayerId == playerId, ct);
}

public sealed class JsonSaveRepository(DataContext db) : ISaveRepository
{
    public Task<SaveGame?> GetAsync(Guid playerId, CancellationToken ct = default) => db.Saves.GetAsync(playerId.ToString(), ct);

    public Task UpsertAsync(Guid playerId, SaveGame save, CancellationToken ct = default) => db.Saves.SetAsync(playerId.ToString(), save, ct);

    public Task<bool> DeleteAsync(Guid playerId, CancellationToken ct = default) => db.Saves.RemoveAsync(playerId.ToString(), ct);
}
