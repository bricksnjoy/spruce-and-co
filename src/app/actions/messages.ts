"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { EMAIL_RE, PHONE_RE, sendEmail, sendSms, type Channel } from "@/lib/messaging";

export type MessageResult = {
  error?: string;
  ok?: boolean;
  sent?: number;
  failed?: { to: string; error: string }[];
};

export interface Recipient {
  to: string;
  name?: string | null;
}

const MAX_RECIPIENTS = 50;

/** Numbers are typed every which way; keep the digits and a leading +. */
function tidyPhone(raw: string): string {
  const t = raw.replace(/[\s\-().]/g, "");
  if (t.startsWith("00")) return `+${t.slice(2)}`;
  // a bare 7-digit Maldivian number
  if (/^\d{7}$/.test(t)) return `+960${t}`;
  return t;
}

export async function sendMessage(input: {
  channel: Channel;
  recipients: Recipient[];
  subject?: string;
  body: string;
}): Promise<MessageResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!me || me.role === "viewer") return { error: "Only staff who can make changes can send messages." };

  const channel = input.channel;
  if (channel !== "email" && channel !== "sms") return { error: "Choose email or SMS." };
  const body = input.body?.trim();
  if (!body) return { error: "Write the message." };
  const subject = input.subject?.trim() ?? "";
  if (channel === "email" && !subject) return { error: "Give the email a subject." };
  if (channel === "sms" && body.length > 1600) return { error: "That's too long for an SMS (1600 characters at most)." };

  // tidy, check and de-duplicate the addresses
  const seen = new Set<string>();
  const list: Recipient[] = [];
  for (const r of input.recipients ?? []) {
    const to = channel === "sms" ? tidyPhone(r.to) : r.to.trim().toLowerCase();
    if (!to || seen.has(to)) continue;
    const valid = channel === "sms" ? PHONE_RE.test(to) : EMAIL_RE.test(to);
    if (!valid) return { error: `"${r.to}" is not a valid ${channel === "sms" ? "phone number" : "email address"}.` };
    seen.add(to);
    list.push({ to, name: r.name?.trim() || null });
  }
  if (!list.length) return { error: "Add at least one recipient." };
  if (list.length > MAX_RECIPIENTS) return { error: `Send to ${MAX_RECIPIENTS} people at most at a time.` };

  const results = await Promise.all(
    list.map(async (r) => ({ r, out: channel === "sms" ? await sendSms(r.to, body) : await sendEmail(r.to, subject, body) })),
  );

  const { error: logError } = await supabase.from("messages").insert(
    results.map(({ r, out }) => ({
      channel,
      recipient: r.to,
      recipient_name: r.name,
      subject: channel === "email" ? subject : null,
      body,
      status: out.ok ? "sent" : "failed",
      error: out.ok ? null : out.error,
      provider_id: out.ok ? out.id : null,
      sent_by: user.id,
    })),
  );

  revalidatePath("/messages");
  const failed = results.filter((x) => !x.out.ok).map(({ r, out }) => ({ to: r.to, error: out.ok ? "" : out.error }));
  const sent = results.length - failed.length;
  if (!sent) return { error: failed[0]?.error ?? "Nothing was sent.", failed };
  return { ok: true, sent, failed, ...(logError ? { error: `Sent, but not saved to history: ${logError.message}` } : {}) };
}
