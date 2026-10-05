/** Importa todos os módulos que registram executores de tarefas e rotinas periódicas. */
import "./sales";
import "./fiscal/service";
import "./routines";
import "./jobs";

export { runDueJobs } from "@/lib/core/jobs";
