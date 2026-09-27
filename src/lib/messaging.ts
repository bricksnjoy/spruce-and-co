/**
 * Sends email through Resend and SMS through Message Owl, using their plain HTTP
 * APIs. Each is switched on by its keys being set in the environment.
 */

export type Channel = "email" | "sms";
export type SendOutcome = { ok: true; id: string | null } | { ok: false; error: string };

export function channelReady(channel: Channel): boolean {
  return channel === "email"
    ? Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
    : Boolean(process.env.MSGOWL_API_KEY && process.env.MSGOWL_SENDER_ID);
}

export const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
/** International format, e.g. +9607771234. */
export const PHONE_RE = /^\+[1-9]\d{6,14}$/;

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function sendEmail(to: string, subject: string, body: string): Promise<SendOutcome> {
  if (!channelReady("email")) return { ok: false, error: "Email is not set up." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        text: body,
        html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${escape(body)}</div>`,
        ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: data.message || `Email service replied ${res.status}.` };
    return { ok: true, id: data.id ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the email service." };
  }
}

const MSGOWL = "https://rest.msgowl.com";
const owlHeaders = () => ({
  Authorization: `AccessKey ${process.env.MSGOWL_API_KEY}`,
  Accept: "application/json",
  "Content-Type": "application/json",
});

/** Pull a readable reason out of whatever shape the error body has. */
function owlError(data: unknown, status: number): string {
  const d = data as { message?: string; error?: string; errors?: unknown } | null;
  if (d?.message) return d.message;
  if (typeof d?.error === "string") return d.error;
  if (d?.errors) return typeof d.errors === "string" ? d.errors : JSON.stringify(d.errors);
  return `SMS service replied ${status}.`;
}

/** `to` is in international form (+9607771234); Message Owl takes it without the +. */
export async function sendSms(to: string, body: string): Promise<SendOutcome> {
  if (!channelReady("sms")) return { ok: false, error: "SMS is not set up." };
  try {
    const res = await fetch(`${MSGOWL}/messages`, {
      method: "POST",
      headers: owlHeaders(),
      body: JSON.stringify({
        recipients: to.replace(/^\+/, ""),
        body,
        sender_id: process.env.MSGOWL_SENDER_ID,
      }),
    });
    const data = (await res.json().catch(() => null)) as { id?: string | number; message_id?: string | number } | null;
    if (!res.ok) return { ok: false, error: owlError(data, res.status) };
    const id = data?.id ?? data?.message_id;
    return { ok: true, id: id == null ? null : String(id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the SMS service." };
  }
}

/** Credit left on the Message Owl account, when it can be read. */
export async function smsBalance(): Promise<string | null> {
  if (!channelReady("sms")) return null;
  try {
    const res = await fetch(`${MSGOWL}/balance`, { headers: owlHeaders(), cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const v = data?.balance ?? (data?.data as Record<string, unknown> | undefined)?.balance;
    return typeof v === "number" || typeof v === "string" ? String(v) : null;
  } catch {
    return null;
  }
}
