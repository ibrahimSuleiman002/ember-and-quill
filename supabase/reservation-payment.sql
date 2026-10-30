-- ═══════════════════════════════════════════════════════════════
--  Ember & Quill — reservation payments
--
--  Run this once in the Supabase dashboard → SQL Editor, after
--  supabase/accounts.sql. It gives reservations the same payment
--  rule orders already have, with one difference: a paid reservation
--  can still be cancelled by the customer, but without a refund.
--
--    • adds reservations.paid_at (the single source of truth)
--    • blocks a reservation from becoming CONFIRMED while unpaid
--    • keeps customers from setting paid_at themselves
--    • replaces cancel_my_reservation(uuid): returns CANCELLED, or
--      CANCELLED_NO_REFUND when payment had been made
--    • records paid / unpaid on the customer-cancellation entry in
--      the activity log
--
--  Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Payment timestamp ───────────────────────────────────────
alter table public.reservations
  add column if not exists paid_at timestamptz;

-- ── 2. No confirmation before payment ──────────────────────────
-- paid_at is the single source of truth: a reservation can only move
-- into CONFIRMED once payment is recorded. The message matches the
-- admin dashboard's payment warning.
create or replace function public.enforce_reservation_payment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'CONFIRMED'
     and new.paid_at is null then
    raise exception 'Reservation must be paid before it can be confirmed.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_reservation_payment() from public;
revoke all on function public.enforce_reservation_payment() from anon, authenticated;

drop trigger if exists reservations_require_payment on public.reservations;
create trigger reservations_require_payment
  before insert or update of status, paid_at on public.reservations
  for each row execute function public.enforce_reservation_payment();

-- ── 3. Customers cannot record their own payment ───────────────
-- The insert policy is the only write path for a signed-in customer:
-- a new reservation must start unpaid. Everyone else (the admin) goes
-- through public.is_admin(); no customer UPDATE policy exists, so
-- paid_at cannot be set directly from the browser either.
alter table public.reservations enable row level security;

drop policy if exists reservations_insert_own on public.reservations;
create policy reservations_insert_own on public.reservations
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'PENDING'
    and paid_at is null
  );

-- Safety net for an install that once had a customer-update policy.
drop policy if exists reservations_update_own on public.reservations;

-- ── 4. Activity log note ───────────────────────────────────────
-- Lets the cancellation entry say whether money had been paid.
alter table public.activity_log
  add column if not exists note text;

-- ── 5. Cancel a reservation ────────────────────────────────────
-- Same outcomes as before, plus CANCELLED_NO_REFUND when paid_at is
-- set. A paid reservation is still cancelled, as the customer asked.
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
  v_paid_at timestamptz;
  v_email text;
  v_updated integer;
  v_result text;
begin
  if v_uid is null then
    return 'NOT_LOGGED_IN';
  end if;

  select r.id, r.status::text, r.paid_at, r.email
    into v_id, v_status, v_paid_at, v_email
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
    -- The admin (or another tab) changed it at the same moment.
    select r.status::text, r.paid_at
      into v_status, v_paid_at
    from public.reservations r
    where r.id = v_id
      and r.user_id = v_uid;

    if v_status = 'CANCELLED' then
      return 'ALREADY_CANCELLED';
    end if;
    return 'TOO_LATE';
  end if;

  v_result := case when v_paid_at is null then 'CANCELLED' else 'CANCELLED_NO_REFUND' end;

  begin
    insert into public.activity_log (actor_email, action, target_type, target_id, note)
    values (
      coalesce(nullif(btrim(coalesce(v_email, '')), ''), 'customer'),
      'RESERVATION_CANCELLED_BY_CUSTOMER',
      'reservation',
      v_id::text,
      case when v_paid_at is null then 'unpaid' else 'paid' end
    );
  exception when undefined_table or undefined_column then
    null;
  end;

  return v_result;
end;
$$;

-- ── 6. Permissions ─────────────────────────────────────────────
-- Signed-in customers are the only callers.
revoke all on function public.cancel_my_reservation(uuid) from public;
revoke all on function public.cancel_my_reservation(uuid) from anon;

grant execute on function public.cancel_my_reservation(uuid) to authenticated;

-- Ask PostgREST to pick up the new column and function immediately.
notify pgrst, 'reload schema';
