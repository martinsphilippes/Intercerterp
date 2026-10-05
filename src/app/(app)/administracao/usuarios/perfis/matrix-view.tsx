import { Check } from "lucide-react";
import { MODULES, SPECIAL_ACTIONS, type PermissionMatrix } from "@/lib/permissions";
import { CRUD_OPS, actionModule, applicable } from "@/domain/roles";

/** Matriz somente leitura (permissões efetivas). */
export function MatrixView({ permissions, actions, isAdmin }: { permissions: PermissionMatrix; actions: string[]; isAdmin?: boolean }) {
  const has = (m: string, op: string) => isAdmin || Boolean((permissions as any)?.[m]?.[op]);
  const acts = new Set(actions ?? []);
  return (
    <div className="space-y-4">
      {isAdmin && <p className="text-sm text-slate-600">Administrador: acesso total, independentemente da matriz do perfil.</p>}
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="table-base w-full text-sm">
          <thead>
            <tr>
              <th>Módulo</th>
              {CRUD_OPS.map((o) => (
                <th key={o.key} className="text-center">
                  {o.label}
                </th>
              ))}
              <th>Operações específicas</th>
            </tr>
          </thead>
          <tbody>
            {MODULES.map((m) => {
              const special = SPECIAL_ACTIONS.filter((a) => actionModule(a.key) === m.key);
              return (
                <tr key={m.key}>
                  <td className="font-medium">{m.label}</td>
                  {CRUD_OPS.map((o) => (
                    <td key={o.key} className="text-center">
                      {!applicable(m.key, o.key) ? <span className="text-slate-300" title="Não se aplica">—</span> : has(m.key, o.key) ? <Check className="mx-auto size-4 text-emerald-600" aria-label="Sim" /> : <span className="mx-auto block size-4 rounded border border-slate-300" aria-label="Não" />}
                    </td>
                  ))}
                  <td className="text-xs">
                    {special.length === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {special.map((a) => (
                          <span key={a.key} className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${isAdmin || acts.has(a.key) ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-50 text-slate-400 ring-slate-200 line-through"}`}>
                            {a.label}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
