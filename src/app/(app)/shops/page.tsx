import { redirect } from "next/navigation";

/** Shops and vendors are one list now. */
export default function ShopsPage() {
  redirect("/expenses/vendors");
}
