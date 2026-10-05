import { redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";

export default async function Page() {
  await requireSession("reports");
  redirect("/relatorios/gerenciais");
}
