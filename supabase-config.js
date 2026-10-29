// ═══════════════════════════════════════════════════════════════
//  Supabase configuration — public credentials for the storefront
//  The publishable key is designed to be public: it only grants
//  what Row Level Security allows the `anon` and `authenticated`
//  roles to do.
//
//  Load order on storefront pages:
//    supabase-js v2 (jsDelivr CDN)  →  menu.js  →  site.js
//    →  this file  →  auth.js  →  page script
//
//  This file creates the only Supabase client in the project. Every page
//  loads it exactly once and every page script uses `window.eqSupabase`,
//  so the login box, order, reservations, my-orders and the tracking pages
//  all share one session and one storage key.
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://obaxbwclndxcbkooagdu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_-aGq-0sn-2dA1_M87LzBmQ_D3msOKt2';

// One fixed key for the customer session, on every page and in every browser.
// supabase-js would otherwise derive `sb-<project-ref>-auth-token` itself; a
// fixed name means the login box and every page look in exactly the same place.
const SUPABASE_STORAGE_KEY = 'eq-customer-auth';

// localStorage with its methods bound to the storage object. Passing
// `window.localStorage` straight through lets a call made without its
// receiver fail with "Illegal invocation", and the failure is swallowed by
// the library — the session then works on the page but is never saved.
const authStorage = {
  getItem: function (key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  },
  setItem: function (key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      /* Storage blocked or full: the session stays in memory only. */
    }
  },
  removeItem: function (key) {
    try {
      window.localStorage.removeItem(key);
    } catch (err) {
      /* ignore */
    }
  }
};

// The single client for the whole site. The guard means that if this file is
// ever evaluated twice, the second evaluation re-uses the same instance
// instead of creating a second one with its own in-memory session.
window.eqSupabase = window.eqSupabase || (typeof window.supabase !== 'undefined'
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: authStorage,
        storageKey: SUPABASE_STORAGE_KEY
      }
    })
  : null);
