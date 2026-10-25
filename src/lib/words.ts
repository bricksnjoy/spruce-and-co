const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
  "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES: [bigint, string][] = [[1_000_000_000n, "Billion"], [1_000_000n, "Million"], [1_000n, "Thousand"]];

function under1000(n: number): string {
  const out: string[] = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)], "Hundred"); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)]); n %= 10; }
  if (n > 0) out.push(ONES[n]);
  return out.join(" ");
}

/** A whole number in words: 210792 → "Two Hundred Ten Thousand Seven Hundred Ninety Two". */
export function wholeInWords(n: bigint): string {
  if (n === 0n) return "Zero";
  const out: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) { out.push(wholeInWords(n / size), name); n %= size; }
  }
  if (n > 0n) out.push(under1000(Number(n)));
  return out.join(" ");
}

const UNITS: Record<string, [string, string]> = { MVR: ["Rufiyaa", "Laari"], USD: ["Dollars", "Cents"] };

/** An amount in laari (or cents) in words, as the grand total prints: "… Rufiyaa Sixty Nine Laari". */
export function amountInWords(laari: bigint, currency = "MVR"): string {
  const [major, minor] = UNITS[currency] ?? [currency, ""];
  const neg = laari < 0n;
  const a = neg ? -laari : laari;
  const whole = a / 100n, part = a % 100n;
  const words = `${wholeInWords(whole)} ${major}${part > 0n && minor ? ` ${wholeInWords(part)} ${minor}` : ""}`;
  return neg ? `Minus ${words}` : words;
}
