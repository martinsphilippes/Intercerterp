import Link from "@/components/ui/link";
import { Fragment } from "react";

/** Renderizador mínimo e seguro (sem HTML bruto) do Markdown simples dos artigos de ajuda. */
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={`${key}-${i++}`} className="rounded bg-slate-100 px-1 text-[0.9em]">{t.slice(1, -1)}</code>);
    else {
      const [, label, href] = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      out.push(href.startsWith("/") ? <Link key={`${key}-${i++}`} href={href} className="text-brand-700 underline">{label}</Link> : <span key={`${key}-${i++}`}>{label}</span>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = source.split("\n");
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push(<h2 key={k++} className="mt-6 text-base font-semibold text-ink first:mt-0">{inline(line.slice(3), `h${k}`)}</h2>);
      i++;
      continue;
    }
    if (/^- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      blocks.push(<ul key={k++} className="mt-2 list-disc space-y-1 pl-5">{items.map((t, j) => <li key={j}>{inline(t, `u${k}${j}`)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ""));
      blocks.push(<ol key={k++} className="mt-2 list-decimal space-y-1 pl-5">{items.map((t, j) => <li key={j}>{inline(t, `o${k}${j}`)}</li>)}</ol>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(## |- |\d+\. )/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++} className="mt-2">{inline(para.join(" "), `p${k}`)}</p>);
  }
  return <div className="text-sm leading-relaxed text-slate-700">{blocks.map((b, j) => <Fragment key={j}>{b}</Fragment>)}</div>;
}
