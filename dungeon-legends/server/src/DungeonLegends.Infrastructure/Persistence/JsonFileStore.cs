using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace DungeonLegends.Infrastructure.Persistence;

/// <summary>
/// Coleção chave/valor persistida em um arquivo JSON.
/// <list type="bullet">
/// <item>Thread-safe (SemaphoreSlim) — várias requisições simultâneas não corrompem dados.</item>
/// <item>Escrita atômica: grava em arquivo temporário e renomeia; um crash nunca deixa JSON pela metade.</item>
/// <item>Mantém um backup (.bak) da versão anterior e o usa se o arquivo principal estiver corrompido.</item>
/// <item>Retorna cópias profundas, então quem lê não altera o cache sem passar por <see cref="SetAsync"/>.</item>
/// </list>
/// Para trocar por um banco (EF Core, Dapper...), basta reimplementar os repositórios.
/// </summary>
public sealed class JsonFileStore<T> : IDisposable where T : class
{
    private readonly string _path;
    private readonly JsonSerializerOptions _json;
    private readonly ILogger _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private Dictionary<string, T>? _items;

    public JsonFileStore(string directory, string collection, JsonSerializerOptions json, ILogger logger)
    {
        Directory.CreateDirectory(directory);
        _path = Path.Combine(directory, collection + ".json");
        _json = json;
        _logger = logger;
    }

    public string FilePath => _path;

    public async Task<T?> GetAsync(string key, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var items = await LoadAsync(ct);
            return items.TryGetValue(key, out var v) ? Clone(v) : null;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<IReadOnlyList<T>> ListAsync(Func<T, bool>? predicate = null, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var items = await LoadAsync(ct);
            IEnumerable<T> q = items.Values;
            if (predicate is not null) q = q.Where(predicate);
            return q.Select(Clone).ToList();
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<int> CountAsync(CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            return (await LoadAsync(ct)).Count;
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>Insere ou substitui.</summary>
    public async Task SetAsync(string key, T value, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var items = await LoadAsync(ct);
            items[key] = Clone(value);
            await FlushAsync(items, ct);
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>Insere apenas se a chave não existir (retorna false caso exista).</summary>
    public async Task<bool> AddAsync(string key, T value, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var items = await LoadAsync(ct);
            if (!items.TryAdd(key, Clone(value))) return false;
            await FlushAsync(items, ct);
            return true;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<bool> RemoveAsync(string key, CancellationToken ct = default)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var items = await LoadAsync(ct);
            if (!items.Remove(key)) return false;
            await FlushAsync(items, ct);
            return true;
        }
        finally
        {
            _lock.Release();
        }
    }

    private async Task<Dictionary<string, T>> LoadAsync(CancellationToken ct)
    {
        if (_items is not null) return _items;
        _items = await TryReadAsync(_path, ct) ?? await TryReadAsync(_path + ".bak", ct) ?? new Dictionary<string, T>(StringComparer.Ordinal);
        return _items;
    }

    private async Task<Dictionary<string, T>?> TryReadAsync(string path, CancellationToken ct)
    {
        if (!File.Exists(path)) return null;
        try
        {
            await using var fs = File.OpenRead(path);
            var data = await JsonSerializer.DeserializeAsync<Dictionary<string, T>>(fs, _json, ct);
            return data is null ? null : new Dictionary<string, T>(data, StringComparer.Ordinal);
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "Arquivo de dados corrompido: {Path}. Tentando backup.", path);
            return null;
        }
    }

    private async Task FlushAsync(Dictionary<string, T> items, CancellationToken ct)
    {
        var tmp = _path + ".tmp";
        await using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 4096, useAsync: true))
        {
            await JsonSerializer.SerializeAsync(fs, items, _json, ct);
            await fs.FlushAsync(ct);
        }
        if (File.Exists(_path)) File.Copy(_path, _path + ".bak", overwrite: true);
        File.Move(tmp, _path, overwrite: true);
    }

    private T Clone(T value) => JsonSerializer.Deserialize<T>(JsonSerializer.SerializeToUtf8Bytes(value, _json), _json)!;

    public void Dispose() => _lock.Dispose();
}
