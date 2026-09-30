import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { getSession } from "@/server/session";
import { AREAS, HELP } from "@/lib/help";
import { OLD_SCREENS } from "@/lib/nav";

export const dynamic = "force-dynamic";

const href = (path: string) => (path.includes("[") ? null : path);

/** How to use every page, one section each. */
export default async function HelpPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="Help" subtitle="How to use every page. Each page also has this in a box at its top." />
      <Card className="px-5 py-4 text-sm">
        <p className="mb-2 font-medium">Pages</p>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
          {AREAS.map((a) => (
            <div key={a} className="mb-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{a}</p>
              {HELP.filter((h) => h.area === a).map((h) => (
                <a key={h.path} href={`#${encodeURIComponent(h.path)}`} className="block text-[var(--brand)] hover:underline">{h.title}</a>
              ))}
            </div>
          ))}
        </div>
      </Card>
      {HELP.map((h) => (
        <Card key={h.path}>
          <div id={encodeURIComponent(h.path)} className="scroll-mt-4">
            <CardHeader title={h.title} subtitle={h.area}
              action={href(h.path) ? <Link href={h.path} className="text-xs font-medium text-[var(--brand)] hover:underline">Open →</Link> : undefined} />
          </div>
          <div className="space-y-2 px-5 py-4 text-sm">
            <p>{h.purpose}</p>
            <ol className="list-decimal space-y-1 pl-5">{h.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
            {h.tips?.map((t, i) => <p key={i} className="text-xs text-[var(--muted)]">Tip: {t}</p>)}
          </div>
        </Card>
      ))}
      {s.book === "live" && (
        <Card>
          <CardHeader title="Old screens (off the menu)" subtitle="Kept, Live only, so old figures can be checked before the switch-over" />
          <ul className="divide-y divide-[var(--border)] text-sm">
            {OLD_SCREENS.map((o) => (
              <li key={o.href} className="flex flex-wrap justify-between gap-2 px-5 py-2">
                <Link href={o.href} className="text-[var(--brand)] hover:underline">{o.label}</Link>
                <span className="text-xs text-[var(--muted)]">replaced by <Link href={o.replacedBy[0]} className="hover:underline">{o.replacedBy[1]}</Link></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
