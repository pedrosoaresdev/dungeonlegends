using System.Text.Json;
using DungeonLegends.Application.Abstractions;
using DungeonLegends.Domain.Content;

namespace DungeonLegends.Infrastructure.Content;

/// <summary>
/// Lê o content.json embutido no assembly no build (o mesmo arquivo do cliente).
/// Validado na inicialização: a API não sobe com conteúdo inconsistente.
/// </summary>
public sealed class EmbeddedContentProvider : IContentProvider
{
    public const string ResourceName = "DungeonLegends.content.json";
    private static readonly JsonSerializerOptions ReadOptions = new(JsonSerializerDefaults.Web);

    public EmbeddedContentProvider() => Content = Load();

    public GameContent Content { get; }

    public static GameContent Load()
    {
        using var stream = typeof(EmbeddedContentProvider).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Recurso embutido '{ResourceName}' não encontrado.");
        return Parse(stream);
    }

    public static GameContent Parse(Stream stream)
    {
        var content = JsonSerializer.Deserialize<GameContent>(stream, ReadOptions)
            ?? throw new InvalidOperationException("content.json vazio.");
        Validate(content);
        return content;
    }

    /// <summary>Checagens de integridade referencial do conteúdo.</summary>
    public static void Validate(GameContent c)
    {
        var errors = new List<string>();
        var enemyIds = c.Enemies.Select(e => e.Id).ToHashSet();
        var bossIds = c.Bosses.Select(b => b.Id).ToHashSet();
        var weaponIds = c.Weapons.Select(w => w.Id).ToHashSet();

        if (c.Classes.Count == 0) errors.Add("Nenhuma classe definida.");
        if (c.Acts.Count == 0) errors.Add("Nenhuma fase definida.");
        foreach (var cls in c.Classes)
            if (!weaponIds.Contains(cls.StartWeapon)) errors.Add($"Classe {cls.Id}: arma inicial '{cls.StartWeapon}' inexistente.");
        foreach (var act in c.Acts)
        {
            if (!bossIds.Contains(act.Boss)) errors.Add($"Fase {act.Id}: chefe '{act.Boss}' inexistente.");
            foreach (var e in act.Enemies)
                if (!enemyIds.Contains(e)) errors.Add($"Fase {act.Id}: inimigo '{e}' inexistente.");
            if (act.Floors < 1) errors.Add($"Fase {act.Id}: precisa de ao menos 1 andar.");
        }
        foreach (var w in c.Weapons)
            if (!c.Rarities.ContainsKey(w.Rarity)) errors.Add($"Arma {w.Id}: raridade '{w.Rarity}' inexistente.");
        if (c.Rules.XpGrowth <= 1) errors.Add("rules.xpGrowth deve ser > 1.");

        var dupes = c.Classes.Select(x => x.Id).Concat(c.Enemies.Select(x => x.Id)).Concat(c.Weapons.Select(x => x.Id))
            .GroupBy(x => x).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
        if (dupes.Count > 0) errors.Add("IDs duplicados: " + string.Join(", ", dupes));

        if (errors.Count > 0)
            throw new InvalidOperationException("content.json inválido:\n - " + string.Join("\n - ", errors));
    }
}
