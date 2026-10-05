import Link from "next/link";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent" | "outline";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-300",
  accent: "bg-accent-500 text-white hover:bg-accent-600 disabled:bg-accent-100",
  secondary: "bg-white text-ink border border-line hover:bg-slate-50 disabled:text-slate-400",
  outline: "bg-transparent text-brand-700 border border-brand-300 hover:bg-brand-50",
  ghost: "bg-transparent text-slate-700 hover:bg-slate-100",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string) {
  return cn("focus-ring inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed", variants[variant], sizes[size], extra);
}

export function Button({ variant = "secondary", size = "md", className, loading, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button {...props} disabled={props.disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, size, className)}>
      {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
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
