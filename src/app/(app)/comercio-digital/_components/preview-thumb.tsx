"use client";

import { useCallback, useState } from "react";
import { iconFor } from "@/components/storefront/product-icon";

/**
 * Imagem de um produto na miniatura da loja: a foto, quando houver e abrir; senão, a ilustração da categoria (a mesma da
 * vitrine). Foto que não abre — arquivo removido, usuário sem acesso ao cadastro de produtos — volta para a ilustração em
 * vez de mostrar o ícone de imagem quebrada do navegador. A conferência no `ref` cobre a falha que acontece antes de a
 * página ficar interativa (o evento de erro, nesse caso, já passou).
 */
export function PreviewThumb({ category, imageUrl, accent, className }: { category: string | null; imageUrl?: string | null; accent: string; className: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useCallback((el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);
  const Icon = iconFor(category);
  return (
    <div className={`relative flex items-center justify-center overflow-hidden bg-slate-50 ${className}`}>
      <Icon className="size-4" style={{ color: accent }} aria-hidden />
      {imageUrl && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={ref} src={imageUrl} alt="" onError={() => setFailed(true)} className="absolute inset-0 size-full bg-white object-cover" />
      )}
    </div>
  );
}
