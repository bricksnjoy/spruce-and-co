import type { createClient } from "@/lib/supabase/server";
import type { SigningKit } from "@/lib/documents";
import type { Company } from "@/components/sales/ledger-sheet";

/**
 * The company's details and stamp, and every active signatory, with short-lived links to
 * their images — which live in a private bucket.
 */
export async function signingKit(supabase: Awaited<ReturnType<typeof createClient>>): Promise<SigningKit> {
  const [{ data: company }, { data: people }] = await Promise.all([
    supabase.from("company")
      .select("stamp_path, legal_name, trade_name, registration_no, tin, gst_registered, taxable_activity_no, address, phone, email, bank_details")
      .eq("id", true).maybeSingle(),
    supabase.from("signatories").select("id, name, title, signature_path").eq("active", true).order("sort_order").order("name"),
  ]);
  const paths = [company?.stamp_path, ...(people ?? []).map((p) => p.signature_path)].filter(Boolean) as string[];
  const { data: signed } = paths.length
    ? await supabase.storage.from("branding").createSignedUrls(paths, 60 * 60)
    : { data: [] };
  const url = (p: string | null | undefined) => (p ? signed?.find((d) => d.path === p)?.signedUrl ?? null : null);

  return {
    company: (company as Company | null) ?? null,
    stampUrl: url(company?.stamp_path),
    signatories: (people ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      title: p.title,
      signatureUrl: url(p.signature_path),
    })),
  };
}
