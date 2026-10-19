import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one, q } from "./harness";

/** Clients and customers are one list; the old clients table is a mirror (migration 017). */
let db: PGlite;
beforeEach(async () => { db = await freshDb(); });

const clientOf = async (contactId: string) =>
  one<{ id: string; name: string; phone: string | null; is_active: boolean }>(db,
    `select cl.id, cl.name, cl.phone, cl.is_active from clients cl join contacts c on c.legacy ->> 'client_id' = cl.id::text where c.id = $1`, [contactId]);

describe("customers and clients", () => {
  it("a new Live customer gets a mirrored client, kept in step", async () => {
    const c = (await one<{ id: string }>(db, `insert into contacts (kinds, name, phone) values ('{customer}', 'Island Resort', '777') returning id`)).id;
    expect(await clientOf(c)).toMatchObject({ name: "Island Resort", phone: "777", is_active: true });
    await db.query(`update contacts set name = 'Island Resort Pvt Ltd', active = false where id = $1`, [c]);
    expect(await clientOf(c)).toMatchObject({ name: "Island Resort Pvt Ltd", is_active: false });
  });

  it("vendors and Test-book customers are not mirrored", async () => {
    const before = Number((await one<{ n: string }>(db, `select count(*) n from clients`)).n);
    await db.query(`insert into contacts (kinds, name) values ('{vendor}', 'Timber')`);
    await db.query(`insert into contacts (kinds, name, book) values ('{customer}', 'Trial', 'sandbox')`);
    expect(Number((await one<{ n: string }>(db, `select count(*) n from clients`)).n)).toBe(before);
  });

  it("a client added by an older screen appears as a customer", async () => {
    const cl = (await one<{ id: string }>(db, `insert into clients (name, phone) values ('Old Screen Co', '999') returning id`)).id;
    const rows = await q<{ name: string; phone: string; kinds: string[] }>(db, `select name, phone, kinds from contacts where legacy ->> 'client_id' = $1`, [cl]);
    expect(rows).toEqual([{ name: "Old Screen Co", phone: "999", kinds: ["customer"] }]);
    await db.query(`update clients set phone = '111' where id = $1`, [cl]);
    expect((await one<{ phone: string }>(db, `select phone from contacts where legacy ->> 'client_id' = $1`, [cl])).phone).toBe("111");
  });

  it("a project's customer and client always agree, whichever side sets it", async () => {
    const c = (await one<{ id: string }>(db, `insert into contacts (kinds, name) values ('{customer}', 'Ministry') returning id`)).id;
    const cl = (await clientOf(c)).id;
    const p = (await one<{ id: string; client_id: string }>(db, `insert into projects (code, name, customer_id) values ('P-1', 'Clinic', $1) returning id, client_id`, [c]));
    expect(p.client_id).toBe(cl);
    // the old screen sets the client: the customer follows
    const other = (await one<{ id: string }>(db, `insert into clients (name) values ('Other') returning id`)).id;
    await db.query(`update projects set client_id = $1 where id = $2`, [other, p.id]);
    const after = await one<{ customer: string }>(db, `select c.name customer from projects p join contacts c on c.id = p.customer_id where p.id = $1`, [p.id]);
    expect(after.customer).toBe("Other");
    // a vendor cannot be a project's customer
    const v = (await one<{ id: string }>(db, `insert into contacts (kinds, name) values ('{vendor}', 'Timber') returning id`)).id;
    await expect(db.query(`update projects set customer_id = $1 where id = $2`, [v, p.id])).rejects.toThrow(/not a customer/);
  });
});
