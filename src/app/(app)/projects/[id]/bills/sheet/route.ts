import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/server/session";
import { billWorkbook } from "@/server/project-bills";

/** The bills sheet for a project: ?kind=template (blank) or ?kind=bills (the bills already added). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return new NextResponse("Not signed in", { status: 401 });
  if (s.role === "viewer") return new NextResponse("Not allowed", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const withBills = req.nextUrl.searchParams.get("kind") === "bills";
  const { buffer, code } = await billWorkbook(s, id, withBills);
  const name = `${code}-${withBills ? "bills" : "bills-template"}${s.book === "sandbox" ? "-TEST" : ""}.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}"` },
  });
}
