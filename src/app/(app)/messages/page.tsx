import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, PageHeader, Stat, Table, Th, Td, Empty } from "@/components/ui";
import { channelReady, smsBalance } from "@/lib/messaging";
import { dateTime } from "@/lib/format";
import { Composer, type Contact } from "./composer";

export const dynamic = "force-dynamic";


export default async function MessagesPage() {
  const supabase = await createClient();
  const since = new Date(new Date().getTime() - 30 * 86_400_000).toISOString();
  const count = (channel: string | null, status: string) => {
    let q = supabase.from("messages").select("id", { count: "exact", head: true }).eq("status", status).gte("created_at", since);
    if (channel) q = q.eq("channel", channel);
    return q;
  };
  const [{ count: emails }, { count: texts }, { count: failed }, balance] = await Promise.all([
    count("email", "sent"), count("sms", "sent"), count(null, "failed"), smsBalance(),
  ]);
  const [{ data: history }, { data: clients }, { data: shops }, { data: people }, { data: investors }] = await Promise.all([
    supabase.from("messages")
      .select("id, channel, recipient, recipient_name, subject, body, status, error, created_at, profiles:sent_by(full_name)")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("clients").select("name, contact_name, email, phone").order("name"),
    supabase.from("vendors").select("name, contact_name, email, phone").order("name"),
    supabase.from("people").select("name, email, phone").eq("active", true).order("name"),
    supabase.from("investors").select("name, contact_name, email, phone").order("name"),
  ]);

  const contacts: Contact[] = [];
  const add = (group: Contact["group"], rows: { name: string; contact_name?: string | null; email: string | null; phone: string | null }[] | null) => {
    for (const r of rows ?? []) {
      if (!r.email && !r.phone) continue;
      const name = r.contact_name ? `${r.name} (${r.contact_name})` : r.name;
      contacts.push({ group, name, email: r.email?.trim() || null, phone: r.phone?.trim() || null });
    }
  };
  add("Clients", clients);
  add("Shops", shops);
  add("People", people);
  add("Investors", investors);

  const rows = history ?? [];

  return (
    <div>
      <PageHeader title="Message center" subtitle="Send an SMS or email to anyone, and see what was sent" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Emails · 30 days" value={String(emails ?? 0)} />
        <Stat label="SMS · 30 days" value={String(texts ?? 0)}
          hint={balance != null ? `Message Owl balance: ${balance}` : undefined} />
        <Stat label="Failed · 30 days" value={String(failed ?? 0)}
          tone={failed ? "bad" : "default"} />
        <Stat label="Contacts" value={String(contacts.length)} hint="with a phone or email" />
      </div>

      <Composer contacts={contacts} ready={{ email: channelReady("email"), sms: channelReady("sms") }} />

      <Card className="mt-4">
        <CardHeader title="Sent messages" subtitle="The latest 100" />
        {rows.length === 0 ? <Empty message="Nothing sent yet." /> : (
          <Table>
            <thead><tr>
              <Th>When</Th><Th>To</Th><Th>Message</Th><Th>By</Th><Th right>Status</Th>
            </tr></thead>
            <tbody>
              {rows.map((m) => {
                const by = m.profiles as unknown as { full_name: string } | null;
                return (
                  <tr key={m.id} className="align-top hover:bg-[var(--hover)]">
                    <Td className="whitespace-nowrap text-xs text-[var(--muted)]">{dateTime(m.created_at)}</Td>
                    <Td>
                      <span className="mr-1.5 rounded bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--brand)]">
                        {m.channel === "sms" ? "SMS" : "Email"}
                      </span>
                      <span className="text-sm">{m.recipient_name || m.recipient}</span>
                      {m.recipient_name && <span className="block text-xs text-[var(--muted)]">{m.recipient}</span>}
                    </Td>
                    <Td className="max-w-md">
                      {m.subject && <span className="block text-sm font-medium">{m.subject}</span>}
                      <span className="line-clamp-2 text-xs text-[var(--muted)]" title={m.body}>{m.body}</span>
                    </Td>
                    <Td className="text-xs text-[var(--muted)]">{by?.full_name ?? "—"}</Td>
                    <Td right>
                      {m.status === "sent" ? (
                        <span className="text-xs font-medium text-emerald-700">Sent</span>
                      ) : (
                        <span className="text-xs font-medium text-red-700" title={m.error ?? ""}>Failed</span>
                      )}
                      {m.status === "failed" && m.error && (
                        <span className="block max-w-[200px] text-[11px] text-[var(--muted)]">{m.error}</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
