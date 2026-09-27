/**
 * Sends email through Resend and SMS through Twilio, using their plain HTTP
 * APIs. Each is switched on by its keys being set in the environment.
 */

export type Channel = "email" | "sms";
export type SendOutcome = { ok: true; id: string | null } | { ok: false; error: string };

export function channelReady(channel: Channel): boolean {
  return channel === "email"
    ? Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
    : Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
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

export async function sendSms(to: string, body: string): Promise<SendOutcome> {
  if (!channelReady("sms")) return { ok: false, error: "SMS is not set up." };
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: body }),
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) return { ok: false, error: data.message || `SMS service replied ${res.status}.` };
    return { ok: true, id: data.sid ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the SMS service." };
  }
}
