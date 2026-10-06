"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, useRef, type ComponentProps } from "react";

type Props = ComponentProps<typeof NextLink>;

/**
 * Link do sistema: pré-carrega a página só na intenção do usuário (mouse por cima ou toque), em vez de pré-carregar
 * todos os links visíveis — menus e tabelas têm dezenas de links e cada pré-carga é uma chamada ao servidor.
 * `prefetch` explícito (true) mantém o comportamento padrão do Next.
 */
export const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ prefetch, onMouseEnter, onTouchStart, onFocus, ...props }, ref) {
  const router = useRouter();
  const done = useRef(false);
  const href = typeof props.href === "string" ? props.href : null;
  const warm = () => {
    if (done.current || !href || !href.startsWith("/") || href.startsWith("/api/")) return;
    done.current = true;
    router.prefetch(href);
  };
  if (prefetch === true) return <NextLink ref={ref} prefetch onMouseEnter={onMouseEnter} onTouchStart={onTouchStart} onFocus={onFocus} {...props} />;
  return (
    <NextLink
      ref={ref}
      prefetch={false}
      onMouseEnter={(e) => {
        warm();
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        warm();
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        warm();
        onFocus?.(e);
      }}
      {...props}
    />
  );
});

export default Link;
