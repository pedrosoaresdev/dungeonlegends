namespace DungeonLegends.Domain.Common;

/// <summary>Erro base do domínio. A API converte cada tipo em um status HTTP (ProblemDetails).</summary>
public abstract class DomainException(string message) : Exception(message);

public sealed class NotFoundException(string resource, object id)
    : DomainException($"{resource} '{id}' não encontrado.");

public sealed class UnauthorizedException(string message = "Token do jogador inválido ou ausente.")
    : DomainException(message);

public sealed class ConflictException(string message) : DomainException(message);

/// <summary>Falha de validação com erros por campo (vira HTTP 400 ValidationProblem).</summary>
public sealed class ValidationException : DomainException
{
    public ValidationException(IReadOnlyDictionary<string, string[]> errors)
        : base("Um ou mais campos são inválidos.") => Errors = errors;

    public ValidationException(string field, string error)
        : this(new Dictionary<string, string[]> { [field] = [error] }) { }

    public IReadOnlyDictionary<string, string[]> Errors { get; }
}
