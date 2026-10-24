-- ═══════════════════════════════════════════════════════════════
--  Ember & Quill — customer tracking + cancellation
--
--  Run this once in the Supabase dashboard → SQL Editor.
--  It adds tracking codes to orders/reservations and creates the
--  four RPCs the public site is allowed to call:
--
--    track_order(p_code, p_phone)        → 0 or 1 order row
--    track_reservation(p_code, p_phone)  → 0 or 1 reservation row
--    cancel_order(p_code, p_phone)       → CANCELLED | ALREADY_CANCELLED
--                                           NOT_FOUND | TOO_LATE
--    cancel_reservation(p_code, p_phone) → same result codes
--
--  The functions are SECURITY DEFINER so anonymous visitors can
--  read/update only the row that matches their code + phone. The
--  tables themselves stay closed to anon SELECT/UPDATE.
--
--  Safe to run more than once. If an older copy of these functions
--  exists with a different return shape, drop it first, e.g.:
--    drop function if exists public.track_order(text, text);
--    drop function if exists public.track_reservation(text, text);
--    drop function if exists public.cancel_order(text, text);
--    drop function if exists public.cancel_reservation(text, text);
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Tracking code columns ───────────────────────────────────
alter table public.orders
  add column if not exists tracking_code text;

alter table public.reservations
  add column if not exists tracking_code text;

-- Distinguishes a customer cancellation (shown in the admin live alerts)
-- from an admin cancellation made in the dashboard.
alter table public.orders
  add column if not exists cancelled_by text;

alter table public.reservations
  add column if not exists cancelled_by text;

create unique index if not exists orders_tracking_code_uidx
  on public.orders (upper(tracking_code))
  where tracking_code is not null;

create unique index if not exists reservations_tracking_code_uidx
  on public.reservations (upper(tracking_code))
  where tracking_code is not null;

-- ── 2. Phone comparison helper ─────────────────────────────────
-- Compares the last 10 digits, so 0803…, 803… and +234803…
-- all match. Requires at least 7 digits from the visitor.
create or replace function public.tracking_phone_matches(
  p_stored text,
  p_supplied text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    length(regexp_replace(coalesce(p_supplied, ''), '\D', '', 'g')) >= 7
    and right(regexp_replace(coalesce(p_stored, ''), '\D', '', 'g'), 10)
      = right(regexp_replace(coalesce(p_supplied, ''), '\D', '', 'g'), 10);
$$;

-- ── 3. Track an order ──────────────────────────────────────────
create or replace function public.track_order(
  p_code text,
  p_phone text
)
returns table (
  order_no bigint,
  customer_name text,
  items jsonb,
  total numeric,
  status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.order_no::bigint,
    o.customer_name,
    coalesce(o.items::jsonb, '[]'::jsonb) as items,
    o.total,
    o.status,
    o.created_at
  from public.orders o
  where upper(o.tracking_code) = upper(btrim(coalesce(p_code, '')))
    and public.tracking_phone_matches(o.phone, p_phone)
  limit 1;
$$;

-- ── 4. Track a reservation ─────────────────────────────────────
create or replace function public.track_reservation(
  p_code text,
  p_phone text
)
returns table (
  customer_name text,
  party_size integer,
  reservation_date text,
  reservation_time text,
  notes text,
  status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.customer_name,
    r.party_size::integer,
    r.reservation_date::text,
    r.reservation_time::text,
    r.notes,
    r.status,
    r.created_at
  from public.reservations r
  where upper(r.tracking_code) = upper(btrim(coalesce(p_code, '')))
    and public.tracking_phone_matches(r.phone, p_phone)
  limit 1;
$$;

-- ── 5. Cancel an order ─────────────────────────────────────────
create or replace function public.cancel_order(
  p_code text,
  p_phone text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id public.orders.id%TYPE;
  v_status text;
  v_email text;
  v_updated integer;
begin
  select o.id, o.status, o.email
    into v_id, v_status, v_email
  from public.orders o
  where upper(o.tracking_code) = upper(btrim(coalesce(p_code, '')))
    and public.tracking_phone_matches(o.phone, p_phone)
  limit 1;

  if v_id is null then
    return 'NOT_FOUND';
  end if;

  if v_status = 'CANCELLED' then
    return 'ALREADY_CANCELLED';
  end if;

  -- Online cancellation is only offered while pending or approved.
  if v_status not in ('PENDING_APPROVAL', 'APPROVED') then
    return 'TOO_LATE';
  end if;

  update public.orders
     set status = 'CANCELLED',
         cancelled_by = 'customer'
   where id = v_id
     and status = v_status;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    -- Someone (the admin or another tab) changed it at the same time.
    select o.status into v_status from public.orders o where o.id = v_id;
    if v_status = 'CANCELLED' then
      return 'ALREADY_CANCELLED';
    end if;
    return 'TOO_LATE';
  end if;

  insert into public.activity_log (actor_email, action, target_type, target_id)
  values (
    coalesce(nullif(btrim(coalesce(v_email, '')), ''), 'customer'),
    'ORDER_CANCELLED_BY_CUSTOMER',
    'order',
    v_id::text
  );

  return 'CANCELLED';
end;
$$;

-- ── 6. Cancel a reservation ────────────────────────────────────
create or replace function public.cancel_reservation(
  p_code text,
  p_phone text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id public.reservations.id%TYPE;
  v_status text;
  v_email text;
  v_updated integer;
begin
  select r.id, r.status, r.email
    into v_id, v_status, v_email
  from public.reservations r
  where upper(r.tracking_code) = upper(btrim(coalesce(p_code, '')))
    and public.tracking_phone_matches(r.phone, p_phone)
  limit 1;

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
     and status = v_status;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    select r.status into v_status from public.reservations r where r.id = v_id;
    if v_status = 'CANCELLED' then
      return 'ALREADY_CANCELLED';
    end if;
    return 'TOO_LATE';
  end if;

  insert into public.activity_log (actor_email, action, target_type, target_id)
  values (
    coalesce(nullif(btrim(coalesce(v_email, '')), ''), 'customer'),
    'RESERVATION_CANCELLED_BY_CUSTOMER',
    'reservation',
    v_id::text
  );

  return 'CANCELLED';
end;
$$;

-- ── 7. Permissions ─────────────────────────────────────────────
-- Only these four entry points are exposed to visitors.
revoke all on function public.track_order(text, text) from public;
revoke all on function public.track_reservation(text, text) from public;
revoke all on function public.cancel_order(text, text) from public;
revoke all on function public.cancel_reservation(text, text) from public;

grant execute on function public.track_order(text, text) to anon, authenticated;
grant execute on function public.track_reservation(text, text) to anon, authenticated;
grant execute on function public.cancel_order(text, text) to anon, authenticated;
grant execute on function public.cancel_reservation(text, text) to anon, authenticated;

-- ── 8. Realtime UPDATE events for the admin dashboard ──────────
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

-- Ask PostgREST to pick up the new columns/functions immediately.
notify pgrst, 'reload schema';
