namespace DungeonLegends.Domain.Common;

/// <summary>Acumulador fluente de erros de validação por campo.</summary>
public sealed class ValidationBuilder
{
    private readonly Dictionary<string, List<string>> _errors = new(StringComparer.Ordinal);

    public bool IsValid => _errors.Count == 0;

    public ValidationBuilder Require(bool condition, string field, string message)
    {
        if (!condition) Add(field, message);
        return this;
    }

    public ValidationBuilder InRange(long value, long min, long max, string field)
        => Require(value >= min && value <= max, field, $"Deve estar entre {min} e {max} (recebido {value}).");

    public void Add(string field, string message)
    {
        if (!_errors.TryGetValue(field, out var list)) _errors[field] = list = [];
        list.Add(message);
    }

    public IReadOnlyDictionary<string, string[]> Build() =>
        _errors.ToDictionary(kv => kv.Key, kv => kv.Value.ToArray(), StringComparer.Ordinal);

    /// <summary>Lança <see cref="ValidationException"/> se houver erros.</summary>
    public void ThrowIfInvalid()
    {
        if (!IsValid) throw new ValidationException(Build());
    }
}
