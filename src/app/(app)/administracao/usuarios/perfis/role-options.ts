import { MODULES, SPECIAL_ACTIONS } from "@/lib/permissions";
import { CRUD_OPS, NOT_APPLICABLE, actionModule } from "@/domain/roles";

export const roleFormOptions = {
  modules: MODULES.map((m) => ({ key: m.key, label: m.label })),
  ops: CRUD_OPS.map((o) => ({ key: o.key, label: o.label })),
  actions: SPECIAL_ACTIONS.map((a) => ({ key: a.key, label: a.label, module: actionModule(a.key) })),
  na: NOT_APPLICABLE as Record<string, string[]>,
};
