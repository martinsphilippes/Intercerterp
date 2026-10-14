/** Código de barras Code 128 (conjunto C) em SVG — usado na chave de acesso do DANFE (44 dígitos). */
import { CODE128_PATTERNS as PATTERNS } from "@/lib/barcode";

export function code128C(digits: string): number[] {
  const d = digits.replace(/\D/g, "");
  const src = d.length % 2 ? "0" + d : d;
  const values = [105];
  for (let i = 0; i < src.length; i += 2) values.push(Number(src.slice(i, i + 2)));
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103, 106);
  return values;
}

export function Barcode128({ value, height = 44, className }: { value: string; height?: number; className?: string }) {
  const codes = code128C(value);
  const widths = codes.flatMap((c) => PATTERNS[c].split("").map(Number));
  const total = widths.reduce((a, b) => a + b, 0) + 20;
  let x = 10;
  const rects: Array<{ x: number; w: number }> = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) rects.push({ x, w });
    x += w;
  });
  return (
    <svg viewBox={`0 0 ${total} ${height}`} preserveAspectRatio="none" className={className} role="img" aria-label={`Código de barras ${value}`}>
      <rect width={total} height={height} fill="#fff" />
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={0} width={r.w} height={height} fill="#000" />
      ))}
    </svg>
  );
}
