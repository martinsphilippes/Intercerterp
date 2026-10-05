/** Código de barras Code 128 (conjunto C) em SVG — usado na chave de acesso do DANFE (44 dígitos). */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

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
