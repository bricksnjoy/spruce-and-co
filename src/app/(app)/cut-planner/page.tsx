import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/server/session";
import { loadCutList } from "@/app/actions/cut-list";
import { CutPlanner } from "./planner";

export const dynamic = "force-dynamic";

export default async function CutPlannerPage() {
  if (!(await getSession())) redirect("/login");
  const initial = await loadCutList();
  return (
    <div>
      <PageHeader
        title="Board cut planner"
        subtitle="List the parts of a piece of furniture and see how they come out of 8 × 4 ft boards, and how many boards you need"
      />
      <CutPlanner initial={initial} />
    </div>
  );
}
