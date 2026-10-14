using System.Security.Cryptography;
using System.Text;
using DungeonLegends.Application.Abstractions;

namespace DungeonLegends.Infrastructure.Security;

/// <summary>Tokens aleatórios de 256 bits; armazenamos apenas SHA-256 e comparamos em tempo constante.</summary>
public sealed class TokenService : ITokenService
{
    public string NewToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public string Hash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public bool Verify(string token, string hash)
    {
        if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(hash)) return false;
        var computed = Encoding.ASCII.GetBytes(Hash(token));
        var expected = Encoding.ASCII.GetBytes(hash);
        return CryptographicOperations.FixedTimeEquals(computed, expected);
    }
}
