import { redirect } from "next/navigation";

/** Salaries are paid through payroll runs now. */
export default function SalariesPage() {
  redirect("/payroll");
}
