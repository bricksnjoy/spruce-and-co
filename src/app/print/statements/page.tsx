import { createClient } from "@/lib/supabase/server";
import { loadStatements } from "@/lib/statements-data";
import { FinancialStatements } from "@/components/financial-statements";
import { PrintToolbar } from "../toolbar";

export const dynamic = "force-dynamic";

export default async function PrintStatements({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year } = await searchParams;
  const supabase = await createClient();
  const data = await loadStatements(supabase, year);
  const name = `Financial Statements 31 December ${data.current.year}`;
  return (
    <>
      <title>{name}</title>
      <PrintToolbar back={`/accounting/statements?year=${data.current.year}`} filename={`${data.company.name} ${name}`} />
      <FinancialStatements data={data} />
    </>
  );
}
