import { redirect } from "next/navigation";

/** Clients and customers are one list now. */
export default function ClientsPage() {
  redirect("/sales/customers");
}
