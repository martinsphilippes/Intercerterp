/** Erro de regra de negócio com mensagem apresentável ao usuário. */
export class BusinessError extends Error {
  constructor(message: string, public readonly code = "business_rule", public readonly details?: unknown) {
    super(message);
    this.name = "BusinessError";
  }
}

export class PermissionError extends BusinessError {
  constructor(message = "Você não tem permissão para esta ação.") {
    super(message, "forbidden");
    this.name = "PermissionError";
  }
}

export function assert(cond: unknown, message: string, code?: string): asserts cond {
  if (!cond) throw new BusinessError(message, code);
}
