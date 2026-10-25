-- ═══════════════════════════════════════════════════════════════
--  Ember & Quill — customer accounts
--
--  Run this once in the Supabase dashboard → SQL Editor, after
--  supabase/tracking.sql. It:
--
--    • creates public.profiles (full_name, phone, address) with RLS
--    • adds orders.user_id / reservations.user_id, defaulted to
--      auth.uid(), so the website never sends the owner id
--    • resets the orders/reservations policies (dropping the old
--      anonymous INSERT rules) and revokes INSERT from anon
--    • lets signed-in customers SELECT only their own rows, and
--      INSERT only new PENDING_APPROVAL (orders) / PENDING
--      (reservations) rows that belong to them and are unpaid
--    • lets admins (public.is_admin()) read and update every row
--    • closes public.activity_log to everyone except admins
--    • creates the cancel_my_order / cancel_my_reservation RPCs,
--      callable by authenticated users only, and retires the old
--      tracking-code RPCs from supabase/tracking.sql
--    • blocks an order from being approved or fulfilled before
--      payment (paid_at must be set)
--    • makes sure Realtime publishes the two tables
--
--  REQUIRES public.is_admin() to already exist (it is created by the
--  admin setup, not by this file).
--
--  Safe to run more than once.
--
--  NOTE ON EMAIL CONFIRMATION
--  The site works with "Confirm email" switched on, but new
--  customers must click the link before they can order. For the
--  seamless "create account → continue with the order" flow, turn
--  it off in Authentication → Providers → Email → Confirm email.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Customer profiles ───────────────────────────────────────
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

grant select, insert, update on public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Keep a profile row in step with every new auth user (works even
-- when email confirmation delays the first login).
create or replace function public.handle_new_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, full_name, phone, address)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), ''),
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'address', '')), '')
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_customer() from public;
revoke all on function public.handle_new_customer() from anon, authenticated;

drop trigger if exists on_auth_customer_created on auth.users;
create trigger on_auth_customer_created
  after insert on auth.users
  for each row execute function public.handle_new_customer();

-- ── 2. Link orders and reservations to the signed-in customer ──
-- The default is evaluated by Postgres on INSERT, so order.html
-- and reservations.html simply omit user_id.
alter table public.orders
  add column if not exists user_id uuid default auth.uid()
  references auth.users (id) on delete set null;

alter table public.reservations
  add column if not exists user_id uuid default auth.uid()
  references auth.users (id) on delete set null;

-- Even if user_id already existed without a default, make the
-- database responsible for filling it in.
alter table public.orders alter column user_id set default auth.uid();
alter table public.reservations alter column user_id set default auth.uid();

-- The website omits status when it inserts, so the column default is
-- what puts a new row into the state the insert policy allows.
alter table public.orders alter column status set default 'PENDING_APPROVAL';
alter table public.reservations alter column status set default 'PENDING';

-- Supabase's SQL editor may have created the tracking columns
-- already; keep the cancellation marker available either way.
alter table public.orders
  add column if not exists cancelled_by text;

alter table public.reservations
  add column if not exists cancelled_by text;

create index if not exists orders_user_created_idx
  on public.orders (user_id, created_at desc);

create index if not exists reservations_user_created_idx
  on public.reservations (user_id, created_at desc);

-- ── 3. Reset the table policies ────────────────────────────────
-- Earlier versions of this project let visitors insert orders and
-- reservations straight from the browser. Drop every policy on the two
-- tables (whatever its name or role) before rebuilding them below, so
-- no old rule can widen the access defined in this file.
do $$
declare
  pol record;
begin
  for pol in
    select p.polname as policyname, c.relname as tablename
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('orders', 'reservations')
  loop
    execute format('drop policy if exists %I on public.%I',
      pol.policyname, pol.tablename);
  end loop;
end $$;

revoke insert on public.orders from anon;
revoke insert on public.reservations from anon;

-- ── 4. Row Level Security ──────────────────────────────────────
alter table public.orders enable row level security;
alter table public.reservations enable row level security;

-- Customers read/insert their own rows; admins read/update all.
-- UPDATE is granted at the table level but only the admin policy
-- below allows it, so customers still cannot edit their own rows.
grant select, insert, update on public.orders to authenticated;
grant select, insert, update on public.reservations to authenticated;

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select to authenticated
  using (user_id = auth.uid());

-- A customer can only create an unpaid order for themselves, and it
-- must start in the approval queue.
drop policy if exists orders_insert_own on public.orders;
create policy orders_insert_own on public.orders
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'PENDING_APPROVAL'
    and paid_at is null
  );

drop policy if exists reservations_select_own on public.reservations;
create policy reservations_select_own on public.reservations
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists reservations_insert_own on public.reservations;
create policy reservations_insert_own on public.reservations
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'PENDING'
  );

-- Admin read/update. Permissive policies are OR-ed together, so an
-- admin sees every row while a customer still sees only their own.
drop policy if exists orders_select_admin on public.orders;
create policy orders_select_admin on public.orders
  for select to authenticated
  using (public.is_admin());

drop policy if exists orders_update_admin on public.orders;
create policy orders_update_admin on public.orders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists reservations_select_admin on public.reservations;
create policy reservations_select_admin on public.reservations
  for select to authenticated
  using (public.is_admin());

drop policy if exists reservations_update_admin on public.reservations;
create policy reservations_update_admin on public.reservations
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── 5. Activity log: admins only ───────────────────────────────
-- The dashboard is the only reader and writer. The cancel_* functions
-- below are SECURITY DEFINER and owned by the migration role, which
-- owns this table, so their inserts bypass RLS as the table owner.
do $$
declare
  pol record;
begin
  for pol in
    select p.polname as policyname
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'activity_log'
  loop
    execute format('drop policy if exists %I on public.activity_log',
      pol.policyname);
  end loop;
end $$;

alter table public.activity_log enable row level security;

-- The functions below append as the table owner (SECURITY DEFINER).
-- Never force RLS here, or those cancel entries would be rejected.
alter table public.activity_log no force row level security;

revoke all on public.activity_log from anon;
revoke all on public.activity_log from authenticated;
grant select, insert on public.activity_log to authenticated;

drop policy if exists activity_log_select_admin on public.activity_log;
create policy activity_log_select_admin on public.activity_log
  for select to authenticated
  using (public.is_admin());

drop policy if exists activity_log_insert_admin on public.activity_log;
create policy activity_log_insert_admin on public.activity_log
  for insert to authenticated
  with check (public.is_admin());

-- ── 6. Cancel an order ─────────────────────────────────────────
create or replace function public.cancel_my_order(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_status text;
  v_paid_at timestamptz;
  v_email text;
  v_updated integer;
begin
  if v_uid is null then
    return 'NOT_LOGGED_IN';
  end if;

  select o.id, o.status::text, o.paid_at, o.email
    into v_id, v_status, v_paid_at, v_email
  from public.orders o
  where o.id = p_order_id
    and o.user_id = v_uid;

  if v_id is null then
    return 'NOT_FOUND';
  end if;

  if v_status = 'CANCELLED' then
    return 'ALREADY_CANCELLED';
  end if;

  if v_paid_at is not null or v_status = 'PAID' then
    return 'PAID';
  end if;

  if v_status not in ('PENDING_APPROVAL', 'APPROVED') then
    return 'TOO_LATE';
  end if;

  update public.orders
     set status = 'CANCELLED',
         cancelled_by = 'customer'
   where id = v_id
     and user_id = v_uid
     and status::text = v_status
     and paid_at is null;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    -- The admin (or another tab) changed it at the same moment.
    select o.status::text, o.paid_at
      into v_status, v_paid_at
    from public.orders o
    where o.id = v_id
      and o.user_id = v_uid;

    if v_status = 'CANCELLED' then
      return 'ALREADY_CANCELLED';
    end if;
    if v_paid_at is not null or v_status = 'PAID' then
      return 'PAID';
    end if;
    return 'TOO_LATE';
  end if;

  begin
    insert into public.activity_log (actor_email, action, target_type, target_id)
    values (
      coalesce(nullif(btrim(coalesce(v_email, '')), ''), 'customer'),
      'ORDER_CANCELLED_BY_CUSTOMER',
      'order',
      v_id::text
    );
  exception when undefined_table then
    null;
  end;

  return 'CANCELLED';
end;
$$;

-- ── 7. Cancel a reservation ────────────────────────────────────
create or replace function public.cancel_my_reservation(p_reservation_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_status text;
  v_email text;
  v_updated integer;
begin
  if v_uid is null then
    return 'NOT_LOGGED_IN';
  end if;

  select r.id, r.status::text, r.email
    into v_id, v_status, v_email
  from public.reservations r
  where r.id = p_reservation_id
    and r.user_id = v_uid;

  if v_id is null then
    return 'NOT_FOUND';
  end if;

  if v_status = 'CANCELLED' then
    return 'ALREADY_CANCELLED';
  end if;

  if v_status not in ('PENDING', 'CONFIRMED') then
    return 'TOO_LATE';
  end if;

  update public.reservations
     set status = 'CANCELLED',
         cancelled_by = 'customer'
   where id = v_id
     and user_id = v_uid
     and status::text = v_status;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    select r.status::text into v_status
    from public.reservations r
    where r.id = v_id
      and r.user_id = v_uid;

    if v_status = 'CANCELLED' then
      return 'ALREADY_CANCELLED';
    end if;
    return 'TOO_LATE';
  end if;

  begin
    insert into public.activity_log (actor_email, action, target_type, target_id)
    values (
      coalesce(nullif(btrim(coalesce(v_email, '')), ''), 'customer'),
      'RESERVATION_CANCELLED_BY_CUSTOMER',
      'reservation',
      v_id::text
    );
  exception when undefined_table then
    null;
  end;

  return 'CANCELLED';
end;
$$;

-- ── 8. Permissions ─────────────────────────────────────────────
-- Signed-in customers are the only callers. Revoke the explicit anon
-- grant an earlier version of this file added, so there is no path for
-- an anonymous visitor at all.
revoke all on function public.cancel_my_order(uuid) from public;
revoke all on function public.cancel_my_reservation(uuid) from public;
revoke all on function public.cancel_my_order(uuid) from anon;
revoke all on function public.cancel_my_reservation(uuid) from anon;

grant execute on function public.cancel_my_order(uuid) to authenticated;
grant execute on function public.cancel_my_reservation(uuid) to authenticated;

-- Retire the pre-accounts RPCs created by supabase/tracking.sql. They
-- identify a booking by tracking code + phone and know nothing about
-- user_id or paid_at, so they must not stay callable now that bookings
-- belong to accounts. cancel_my_order, cancel_my_reservation and
-- is_admin keep their authenticated access untouched.
revoke execute on function public.track_order(text, text) from public, anon, authenticated;
revoke execute on function public.track_reservation(text, text) from public, anon, authenticated;
revoke execute on function public.cancel_order(text, text) from public, anon, authenticated;
revoke execute on function public.cancel_reservation(text, text) from public, anon, authenticated;

-- ── 9. No approval or delivery before payment ──────────────────
-- paid_at is the single source of truth: an order can only move into
-- APPROVED, OUT_FOR_DELIVERY or DELIVERED once payment is recorded.
-- The message matches the admin dashboard's payment warning.
create or replace function public.enforce_order_payment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('APPROVED', 'OUT_FOR_DELIVERY', 'DELIVERED')
     and new.paid_at is null then
    raise exception 'Order must be paid before it can be approved, marked out for delivery or delivered.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_order_payment() from public;
revoke all on function public.enforce_order_payment() from anon, authenticated;

drop trigger if exists orders_require_payment on public.orders;
create trigger orders_require_payment
  before insert or update of status, paid_at on public.orders
  for each row execute function public.enforce_order_payment();

-- ── 10. Realtime for the customer's own rows ───────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'orders'
    ) then
      execute 'alter publication supabase_realtime add table public.orders';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'reservations'
    ) then
      execute 'alter publication supabase_realtime add table public.reservations';
    end if;
  end if;
end $$;

-- Ask PostgREST to pick up the new table, columns and functions.
notify pgrst, 'reload schema';
