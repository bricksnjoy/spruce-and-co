import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

/**
 * What we try to read off a photographed bill. Every field is a best effort —
 * the entry form lets a human correct any of it before the bill is saved, and
 * after.
 */
const BillSchema = z.object({
  shop_name: z.string().describe("Trading name of the shop or supplier printed on the bill"),
  supplier_tin: z
    .string()
    .describe(
      "Supplier's Taxpayer Identification Number, often printed as TIN or GST number, e.g. 1000000GST501. Empty string if not shown.",
    ),
  invoice_number: z.string().describe("Invoice, bill or receipt number. Empty string if absent."),
  invoice_date: z.string().describe("Date on the bill as YYYY-MM-DD. Empty string if unreadable."),
  currency: z.string().describe("ISO currency code, e.g. MVR, USD"),
  subtotal: z.number().describe("Amount before tax. 0 if not shown separately."),
  gst_rate: z
    .number()
    .describe("GST rate charged, as a number: 0, 6, 8 or 12. Use 0 when no GST is shown."),
  gst_amount: z.number().describe("GST/VAT charged. 0 if none."),
  total: z.number().describe("Grand total actually payable, including GST"),
  item_summary: z
    .string()
    .describe("Short description of what was bought, e.g. 'Cement, sand and rebar'"),
  cost_category: z
    .string()
    .describe(
      "Which cost category this bill belongs to. Copy one of the allowed names exactly, or empty string if none fits.",
    ),
  expense_class: z
    .enum(["revenue", "capital"])
    .describe(
      "capital for plant, equipment, tools or anything lasting beyond the job; revenue for consumed materials, hire and services",
    ),
  confidence: z
    .number()
    .describe("0-100: confidence in this reading. Low if the photo is blurred, skewed or cropped."),
  notes: z.string().describe("Anything ambiguous a human should check. Empty string if all clear."),
});

export type ExtractedBill = z.infer<typeof BillSchema>;

const SYSTEM = `You read construction supplier bills and receipts for a Maldivian back-office system.

Extract exactly what is printed. Rules:
- Never invent a value. If a field is not legible or not present, use an empty string for text and 0 for numbers.
- Amounts are numbers only — strip currency symbols and thousands separators.
- total is what was actually paid, including GST. subtotal excludes GST.
- The Maldives general GST rate is 8% (it was 6% before 2023, so older bills show 6%). Read the rate printed on the bill; if only an amount is shown, infer it from amount ÷ subtotal and round to 0, 6, 8 or 12.
- The supplier TIN is often near the shop name or in the footer, formatted like 1000000GST501.
- Set confidence honestly: below 60 if the image is blurry, skewed, cropped or handwritten.
- Put anything a human should double-check into notes.
- Choose cost_category from the allowed list by what was bought, not by who sold it: a hardware shop sells cement (Materials), tiles (Internal Finishes) and wiring (Mechanical & Electrical) alike. Leave it empty rather than guessing between two that fit equally.`;

/** The prompt carries the categories, since they are the customer's own. */
function systemFor(categories: string[]) {
  return categories.length
    ? `${SYSTEM}\n\nAllowed cost_category values, exactly as written:\n${categories
        .map((c) => `- ${c}`)
        .join("\n")}`
    : SYSTEM;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const READ_PROMPT = "Read this bill and extract its details.";

/** Whichever reader the server is set up for, in order of preference. */
export function reader(): "claude" | "gemini" | null {
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return "gemini";
  return null;
}

/** True when the server is configured to read bills automatically. */
export function extractionAvailable() {
  return reader() !== null;
}

export async function extractBill(
  fileBytes: Buffer,
  mimeType: string,
  categories: string[] = [],
): Promise<ExtractedBill> {
  const which = reader();
  if (!which) {
    throw new Error(
      "Auto-reading is not configured. Set ANTHROPIC_API_KEY or GEMINI_API_KEY to switch it on, or type the receipt in by hand.",
    );
  }
  return which === "claude"
    ? withClaude(fileBytes, mimeType, categories)
    : withGemini(fileBytes, mimeType, categories);
}

async function withClaude(
  fileBytes: Buffer,
  mimeType: string,
  categories: string[],
): Promise<ExtractedBill> {
  const client = new Anthropic();
  const data = fileBytes.toString("base64");

  const source =
    mimeType === "application/pdf"
      ? ({
          type: "document" as const,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data },
        })
      : ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: (IMAGE_TYPES.includes(mimeType)
              ? mimeType
              : "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data,
          },
        });

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 8000,
    system: systemFor(categories),
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: zodOutputFormat(BillSchema),
    },
    messages: [
      {
        role: "user",
        content: [source, { type: "text", text: READ_PROMPT }],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The reader declined to process this document.");
  }

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Could not read a receipt out of this image.");
  return parsed;
}

/**
 * Gemini instead, for anyone running on its free tier. Same schema and the
 * same prompt, so a bill reads the same whichever key is set — note that on
 * Google's free tier the bills submitted may be used to improve their models,
 * which the paid tier and Anthropic both exclude.
 */
async function withGemini(
  fileBytes: Buffer,
  mimeType: string,
  categories: string[],
): Promise<ExtractedBill> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
  });

  const primary = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
  // an alias rather than a pinned version, so it stays valid as Google
  // retires model names underneath us
  const lite = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-flash-lite-latest";

  /**
   * On the free tier the two things that go wrong are congestion and the
   * per-minute limit, and both are cleared by asking again — the limit is
   * counted per model, so the second name is a fresh allowance rather than
   * merely a smaller model. Alternating between them, with a little more
   * patience each round, gets a batch of bills through without the person
   * being told to come back later.
   */
  const attempts: { model: string; wait: number }[] = [
    { model: primary, wait: 0 },
    { model: lite, wait: 0 },
    { model: primary, wait: 2000 },
    { model: lite, wait: 5000 },
  ];

  let res: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
  let lastError = "Could not read a receipt out of this image.";
  const dead = new Set<string>();

  for (const { model, wait } of attempts) {
    if (dead.has(model)) continue;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      res = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType:
                    mimeType === "application/pdf" || IMAGE_TYPES.includes(mimeType)
                      ? mimeType
                      : "image/jpeg",
                  data: fileBytes.toString("base64"),
                },
              },
              { text: READ_PROMPT },
            ],
          },
        ],
        config: {
          systemInstruction: systemFor(categories),
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(BillSchema),
          temperature: 0,
          // A bill is read, not reasoned about: the fields are printed on
          // the paper. Deliberating over it costs seconds of the wait and
          // changes none of the answers.
          thinkingConfig: { thinkingLevel: "MINIMAL" as never },
        },
      });
      break;
    } catch (e) {
      // a model name Google does not know is not this bill's problem: stop
      // asking for it, and keep the first real error so the person is told
      // what actually went wrong
      if (isUnknownModel(e)) {
        dead.add(model);
        continue;
      }
      lastError = googleMessage(e);
      // a bad key or an unreadable image fails the same way however many
      // times it is asked
      if (!isBusy(e)) break;
    }
  }

  if (!res) throw new Error(lastError);

  const text = res.text;
  if (!text) throw new Error("Could not read a receipt out of this image.");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The reader returned something that was not a receipt.");
  }

  const parsed = BillSchema.safeParse(json);
  if (!parsed.success) throw new Error("Could not read a receipt out of this image.");
  return parsed.data;
}

/** Pull the human-readable part out of a Google API error. */
function googleMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const match = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const msg = match ? match[1].replace(/\\"/g, '"') : raw;
  if (/quota|rate limit|RESOURCE_EXHAUSTED/i.test(msg)) {
    return "Google's free tier is rate limited — wait a moment and read this receipt again.";
  }
  if (/503|UNAVAILABLE|overloaded|high demand/i.test(msg)) {
    return "Google's free reader is busy and did not answer after three tries. Wait a moment and read this receipt again, or fill it in by hand.";
  }
  if (/API key|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) {
    return "The Gemini key was rejected. Check GEMINI_API_KEY in Vercel.";
  }
  return msg.slice(0, 300);
}

/** True when Google is merely busy, so the same request is worth repeating. */
function isBusy(e: unknown): boolean {
  const raw = e instanceof Error ? e.message : String(e);
  return /503|UNAVAILABLE|overloaded|high demand|try again later|429|RESOURCE_EXHAUSTED|rate limit|quota/i.test(
    raw,
  );
}

/** True when Google does not recognise the model name we asked for. */
function isUnknownModel(e: unknown): boolean {
  const raw = e instanceof Error ? e.message : String(e);
  return /is not found for API version|NOT_FOUND|no longer available|not supported for generateContent/i.test(
    raw,
  );
}
