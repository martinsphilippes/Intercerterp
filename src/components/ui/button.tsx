import Link from "next/link";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent" | "outline";
type Size = "sm" | "md" | "lg";

// Botões com relevo (gradiente + sombra) e afundamento ao pressionar, para parecerem clicáveis em qualquer tela
const variants: Record<Variant, string> = {
  primary:
    "bg-gradient-to-b from-brand-600 to-brand-700 text-white border border-brand-800 shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(15_33_71/0.35)] hover:from-brand-700 hover:to-brand-800 active:from-brand-800 active:to-brand-800 disabled:from-brand-300 disabled:to-brand-300 disabled:border-brand-300 disabled:shadow-none",
  accent:
    "bg-gradient-to-b from-accent-500 to-accent-600 text-white border border-accent-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_rgb(180_77_11/0.35)] hover:from-accent-600 hover:to-accent-700 disabled:from-accent-100 disabled:to-accent-100 disabled:border-accent-100 disabled:shadow-none",
  secondary:
    "bg-gradient-to-b from-white to-slate-50 text-ink border border-slate-300 shadow-[0_1px_2px_rgb(15_23_42/0.08)] hover:border-slate-400 hover:to-slate-100 active:bg-slate-100 active:from-slate-100 disabled:text-slate-400 disabled:shadow-none",
  outline: "bg-white text-brand-700 border border-brand-300 shadow-[0_1px_2px_rgb(15_23_42/0.06)] hover:bg-brand-50 hover:border-brand-400 active:bg-brand-100",
  ghost: "bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200",
  danger:
    "bg-gradient-to-b from-red-500 to-red-600 text-white border border-red-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(127_29_29/0.35)] hover:from-red-600 hover:to-red-700 disabled:from-red-300 disabled:to-red-300 disabled:border-red-300 disabled:shadow-none",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return cn(
    "btn focus-ring relative inline-flex cursor-pointer select-none items-center justify-center rounded-md font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow,transform] duration-100 active:translate-y-px active:shadow-inner disabled:cursor-not-allowed disabled:active:translate-y-0 aria-busy:cursor-wait",
    variants[variant],
    sizes[size],
    extra,
  );
}

/** Indicador de carregamento usado dentro dos botões. */
export function Spinner({ className }: { className?: string }) {
  return <span className={cn("size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent", className)} aria-hidden />;
}

export function Button({ variant = "secondary", size = "md", className, loading, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button {...props} disabled={props.disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "secondary", size = "md", className, children, ...rest }: { href: string; variant?: Variant; size?: Size; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
