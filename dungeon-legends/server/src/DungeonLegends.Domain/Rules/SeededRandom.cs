namespace DungeonLegends.Domain.Rules;

/// <summary>
/// Mulberry32 — idêntico ao <c>RNG</c> de <c>client/js/core/math.js</c>.
/// Mesma semente => mesma sequência no navegador e no servidor.
/// </summary>
public sealed class SeededRandom(uint seed)
{
    private uint _state = seed;

    public uint State => _state;

    public double NextDouble()
    {
        unchecked
        {
            _state += 0x6D2B79F5;
            var t = _state;
            t = (t ^ (t >> 15)) * (t | 1);
            t ^= t + ((t ^ (t >> 7)) * (t | 61));
            return (t ^ (t >> 14)) / 4294967296.0;
        }
    }

    /// <summary>Inteiro em [min, max] (inclusivo).</summary>
    public int Next(int min, int max) => min + (int)Math.Floor(NextDouble() * (max - min + 1));

    public T Pick<T>(IReadOnlyList<T> items) => items[(int)Math.Floor(NextDouble() * items.Count)];
}

public static class StringHash
{
    /// <summary>FNV-1a 32 bits — igual a <c>hashString</c> no cliente.</summary>
    public static uint Fnv1a(string text)
    {
        unchecked
        {
            var h = 0x811C9DC5u;
            foreach (var c in text)
            {
                h ^= c;
                h *= 0x01000193u;
            }
            return h;
        }
    }
}
