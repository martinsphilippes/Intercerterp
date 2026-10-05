import { cn } from "./cn";

export const inputClass =
  "focus-ring block w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-500 aria-[invalid=true]:border-red-500";

export function Field({ label, hint, error, required, children, className, htmlFor }: { label?: React.ReactNode; hint?: React.ReactNode; error?: string | null; required?: boolean; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label && (
        <label htmlFor={htmlFor} className="text-xs font-medium text-slate-600">
          {label}
          {required && <span className="ml-0.5 text-red-600">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, "h-9", className)} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cn(inputClass, className)} />;
}

export function Select({ className, options, placeholder, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string; label: string; disabled?: boolean }>; placeholder?: string }) {
  return (
    <select {...props} className={cn(inputClass, "h-9 pr-8", className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700", className)}>
      <input type="checkbox" {...props} className="focus-ring size-4 rounded border-line accent-brand-700" />
      {label}
    </label>
  );
}

export function FormGrid({ children, cols = 3, className }: { children: React.ReactNode; cols?: 1 | 2 | 3 | 4 | 6; className?: string }) {
  const map = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4", 6: "sm:grid-cols-3 lg:grid-cols-6" };
  return <div className={cn("grid grid-cols-1 gap-4", map[cols], className)}>{children}</div>;
}

export function FormSection({ title, description, children, actions }: { title: string; description?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white">
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
