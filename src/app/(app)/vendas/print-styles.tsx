/**
 * Estilos de impressão de comprovantes (recibo 80 mm, comprovantes de caixa e relatórios):
 * somente a área `.print-doc` é impressa; o restante da aplicação fica oculto.
 */
export function PrintStyles({ paper = "80mm" }: { paper?: "80mm" | "A4" }) {
  const css = `
@media print {
  body * { visibility: hidden !important; }
  .print-doc, .print-doc * { visibility: visible !important; }
  .print-doc { position: absolute; left: 0; top: 0; margin: 0 !important; box-shadow: none !important; border: 0 !important; ${paper === "80mm" ? "width: 72mm !important; padding: 0 2mm !important;" : "width: 100% !important;"} }
  @page { ${paper === "80mm" ? "size: 80mm auto; margin: 2mm;" : "size: A4; margin: 12mm;"} }
}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
