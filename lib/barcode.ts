// Internal in-store barcodes. GS1 reserves EAN-13 prefixes 20–29 for in-store /
// restricted-distribution use, so we mint valid "20"-prefixed EAN-13 codes for
// products that don't come with their own barcode (loose/unbranded goods).

export function ean13CheckDigit(d12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = d12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? n : n * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === code.charCodeAt(12) - 48;
}

// A barcode we minted in-store ("20"-prefixed EAN-13) rather than one that came
// printed on the product. Only these need labels printed — real products already
// carry their own scannable barcode.
export function isInternalBarcode(code?: string | null): boolean {
  return !!code && code.startsWith("20") && isValidEan13(code);
}

// A valid in-store EAN-13: "20" + 10 random digits + check digit. Pass the set
// of existing barcodes to avoid collisions.
export function generateInternalBarcode(existing?: Set<string>): string {
  for (let attempt = 0; attempt < 25; attempt++) {
    let body = "20";
    for (let i = 0; i < 10; i++) body += Math.floor(Math.random() * 10);
    const code = body + ean13CheckDigit(body);
    if (!existing || !existing.has(code)) return code;
  }
  let body = "20";
  for (let i = 0; i < 10; i++) body += Math.floor(Math.random() * 10);
  return body + ean13CheckDigit(body);
}
