namespace DungeonLegends.Domain.Entities;

/// <summary>Checkpoint do jogo (salvo no início de cada andar).</summary>
public sealed class SaveGame
{
    public int Version { get; set; }
    public string HeroClass { get; set; } = "";
    public SaveRun Run { get; set; } = new();
    public SaveHero Hero { get; set; } = new();
    public DateTimeOffset SavedAt { get; set; }
}

public sealed class SaveRun
{
    public Guid? RunId { get; set; }
    public uint Seed { get; set; }
    public int Act { get; set; } = 1;
    public int Floor { get; set; } = 1;
    public int Kills { get; set; }
    public int BossesKilled { get; set; }
    public int GoldEarned { get; set; }
    public long TimeMs { get; set; }
    public int FloorsCleared { get; set; }
    public bool Daily { get; set; }
    public DailyModifier? Modifier { get; set; }
    public Dictionary<string, int> ShopBought { get; set; } = new(StringComparer.Ordinal);
}

public sealed class SaveHero
{
    public int Level { get; set; } = 1;
    public int Xp { get; set; }
    public int Gold { get; set; }
    public int Hp { get; set; }
    public Dictionary<string, int> Perks { get; set; } = new(StringComparer.Ordinal);
    public HeroBonus Bonus { get; set; } = new();
    public HeroPotions Potions { get; set; } = new();
    public WeaponRef Weapon { get; set; } = new();
}

public sealed class HeroBonus
{
    public int Atk { get; set; }
    public int Def { get; set; }
    public int MaxHp { get; set; }
}

public sealed class HeroPotions
{
    public int Hp { get; set; }
    public int Mp { get; set; }
}

public sealed class WeaponRef
{
    public string Id { get; set; } = "";
}
