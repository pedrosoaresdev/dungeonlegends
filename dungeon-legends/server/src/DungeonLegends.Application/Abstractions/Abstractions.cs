using DungeonLegends.Domain.Content;
using DungeonLegends.Domain.Entities;

namespace DungeonLegends.Application.Abstractions;

/// <summary>Relógio injetável (facilita testes de regras dependentes de tempo).</summary>
public interface IClock
{
    DateTimeOffset UtcNow { get; }
}

/// <summary>Fonte do conteúdo do jogo (content.json).</summary>
public interface IContentProvider
{
    GameContent Content { get; }
}

/// <summary>Geração e verificação de tokens de jogador.</summary>
public interface ITokenService
{
    string NewToken();
    string Hash(string token);
    bool Verify(string token, string hash);
}

public interface IPlayerRepository
{
    Task<PlayerAccount?> GetAsync(Guid id, CancellationToken ct = default);
    Task<PlayerAccount?> FindByNameAsync(string name, CancellationToken ct = default);
    Task AddAsync(PlayerAccount player, CancellationToken ct = default);
    Task UpdateAsync(PlayerAccount player, CancellationToken ct = default);
    Task<int> CountAsync(CancellationToken ct = default);
}

public interface IRunRepository
{
    Task<GameRun?> GetAsync(Guid id, CancellationToken ct = default);
    Task AddAsync(GameRun run, CancellationToken ct = default);
    Task UpdateAsync(GameRun run, CancellationToken ct = default);
    Task<IReadOnlyList<GameRun>> ListFinishedAsync(CancellationToken ct = default);
    Task<IReadOnlyList<GameRun>> ListByPlayerAsync(Guid playerId, CancellationToken ct = default);
}

public interface ISaveRepository
{
    Task<SaveGame?> GetAsync(Guid playerId, CancellationToken ct = default);
    Task UpsertAsync(Guid playerId, SaveGame save, CancellationToken ct = default);
    Task<bool> DeleteAsync(Guid playerId, CancellationToken ct = default);
}
