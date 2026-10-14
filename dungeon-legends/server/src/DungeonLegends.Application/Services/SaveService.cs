using DungeonLegends.Application.Abstractions;
using DungeonLegends.Domain.Common;
using DungeonLegends.Domain.Entities;
using DungeonLegends.Domain.Rules;

namespace DungeonLegends.Application.Services;

public sealed class SaveService(ISaveRepository saves, IRunRepository runs, IContentProvider contentProvider, IClock clock)
{
    public async Task<SaveGame> GetAsync(PlayerAccount player, CancellationToken ct = default) =>
        await saves.GetAsync(player.Id, ct) ?? throw new NotFoundException("Save do jogador", player.Id);

    public async Task<SaveGame> PutAsync(PlayerAccount player, SaveGame save, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(save);
        var content = contentProvider.Content;
        SaveValidator.Validate(content, save);

        // o save precisa referenciar uma partida ativa deste jogador, com a mesma semente/classe
        if (save.Run.RunId is { } runId)
        {
            var run = await runs.GetAsync(runId, ct) ?? throw new ValidationException("run.runId", "Partida inexistente.");
            if (run.PlayerId != player.Id) throw new UnauthorizedException("Esta partida pertence a outro jogador.");
            if (run.Status != RunStatus.Active) throw new ConflictException("Não é possível salvar uma partida já finalizada.");
            if (run.Seed != save.Run.Seed || run.HeroClass != save.HeroClass)
                throw new ValidationException("run", "Semente ou classe não conferem com a partida.");
        }

        // impede "voltar no tempo" para farmar: o save novo não pode regredir na campanha
        var existing = await saves.GetAsync(player.Id, ct);
        if (existing is not null && existing.Run.RunId == save.Run.RunId && save.Run.RunId is not null &&
            save.Run.FloorsCleared < existing.Run.FloorsCleared)
            throw new ConflictException("O save enviado é mais antigo que o save atual.");

        save.SavedAt = clock.UtcNow;
        await saves.UpsertAsync(player.Id, save, ct);
        return save;
    }

    public Task<bool> DeleteAsync(PlayerAccount player, CancellationToken ct = default) => saves.DeleteAsync(player.Id, ct);
}
