namespace DungeonLegends.Domain.Content;

/// <summary>
/// Conteúdo do jogo (classes, inimigos, fases, regras). Carregado do mesmo
/// <c>client/data/content.json</c> usado pelo navegador — fonte única de verdade.
/// </summary>
public sealed record GameContent(
    string Version,
    GameRules Rules,
    IReadOnlyList<HeroClassDef> Classes,
    IReadOnlyList<EnemyDef> Enemies,
    IReadOnlyList<BossDef> Bosses,
    IReadOnlyList<ActDef> Acts,
    IReadOnlyList<WeaponDef> Weapons,
    IReadOnlyDictionary<string, RarityDef> Rarities,
    IReadOnlyList<PerkDef> Perks,
    IReadOnlyList<ShopItemDef> Shop)
{
    /// <summary>Total de andares, contando a arena de chefe de cada fase.</summary>
    public int TotalFloors => Acts.Sum(a => a.Floors + 1);

    public HeroClassDef? FindClass(string id) => Classes.FirstOrDefault(c => c.Id == id);

    public WeaponDef? FindWeapon(string id) => Weapons.FirstOrDefault(w => w.Id == id);

    public PerkDef? FindPerk(string id) => Perks.FirstOrDefault(p => p.Id == id);

    /// <summary>Índice absoluto (1-based) de um andar dentro da campanha.</summary>
    public int AbsoluteFloor(int act, int floor)
    {
        var n = 0;
        for (var i = 0; i < act - 1 && i < Acts.Count; i++) n += Acts[i].Floors + 1;
        return n + floor;
    }
}

public sealed record GameRules(
    int MaxLevel,
    int XpBase,
    double XpGrowth,
    StatPerLevel StatPerLevel,
    ScoreRules Score,
    AntiCheatRules AntiCheat);

public sealed record StatPerLevel(double Hp, double Atk, double Def);

public sealed record ScoreRules(
    int PerFloor,
    int PerKill,
    int PerBoss,
    int PerGold,
    int PerLevel,
    int VictoryBonus,
    int TimeBonusMax,
    int TimeBonusSecondsPerFloor);

public sealed record AntiCheatRules(int MinSecondsPerFloor, int MaxKillsPerFloor, int MaxGoldPerFloor);

public sealed record HeroStats(int Hp, int Mana, int Atk, int Def, int Speed, double Crit, double AttackRate, int Range);

public sealed record AbilityDef(string Id, string Name, double Cooldown, int Cost);

public sealed record HeroClassDef(
    string Id,
    string Name,
    string Sprite,
    string Description,
    string Attack,
    AbilityDef Ability,
    HeroStats Stats,
    string StartWeapon,
    string Color);

public sealed record EnemyDef(string Id, string Name, string Sprite, int Hp, int Atk, int Speed, int Xp, int Gold, string Ai);

public sealed record BossDef(string Id, string Name, string Sprite, int Hp, int Atk, int Speed, int Xp, int Gold, IReadOnlyList<string> Patterns);

public sealed record ActDef(int Id, string Name, string Subtitle, string Story, int Floors, IReadOnlyList<string> Enemies, string Boss);

public sealed record WeaponDef(string Id, string Name, int Power, double Speed, string Rarity);

public sealed record RarityDef(string Name, string Color, int Weight, int MinAct);

public sealed record PerkDef(string Id, string Name, string Desc, string Stat, double Value, int Max);

public sealed record ShopItemDef(string Id, string Name, string Sprite, int Price, string Desc);
