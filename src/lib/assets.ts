const r2 = (x: number) => Math.round(x * 100) / 100;

/** An item of equipment's depreciation to a date, month by month as the journal does it. */
export function assetValue(a: { purchased_on: string; cost: number; life_years: number; disposed_on?: string | null }, at: string) {
  const months = Math.max(1, a.life_years) * 12;
  const monthly = a.cost / months;
  const d = new Date(`${a.purchased_on.slice(0, 7)}-01T00:00:00Z`);
  let written = 0;
  for (let k = 1; k <= months; k++) {
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 0)).toISOString().slice(0, 10);
    if (end > at || (a.disposed_on && end > a.disposed_on)) break;
    written += monthly;
  }
  return { depreciation: r2(written), value: r2(a.cost - written), monthly: r2(monthly) };
}
