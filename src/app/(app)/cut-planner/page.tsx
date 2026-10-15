import { PageHeader } from "@/components/ui";
import { CutPlanner } from "./planner";

export default function CutPlannerPage() {
  return (
    <div>
      <PageHeader
        title="Board cut planner"
        subtitle="List the parts of a piece of furniture and see how they come out of 8 × 4 ft boards, and how many boards you need"
      />
      <CutPlanner />
    </div>
  );
}
