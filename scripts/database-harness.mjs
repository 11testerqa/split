// Test-only PostgreSQL harness. Auth transport is synthetic; production uses Supabase Auth.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile } from "node:fs/promises";
export async function createHarness() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(
    `create schema auth;create table auth.users(id uuid primary key);create role anon;create role authenticated;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(
    await readFile("supabase/migrations/202610080001_splitpop.sql", "utf8"),
  );
  let queue = Promise.resolve();
  function run(user, fn) {
    const promise = queue.then(async () => {
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user,
      ]);
      try {
        return await fn(db);
      } finally {
        await db.exec("reset role");
      }
    });
    queue = promise.catch(() => {});
    return promise;
  }
  return { db, run };
}
