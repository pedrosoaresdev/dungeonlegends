using DungeonLegends.Domain.Common;
using DungeonLegends.Domain.Content;
using DungeonLegends.Domain.Entities;

namespace DungeonLegends.Domain.Rules;

/// <summary>Valida um checkpoint contra as regras do jogo antes de persisti-lo.</summary>
public static class SaveValidator
{
    public const int CurrentVersion = 1;
    public const int MaxGold = 1_000_000;
    public const int MaxPotions = 99;

    public static void Validate(GameContent content, SaveGame save)
    {
        ArgumentNullException.ThrowIfNull(content);
        ArgumentNullException.ThrowIfNull(save);
        var v = new ValidationBuilder();
        var rules = content.Rules;

        v.Require(save.Version == CurrentVersion, "version", $"Versão de save não suportada (esperado {CurrentVersion}).");
        var cls = content.FindClass(save.HeroClass);
        v.Require(cls is not null, "heroClass", $"Classe '{save.HeroClass}' não existe.");

        var run = save.Run ?? new SaveRun();
        v.InRange(run.Act, 1, content.Acts.Count, "run.act");
        if (run.Act >= 1 && run.Act <= content.Acts.Count)
            v.InRange(run.Floor, 1, content.Acts[run.Act - 1].Floors + 1, "run.floor");
        v.InRange(run.Kills, 0, 100_000, "run.kills");
        // pode ser igual a Act quando o jogador sai do jogo logo após derrotar o chefe
        v.InRange(run.BossesKilled, 0, run.Act, "run.bossesKilled");
        v.InRange(run.FloorsCleared, 0, content.TotalFloors, "run.floorsCleared");
        v.InRange(run.TimeMs, 0, (long)TimeSpan.FromDays(7).TotalMilliseconds, "run.timeMs");
        v.Require(run.FloorsCleared == content.AbsoluteFloor(run.Act, run.Floor) - 1, "run.floorsCleared", "Inconsistente com a fase/andar atual.");
        foreach (var (id, n) in run.ShopBought ?? [])
        {
            v.Require(content.Shop.Any(s => s.Id == id), "run.shopBought", $"Item '{id}' não existe na loja.");
            v.InRange(n, 0, 99, $"run.shopBought.{id}");
        }

        var hero = save.Hero ?? new SaveHero();
        v.InRange(hero.Level, 1, rules.MaxLevel, "hero.level");
        if (hero.Level >= 1 && hero.Level <= rules.MaxLevel)
            v.InRange(hero.Xp, 0, ProgressionRules.XpForLevel(rules, hero.Level), "hero.xp");
        v.InRange(hero.Gold, 0, MaxGold, "hero.gold");
        v.Require(hero.Hp > 0, "hero.hp", "Um herói morto não pode ser salvo.");
        v.InRange(hero.Potions?.Hp ?? 0, 0, MaxPotions, "hero.potions.hp");
        v.InRange(hero.Potions?.Mp ?? 0, 0, MaxPotions, "hero.potions.mp");
        v.Require(content.FindWeapon(hero.Weapon?.Id ?? "") is not null, "hero.weapon", $"Arma '{hero.Weapon?.Id}' não existe.");

        var perkPoints = 0;
        foreach (var (id, stacks) in hero.Perks ?? [])
        {
            var perk = content.FindPerk(id);
            if (perk is null)
            {
                v.Add("hero.perks", $"Perk '{id}' não existe.");
                continue;
            }
            v.InRange(stacks, 0, perk.Max, $"hero.perks.{id}");
            perkPoints += stacks;
        }
        v.Require(perkPoints <= hero.Level - 1, "hero.perks", $"{perkPoints} perks para o nível {hero.Level} (máximo {hero.Level - 1}).");

        // bônus só vêm de elixires da loja (+3 ATQ, +2 DEF, +25 vida) — e do modificador "Canhão de Vidro"
        var bought = run.ShopBought ?? [];
        var glass = run.Modifier?.Id == "glass";
        v.Require(hero.Bonus.Atk <= (bought.GetValueOrDefault("elixir_atk") * 3) + (glass ? 6 : 0), "hero.bonus.atk", "Bônus de ataque sem compras correspondentes.");
        v.Require(hero.Bonus.Def <= bought.GetValueOrDefault("elixir_def") * 2, "hero.bonus.def", "Bônus de defesa sem compras correspondentes.");
        v.Require(hero.Bonus.MaxHp <= bought.GetValueOrDefault("heart") * 25, "hero.bonus.maxHp", "Bônus de vida sem compras correspondentes.");

        v.ThrowIfInvalid();
    }
}
