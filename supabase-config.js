// ═══════════════════════════════════════════════════════════════
//  Supabase configuration — public credentials for the storefront
//  The publishable key is designed to be public: it only grants
//  what Row Level Security allows the `anon` role to do (here:
//  insert a new order — no reads).
//
//  Load order on order.html:
//    supabase-js v2 (jsDelivr CDN)  →  this file  →  order.js
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://obaxbwclndxcbkooagdu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_-aGq-0sn-2dA1_M87LzBmQ_D3msOKt2';

// The UMD build from the CDN exposes the library as the global `supabase`.
// Guard the call so a blocked CDN fails gracefully instead of breaking the page.
const supabaseClient = typeof window.supabase !== 'undefined'
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
