/**
 * Pix estático "copia e cola" (BR Code, padrão EMV® QRCPS do Banco Central) montado localmente a partir da chave Pix
 * cadastrada na conta financeira. Não há integração com PSP: o pagamento NÃO é confirmado automaticamente — a baixa da
 * parcela continua manual (ou pela conciliação do extrato).
 */

function tlv(id: string, value: string) {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

/** CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF), exigido no campo 63 do BR Code. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Texto em ASCII simples (sem acentos), como pedem os campos de nome/cidade do BR Code. */
function ascii(v: string, max: number) {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,\-/]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export interface PixStaticInput {
  key: string;
  merchantName: string;
  merchantCity: string;
  /** centavos; omitido ou 0 = valor livre */
  amount?: number | null;
  /** identificador da cobrança (até 25 caracteres alfanuméricos) */
  txid?: string | null;
}

/** Payload "copia e cola" do Pix estático. */
export function pixStaticPayload(input: PixStaticInput): string {
  const key = input.key.trim();
  const mai = tlv("00", "br.gov.bcb.pix") + tlv("01", key);
  const txid = (input.txid ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const parts = [
    tlv("00", "01"),
    tlv("26", mai),
    tlv("52", "0000"),
    tlv("53", "986"),
    input.amount && input.amount > 0 ? tlv("54", (input.amount / 100).toFixed(2)) : "",
    tlv("58", "BR"),
    tlv("59", ascii(input.merchantName, 25) || "RECEBEDOR"),
    tlv("60", ascii(input.merchantCity, 15) || "BRASIL"),
    tlv("62", tlv("05", txid)),
  ].join("");
  const withCrcId = `${parts}6304`;
  return withCrcId + crc16(withCrcId);
}
