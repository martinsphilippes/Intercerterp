/**
 * Erros da interface de serviço com código estável do contrato (o Interos decide pelo `codigo`, não pela mensagem).
 * Sem dependência de HTTP: os serviços de domínio do multiempresa lançam estes erros e a rota os traduz.
 */
export class ServiceError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly codigo: string,
    message: string,
    public readonly detalhes?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export interface FieldIssue {
  campo: string;
  mensagem: string;
}

export function validationError(campos: FieldIssue[]): ServiceError {
  return new ServiceError(422, "validacao", campos.length === 1 ? campos[0].mensagem : "Há campos inválidos na solicitação.", { campos });
}

export const notFound = (what = "Empresa") => new ServiceError(404, "nao_encontrado", `${what} não encontrada para esta credencial.`);
