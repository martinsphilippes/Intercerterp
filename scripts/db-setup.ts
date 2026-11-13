import "./env";
import { pgDriver, postgresUrl } from "../src/lib/db/postgres/driver";
import { provisionPostgres } from "../src/lib/db/postgres/ddl";

/**
 * Cria no Postgres o que falta do esquema (tabelas, colunas, índices). O sistema já faz isso sozinho na primeira
 * consulta de cada versão; este roteiro serve para preparar o banco antes da publicação ou conferir uma instalação.
 */
const url = postgresUrl();
if (!url) {
  console.error("Defina DATABASE_URL (.env.local) com o endereço do banco Postgres.");
  process.exit(1);
}
const driver = pgDriver(url);
provisionPostgres(driver)
  .then(() => driver.end())
  .catch(async (e) => {
    console.error(e);
    await driver.end().catch(() => undefined);
    process.exit(1);
  });
