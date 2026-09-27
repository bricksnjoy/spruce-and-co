"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui";
import { sendMessage, type MessageResult, type Recipient } from "@/app/actions/messages";

export interface Contact {
  group: "Clients" | "Shops" | "People" | "Investors";
  name: string;
  email: string | null;
  phone: string | null;
}

type Channel = "email" | "sms";

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";
const label = "mb-1.5 block text-xs font-medium text-[var(--muted)]";

/** An SMS is billed per 160-character part (70 if it has non-Latin letters). */
function smsParts(body: string) {
  const unicode = /[^\u0000-\u007f]/.test(body);
  const one = unicode ? 70 : 160;
  const many = unicode ? 67 : 153;
  if (body.length <= one) return { parts: body ? 1 : 0, unicode };
  return { parts: Math.ceil(body.length / many), unicode };
}

export function Composer({ contacts, ready }: { contacts: Contact[]; ready: Record<Channel, boolean> }) {
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>("email");
  const [to, setTo] = useState<Recipient[]>([]);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<MessageResult | null>(null);
  const [pending, start] = useTransition();

  const addressOf = (c: Contact) => (channel === "email" ? c.email : c.phone);
  const matches = useMemo(() => {
    const n = search.trim().toLowerCase();
    if (!n) return [];
    return contacts
      .filter((c) => addressOf(c) && (c.name.toLowerCase().includes(n) || (addressOf(c) ?? "").toLowerCase().includes(n)))
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, contacts, channel]);

  const addRecipient = (r: Recipient) => {
    const key = r.to.trim().toLowerCase();
    if (!key) return;
    setTo((list) => (list.some((x) => x.to.trim().toLowerCase() === key) ? list : [...list, { to: r.to.trim(), name: r.name }]));
  };
  /** Split what was typed or pasted on commas, semicolons, spaces or new lines. */
  const addTyped = () => {
    const parts = typed.split(channel === "email" ? /[\s,;]+/ : /[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    parts.forEach((p) => addRecipient({ to: p }));
    setTyped("");
  };

  const switchChannel = (c: Channel) => {
    if (c === channel) return;
    setChannel(c);
    setTo([]);
    setResult(null);
  };

  const submit = () => {
    const pendingTyped = typed.trim()
      ? typed.split(channel === "email" ? /[\s,;]+/ : /[,;\n]+/).map((s) => ({ to: s.trim() })).filter((r) => r.to)
      : [];
    const recipients = [...to, ...pendingTyped];
    start(async () => {
      const r = await sendMessage({ channel, recipients, subject, body });
      setResult(r);
      if (r.ok) {
        setTo([]);
        setTyped("");
        setBody("");
        setSubject("");
        router.refresh();
      }
    });
  };

  const sms = smsParts(body);
  const notReady = !ready[channel];

  return (
    <Card>
      <CardHeader title="New message"
        action={
          <div role="group" aria-label="Channel"
            className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--field)] p-0.5 text-xs font-medium">
            {(["email", "sms"] as const).map((c) => (
              <button key={c} type="button" onClick={() => switchChannel(c)} aria-pressed={channel === c}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  channel === c ? "bg-[var(--brand)] text-white" : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}>
                {c === "email" ? "Email" : "SMS"}
              </button>
            ))}
          </div>
        } />

      <div className="space-y-4 px-5 py-4">
        {notReady && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {channel === "email" ? (
              <>Email isn&apos;t connected yet. Add <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> (e.g. <code>Spruce &amp; Co &lt;office@yourdomain.com&gt;</code>) in Vercel → Settings → Environment Variables, then redeploy.</>
            ) : (
              <>SMS isn&apos;t connected yet. Add <code>MSGOWL_API_KEY</code> (from the Message Owl console → API keys) and <code>MSGOWL_SENDER_ID</code> (your approved sender name) in Vercel → Settings → Environment Variables, then redeploy.</>
            )}
          </div>
        )}

        <div>
          <label className={label} htmlFor="m-to">To</label>
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--field)] px-2 py-1.5 focus-within:border-[var(--brand)]">
            {to.map((r) => (
              <span key={r.to} className="inline-flex items-center gap-1 rounded-md bg-[var(--brand-soft)] px-2 py-0.5 text-xs">
                {r.name ? <><b className="font-medium">{r.name}</b> <span className="text-[var(--muted)]">{r.to}</span></> : r.to}
                <button type="button" aria-label={`Remove ${r.to}`} onClick={() => setTo((l) => l.filter((x) => x.to !== r.to))}
                  className="ml-0.5 text-[var(--muted)] hover:text-red-700">×</button>
              </span>
            ))}
            <input id="m-to" value={typed} onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "," || e.key === ";") { e.preventDefault(); addTyped(); }
                else if (e.key === "Backspace" && !typed && to.length) setTo((l) => l.slice(0, -1));
              }}
              onBlur={addTyped}
              placeholder={to.length ? "" : channel === "email" ? "Type any email address and press Enter" : "Type any number, e.g. 7771234 or +9607771234"}
              className="min-w-[220px] flex-1 bg-transparent px-1 py-1 text-sm outline-none" />
          </div>
          {channel === "sms" && (
            <p className="mt-1 text-[11px] text-[var(--muted)]">7-digit numbers are taken as Maldivian (+960). Use + and the country code for others.</p>
          )}
        </div>

        <div className="relative">
          <label className={label} htmlFor="m-find">Or add from contacts</label>
          <input id="m-find" value={search} onChange={(e) => setSearch(e.target.value)} className={input}
            placeholder="Search clients, shops, people, investors…" autoComplete="off" />
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--field)] py-1 shadow-lg">
              {matches.map((c, i) => (
                <li key={`${c.group}-${c.name}-${i}`}>
                  <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--hover)]"
                    onClick={() => { addRecipient({ to: addressOf(c)!, name: c.name }); setSearch(""); }}>
                    <span>{c.name} <span className="text-xs text-[var(--muted)]">· {c.group}</span></span>
                    <span className="text-xs text-[var(--muted)]">{addressOf(c)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {channel === "email" && (
          <div>
            <label className={label} htmlFor="m-subject">Subject</label>
            <input id="m-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={input} />
          </div>
        )}

        <div>
          <label className={label} htmlFor="m-body">Message</label>
          <textarea id="m-body" value={body} onChange={(e) => setBody(e.target.value)} rows={channel === "sms" ? 4 : 8} className={input} />
          {channel === "sms" && (
            <p className="mt-1 text-right text-[11px] text-[var(--muted)]">
              {body.length} characters · {sms.parts} SMS part{sms.parts === 1 ? "" : "s"}{sms.unicode ? " (non-Latin letters: 70 per part)" : ""}
            </p>
          )}
        </div>

        {result?.error && <p className="text-sm text-red-700">{result.error}</p>}
        {result?.ok && (
          <p className="text-sm text-emerald-700">
            Sent to {result.sent} recipient{result.sent === 1 ? "" : "s"}.
            {result.failed?.length ? <span className="text-red-700"> {result.failed.length} failed: {result.failed.map((f) => `${f.to} (${f.error})`).join(", ")}</span> : null}
          </p>
        )}

        <div className="flex items-center justify-between border-t border-[var(--border)] pt-4">
          <p className="text-xs text-[var(--muted)]">
            {to.length} recipient{to.length === 1 ? "" : "s"} · each gets their own copy
          </p>
          <button type="button" onClick={submit} disabled={pending || notReady}
            className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
            {pending ? "Sending…" : channel === "email" ? "Send email" : "Send SMS"}
          </button>
        </div>
      </div>
    </Card>
  );
}
