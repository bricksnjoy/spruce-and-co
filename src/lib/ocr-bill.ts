/**
 * Free, key-less bill reading: Tesseract in the browser, plus rules that pull
 * the fields a MIRA input schedule needs out of the text it returns.
 *
 * It is deliberately conservative — a field it is not reasonably sure of is
 * left blank for the person to fill, because a wrong number that looks filled
 * in is worse than an empty box.
 */

export interface OcrFields {
  shop: string;
  supplier_tin: string;
  bill_no: string;
  issue_date: string;
  subtotal: number;
  gst_rate: number;
  tax_amount: number;
  total: number;
  description: string;
  confidence: number;
  notes: string;
}

/* ------------------------------------------------------------------ */
/* image                                                               */
/* ------------------------------------------------------------------ */

/**
 * Phone photos are far larger than Tesseract needs and are usually shot in
 * poor light. Downscaling and flattening to high-contrast greyscale is the
 * single biggest thing that improves a thermal-receipt read.
 */
async function prepare(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const maxW = 1800;
  const scale = Math.min(1, maxW / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // mean luminance, used as the threshold so the contrast stretch follows
  // the lighting of this particular photo rather than a fixed guess
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  const mean = sum / (d.length / 4);

  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // push away from the mean, but stop short of hard black and white so
    // faint thermal print is not erased altogether
    const v = Math.max(0, Math.min(255, mean + (lum - mean) * 1.8));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* text                                                                */
/* ------------------------------------------------------------------ */

export async function readWithTesseract(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<OcrFields> {
  const { createWorker } = await import("tesseract.js");
  const canvas = await prepare(file);

  const worker = await createWorker("eng", 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(Math.round(m.progress * 100));
    },
  });

  try {
    const { data } = await worker.recognize(canvas);
    return parseBillText(data.text, data.confidence ?? 0);
  } finally {
    await worker.terminate();
  }
}

/* ------------------------------------------------------------------ */
/* rules                                                               */
/* ------------------------------------------------------------------ */

const NUM = /(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/;

/** Last number on a line — on a receipt the amount sits at the right. */
function amountOn(line: string): number | null {
  const all = line.match(new RegExp(NUM.source, "g"));
  if (!all?.length) return null;
  const n = Number(all[all.length - 1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function findLine(lines: string[], re: RegExp): string | null {
  for (const l of lines) if (re.test(l)) return l;
  return null;
}

/** Totals sit at the foot of a receipt, so the last match is the real one. */
function findLastLine(lines: string[], re: RegExp): string | null {
  for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i])) return lines[i];
  return null;
}

const IS_SUBTOTAL = /sub\s*-?\s*total|net\s*(amount|total)|taxable/i;

/** dd/mm/yyyy and friends, plus yyyy-mm-dd, normalised to an ISO date. */
function findDate(text: string): string {
  const iso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // day first, which is how the Maldives writes dates
  const dmy = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/);
  if (dmy) {
    const [, d, m] = dmy;
    let y = dmy[3];
    if (y.length === 2) y = `20${y}`;
    const day = Number(d);
    const mon = Number(m);
    if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }
  return "";
}

/**
 * MIRA TINs read like 1013456GST501. OCR reliably turns 0/O, 1/I and 5/S
 * into one another, so the shape is matched loosely and then repaired.
 */
function findTin(text: string): string {
  const m = text.toUpperCase().match(/\b([0-9OIS]{6,8})\s*[-]?\s*(GST|G5T|657)\s*[-]?\s*([0-9OIS]{2,4})\b/);
  if (!m) return "";
  const digits = (s: string) => s.replace(/O/g, "0").replace(/I/g, "1").replace(/S/g, "5");
  return `${digits(m[1])}GST${digits(m[3])}`;
}

/** The shop name is nearly always the first real line of the header. */
function findShop(lines: string[]): string {
  const skip =
    /invoice|receipt|bill|tax|cash|customer|date|tel|phone|address|male'|maldives|thank|www\.|@|^\d/i;
  for (const l of lines.slice(0, 8)) {
    const t = l.trim();
    if (t.length < 3 || t.length > 45) continue;
    if (skip.test(t)) continue;
    if (!/[A-Za-z]{3}/.test(t)) continue;
    return t.replace(/[^\w\s&.'()-]/g, "").trim();
  }
  return "";
}

export function parseBillText(text: string, ocrConfidence: number): OcrFields {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const shop = findShop(lines);
  const supplier_tin = findTin(text);
  const issue_date = findDate(text);

  const billLine = findLine(lines, /\b(invoice|receipt|bill)\s*(no|number|#)/i);
  const bill_no =
    billLine?.match(/(?:\bno\.?|\bnumber|#)\s*:?\s*([A-Z0-9][A-Z0-9/-]{2,19})/i)?.[1]?.trim() ?? "";

  // totals: prefer the most explicit label available
  // "Sub Total" also contains "total", so it has to be ruled out explicitly
  const totalCandidates = lines.filter((l) => !IS_SUBTOTAL.test(l));
  const totalLine =
    findLine(totalCandidates, /\bgrand\s*total\b/i) ??
    findLine(totalCandidates, /\b(total\s*(amount\s*)?(payable|due)|amount\s*(due|payable))\b/i) ??
    findLastLine(totalCandidates, /\btotal\b/i);
  // the TIN line also says "GST", and its digits are not an amount
  const gstLine = findLine(
    lines.filter((l) => !/\btin\b|t[1i]n\b/i.test(l) && !findTin(l)),
    /\b(t-?gst|gst|tax)\b/i,
  );
  const subLine = findLine(lines, IS_SUBTOTAL);

  let total = totalLine ? (amountOn(totalLine) ?? 0) : 0;
  let tax_amount = gstLine ? (amountOn(gstLine) ?? 0) : 0;
  let subtotal = subLine ? (amountOn(subLine) ?? 0) : 0;

  // the rate is usually printed beside the GST line
  // what was actually printed, before anything is worked out from the rest
  const printedAll = Boolean(subtotal && tax_amount && total);

  const rateHit = (gstLine ?? text).match(/\b(6|8|12)\s*%/);
  let gst_rate = rateHit ? Number(rateHit[1]) : 8;
  let splitWasCalculated = false;

  // fill in whichever of the three is missing from the other two
  if (!subtotal && total && tax_amount) subtotal = round2(total - tax_amount);
  if (!tax_amount && total && subtotal) tax_amount = round2(total - subtotal);
  if (!total && subtotal && tax_amount) total = round2(subtotal + tax_amount);
  if (!total && subtotal && !tax_amount) {
    tax_amount = round2(subtotal * (gst_rate / 100));
    total = round2(subtotal + tax_amount);
  }
  if (total && !subtotal && !tax_amount) {
    subtotal = round2(total / (1 + gst_rate / 100));
    tax_amount = round2(total - subtotal);
    splitWasCalculated = true;
  }
  if (subtotal && tax_amount && !rateHit) {
    const implied = (tax_amount / subtotal) * 100;
    for (const r of [6, 8, 12]) if (Math.abs(implied - r) < 0.6) gst_rate = r;
  }

  // sanity: the three have to agree, or the read is not trustworthy
  const notes: string[] = [];
  const amountsDisagree =
    Boolean(total && subtotal && tax_amount) &&
    Math.abs(subtotal + tax_amount - total) > 0.5;
  if (amountsDisagree) {
    notes.push("Net + GST does not add up to the total — check all three.");
  }
  if (!total) notes.push("No total found; enter it by hand.");
  if (!shop) notes.push("Shop name not found.");
  if (!supplier_tin) notes.push("No TIN found — GST cannot be claimed without it.");
  if (splitWasCalculated) {
    notes.push(
      `GST was not printed separately, so the ${gst_rate}% split was worked out from the total.`,
    );
  }

  // Confidence answers "how much of this can be taken on trust", so it starts
  // from how cleanly the text read and is adjusted by what the fields say
  // about each other. Fields are weighted by what it costs to get them wrong:
  // a bad total is a bad P&L, while a missing TIN is often just a shop that
  // does not print one.
  let confidence = ocrConfidence;
  if (!total) confidence -= 30;
  if (!shop) confidence -= 10;
  if (!issue_date) confidence -= 8;
  if (!supplier_tin) confidence -= 5;
  if (splitWasCalculated) confidence -= 5;
  // the three amounts agreeing to the laariyaa is hard to get wrong by
  // accident, so it is the strongest evidence the numbers were read right
  if (printedAll && Math.abs(subtotal + tax_amount - total) < 0.02) {
    confidence += 10;
  } else if (amountsDisagree) {
    confidence -= 25;
  }
  confidence = Math.max(5, Math.min(97, Math.round(confidence)));

  return {
    shop,
    supplier_tin,
    bill_no,
    issue_date,
    subtotal,
    gst_rate,
    tax_amount,
    total,
    description: "",
    confidence,
    notes: notes.join(" "),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
