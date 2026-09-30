import { redirect } from "next/navigation";

/** People and employees are one list now. */
export default function PeoplePage() {
  redirect("/payroll/employees");
}
