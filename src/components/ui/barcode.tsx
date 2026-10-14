import { code128Widths, ean13Modules, isEan13 } from "@/lib/barcode";

/**
 * Código de barras de produto em SVG: EAN-13 quando o código é um GTIN-13 válido; senão Code 128
 * (outros GTINs, SKU ou código interno). Desenhado em unidades de módulo e escalado pelo CSS (largura/altura).
 */
export function ProductBarcode({ value, className, showText = true }: { value: string; className?: string; showText?: boolean }) {
  if (isEan13(value)) return <Ean13 value={value} className={className} showText={showText} />;
  return <Code128 value={value} className={className} showText={showText} />;
}

function Ean13({ value, className, showText }: { value: string; className?: string; showText: boolean }) {
  const { modules, guards } = ean13Modules(value);
  const quiet = 9;
  const width = modules.length + quiet * 2;
  const bar = 50;
  const guard = showText ? 56 : 50;
  const height = showText ? 64 : 50;
  const rects: Array<{ x: number; w: number; h: number }> = [];
  for (let i = 0; i < modules.length; i++) {
    if (modules[i] !== "1") continue;
    const h = guards[i] ? guard : bar;
    const last = rects[rects.length - 1];
    if (last && last.x + last.w === quiet + i && last.h === h) last.w += 1;
    else rects.push({ x: quiet + i, w: 1, h });
  }
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={`Código de barras EAN-13 ${value}`} preserveAspectRatio="xMidYMid meet">
      <rect width={width} height={height} fill="#fff" />
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={0} width={r.w} height={r.h} fill="#000" />
      ))}
      {showText && (
        <g fontFamily="ui-monospace, monospace" fontSize={9} fill="#000">
          <text x={quiet - 6} y={height - 1}>{value[0]}</text>
          <text x={quiet + 3 + 21} y={height - 1} textAnchor="middle" letterSpacing={1.2}>{value.slice(1, 7)}</text>
          <text x={quiet + 50 + 21} y={height - 1} textAnchor="middle" letterSpacing={1.2}>{value.slice(7)}</text>
        </g>
      )}
    </svg>
  );
}

function Code128({ value, className, showText }: { value: string; className?: string; showText: boolean }) {
  const widths = code128Widths(value);
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  const bar = 50;
  const height = showText ? 62 : bar;
  let x = quiet;
  const rects: Array<{ x: number; w: number }> = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) rects.push({ x, w });
    x += w;
  });
  return (
    <svg viewBox={`0 0 ${total} ${height}`} className={className} role="img" aria-label={`Código de barras ${value}`} preserveAspectRatio="xMidYMid meet">
      <rect width={total} height={height} fill="#fff" />
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={0} width={r.w} height={bar} fill="#000" />
      ))}
      {showText && (
        <text x={total / 2} y={height - 1} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={10} fill="#000">
          {value}
        </text>
      )}
    </svg>
  );
}
