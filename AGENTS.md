# AGENTS.md — Ember & Quill

Restaurant platform for ZIKO Innovation. Static HTML/JS customer site plus an
admin dashboard (`admin.html`). Supabase (Postgres, Auth, RLS, RPC functions)
and Vercel. No build step.

## Layout

- Shared code: `site.js` (nav, cart, checkout), `auth.js`, `supabase-config.js`.
  There is no `cart.js` — the shared cart lives inside `site.js`.
- Each page is a plain `.html` file with its own script (`menu.html` + `menu.js`).
- SQL lives in `supabase/` (`accounts.sql`, `menu.sql`, `tracking.sql`, ...).

## Run locally

`npx serve -l 5555 .` then open http://localhost:5555

## Database rules

- Never modify or delete any table starting with `iris_`. They belong to the
  Agent Operators' AI, "Iris". Read them only through our own admin-only
  `security definer` functions.
- Never run SQL changes yourself. Put them in a new `.sql` file in `supabase/`
  and tell me — I run them myself.
- Never store raw card numbers or CVV. Payments use provider tokens only
  (`last4`, `brand`, provider ids).

## Security rules

- Iris must never be able to charge cards or approve orders.
- `approve_order`, `reject_order`, `charge_payment` and `refund_payment` are
  admin-only (`public.is_admin()`).
- Never weaken RLS.

## Work rules

- Do not push or deploy unless I ask.
- Keep changes small, and tell me exactly what changed and how to test it.
- Do not remove existing features. Ask before big changes.

## Customer experience

- Automatic account creation is switched off for now — `AUTO_ACCOUNT = false`
  at the top of `site.js`. Customers log in or create their own account in the
  login popup before ordering; checkout never signs anyone up and sends no
  emails. Set it back to `true` to let a first order open the account again
  (`ensureOrderSession` in `site.js`).
- Once logged in, a customer stays logged in on that device: the session is
  saved by Supabase and restored on every page, and their profile prefills the
  checkout form. Only "Log out" ends it.
- Unavailable dishes cannot be ordered.
- Never show raw errors to customers — friendly messages only, and keep their
  cart and typed details on any failure.

## Testing

Playwright specs live in `tests/e2e/` (Chromium, phone + desktop). They stub
the Supabase menu read, so the default suite never writes to the database.
Run the whole suite before calling a task done.

    npm install && npx playwright install chromium && npm test

`admin-call.spec.js` covers the admin dashboard and stubs all of it, sign-in
included, so the dashboard tests also never reach the live project. Note the
shape when adding more admin specs: supabase-js posts functions to
`/rest/v1/rpc/<function name>` (the name is in the path, not the body), and
the dashboard's Realtime socket cannot be routed by Playwright — that spec
points it at a dead port instead.

`live-order.spec.js` (real account + order) only runs when `E2E_PLACE_ORDER=1`
is set — in PowerShell: `$env:E2E_PLACE_ORDER="1"`. It also needs
`AUTO_ACCOUNT = true`.

`real-auth.spec.js` is the one spec that uses the REAL Supabase (nothing is
stubbed) and therefore **creates live test accounts** in `auth.users`
(`e2e+<timestamp>@example.com`, name "E2E TEST"). It never taps the final
"Place order", so it writes no orders. Run it with:

    npm run test:real-auth

(that is `cross-env E2E_REAL_AUTH=1 playwright test real-auth.spec.js`, so it
works in cmd, PowerShell and Git Bash). Delete the accounts afterwards with
`supabase/cleanup_e2e_users.sql` — I run that myself, agents never do.

`tests/e2e/session.spec.js`, `live-order.spec.js` and `real-auth.spec.js` each
carry a copy of the `AUTO_ACCOUNT` flag: if you change the setting in `site.js`,
change the copy there too so the right tests run.
