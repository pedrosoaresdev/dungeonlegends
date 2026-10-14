using System.Text.RegularExpressions;
using DungeonLegends.Application.Abstractions;
using DungeonLegends.Application.Contracts;
using DungeonLegends.Domain.Common;
using DungeonLegends.Domain.Entities;

namespace DungeonLegends.Application.Services;

public sealed partial class PlayerService(IPlayerRepository players, IRunRepository runs, ITokenService tokens, IClock clock)
{
    private static readonly string[] BlockedWords = ["admin", "moderador", "anthropic", "null", "undefined"];

    [GeneratedRegex(@"^[\p{L}\p{N} _\-]{3,16}$")]
    private static partial Regex NamePattern();

    public async Task<RegisterPlayerResponse> RegisterAsync(RegisterPlayerRequest request, CancellationToken ct = default)
    {
        var name = NormalizeName(request.Name);
        ValidateName(name);
        if (await players.FindByNameAsync(name, ct) is not null)
            throw new ConflictException($"O nome '{name}' já está em uso. Escolha outro.");

        var token = tokens.NewToken();
        var player = new PlayerAccount
        {
            Id = Guid.NewGuid(),
            Name = name,
            TokenHash = tokens.Hash(token),
            CreatedAt = clock.UtcNow,
            LastSeenAt = clock.UtcNow,
        };
        await players.AddAsync(player, ct);
        return new RegisterPlayerResponse(player.Id, player.Name, token);
    }

    /// <summary>Valida o token do jogador. Lança <see cref="UnauthorizedException"/> se inválido.</summary>
    public async Task<PlayerAccount> AuthenticateAsync(Guid playerId, string? token, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token)) throw new UnauthorizedException();
        var player = await players.GetAsync(playerId, ct) ?? throw new NotFoundException("Jogador", playerId);
        if (!tokens.Verify(token, player.TokenHash)) throw new UnauthorizedException();
        player.LastSeenAt = clock.UtcNow;
        await players.UpdateAsync(player, ct);
        return player;
    }

    public async Task<PlayerProfileResponse> GetProfileAsync(Guid playerId, CancellationToken ct = default)
    {
        var player = await players.GetAsync(playerId, ct) ?? throw new NotFoundException("Jogador", playerId);
        var history = (await runs.ListByPlayerAsync(playerId, ct))
            .Where(r => r.Status == RunStatus.Finished)
            .OrderByDescending(r => r.FinishedAt)
            .Take(10)
            .Select(r => new RunHistoryItem(r.Id, r.HeroClass, r.Score, r.Summary?.FloorsCleared ?? 0, r.Summary?.Victory ?? false, r.Flagged, r.FinishedAt))
            .ToList();
        return new PlayerProfileResponse(player.Id, player.Name, player.CreatedAt, player.Stats, history);
    }

    internal static string NormalizeName(string? name) =>
        MultiSpace().Replace((name ?? "").Trim(), " ");

    internal static void ValidateName(string name)
    {
        if (!NamePattern().IsMatch(name))
            throw new ValidationException("name", "O nome deve ter de 3 a 16 caracteres (letras, números, espaço, _ ou -).");
        if (BlockedWords.Any(w => name.Contains(w, StringComparison.OrdinalIgnoreCase)))
            throw new ValidationException("name", "Este nome não é permitido.");
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex MultiSpace();
}
