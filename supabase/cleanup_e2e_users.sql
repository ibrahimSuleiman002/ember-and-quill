-- ============================================================================
--  Ember & Quill — delete the automated E2E test accounts
--  supabase/cleanup_e2e_users.sql
--
--  WHAT IT REMOVES (only these, in this order)
--    1. public.orders        rows owned by a test account
--    2. public.reservations  rows owned by a test account
--    3. public.profiles      rows for a test account
--    4. auth.users           the test account itself — Supabase cascades its
--                            own rows (identities, sessions, refresh tokens,
--                            mfa factors, one-time tokens) from here
--
--  The accounts are picked by ONE pattern: email LIKE 'e2e+%@example.com'.
--  That is the shape used by tests/e2e/live-order.spec.js and
--  tests/e2e/real-auth.spec.js (e2e+20261111-093015-1234567@example.com).
--  Nothing else can match it, and no real customer signs up with an
--  @example.com address.
--
--  WHAT IT NEVER TOUCHES
--    • any table starting with iris_ — those belong to Iris
--    • orders or reservations belonging to a real customer (their user_id is
--      a different account and the pattern never matches them)
--    • payment provider data: no card/token row is deleted here
--
--  WHY orders/reservations ARE DELETED EXPLICITLY
--    accounts.sql adds their user_id as
--      references auth.users (id) on delete set null
--    so dropping the user would leave the rows behind, owned by nobody, and
--    (for reservations) sitting on a table the dashboard still counts.
--
--  HOW TO RUN — you run this, in the Supabase SQL editor
--    1. Execute section 1 (PREVIEW) on its own and read the list.
--    2. Then execute everything below it. It is one transaction, so nothing
--       is final until the COMMIT at the bottom.
--    3. If a DELETE aborts on a foreign key, the error names the table that
--       still points at auth.users. Stop there and tell me — do not add a
--       cascade of your own.
-- ============================================================================


-- ── 1. PREVIEW: what would be deleted ──────────────────────────────────────
select
  u.id,
  u.email,
  u.created_at,
  (select count(*) from public.orders o       where o.user_id = u.id) as orders,
  (select count(*) from public.reservations r where r.user_id = u.id) as reservations
from auth.users u
where u.email like 'e2e+%@example.com'
order by u.created_at desc;


-- ── 2. The actual cleanup ─────────────────────────────────────────────────
begin;

-- Freeze the target list first, so every delete below works off exactly the
-- same rows and the final report can still count them afterwards.
create temporary table if not exists e2e_test_users (id uuid primary key, email text)
  on commit drop;

truncate e2e_test_users;

insert into e2e_test_users (id, email)
select u.id, u.email
from auth.users u
where u.email like 'e2e+%@example.com';

select count(*) as test_accounts_found from e2e_test_users;

delete from public.orders
 where user_id in (select id from e2e_test_users);

delete from public.reservations
 where user_id in (select id from e2e_test_users);

-- Already covered by "on delete cascade" on profiles.user_id, but doing it
-- explicitly means the count below is reported before the user disappears.
delete from public.profiles
 where user_id in (select id from e2e_test_users);

delete from public.activity_log
 where actor_email in (select email from e2e_test_users);

delete from auth.users
 where id in (select id from e2e_test_users);

-- ── 3. Report ─────────────────────────────────────────────────────────────
select
  (select count(*) from e2e_test_users)                                  as accounts_deleted,
  (select count(*) from public.profiles p
     where p.user_id in (select id from e2e_test_users))                 as profiles_left,
  (select count(*) from auth.users u
     where u.email like 'e2e+%@example.com')                             as still_matching_pattern;

commit;
