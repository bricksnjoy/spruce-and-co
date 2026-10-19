import { PageSkeleton } from "@/components/skeleton";

export default function Loading() {
  return <PageSkeleton stats={0} rows={8} />;
}
