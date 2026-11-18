import { describe, it, expect, vi, afterEach } from "vitest";
import pg from "pg";
import { withExplicitSslMode } from "@/lib/db/postgres/driver";

/**
 * O endereço do Neon vem com `sslmode=require`. O `pg` 8 já o trata como `verify-full`, mas avisa (o aviso aparecia
 * como erro no painel da Vercel) e mudará a regra na próxima versão principal. O endereço passa a dizer `verify-full`:
 * mesma conexão de hoje, sem aviso, e sem risco de afrouxar numa atualização.
 */
describe("modo SSL explícito na conexão do banco", () => {
  const neon = "postgresql://neondb_owner:npg_Ab1Cd2@ep-calm-sun-a1b2c3d4-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

  afterEach(() => vi.restoreAllMocks());

  it("troca prefer, require e verify-ca por verify-full sem mexer no resto do endereço", () => {
    expect(withExplicitSslMode(neon)).toBe(neon.replace("sslmode=require", "sslmode=verify-full"));
    for (const mode of ["prefer", "require", "verify-ca"]) {
      expect(withExplicitSslMode(`postgres://u:p@h:5432/db?sslmode=${mode}`)).toBe("postgres://u:p@h:5432/db?sslmode=verify-full");
      expect(withExplicitSslMode(`postgres://u:p@h/db?application_name=erp&sslmode=${mode}&connect_timeout=10`)).toBe("postgres://u:p@h/db?application_name=erp&sslmode=verify-full&connect_timeout=10");
    }
    // senha com caracteres codificados e parâmetro cujo valor também é "require": nada além do sslmode muda
    const odd = "postgresql://user:p%40ss%3Aw%2Frd@host.example.com/db?channel_binding=require&sslmode=require";
    expect(withExplicitSslMode(odd)).toBe("postgresql://user:p%40ss%3Aw%2Frd@host.example.com/db?channel_binding=require&sslmode=verify-full");
  });

  it("respeita quem escolheu outro modo, a compatibilidade com o libpq ou nenhum modo", () => {
    for (const url of [
      "postgres://u:p@localhost:5432/db",
      "postgres://u:p@localhost:5432/db?sslmode=disable",
      "postgres://u:p@h/db?sslmode=no-verify",
      "postgres://u:p@h/db?sslmode=verify-full",
      "postgres://u:p@h/db?uselibpqcompat=true&sslmode=require",
      "postgres://u:p@h/db?sslmode=require&uselibpqcompat=true",
      "postgres://u:p@h/db?sslmode=requireX",
      "",
    ]) {
      expect(withExplicitSslMode(url)).toBe(url);
    }
  });

  it("o cliente pg monta a MESMA configuração de SSL de antes e não emite mais o aviso", () => {
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const sslOf = (connectionString: string) => new pg.Client({ connectionString }).ssl;
    // primeiro os endereços já corrigidos: nenhum aviso
    const fixed = ["prefer", "require", "verify-ca"].map((m) => sslOf(withExplicitSslMode(`postgres://u:p@h/db?sslmode=${m}`)));
    expect(warn).not.toHaveBeenCalled();
    // contraprova: o endereço original produz o aviso (o espião pega) e a mesma configuração
    const original = sslOf("postgres://u:p@h/db?sslmode=require");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/SECURITY WARNING: The SSL modes/);
    for (const f of fixed) expect(f).toEqual(original);
    // objeto vazio: nada desliga a conferência do certificado (padrão do Node = conferir certificado e nome do servidor)
    expect(original).toEqual({});
  });
});
