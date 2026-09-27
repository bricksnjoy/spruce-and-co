import type { ReactNode } from "react";
import type { StatementsData } from "@/lib/statements-data";

/**
 * The financial statements laid out as A4 pages, the way the auditors'
 * samples are: this year beside last, a notes column, amounts in rufiyaa with
 * brackets for negatives, the board's approval and a page number on each.
 */

const fmt = (v: number) => {
  const r = Math.round(v);
  if (r === 0) return "-";
  const s = Math.abs(r).toLocaleString("en-US");
  return r < 0 ? `(${s})` : s;
};

const NOTES_FROM = 5;
const NOTES_TO = 7;

type RowKind = "item" | "head" | "sub" | "total" | "gap";

function Row({ label, note, a, b, kind = "item", indent }: { label?: ReactNode; note?: number | string; a?: number; b?: number; kind?: RowKind; indent?: boolean }) {
  if (kind === "gap") return <tr><td colSpan={4} className="h-3" /></tr>;
  if (kind === "head") {
    return (
      <tr>
        <td colSpan={4} className="pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide">{label}</td>
      </tr>
    );
  }
  const strong = kind === "sub" || kind === "total";
  const line = kind === "sub" ? "border-t border-black" : kind === "total" ? "border-t border-black border-b-[3px] border-b-black border-double" : "";
  return (
    <tr className={strong ? "font-semibold" : ""}>
      <td className={`py-[3px] ${indent ? "pl-4" : ""}`}>{label}</td>
      <td className="w-12 py-[3px] text-center">{note ?? ""}</td>
      <td className="w-32 py-[3px] pl-2 text-right tabular-nums"><span className={`block ${line}`}>{a === undefined ? "" : fmt(a)}</span></td>
      <td className="w-32 py-[3px] pl-2 text-right tabular-nums"><span className={`block ${line}`}>{b === undefined ? "" : fmt(b)}</span></td>
    </tr>
  );
}

function Note({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="mb-4 break-inside-avoid">
      <p className="mb-1 font-bold">{n}. {title}</p>
      {children}
    </div>
  );
}

function Sheet({ data, title, sub, page, children, sign, noFooterNote, dense }: {
  data: StatementsData;
  title: string;
  sub: string;
  page: number;
  children: ReactNode;
  sign?: boolean;
  noFooterNote?: boolean;
  dense?: boolean;
}) {
  const { current } = data;
  return (
    <section className={`doc-sheet mx-auto mb-6 flex min-h-[297mm] w-[210mm] max-w-full flex-col bg-white px-[18mm] pb-[12mm] pt-[16mm] text-[12px] leading-snug text-black shadow-[0_2px_12px_rgba(0,0,0,0.12)] print:mb-0 print:break-after-page print:last:break-after-auto ${dense ? "[&_td]:py-px" : ""}`}
      style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
      <header className="mb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[14px] font-bold">{data.company.name}</p>
            <p className="text-[13px] font-bold">{title}</p>
            <p className="font-semibold">{sub}</p>
            <p className="mt-0.5 text-[11px] italic">(All Amounts in Maldivian Rufiyaa Unless Otherwise Stated)</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- a plain img prints reliably */}
          <img src="/logo-mark.png" alt="Spruce & Co" className="h-[18mm] w-[18mm] shrink-0 object-contain" />
        </div>
        {current.toDate && !noFooterNote && (
          <p className="mt-2 border border-black px-2 py-1 text-[10px]">
            Draft — the year is not over. Figures are to date and will change until 31 December {current.year}.
          </p>
        )}
      </header>
      <div className="flex-1">{children}</div>
      {sign && (
        <div className="mt-8 text-[12px]">
          <p>These financial statements were approved by the Board of Directors on ………………………………</p>
          <div className="mt-14 w-64 border-t border-dotted border-black pt-1">
            <p className="font-semibold">Managing Director</p>
            <p>{data.company.name}</p>
          </div>
        </div>
      )}
      <footer className="mt-6 flex items-end justify-between text-[10px]">
        <span className="italic">{noFooterNote ? "" : `The notes on pages ${NOTES_FROM} to ${NOTES_TO} are an integral part of these financial statements.`}</span>
        <span className="ml-4 shrink-0">Page {page}</span>
      </footer>
    </section>
  );
}

function Columns({ a, b, first = "" }: { a: StatementsData["current"]; b: StatementsData["prior"]; first?: string }) {
  return (
    <thead>
      <tr className="text-[11px] font-bold">
        <th className="text-left font-bold">{first}</th>
        <th className="w-12 text-center">Notes</th>
        <th className="w-32 pl-2 text-right">31 Dec {a.year}</th>
        <th className="w-32 pl-2 text-right">31 Dec {b.year}</th>
      </tr>
    </thead>
  );
}

export function FinancialStatements({ data }: { data: StatementsData }) {
  const c = data.current;
  const p = data.prior;
  const cp = c.position;
  const pp = p.position;
  const T = "w-full border-collapse";

  // the equity statement: a column per part of equity, a year per block
  const eqBlock = (y: typeof c) => {
    const e = y.equity;
    const capital = e.introduced + e.kept + e.drawn + e.otherCap;
    const retained = e.profit + e.shares + e.opening;
    return { e, capital, retained, share: e.shareIn };
  };
  const eqRow = (label: ReactNode, v: [number, number, number], kind: "item" | "total" = "item") => {
    const line = kind === "total" ? "border-t border-black border-b-[3px] border-double border-b-black" : "";
    return (
      <tr className={kind === "total" ? "font-semibold" : ""}>
        <td className="py-[3px]">{label}</td>
        {[...v, v[0] + v[1] + v[2]].map((x, i) => (
          <td key={i} className="w-28 py-[3px] pl-2 text-right tabular-nums"><span className={`block ${line}`}>{fmt(x)}</span></td>
        ))}
      </tr>
    );
  };
  const eq = (y: typeof c, prev: typeof p | null) => {
    const b = eqBlock(y);
    const open = prev ? prev.position.equity : y.opening.equity;
    return (
      <>
        {eqRow(<span className="font-semibold">Balance at 1 January {y.year}</span>, [open.share, open.capital, open.retained])}
        {eqRow("Profit for the year", [0, 0, b.e.profit])}
        {eqRow("Other comprehensive income", [0, 0, 0])}
        {Math.abs(b.e.opening) > 0.5 && eqRow("Opening balance brought in", [0, 0, b.e.opening])}
        {eqRow("Profit shares to partners and investors", [0, 0, b.e.shares])}
        {Math.abs(b.share) > 0.5 && eqRow("Shares issued", [b.share, 0, 0])}
        {eqRow("Capital introduced by partners", [0, b.e.introduced, 0])}
        {eqRow("Profit shares kept as capital", [0, b.e.kept, 0])}
        {eqRow("Drawings by partners", [0, b.e.drawn, 0])}
        {Math.abs(b.e.otherCap) > 0.5 && eqRow("Other capital movements", [0, b.e.otherCap, 0])}
        {eqRow(`Balance at 31 December ${y.year}`, [y.position.equity.share, y.position.equity.capital, y.position.equity.retained], "total")}
      </>
    );
  };

  const cfRows = (label: string, a: number, b: number, opts: { note?: number; kind?: RowKind; indent?: boolean } = {}) =>
    <Row label={label} a={a} b={b} note={opts.note} kind={opts.kind} indent={opts.indent} />;
  const cc = c.cashflow;
  const pc = p.cashflow;
  const flowLines = (a: [string, number][], b: [string, number][]) => {
    const keys = [...new Set([...a.map(([k]) => k), ...b.map(([k]) => k)])];
    const get = (rows: [string, number][], k: string) => rows.find(([x]) => x === k)?.[1] ?? 0;
    return keys.map((k) => <Row key={k} label={k} a={get(a, k)} b={get(b, k)} indent />);
  };

  // notes: this year's breakdown beside last year's, by name
  const noteTable = (a: [string, number][], b: [string, number][], total: string, max = 10) => {
    const keys = [...new Set([...a.map(([k]) => k), ...b.map(([k]) => k)])];
    const get = (rows: [string, number][], k: string) => rows.find(([x]) => x === k)?.[1] ?? 0;
    const rows = keys.map((k) => [k, get(a, k), get(b, k)] as const).sort((x, y) => Math.abs(y[1]) + Math.abs(y[2]) - Math.abs(x[1]) - Math.abs(x[2]));
    const shown = rows.slice(0, max);
    const rest = rows.slice(max);
    const sa = a.reduce((s, [, v]) => s + v, 0);
    const sb = b.reduce((s, [, v]) => s + v, 0);
    return (
      <table className={T}>
        <tbody>
          {shown.map(([k, x, y]) => <Row key={k} label={k} a={x} b={y} />)}
          {rest.length > 0 && <Row label={`Other (${rest.length})`} a={rest.reduce((s, r) => s + r[1], 0)} b={rest.reduce((s, r) => s + r[2], 0)} />}
          {!rows.length && <Row label="None" a={0} b={0} />}
          <Row label={total} a={sa} b={sb} kind="total" />
        </tbody>
      </table>
    );
  };
  const noteHead = <table className={T}><Columns a={c} b={p} /></table>;

  const payablesA = cp.liabilities.payables + cp.liabilities.gst + cp.liabilities.advances;
  const payablesB = pp.liabilities.payables + pp.liabilities.gst + pp.liabilities.advances;
  const s = data.settings;

  return (
    <div>
      {/* 1 — Statement of Financial Position */}
      <Sheet data={data} page={1} title="Statement of Financial Position" sub={`As at 31 December ${c.year}`} sign>
        <table className={T}>
          <Columns a={c} b={p} />
          <tbody>
            <Row kind="head" label="Assets" />
            <Row kind="head" label="Non-current assets" />
            <Row label="Property, plant and equipment" note={7} a={cp.assets.ppe} b={pp.assets.ppe} />
            <Row label="Total non-current assets" a={cp.assets.ppe} b={pp.assets.ppe} kind="sub" />
            <Row kind="head" label="Current assets" />
            <Row label="Work in progress" note={8} a={cp.assets.wip} b={pp.assets.wip} />
            <Row label="Trade and other receivables" note={9} a={cp.assets.receivables} b={pp.assets.receivables} />
            <Row label="Cash and cash equivalents" note={10} a={cp.assets.cash} b={pp.assets.cash} />
            <Row label="Total current assets" a={cp.assets.wip + cp.assets.receivables + cp.assets.cash} b={pp.assets.wip + pp.assets.receivables + pp.assets.cash} kind="sub" />
            <Row label="Total assets" a={cp.totalAssets} b={pp.totalAssets} kind="total" />
            <Row kind="gap" />
            <Row kind="head" label="Equity and liabilities" />
            <Row kind="head" label="Equity" />
            <Row label="Share capital" note={11} a={cp.equity.share} b={pp.equity.share} />
            <Row label="Partners' capital" note={12} a={cp.equity.capital} b={pp.equity.capital} />
            <Row label="Retained earnings" a={cp.equity.retained} b={pp.equity.retained} />
            <Row label="Total equity" a={cp.equity.total} b={pp.equity.total} kind="sub" />
            <Row kind="head" label="Current liabilities" />
            <Row label="Trade and other payables" note={13} a={payablesA} b={payablesB} />
            <Row label="Due to partners and investors" note={14} a={cp.liabilities.due} b={pp.liabilities.due} />
            <Row label="Bank overdraft" note={10} a={cp.liabilities.overdraft} b={pp.liabilities.overdraft} />
            <Row label="Income tax payable" note={6} a={cp.liabilities.tax} b={pp.liabilities.tax} />
            <Row label="Total current liabilities" a={cp.totalLiabilities} b={pp.totalLiabilities} kind="sub" />
            <Row label="Total liabilities" a={cp.totalLiabilities} b={pp.totalLiabilities} kind="sub" />
            <Row label="Total equity and liabilities" a={cp.equity.total + cp.totalLiabilities} b={pp.equity.total + pp.totalLiabilities} kind="total" />
          </tbody>
        </table>
      </Sheet>

      {/* 2 — Statement of Comprehensive Income */}
      <Sheet data={data} page={2} title="Statement of Comprehensive Income" sub={`For the year ended 31 December ${c.year}`}>
        <table className={T}>
          <Columns a={c} b={p} />
          <tbody>
            <Row label="Revenue" note={2} a={c.performance.revenue} b={p.performance.revenue} />
            <Row label="Cost of sales" note={3} a={-c.performance.cogs} b={-p.performance.cogs} />
            <Row label="Gross profit" a={c.performance.gross} b={p.performance.gross} kind="sub" />
            <Row kind="gap" />
            <Row label="Administrative expenses" note={4} a={-c.performance.admin} b={-p.performance.admin} />
            <Row label="Operating profit" a={c.performance.operating} b={p.performance.operating} kind="sub" />
            <Row kind="gap" />
            <Row label="Finance costs" note={5} a={-c.performance.finance} b={-p.performance.finance} />
            <Row label="Profit before tax" a={c.performance.pbt} b={p.performance.pbt} kind="sub" />
            <Row label="Income tax expense" note={6} a={-c.performance.tax} b={-p.performance.tax} />
            <Row label="Profit for the year" a={c.performance.pat} b={p.performance.pat} kind="sub" />
            <Row kind="gap" />
            <Row label="Other comprehensive income" a={0} b={0} />
            <Row label="Total comprehensive income for the year" a={c.performance.pat} b={p.performance.pat} kind="total" />
          </tbody>
        </table>
      </Sheet>

      {/* 3 — Statement of Changes in Equity */}
      <Sheet data={data} page={3} title="Statement of Changes in Equity" sub={`For the year ended 31 December ${c.year}`}>
        <table className={T}>
          <thead>
            <tr className="align-bottom text-[11px] font-bold">
              <th />
              <th className="w-28 pl-2 text-right">Share capital</th>
              <th className="w-28 pl-2 text-right">Partners&apos; capital</th>
              <th className="w-28 pl-2 text-right">Retained earnings</th>
              <th className="w-28 pl-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {eq(p, null)}
            <tr><td colSpan={5} className="h-5" /></tr>
            {eq(c, p)}
          </tbody>
        </table>
      </Sheet>

      {/* 4 — Statement of Cash Flows */}
      <Sheet data={data} page={4} title="Statement of Cash Flows" sub={`For the year ended 31 December ${c.year}`}>
        <table className={T}>
          <Columns a={c} b={p} />
          <tbody>
            <Row kind="head" label="Cash flows from operating activities" />
            {cfRows("Profit before tax", cc.pbt, pc.pbt)}
            <Row label="Adjustments for:" />
            {cfRows("Depreciation", cc.depreciation, pc.depreciation, { note: 7, indent: true })}
            {cfRows("Finance costs", cc.finance, pc.finance, { note: 5, indent: true })}
            {cfRows("Operating profit before working capital changes", cc.adjusted, pc.adjusted, { kind: "sub" })}
            <Row label="Changes in working capital:" />
            {cfRows("(Increase) / decrease in work in progress", cc.dWip, pc.dWip, { indent: true })}
            {cfRows("(Increase) / decrease in receivables", cc.dAr, pc.dAr, { indent: true })}
            {cfRows("Increase / (decrease) in payables", cc.dPay, pc.dPay, { indent: true })}
            {cfRows("Increase / (decrease) in GST payable", cc.dGst, pc.dGst, { indent: true })}
            {cfRows("Income tax paid", cc.dTax, pc.dTax, { indent: true })}
            {(Math.abs(cc.other) > 0.5 || Math.abs(pc.other) > 0.5) && cfRows("Other movements", cc.other, pc.other, { indent: true })}
            {cfRows("Net cash from operating activities", cc.operating, pc.operating, { kind: "sub" })}
            <Row kind="gap" />
            <Row kind="head" label="Cash flows from investing activities" />
            {flowLines(cc.investingLines, pc.investingLines)}
            {cfRows("Net cash used in investing activities", cc.investing, pc.investing, { kind: "sub" })}
            <Row kind="gap" />
            <Row kind="head" label="Cash flows from financing activities" />
            {flowLines(cc.financingLines, pc.financingLines)}
            {cfRows("Net cash from / (used in) financing activities", cc.financing, pc.financing, { kind: "sub" })}
            <Row kind="gap" />
            {cfRows("Net increase / (decrease) in cash and cash equivalents", cc.net, pc.net, { kind: "sub" })}
            {cfRows("Cash and cash equivalents at 1 January", cc.opening, pc.opening)}
            {cfRows("Cash and cash equivalents at 31 December", cc.closing, pc.closing, { note: 10, kind: "total" })}
          </tbody>
        </table>
      </Sheet>

      {/* 5 — Notes: policies, revenue and cost of sales */}
      <Sheet data={data} page={5} title="Notes to the Financial Statements" sub={`For the year ended 31 December ${c.year}`} noFooterNote dense>
        <Note n={1} title="Basis of preparation and accounting policies">
          <div className="space-y-1.5 text-[11px]">
            <p>
              {data.company.name} is a private limited company incorporated in the Maldives
              {data.company.registration ? ` (registration ${data.company.registration})` : ""}, carrying out interior fit-out and joinery
              work. These statements are prepared on the accrual basis in Maldivian Rufiyaa from the company&apos;s own records of projects, bills,
              invoices, salaries, partners&apos; capital and profit shares.
            </p>
            <p><b>Revenue</b> is recognised when a project is completed, or when an invoice for it is issued. The value of a project includes its
              approved variations.</p>
            <p><b>Work in progress</b> is the cost of materials, labour and site costs on projects not yet earned. It passes to cost of sales in step
              with the revenue earned on each project, and in full on completion.</p>
            <p><b>Property, plant and equipment</b> is stated at cost less depreciation, charged evenly over {s.asset_life_years} years.</p>
            <p><b>Profit shares</b> to partners and investors are appropriations of profit, not expenses. Those kept in the business are added to
              partners&apos; capital; those not yet settled are shown as due to partners and investors.</p>
            <p><b>Income tax</b> is an estimate of business profit tax at {s.bpt_rate}% of taxable profit above MVR {s.bpt_threshold.toLocaleString("en-US")}
              {" "}each year, before any adjustments made in the return.</p>
            <p><b>GST</b>{s.gst_registered ? " is charged at 8% and collected on behalf of the MIRA; revenue is shown net of it." : ": the company is not registered, so revenue and costs are shown including any GST paid."}</p>
          </div>
        </Note>
        {noteHead}
        <Note n={2} title="Revenue — by project">{noteTable(c.notes.revenue, p.notes.revenue, "Total revenue", 8)}</Note>
        <Note n={3} title="Cost of sales">{noteTable(c.notes.cogs, p.notes.cogs, "Total cost of sales", 8)}</Note>
      </Sheet>

      {/* 6 — Notes: the rest of the income statement, and assets */}
      <Sheet data={data} page={6} title="Notes to the Financial Statements (continued)" sub={`For the year ended 31 December ${c.year}`} noFooterNote dense>
        {noteHead}
        <Note n={4} title="Administrative expenses">{noteTable(c.notes.admin, p.notes.admin, "Total administrative expenses", 8)}</Note>
        <Note n={5} title="Finance costs">{noteTable(c.notes.finance, p.notes.finance, "Total finance costs", 4)}</Note>
        <Note n={6} title="Income tax">
          <table className={T}>
            <tbody>
              <Row label="Profit before tax" a={c.performance.pbt} b={p.performance.pbt} />
              <Row label={`Tax-free threshold`} a={-Math.min(Math.max(0, c.performance.pbt), s.bpt_threshold)} b={-Math.min(Math.max(0, p.performance.pbt), s.bpt_threshold)} />
              <Row label={`Business profit tax at ${s.bpt_rate}% (estimate)`} a={c.performance.tax} b={p.performance.tax} kind="total" />
            </tbody>
          </table>
        </Note>
        <Note n={7} title="Property, plant and equipment">
          <table className={T}>
            <tbody>
              <Row label="Cost" a={cp.ppeCost} b={pp.ppeCost} />
              <Row label="Accumulated depreciation" a={-cp.accdep} b={-pp.accdep} />
              <Row label="Carrying amount" a={cp.assets.ppe} b={pp.assets.ppe} kind="total" />
            </tbody>
          </table>
        </Note>
        <Note n={8} title="Work in progress — costs on projects not yet earned">{noteTable(c.notes.wip, p.notes.wip, "Total work in progress", 8)}</Note>
      </Sheet>

      {/* 7 — Notes: the rest of the balance sheet */}
      <Sheet data={data} page={7} title="Notes to the Financial Statements (continued)" sub={`As at 31 December ${c.year}`} noFooterNote dense>
        {noteHead}
        <Note n={9} title="Trade and other receivables">{noteTable(c.notes.receivables.filter(([, v]) => v > 0), p.notes.receivables.filter(([, v]) => v > 0), "Total receivables", 6)}</Note>
        <Note n={10} title="Cash and cash equivalents">
          <table className={T}>
            <tbody>
              <Row label="Cash at bank and in hand" a={cp.assets.cash} b={pp.assets.cash} />
              <Row label="Bank overdraft" a={-cp.liabilities.overdraft} b={-pp.liabilities.overdraft} />
              <Row label="Net cash and cash equivalents" a={cc.closing} b={pc.closing} kind="total" />
            </tbody>
          </table>
        </Note>
        <Note n={11} title="Share capital">
          <table className={T}>
            <tbody>
              <Row label="Issued and fully paid" a={cp.equity.share} b={pp.equity.share} kind="total" />
            </tbody>
          </table>
        </Note>
        <Note n={12} title="Partners' capital">{noteTable(c.notes.capital, p.notes.capital, "Total partners' capital", 6)}</Note>
        <Note n={13} title="Trade and other payables">
          <table className={T}>
            <tbody>
              <Row label="Trade payables" a={cp.liabilities.payables} b={pp.liabilities.payables} />
              <Row label="GST payable" a={cp.liabilities.gst} b={pp.liabilities.gst} />
              <Row label="Advances from customers" a={cp.liabilities.advances} b={pp.liabilities.advances} />
              <Row label="Total trade and other payables" a={payablesA} b={payablesB} kind="total" />
            </tbody>
          </table>
        </Note>
        <Note n={14} title="Due to partners and investors — profit shares not yet settled">{noteTable(c.notes.due, p.notes.due, "Total due", 6)}</Note>
      </Sheet>
    </div>
  );
}
