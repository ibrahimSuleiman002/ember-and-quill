"use strict";

// ═══════════════════════════════════════════════════════════════
//  Ember & Quill — Admin dashboard
//  Live data from Supabase: public.orders, public.reservations and
//  public.activity_log. No sample data.
//  Iris data comes through the read-only admin_iris_stats /
//  admin_iris_orders functions; this page never writes to an iris_ table.
//  Admin users sign in with Supabase Auth; the session persists
//  across refreshes. Customers can only insert orders/reservations.
//  The activity log is append-only: this page only inserts and
//  reads it, never edits or deletes rows.
//  New orders/reservations arrive over Realtime (with a 30s polling
//  fallback) and raise a top toast, a beep, a tab badge and an
//  optional browser notification.
// ═══════════════════════════════════════════════════════════════

const client = window.eqSupabase || null;

const STATUS_ORDER = [
  "PENDING_APPROVAL", "APPROVED", "PAID", "PREPARING",
  "OUT_FOR_DELIVERY", "DELIVERED", "REJECTED", "CANCELLED"
];
const STATUS_LABELS = {
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  PAID: "Paid",
  PREPARING: "Preparing",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled"
};

// The simplified flow has one next step after approval. PAID and
// PREPARING are legacy statuses, treated as approved for this step.
const ORDER_OUT_FROM = ["APPROVED", "PAID", "PREPARING"];
const ORDER_OUT_LABEL = "Out for delivery - notify customer";
const ORDER_STATUS_ACTIONS = {
  APPROVED: "ORDER_APPROVED",
  REJECTED: "ORDER_REJECTED",
  OUT_FOR_DELIVERY: "ORDER_OUT_FOR_DELIVERY"
};

// The payment step is part of the order filters now: Awaiting payment
// is an unpaid PENDING_APPROVAL order, and Paid (ready to approve) is a
// paid one. Preparing and Delivered stay out of the filters, but their
// labels/styles remain so older rows still display correctly.
const ORDER_FILTERS = [
  "ALL", "AWAITING_PAYMENT", "PAID_READY", "APPROVED",
  "OUT_FOR_DELIVERY", "REJECTED", "CANCELLED"
];
const ORDER_FILTER_LABELS = {
  ALL: "All",
  AWAITING_PAYMENT: "Awaiting payment",
  PAID_READY: "Paid (ready to approve)",
  APPROVED: "Approved",
  OUT_FOR_DELIVERY: "Out for delivery",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled"
};

const RESERVATION_STATUSES = ["PENDING", "CONFIRMED", "CANCELLED"];
const RESERVATION_LABELS = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled"
};

// Iris orders come from the admin_iris_orders RPC and are read-only here:
// this page never writes to an iris_ table.
const IRIS_STATS_RPC = "admin_iris_stats";
const IRIS_ORDERS_RPC = "admin_iris_orders";

const SOURCE_FILTERS = ["ALL", "WEBSITE", "IRIS"];
const SOURCE_FILTER_LABELS = { ALL: "All", WEBSITE: "Website", IRIS: "Iris" };

// One address per page: #dashboard, #orders, #order/<id>, #customers,
// #menu, #reservations, #wallet, #settings, #activity.
const ROUTES = {
  dashboard: { title: "Dashboard", crumbs: ["Admin", "Dashboard"] },
  orders: { title: "Orders", crumbs: ["Admin", "Orders", "List"] },
  order: { title: "Order detail", crumbs: ["Admin", "Orders", "Detail"] },
  customers: { title: "Customers", crumbs: ["Admin", "Customers", "List"] },
  menu: { title: "Menu", crumbs: ["Admin", "Menu", "List"] },
  reservations: { title: "Reservations", crumbs: ["Admin", "Reservations"] },
  wallet: { title: "Wallet", crumbs: ["Admin", "Wallet"] },
  settings: { title: "Settings", crumbs: ["Admin", "Settings"] },
  activity: { title: "Activity Log", crumbs: ["Admin", "Activity Log"] }
};
const DEFAULT_ROUTE = "dashboard";

const ACTIVITY_LABELS = {
  ORDER_APPROVED: "Order approved",
  ORDER_REJECTED: "Order rejected",
  ORDER_MARKED_PAID: "Marked as paid",
  ORDER_PREPARING: "Order preparing",
  ORDER_OUT_FOR_DELIVERY: "Marked out for delivery",
  ORDER_DELIVERED: "Order delivered",
  ORDER_CANCELLED_BY_CUSTOMER: "Cancelled by customer",
  RESERVATION_CONFIRMED: "Reservation confirmed",
  RESERVATION_MARKED_PAID: "Marked as paid",
  RESERVATION_CANCELLED: "Reservation cancelled",
  RESERVATION_CANCELLED_BY_CUSTOMER: "Cancelled by customer",
  MENU_ITEM_AVAILABILITY_CHANGED: "Menu availability changed",
  CUSTOMER_CALLED: "Called customer"
};

const UNUSUAL_TOTAL = 100000;

const state = {
  view: DEFAULT_ROUTE,
  statusFilter: "ALL",
  sourceFilter: "ALL",
  resFilter: "ALL",
  customerSearch: "",
  orders: [],
  reservations: [],
  activity: [],
  menu: [],
  irisOrders: [],
  irisStats: null,
  irisLoading: true,
  irisError: null,
  irisStatsError: null,
  irisUpdatedAt: null,
  ordersLoading: true,
  ordersError: null,
  resLoading: true,
  resError: null,
  resActionError: null,
  activityLoading: true,
  activityError: null,
  menuLoading: true,
  menuError: null,
  menuActionError: null,
  menuSearch: "",
  menuSavingId: null,
  menuSavingRemarksId: null,
  menuRemarksDraft: {},
  menuNoteOpen: {},
  saving: false,
  authed: false,
  openOrderKey: null,
  newOrders: 0,
  newReservations: 0,
  titleCount: 0,
  titleLabel: "New order",
  liveStatus: "connecting",
  dashboardSig: "",
  charts: []
};

/* ── Helpers ── */
function money(n) {
  return "₦" + (Number(n) || 0).toLocaleString("en-NG");
}

// Iris stores money in minor units (kobo), so every Iris amount is divided by
// 100 here. Kobo only show up when there are actually kobo to show.
function moneyMinor(minor, currency) {
  const cur = String(currency || "NGN").toUpperCase();
  const kobo = Math.round(Number(minor) || 0);
  // Kobo are only shown when there are kobo, and then always as two decimals.
  const text = (kobo / 100).toLocaleString("en-NG", {
    minimumFractionDigits: kobo % 100 ? 2 : 0,
    maximumFractionDigits: 2
  });
  return cur === "NGN" ? "₦" + text : cur + " " + text;
}

function amountTextOf(o) {
  if (isIrisOrder(o)) {
    return o.total_minor == null ? "—" : moneyMinor(o.total_minor, o.currency);
  }
  return money(totalOf(o));
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
  });
}

function errorText(err) {
  if (!err) return "Unknown error.";
  return err.message || err.error_description || String(err);
}

function statusLabel(s) {
  return STATUS_LABELS[s] || String(s || "Unknown");
}

function statusClass(o) {
  if (isIrisOrder(o)) return irisStatusClass(o.status);
  return STATUS_ORDER.indexOf(o.status) !== -1 ? "status-" + o.status : "status-UNKNOWN";
}

// Iris keeps its own status text. It is not documented in this codebase, so
// anything that lines up with the website vocabulary gets the matching colour
// and everything else falls back to the neutral unknown style.
function irisStatusClass(s) {
  const key = String(s || "").toUpperCase();
  return STATUS_ORDER.indexOf(key) !== -1 ? "status-" + key : "status-UNKNOWN";
}

function prettyValue(s) {
  return String(s == null ? "" : s)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
    .trim();
}

function irisStatusLabel(s) {
  const key = String(s || "").toUpperCase();
  if (STATUS_LABELS[key]) return STATUS_LABELS[key];
  return prettyValue(s) || "Unknown";
}

function isIrisPaid(o) {
  return ["PAID", "CONFIRMED", "SETTLED"].indexOf(String(o.payment_status || "").toUpperCase()) !== -1;
}

function isUnpaidPending(o) {
  return o.status === "PENDING_APPROVAL" && !o.paid_at;
}

function paymentBadge(o) {
  if (isIrisOrder(o)) {
    if (isIrisPaid(o)) return '<span class="tag tag-paid">Paid</span>';
    if (o.payment_status) {
      return '<span class="tag tag-awaiting">' + esc(irisStatusLabel(o.payment_status)) + "</span>";
    }
    return '<span class="tag tag-awaiting">No payment recorded</span>';
  }
  if (o.paid_at) return '<span class="tag tag-paid">Paid</span>';
  if (o.status === "PENDING_APPROVAL") return '<span class="tag tag-awaiting">Awaiting payment</span>';
  return "";
}

function sourceBadge(o) {
  return isIrisOrder(o)
    ? '<span class="tag tag-source-iris">Iris</span>'
    : '<span class="tag tag-source-website">Website</span>';
}

// An order only counts as income once it is paid and has not been
// called off again afterwards.
function isRevenue(o) {
  return !!o.paid_at && o.status !== "REJECTED" && o.status !== "CANCELLED";
}

function isCounted(o) {
  return o.status !== "REJECTED" && o.status !== "CANCELLED";
}

// Orders have no customer table the admin can read (profiles are
// owner-only), so a customer is identified by their own fields.
function customerKeyOf(o) {
  if (o.user_id) return "u:" + String(o.user_id).toLowerCase();
  const phone = normalizePhone(o.phone);
  if (phone) return "p:" + phone;
  const email = String(o.email || "").trim().toLowerCase();
  if (email) return "e:" + email;
  const name = String(o.customer_name || "").trim().toLowerCase();
  return name ? "n:" + name : null;
}

function itemsSummary(o, max) {
  const items = itemsOf(o);
  const limit = max || 2;
  const names = items.map(function (it) {
    const qty = Number(it.qty) || 0;
    return (it.name || "Item") + (qty > 1 ? " ×" + qty : "");
  });
  if (!names.length) return "—";
  if (names.length <= limit) return names.join(", ");
  return names.slice(0, limit).join(", ") + " +" + (names.length - limit) + " more";
}

function resStatusLabel(s) {
  return RESERVATION_LABELS[s] || String(s || "Unknown");
}

function resStatusClass(s) {
  return RESERVATION_STATUSES.indexOf(s) !== -1 ? "status-" + s : "status-UNKNOWN";
}

function orderLabel(o) {
  if (isIrisOrder(o)) {
    const n = o.order_number;
    return n === null || n === undefined || n === "" ? "IRIS-—" : String(n);
  }
  const n = o.order_no;
  if (n === null || n === undefined || n === "") return "ORD-—";
  return "ORD-" + String(n).padStart(4, "0");
}

function orderKey(o) {
  return (isIrisOrder(o) ? "iris-" : "") + String(o.id != null ? o.id : (o.order_no || o.order_number));
}

// An Iris row is looked up from the merged list by key, so the detail page,
// the links and the badges all resolve the source from the row itself.
function isIrisOrder(o) {
  return !!o && o.__src === "iris";
}

// Iris rows speak `requested_at`; website rows were placed when created.
function orderDateOf(o) {
  return isIrisOrder(o) ? (o.requested_at || o.created_at) : o.created_at;
}

function orderMatchesFilter(o, filter) {
  if (filter === "ALL") return true;
  if (isIrisOrder(o)) {
    // The website chips are about the website flow; an Iris row only joins a
    // chip when its own status text says the same thing.
    const irisStatus = String(o.status || "").toUpperCase();
    if (filter === "AWAITING_PAYMENT") return !isIrisPaid(o);
    if (filter === "PAID_READY") return isIrisPaid(o) && irisStatus === "PENDING_APPROVAL";
    return irisStatus === filter;
  }
  if (filter === "AWAITING_PAYMENT") return isUnpaidPending(o);
  if (filter === "PAID_READY") return o.status === "PENDING_APPROVAL" && !!o.paid_at;
  return o.status === filter;
}

function totalOf(o) {
  return Number(o.total) || 0;
}

function itemsOf(o) {
  if (isIrisOrder(o)) {
    return (Array.isArray(o.items) ? o.items : []).map(function (it) {
      return {
        name: it.name,
        qty: Number(it.quantity) || 0,
        price: (Number(it.unit_price_minor) || 0) / 100
      };
    });
  }
  if (Array.isArray(o.items)) return o.items;
  if (typeof o.items === "string") {
    try {
      const parsed = JSON.parse(o.items);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

function normalizePhone(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.indexOf("234") === 0) d = d.slice(3);
  return d.replace(/^0/, "");
}

function phoneIntl(p) {
  return "+234" + normalizePhone(p);
}

function waNumber(p) {
  return "234" + normalizePhone(p);
}

// The one cleaner behind every phone control in the dashboard. Staff and
// customers type numbers however they like, so spaces, dashes, dots and
// brackets go first: "0803 123 4567", "(0803) 123-4567" and "2348031234567"
// all dial as tel:+2348031234567, and a number that already starts with + is
// kept as it is. Anything missing or too short to dial returns null, so the
// caller can show "No phone number" instead of a link that does nothing.
function dialNumber(value) {
  const cleaned = String(value || "").replace(/[\s\-().]/g, "");
  if (!cleaned) return null;

  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 10) return null;

  if (cleaned.charAt(0) === "+") return "+" + digits;
  if (digits.charAt(0) === "0") return "+234" + digits.slice(1);
  if (digits.slice(0, 3) === "234") return "+" + digits;
  if (digits.length === 10) return "+234" + digits;
  return null;
}

// Website order rows keep the number in "phone"; the Iris RPC calls it
// "customer_phone".
function orderPhoneOf(o) {
  return String((isIrisOrder(o) ? o.customer_phone : o.phone) || "");
}

function orderNameOf(o) {
  return String(o.customer_name || "");
}

const PHONE_ICON_SVG =
  '<svg class="admin-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"' +
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 15.6 15.6 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 15.6 15.6 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>' +
  '</svg>';

const COPY_ICON_SVG =
  '<svg class="admin-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"' +
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="9" y="9" width="12" height="12" rx="2"/>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
  '</svg>';

// Dial + copy for one customer, drawn the same way on the order page, an
// orders row and the customers list. `options.compact` is the in-row version:
// icon-only buttons, because a table row has no room for the words.
// `target` says what the call was about, for the activity log entry.
function callControlsHtml(phone, name, target, options) {
  const opts = options || {};
  const dial = dialNumber(phone);

  if (!dial) return '<span class="admin-no-phone">No phone number</span>';

  const who = String(name || "").trim();
  const label = "Call customer" + (who ? " " + who : "");
  const callAttrs =
    ' data-call-name="' + esc(who) + '"' +
    (target && target.type ? ' data-call-type="' + esc(target.type) + '"' : "") +
    (target && target.id != null ? ' data-call-id="' + esc(target.id) + '"' : "") +
    (target && target.label ? ' data-call-label="' + esc(target.label) + '"' : "");
  const copyAttrs =
    ' data-copy-number="' + esc(dial) + '"' +
    ' data-copy-text="' + esc(opts.compact ? "Copy" : "Copy number") + '"';

  if (opts.compact) {
    return '<span class="admin-contact admin-contact--compact">' +
      '<a class="admin-call-icon" href="tel:' + esc(dial) + '"' + callAttrs +
        ' aria-label="' + esc(label) + '" title="' + esc(label) + '">' + PHONE_ICON_SVG +
        '<span class="admin-call-text">Call</span></a>' +
      '<span class="admin-phone-number">' + esc(phone) + "</span>" +
      '<button type="button" class="admin-copy-icon"' + copyAttrs +
        ' aria-label="Copy number ' + esc(phone) + '" title="Copy number">' + COPY_ICON_SVG +
        '<span class="admin-copy-text">Copy</span></button>' +
    "</span>";
  }

  return '<span class="admin-contact">' +
    '<a class="btn-admin-outline admin-call-btn" href="tel:' + esc(dial) + '"' + callAttrs + ">" +
      PHONE_ICON_SVG + '<span class="admin-call-text">Call customer</span></a>' +
    '<span class="admin-phone-number">' + esc(phone) + "</span>" +
    '<button type="button" class="btn-admin-outline admin-copy-btn"' + copyAttrs + ">" +
      COPY_ICON_SVG + '<span class="admin-copy-text">Copy number</span></button>' +
  "</span>";
}

// The WhatsApp button that was already here, now always beside Call.
function whatsappControlHtml(phone) {
  const dial = dialNumber(phone);
  if (!dial) return "";
  return '<a class="btn-admin-outline admin-wa-btn" href="https://wa.me/' + esc(waNumber(phone)) + '"' +
    ' target="_blank" rel="noopener">WhatsApp</a>';
}

/* ── Call + copy wiring ── */

const COPIED_TEXT_MS = 1800;

function markCopied(btn) {
  const text = btn.querySelector(".admin-copy-text");
  if (!text) return;

  const original = btn.getAttribute("data-copy-text") || "Copied";
  clearTimeout(btn._copyTimer);
  text.textContent = "Copied";
  btn.classList.add("is-copied");
  btn._copyTimer = setTimeout(function () {
    text.textContent = original;
    btn.classList.remove("is-copied");
  }, COPIED_TEXT_MS);
}

// No number on screen is ever a dead end: if the clipboard is blocked (a
// browser that refuses it, or a plain http connection) the old execCommand
// path still works, and failing both the number stays visible to select.
function legacyCopy(value) {
  try {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-100px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch (err) {
    return false;
  }
}

async function copyPhoneNumber(btn) {
  const value = btn.getAttribute("data-copy-number") || "";
  if (!value) return;

  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(value);
      copied = true;
    }
  } catch (err) {
    copied = false;
  }
  if (!copied) copied = legacyCopy(value);

  if (copied) {
    markCopied(btn);
    toast("Number copied: " + value);
  } else {
    toast("Could not copy the number — it is on the screen, so you can select it.");
  }
}

// One row in the same log the approve/reject buttons already write to; the
// action column reads "Called customer", the note carries who and what it was
// about, and actor_email + created_at are stored by the log itself.
async function logCustomerCall(link) {
  const name = link.getAttribute("data-call-name") || "";
  const type = link.getAttribute("data-call-type") || "customer";
  const id = link.getAttribute("data-call-id") || "";
  const about = link.getAttribute("data-call-label") || "";

  let note = name;
  if (about) note += (note ? " " : "") + "about order " + about;

  const res = await logActivity("CUSTOMER_CALLED", type, id, note);
  if (res && res.error) {
    toast("The call was made, but it could not be added to the activity log.");
  }
}

function bindCallControls() {
  // These controls are re-rendered constantly, so one delegated listener on
  // the document covers every place they appear.
  document.addEventListener("click", function (event) {
    const node = event.target;
    if (!node || !node.closest) return;

    const copy = node.closest("[data-copy-number]");
    if (copy) {
      event.preventDefault();
      copyPhoneNumber(copy);
      return;
    }

    // The tel: link is left alone so the dialler still opens; recording the
    // call happens alongside it.
    const call = node.closest("[data-call-name]");
    if (call) logCustomerCall(call);
  });
}

function formatTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// reservation_date is a plain date (YYYY-MM-DD) — parse it locally so
// the weekday never shifts because of a timezone.
function formatDate(value) {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return String(value);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function guestsLabel(n) {
  const v = Number(n) || 0;
  return v + (v === 1 ? " guest" : " guests");
}

function activityLabel(action) {
  if (ACTIVITY_LABELS[action]) return ACTIVITY_LABELS[action];
  const text = String(action || "Action").replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function activityTarget(entry) {
  if (entry.target_type === "order") {
    const o = state.orders.find(function (x) {
      return String(x.id) === String(entry.target_id);
    });
    return o ? orderLabel(o) : "Order";
  }
  if (entry.target_type === "reservation") {
    const r = state.reservations.find(function (x) {
      return String(x.id) === String(entry.target_id);
    });
    return r ? "Reservation — " + (r.customer_name || "guest") : "Reservation";
  }
  if (entry.target_type === "menu_item") {
    const item = state.menu.find(function (x) {
      return String(x.id) === String(entry.target_id);
    });
    return item ? item.name : "Menu item";
  }
  return entry.target_type || "—";
}

/* ── Element refs ── */
const el = {};

function cacheElements() {
  el.boot = document.getElementById("bootView");
  el.login = document.getElementById("loginView");
  el.loginForm = document.getElementById("loginForm");
  el.loginEmail = document.getElementById("loginEmail");
  el.loginPassword = document.getElementById("loginPassword");
  el.loginBtn = document.getElementById("loginBtn");
  el.loginError = document.getElementById("loginError");

  el.menuBtn = document.getElementById("adminMenuBtn");
  el.sidebar = document.getElementById("adminSidebar");
  el.sidebarBackdrop = document.getElementById("sidebarBackdrop");
  el.sidebarClose = document.getElementById("sidebarCloseBtn");
  el.pageTitle = document.getElementById("adminPageTitle");
  el.breadcrumb = document.getElementById("adminBreadcrumb");
  el.userEmail = document.getElementById("adminUserEmail");
  el.signOutBtn = document.getElementById("signOutBtn");
  el.liveNote = document.getElementById("liveNote");
  el.liveStatus = document.getElementById("liveStatus");
  el.enableAlerts = document.getElementById("enableAlertsBtn");
  el.alertStack = document.getElementById("adminAlertStack");
  el.ordersBadge = document.getElementById("ordersBadge");
  el.reservationsBadge = document.getElementById("reservationsBadge");
  el.main = document.getElementById("adminMain");

  el.dashboardBody = document.getElementById("dashboardBody");
  el.filters = document.getElementById("statusFilters");
  el.sourceFilters = document.getElementById("sourceFilters");
  el.orderStats = document.getElementById("orderStats");
  el.ordersList = document.getElementById("ordersList");
  el.reservationFilters = document.getElementById("reservationFilters");
  el.reservationsList = document.getElementById("reservationsList");
  el.customersList = document.getElementById("customersList");
  el.activityList = document.getElementById("activityList");
  el.customerSearch = document.getElementById("customerSearch");
  el.menuSearch = document.getElementById("menuSearch");
  el.menuList = document.getElementById("menuList");

  el.orderDetail = document.getElementById("orderDetailBody");
  el.navOrderDetail = document.getElementById("navOrderDetail");

  el.modal = document.getElementById("modal");
  el.modalTitle = document.getElementById("modalTitle");
  el.modalBody = document.getElementById("modalBody");
  el.modalFields = document.getElementById("modalFields");
  el.modalInput = document.getElementById("modalInput");
  el.modalCancel = document.getElementById("modalCancel");
  el.modalConfirm = document.getElementById("modalConfirm");

  el.toast = document.getElementById("toast");
}

/* ── Auth gate ── */

// A session is only trusted once is_admin() confirms it. While that
// check is running, the onAuthStateChange handler below stays quiet so a
// customer session can never paint the dashboard even for a moment.
let authCheckInProgress = false;

function showLoginError(message, field) {
  if (!el.loginError) return;
  el.loginError.textContent = message;
  el.loginError.hidden = false;
  if (field && typeof field.focus === "function") field.focus();
}

function hideLoginError() {
  if (!el.loginError) return;
  el.loginError.hidden = true;
  el.loginError.textContent = "";
}

function showLogin(message) {
  el.boot.hidden = true;
  el.login.hidden = false;
  el.main.hidden = true;
  el.menuBtn.hidden = true;
  el.sidebar.hidden = true;
  closeNav();
  el.liveNote.hidden = true;
  if (message) showLoginError(message);
  else hideLoginError();
}

function resetDataState() {
  state.orders = [];
  state.reservations = [];
  state.activity = [];
  state.menu = [];
  state.irisOrders = [];
  state.irisStats = null;
  state.irisUpdatedAt = null;
  state.irisLoading = true;
  state.irisError = null;
  state.irisStatsError = null;
  state.ordersLoading = true;
  state.resLoading = true;
  state.activityLoading = true;
  state.menuLoading = true;
  state.ordersError = null;
  state.resError = null;
  state.activityError = null;
  state.menuError = null;
  state.menuActionError = null;
  state.menuSavingId = null;
  state.menuSavingRemarksId = null;
  state.menuRemarksDraft = {};
  state.menuNoteOpen = {};
  state.resActionError = null;
  state.saving = false;
  state.dashboardSig = "";
}

function setLoggedOut() {
  state.authed = false;
  stopRealtime();
  stopPolling();
  resetDataState();
  state.statusFilter = "ALL";
  state.sourceFilter = "ALL";
  state.resFilter = "ALL";
  state.customerSearch = "";
  state.menuSearch = "";
  state.newOrders = 0;
  state.newReservations = 0;
  state.titleCount = 0;
  state.titleLabel = "New order";
  if (el.customerSearch) el.customerSearch.value = "";
  if (el.menuSearch) el.menuSearch.value = "";
  closeModal();
  clearTopAlerts();
  updateBadges();
  updateTitle();
  if (el.loginForm) el.loginForm.reset();
  setRoute(DEFAULT_ROUTE);
  showLogin();
}

function setAuthed(session) {
  if (state.authed) return;
  state.authed = true;
  state.userEmail = session && session.user ? (session.user.email || "") : "";
  if (el.userEmail) el.userEmail.textContent = state.userEmail;

  el.boot.hidden = true;
  el.login.hidden = true;
  el.main.hidden = false;
  el.menuBtn.hidden = false;
  el.sidebar.hidden = false;
  document.body.classList.add("admin-nav-shown");
  el.liveNote.hidden = false;
  hideLoginError();
  const route = parseRoute();
  applyRoute(route.name, route.param, true);
  updateAlertsButton();
  startRealtime();
  startPolling();
  loadDashboard();
}

function setLoginBusy(busy) {
  if (!el.loginBtn) return;
  el.loginBtn.disabled = busy;
  el.loginBtn.textContent = busy ? "Signing in…" : "Sign in";
  el.loginBtn.setAttribute("aria-busy", busy ? "true" : "false");
}

// The database decides who is an admin. Anything other than a literal
// `true` (false, no row, a missing function, a network error) is denied.
async function verifyAdminAccess() {
  try {
    const res = await client.rpc("is_admin");
    return !res.error && res.data === true;
  } catch (err) {
    return false;
  }
}

async function denyNonAdmin() {
  // Drop the session first so a refresh cannot slip them into the
  // dashboard, then put the login screen back with the reason.
  try {
    await client.auth.signOut();
  } catch (err) {
    /* Ignore — setLoggedOut still clears this page below. */
  }
  setLoggedOut();
  showLogin("This account is not an admin account.");
}

async function verifyAndEnter(session) {
  if (authCheckInProgress) return;
  authCheckInProgress = true;

  try {
    if (await verifyAdminAccess()) setAuthed(session);
    else await denyNonAdmin();
  } finally {
    authCheckInProgress = false;
  }
}

function loginErrorMessage(err) {
  const msg = (err && (err.message || err.error_description)) || "";
  const lower = msg.toLowerCase();
  if (lower.indexOf("invalid login") !== -1) return "Incorrect email or password.";
  if (lower.indexOf("email not confirmed") !== -1) return "This account's email has not been confirmed yet.";
  if (lower.indexOf("invalid") !== -1 && lower.indexOf("email") !== -1) return "Please enter a valid email address.";
  return msg || "Could not sign in. Please try again.";
}

async function handleLogin(event) {
  event.preventDefault();
  hideLoginError();

  const email = el.loginEmail.value.trim();
  const password = el.loginPassword.value;

  if (!email) { showLoginError("Please enter your email address.", el.loginEmail); return; }
  if (!password) { showLoginError("Please enter your password.", el.loginPassword); return; }
  if (!client) {
    showLoginError("Could not connect to Supabase. Check your connection and reload the page.");
    return;
  }

  setLoginBusy(true);
  let result;
  try {
    result = await client.auth.signInWithPassword({ email: email, password: password });
  } catch (err) {
    result = { error: err };
  }
  if (result.error) {
    setLoginBusy(false);
    showLoginError(loginErrorMessage(result.error));
    el.loginPassword.value = "";
    el.loginPassword.focus();
    return;
  }

  el.loginPassword.value = "";

  const session = result.data && result.data.session ? result.data.session : null;
  if (!session) {
    setLoginBusy(false);
    return;
  }

  await verifyAndEnter(session);
  setLoginBusy(false);
}

async function handleSignOut() {
  if (!client) { setLoggedOut(); return; }
  el.signOutBtn.disabled = true;
  let error = null;
  try {
    const res = await client.auth.signOut();
    error = res.error;
  } catch (err) {
    error = err;
  }
  el.signOutBtn.disabled = false;
  if (error) {
    toast("Could not sign out: " + errorText(error));
    return;
  }
  setLoggedOut();
}

/* ── Data ── */
function loadDashboard() {
  return Promise.all([loadOrders(), loadReservations(), loadActivity(), loadMenu(), loadIris()]);
}

// Iris rows are read through the two admin-only RPC functions. Nothing here
// writes: the iris_ tables belong to Iris.
function tagIrisOrders(rows) {
  return (Array.isArray(rows) ? rows : []).map(function (r) {
    return Object.assign({}, r, { __src: "iris" });
  });
}

function irisSignature(rows) {
  return rows.map(function (r) {
    return [r.id, r.status, r.payment_status, r.total_minor, r.order_number].join(":");
  }).join("|");
}

async function loadIris(opts) {
  if (!client) return;
  const silent = !!(opts && opts.silent);

  if (!silent) {
    state.irisLoading = true;
    state.irisError = null;
    state.irisStatsError = null;
    renderOrders();
    renderDashboard();
  }

  let stats = null;
  let orders = null;
  let statsError = null;
  let ordersError = null;

  try {
    const res = await client.rpc(IRIS_STATS_RPC);
    if (res.error) statsError = res.error;
    else stats = res.data;
  } catch (err) {
    statsError = err;
  }

  try {
    const res = await client.rpc(IRIS_ORDERS_RPC);
    if (res.error) ordersError = res.error;
    else orders = res.data;
  } catch (err) {
    ordersError = err;
  }

  // A failed stats read never invents a number: numbers already on screen stay
  // there behind a "could not refresh" note, and only a first-load failure puts
  // the error phrase on the cards.
  let changed = !silent;

  if (stats) {
    changed = changed || JSON.stringify(stats) !== JSON.stringify(state.irisStats);
    state.irisStats = stats;
    state.irisStatsError = null;
  } else {
    changed = changed || !state.irisStatsError;
    state.irisStatsError = statsError;
  }

  if (orders) {
    const tagged = tagIrisOrders(orders);
    changed = changed || irisSignature(tagged) !== irisSignature(state.irisOrders);
    state.irisOrders = tagged;
    state.irisError = null;
    state.irisUpdatedAt = Date.now();
  } else if (!silent) {
    state.irisError = ordersError;
    state.irisOrders = [];
  }

  state.irisLoading = false;
  if (!changed) return;
  renderOrders();
  renderDashboard();
}

async function loadOrders(opts) {
  if (!client) return;
  const silent = !!(opts && opts.silent);

  if (!silent) {
    state.ordersLoading = true;
    state.ordersError = null;
    renderOrders();
    renderCustomers();
    renderOrderDetail();
    renderDashboard();
  }

  let next = null;
  let error = null;

  try {
    const res = await client
      .from("orders")
      .select("id, order_no, customer_name, phone, email, address, items, total, status, paid_at, created_at, user_id")
      .order("created_at", { ascending: false, nullsFirst: false });

    if (res.error) error = res.error;
    else next = res.data || [];
  } catch (err) {
    error = err;
  }

  // Silent refreshes (polling / realtime catch-up) must never blank the
  // list or interrupt the admin — only repaint when the data changed.
  if (silent) {
    if (error || !next) return;
    if (ordersSignature(next) === ordersSignature(state.orders)) return;
    state.orders = next;
    state.ordersLoading = false;
    state.ordersError = null;
    renderOrders();
    renderCustomers();
    renderOrderDetail();
    renderDashboard();
    renderActivity();
    return;
  }

  if (error) {
    state.ordersError = error;
    state.orders = [];
  } else {
    state.orders = next || [];
  }

  state.ordersLoading = false;
  renderOrders();
  renderCustomers();
  renderOrderDetail();
  renderDashboard();
  renderActivity();
}

async function loadReservations(opts) {
  if (!client) return;
  const silent = !!(opts && opts.silent);

  if (!silent) {
    state.resLoading = true;
    state.resError = null;
    renderReservations();
  }

  let next = null;
  let error = null;

  try {
    const res = await client
      .from("reservations")
      .select("id, customer_name, phone, email, party_size, reservation_date, reservation_time, notes, status, paid_at, created_at")
      .order("created_at", { ascending: false, nullsFirst: false });

    if (res.error) error = res.error;
    else next = res.data || [];
  } catch (err) {
    error = err;
  }

  if (silent) {
    if (error || !next) return;
    if (reservationsSignature(next) === reservationsSignature(state.reservations)) return;
    state.reservations = next;
    state.resLoading = false;
    state.resError = null;
    renderReservations();
    renderActivity();
    return;
  }

  if (error) {
    state.resError = error;
    state.reservations = [];
  } else {
    state.reservations = next || [];
  }

  state.resLoading = false;
  renderReservations();
  renderActivity();
}

async function loadActivity(opts) {
  if (!client) return;
  const silent = !!(opts && opts.silent);

  if (!silent) {
    state.activityLoading = true;
    state.activityError = null;
    renderActivity();
  }

  let next = null;
  let error = null;

  try {
    const res = await client
      .from("activity_log")
      .select("id, actor_email, action, target_type, target_id, note, created_at")
      .order("created_at", { ascending: false, nullsFirst: false });

    if (res.error) error = res.error;
    else next = res.data || [];
  } catch (err) {
    error = err;
  }

  // Silent refreshes (realtime catch-up / polling) never blank the list.
  if (silent) {
    if (error || !next) return;
    if (activitySignature(next) === activitySignature(state.activity)) return;
    state.activity = next;
    state.activityError = null;
    state.activityLoading = false;
    renderActivity();
    renderOrderDetail();
    return;
  }

  if (error) {
    state.activityError = error;
    state.activity = [];
  } else {
    state.activity = next || [];
  }

  state.activityLoading = false;
  renderActivity();
  renderOrderDetail();
}

async function loadMenu(opts) {
  if (!client) return;
  const silent = !!(opts && opts.silent);

  if (!silent) {
    state.menuLoading = true;
    state.menuError = null;
    renderMenu();
    renderDashboard();
  }

  let next = null;
  let error = null;

  try {
    const res = await client
      .from("menu_admin")
      .select("id, slug, name, category, description, price, image_url, available, remarks, sort_order, updated_at")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (res.error) error = res.error;
    else next = res.data || [];
  } catch (err) {
    error = err;
  }

  if (silent) {
    if (error || !next) return;
    if (menuSignature(next) === menuSignature(state.menu)) return;
    state.menu = next;
    state.menuLoading = false;
    state.menuError = null;
    renderMenu();
    renderActivity();
    renderDashboard();
    return;
  }

  if (error) {
    state.menuError = error;
    state.menu = [];
  } else {
    state.menu = next || [];
  }

  state.menuLoading = false;
  renderMenu();
  renderActivity();
  renderDashboard();
}

function menuSignature(items) {
  return (items || []).map(function (item) {
    return [
      item.id,
      item.available ? 1 : 0,
      item.remarks || "",
      item.name || "",
      item.category || "",
      item.image_url || "",
      item.price
    ].join("~");
  }).join("|");
}

/* ── Dashboard (computed from the loaded orders + menu only) ── */
const CHART_PALETTE = [
  "#FF5A36", "#E8A33D", "#6FAE86", "#6EA8FE", "#C58BD6",
  "#7FD69F", "#FF9C85", "#B8BEC4", "#D8B26E", "#8FA0C8"
];

function monthKey(value) {
  const d = value ? new Date(value) : null;
  if (!d || isNaN(d.getTime())) return null;
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function monthLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function dashboardData() {
  const revenueOrders = state.orders.filter(isRevenue);

  const months = new Map();
  revenueOrders.forEach(function (o) {
    const key = monthKey(o.paid_at || o.created_at);
    if (!key) return;
    months.set(key, (months.get(key) || 0) + totalOf(o));
  });
  const monthKeys = Array.from(months.keys()).sort();
  const monthly = monthKeys.slice(-12).map(function (key) {
    return { key: key, label: monthLabel(key), value: months.get(key) };
  });

  const menuByName = new Map();
  state.menu.forEach(function (item) {
    menuByName.set(String(item.name || "").trim().toLowerCase(), item);
  });

  const categories = new Map();
  const dishes = new Map();

  revenueOrders.forEach(function (o) {
    itemsOf(o).forEach(function (it) {
      const qty = Number(it.qty) || 0;
      const price = Number(it.price) || 0;
      const income = qty * price;
      const name = String(it.name || "Item").trim();
      if (!name || income <= 0) return;

      const item = menuByName.get(name.toLowerCase());
      const category = (item && item.category ? String(item.category) : "Other");
      categories.set(category, (categories.get(category) || 0) + income);

      let dish = dishes.get(name.toLowerCase());
      if (!dish) {
        dish = { name: name, qty: 0, income: 0, item: item || null, price: price };
        dishes.set(name.toLowerCase(), dish);
      }
      dish.qty += qty;
      dish.income += income;
    });
  });

  const customers = new Set();
  state.orders.forEach(function (o) {
    const key = customerKeyOf(o);
    if (key) customers.add(key);
  });

  return {
    totalDishes: state.menu.length,
    totalRevenue: revenueOrders.reduce(function (sum, o) { return sum + totalOf(o); }, 0),
    totalOrders: state.orders.length,
    totalCustomers: customers.size,
    monthly: monthly,
    categories: Array.from(categories.entries())
      .sort(function (a, b) { return b[1] - a[1]; }),
    trending: Array.from(dishes.values())
      .sort(function (a, b) { return b.qty - a.qty || b.income - a.income; })
      .slice(0, 6)
  };
}

function trendingCard(dish) {
  const src = dish.item ? menuImageSrc(dish.item.image_url) : "";
  const price = dish.item ? Number(dish.item.price) : dish.price;
  return '<article class="menu-card">' +
    (src ? '<img class="menu-card-img" src="' + esc(src) + '" alt="' + esc(dish.name) + '" loading="lazy">' : "") +
    '<div class="menu-card-body">' +
      '<h3 class="menu-card-name">' + esc(dish.name) + "</h3>" +
      '<div class="menu-card-price">' + money(price) + "</div>" +
      '<p class="admin-trending-meta">' + dish.qty + " ordered · " + money(dish.income) + " income</p>" +
      (dish.item ? '<p class="admin-trending-cat">' + esc(dish.item.category || "Other") + "</p>" : "") +
    "</div>" +
  "</article>";
}

function chartCanvas(id, emptyHtml) {
  return emptyHtml || '<div class="admin-chart-body"><canvas id="' + id + '"></canvas></div>';
}

function destroyCharts() {
  state.charts.forEach(function (c) {
    try { c.destroy(); } catch (err) { /* already gone */ }
  });
  state.charts = [];
}

function buildCharts(data) {
  if (!window.Chart) return;

  const tickColor = "#B8BEC4";
  const gridColor = "rgba(255, 255, 255, 0.08)";

  const revenue = document.getElementById("eqRevenueChart");
  if (revenue && data.monthly.length) {
    state.charts.push(new window.Chart(revenue, {
      type: "bar",
      data: {
        labels: data.monthly.map(function (m) { return m.label; }),
        datasets: [{
          label: "Paid revenue",
          data: data.monthly.map(function (m) { return m.value; }),
          backgroundColor: "#FF5A36",
          borderRadius: 4,
          maxBarThickness: 42
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) { return money(ctx.parsed.y); }
            }
          }
        },
        scales: {
          x: { ticks: { color: tickColor }, grid: { color: gridColor } },
          y: {
            ticks: { color: tickColor, callback: function (v) { return "₦" + Number(v).toLocaleString("en-NG"); } },
            grid: { color: gridColor }
          }
        }
      }
    }));
  }

  const byCategory = document.getElementById("eqCategoryChart");
  if (byCategory && data.categories.length) {
    state.charts.push(new window.Chart(byCategory, {
      type: "doughnut",
      data: {
        labels: data.categories.map(function (c) { return c[0]; }),
        datasets: [{
          data: data.categories.map(function (c) { return c[1]; }),
          backgroundColor: data.categories.map(function (c, i) {
            return CHART_PALETTE[i % CHART_PALETTE.length];
          }),
          borderColor: "#0b0d11",
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { color: tickColor, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.label + ": " + money(ctx.parsed);
              }
            }
          }
        }
      }
    }));
  }
}

function dashboardSignature() {
  return [
    state.ordersLoading ? 1 : 0,
    state.menuLoading ? 1 : 0,
    state.ordersError ? 1 : 0,
    state.menuError ? 1 : 0,
    ordersSignature(state.orders),
    menuSignature(state.menu),
    state.irisLoading ? 1 : 0,
    state.irisStatsError ? 1 : 0,
    state.irisError ? 1 : 0,
    irisSignature(state.irisOrders),
    state.irisStats ? JSON.stringify(state.irisStats) : "-"
  ].join("::");
}

const IRIS_ERROR_TEXT = "Could not load Iris data";

function irisNum(v) {
  if (v === null || v === undefined) return "—";
  return Number(v).toLocaleString("en-NG");
}

// Three cards, and never a made-up figure: while the first read is in flight
// they show a dash, and if it failed they say so. A later failed refresh keeps
// the last real numbers and only changes the note.
function irisCardsHtml() {
  const stats = state.irisStats;

  if (state.irisStatsError && !stats) {
    return ["Iris conversations", "Iris orders", "Iris order value"].map(function (label) {
      return '<div class="admin-stat admin-stat--iris admin-stat--error">' +
        '<span class="admin-stat-label">' + esc(label) + "</span>" +
        '<span class="admin-stat-value">' + esc(IRIS_ERROR_TEXT) + "</span>" +
        '<span class="admin-stat-note"><button type="button" class="btn-admin-ghost" data-iris-retry="1">Try again</button></span>' +
      "</div>";
    }).join("");
  }

  const staleNote = state.irisStatsError ? "Could not refresh Iris data" : "";

  if (!stats) {
    return ["Iris conversations", "Iris orders", "Iris order value"].map(function (label) {
      return '<div class="admin-stat admin-stat--iris">' +
        '<span class="admin-stat-label">' + esc(label) + "</span>" +
        '<span class="admin-stat-value">—</span>' +
        '<span class="admin-stat-note">Loading…</span>' +
      "</div>";
    }).join("");
  }

  const open = stats.chats_open == null ? null : Number(stats.chats_open);

  return '<div class="admin-stat admin-stat--iris">' +
      '<span class="admin-stat-label">Iris conversations</span>' +
      '<span class="admin-stat-value">' + esc(irisNum(stats.chats_total)) + "</span>" +
      '<span class="admin-stat-note">' + (staleNote
        ? esc(staleNote)
        : open === null ? "—" : open === 1 ? "1 open now" : irisNum(open) + " open now") + "</span>" +
    "</div>" +
    '<div class="admin-stat admin-stat--iris">' +
      '<span class="admin-stat-label">Iris orders</span>' +
      '<span class="admin-stat-value">' + esc(irisNum(stats.orders_total)) + "</span>" +
      '<span class="admin-stat-note">' + (staleNote ? esc(staleNote) : "The 200 newest are listed under Orders") + "</span>" +
    "</div>" +
    '<div class="admin-stat admin-stat--iris">' +
      '<span class="admin-stat-label">Iris order value</span>' +
      '<span class="admin-stat-value">' + esc(stats.orders_value_minor == null
        ? "—"
        : moneyMinor(stats.orders_value_minor, "NGN")) + "</span>" +
      '<span class="admin-stat-note">' + (staleNote ? esc(staleNote) : "All Iris orders, before refunds") + "</span>" +
    "</div>";
}

function irisSectionHtml() {
  return '<section class="admin-chart-card admin-iris-card">' +
    "<h2>Iris</h2>" +
    '<div class="admin-stats-grid">' + irisCardsHtml() + "</div>" +
    '<p class="admin-chart-note">Read-only from the Iris functions. Website totals above do not include Iris orders.</p>' +
  "</section>";
}

function renderDashboard() {
  if (!el.dashboardBody) return;

  const sig = dashboardSignature();
  if (sig === state.dashboardSig) return;
  state.dashboardSig = sig;

  const bindIrisRetry = function () {
    el.dashboardBody.querySelectorAll("[data-iris-retry]").forEach(function (b) {
      b.addEventListener("click", function () { loadIris(); });
    });
  };

  if (state.ordersLoading || state.menuLoading) {
    destroyCharts();
    el.dashboardBody.innerHTML = '<p class="empty">Loading dashboard…</p>' + irisSectionHtml();
    bindIrisRetry();
    return;
  }
  if (state.ordersError) {
    destroyCharts();
    renderLoadError(el.dashboardBody, state.ordersError, loadOrders);
    el.dashboardBody.insertAdjacentHTML("beforeend", irisSectionHtml());
    bindIrisRetry();
    return;
  }

  const data = dashboardData();

  destroyCharts();
  el.dashboardBody.innerHTML =
    '<div class="admin-stats-grid">' +
      statCard("Total dishes", String(data.totalDishes), "From the admin menu") +
      statCard("Total revenue", money(data.totalRevenue), "Paid orders only") +
      statCard("Total orders", String(data.totalOrders), "All orders on record") +
      statCard("Total customers", String(data.totalCustomers), "Distinct customers who ordered") +
    "</div>" +
    irisSectionHtml() +
    '<div class="admin-chart-grid">' +
      '<section class="admin-chart-card">' +
        "<h2>Monthly revenue</h2>" +
        chartCanvas("eqRevenueChart", data.monthly.length ? "" :
          '<p class="empty">No paid orders yet. Revenue appears here once an order is marked as paid.</p>') +
        '<p class="admin-chart-note">Paid orders, grouped by the month they were paid.</p>' +
      "</section>" +
      '<section class="admin-chart-card">' +
        "<h2>Sales by category</h2>" +
        chartCanvas("eqCategoryChart", data.categories.length ? "" :
          '<p class="empty">No dish sales to group yet.</p>') +
        '<p class="admin-chart-note">Order items matched to their menu category.</p>' +
      "</section>" +
    "</div>" +
    '<section class="admin-chart-card admin-trending-card">' +
      "<h2>Trending dishes</h2>" +
      (data.trending.length
        ? '<div class="menu-cards admin-menu-grid">' + data.trending.map(trendingCard).join("") + "</div>"
        : '<p class="empty">No dishes sold yet.</p>') +
    "</section>" +
    (window.Chart ? "" :
      '<p class="admin-chart-note">The chart library did not load, so the two charts above show their data as text-only totals. Everything else still works.</p>');

  buildCharts(data);
  bindIrisRetry();
}

async function logActivity(action, targetType, targetId, note) {
  if (!client) return { error: { message: "Not connected to Supabase." } };
  try {
    const res = await client.from("activity_log").insert({
      actor_email: state.userEmail || null,
      action: action,
      target_type: targetType,
      target_id: targetId == null ? null : String(targetId),
      note: note == null ? null : String(note)
    });
    return { error: res.error || null };
  } catch (err) {
    return { error: err };
  }
}

/* ── Rendering ── */
function renderFilters() {
  el.filters.innerHTML = ORDER_FILTERS.map(function (key) {
    return '<button type="button" class="filter-btn' + (state.statusFilter === key ? " active" : "") +
      '" data-status="' + key + '">' + esc(ORDER_FILTER_LABELS[key] || key) + "</button>";
  }).join("");

  el.filters.querySelectorAll(".filter-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      state.statusFilter = b.getAttribute("data-status");
      renderFilters();
      renderOrders();
    });
  });
}

function renderSourceFilters() {
  if (!el.sourceFilters) return;
  el.sourceFilters.innerHTML = SOURCE_FILTERS.map(function (key) {
    const count = key === "ALL" ? allOrders().length
      : key === "IRIS" ? state.irisOrders.length
      : state.orders.length;
    return '<button type="button" class="filter-btn' + (state.sourceFilter === key ? " active" : "") +
      '" data-source="' + key + '">' + esc(SOURCE_FILTER_LABELS[key] || key) +
      ' <span class="filter-count">' + count + "</span></button>";
  }).join("");

  el.sourceFilters.querySelectorAll(".filter-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      state.sourceFilter = b.getAttribute("data-source");
      renderSourceFilters();
      renderOrders();
    });
  });
}

function renderReservationFilters() {
  const opts = ["ALL"].concat(RESERVATION_STATUSES);
  el.reservationFilters.innerHTML = opts.map(function (s) {
    return '<button type="button" class="filter-btn' + (state.resFilter === s ? " active" : "") +
      '" data-status="' + s + '">' + (s === "ALL" ? "All" : esc(resStatusLabel(s))) + "</button>";
  }).join("");

  el.reservationFilters.querySelectorAll(".filter-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      state.resFilter = b.getAttribute("data-status");
      renderReservationFilters();
      renderReservations();
    });
  });
}

function menuImageSrc(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^(?:https?:)?\/\//i.test(s) || s.charAt(0) === "/" || s.indexOf("images/") === 0) return s;
  return "images/" + s;
}

function menuCardHtml(item) {
  const id = String(item.id);
  const saving = state.menuSavingId === item.id;
  const savingRemarks = state.menuSavingRemarksId === item.id;
  const unavailable = !item.available;
  const remarks = state.menuRemarksDraft[id] !== undefined
    ? state.menuRemarksDraft[id]
    : (item.remarks || "");
  const noteOpen = !!state.menuNoteOpen[id];
  const src = menuImageSrc(item.image_url);
  const name = esc(item.name);

  return '<article class="menu-card' + (unavailable ? " menu-card--unavailable" : "") + '" data-menu-id="' + esc(id) + '">' +
    (src ? '<img class="menu-card-img" src="' + esc(src) + '" alt="' + name + '" loading="lazy">' : "") +
    '<div class="menu-card-body">' +
      (unavailable ? '<span class="menu-unavailable-badge">Unavailable</span>' : "") +
      '<h3 class="menu-card-name">' + name + "</h3>" +
      '<p class="menu-card-desc">' + esc(item.description || "") + "</p>" +
      '<div class="menu-card-price">' + money(item.price) + "</div>" +
      '<div class="admin-card-actions">' +
        '<span class="admin-card-switch">' +
          '<button type="button" class="menu-switch' + (item.available ? " menu-switch--on" : "") + '"' +
            ' role="switch" aria-checked="' + (item.available ? "true" : "false") + '"' +
            ' aria-label="Availability for ' + name + '"' + (saving ? " disabled" : "") + ">" +
            '<span class="menu-switch-knob"></span>' +
          "</button>" +
          '<span class="menu-switch-label' + (item.available ? " menu-switch-label--on" : "") + '">' +
            (item.available ? "Available" : "Unavailable") + "</span>" +
        "</span>" +
        '<button type="button" class="menu-note-toggle" data-menu-note-toggle="' + esc(id) + '"' +
          ' aria-expanded="' + (noteOpen ? "true" : "false") + '">' +
          (item.remarks ? "Note ·" : "Note") + "</button>" +
      "</div>" +
      '<div class="menu-card-note"' + (noteOpen ? "" : " hidden") + ">" +
        '<input class="admin-input menu-remarks-input" type="text" placeholder="Note for Iris…"' +
          ' aria-label="Note for Iris for ' + name + '" data-menu-remarks="' + esc(id) + '"' +
          ' value="' + esc(remarks) + '">' +
        '<button type="button" class="btn-admin-outline" data-menu-save-remarks="' + esc(id) + '"' +
          (savingRemarks ? " disabled" : "") + ">" +
          (savingRemarks ? "Saving…" : "Save") + "</button>" +
      "</div>" +
    "</div>" +
  "</article>";
}

function renderMenu() {
  if (!el.menuList) return;

  if (state.menuLoading) {
    el.menuList.innerHTML = '<p class="empty">Loading menu…</p>';
    return;
  }
  if (state.menuError) {
    renderLoadError(el.menuList, state.menuError, loadMenu);
    return;
  }

  const actionAlert = state.menuActionError
    ? '<div class="admin-alert admin-alert-error" role="alert">' +
        "<strong>Could not save the change — the menu is as it was before. Please try again.</strong>" +
        '<p class="admin-alert-detail">' + esc(errorText(state.menuActionError)) + "</p>" +
      "</div>"
    : "";

  const term = String(state.menuSearch || "").trim().toLowerCase();
  const items = state.menu.filter(function (item) {
    if (term) {
      const hay = (String(item.name || "") + " " + String(item.category || "")).toLowerCase();
      if (hay.indexOf(term) === -1) return false;
    }
    return true;
  });

  if (!items.length) {
    el.menuList.innerHTML = actionAlert + '<p class="empty">' +
      (state.menu.length ? "No dishes match your search." : "No menu items yet.") +
      "</p>";
    return;
  }

  el.menuList.innerHTML = actionAlert + items.map(menuCardHtml).join("");

  el.menuList.querySelectorAll(".menu-switch").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const card = btn.closest(".menu-card");
      const id = card ? card.getAttribute("data-menu-id") : null;
      const item = state.menu.find(function (x) {
        return String(x.id) === String(id);
      });
      if (item) setMenuAvailability(item, !item.available);
    });
  });

  el.menuList.querySelectorAll("[data-menu-note-toggle]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const id = btn.getAttribute("data-menu-note-toggle");
      state.menuNoteOpen[id] = !state.menuNoteOpen[id];
      renderMenu();
      if (state.menuNoteOpen[id]) {
        const box = el.menuList.querySelector('[data-menu-remarks="' + id + '"]');
        if (box) box.focus();
      }
    });
  });

  el.menuList.querySelectorAll("[data-menu-save-remarks]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const id = btn.getAttribute("data-menu-save-remarks");
      const item = state.menu.find(function (x) {
        return String(x.id) === String(id);
      });
      if (!item) return;
      const box = el.menuList.querySelector('[data-menu-remarks="' + id + '"]');
      saveMenuRemarks(item, box ? box.value : "");
    });
  });

  el.menuList.querySelectorAll("[data-menu-remarks]").forEach(function (box) {
    box.addEventListener("input", function () {
      state.menuRemarksDraft[box.getAttribute("data-menu-remarks")] = box.value;
    });
  });
}

function renderLoadError(container, err, retryFn) {
  container.innerHTML =
    '<div class="admin-alert admin-alert-error" role="alert">' +
      "<strong>Could not load data from Supabase.</strong>" +
      '<p class="admin-alert-detail">' + esc(errorText(err)) + "</p>" +
      '<button type="button" class="btn-admin-ghost" data-retry="1">Try again</button>' +
    "</div>";

  const retry = container.querySelector("[data-retry]");
  if (retry) retry.addEventListener("click", retryFn);
}

function statCard(label, value, note) {
  return '<div class="admin-stat">' +
    '<span class="admin-stat-label">' + esc(label) + "</span>" +
    '<span class="admin-stat-value">' + esc(value) + "</span>" +
    (note ? '<span class="admin-stat-note">' + esc(note) + "</span>" : "") +
  "</div>";
}

function renderOrderStats() {
  if (!el.orderStats) return;

  const orders = state.orders;
  if (state.ordersLoading || state.ordersError || !orders.length) {
    el.orderStats.innerHTML = "";
    return;
  }

  const deliveries = orders.filter(function (o) {
    return o.status === "OUT_FOR_DELIVERY" || o.status === "DELIVERED";
  }).length;
  const paidRevenue = orders.reduce(function (sum, o) {
    return isRevenue(o) ? sum + totalOf(o) : sum;
  }, 0);
  const awaiting = orders.filter(function (o) {
    return o.status === "PENDING_APPROVAL";
  }).length;
  const cancelled = orders.filter(function (o) {
    return o.status === "CANCELLED";
  }).length;
  const cancelledPct = Math.round((cancelled / orders.length) * 100);

  el.orderStats.innerHTML =
    statCard("Deliveries", String(deliveries), "Out for delivery + delivered") +
    statCard("Paid revenue", money(paidRevenue), "Paid orders, excluding cancelled and rejected") +
    statCard("Awaiting approval", String(awaiting), "Orders not approved yet") +
    statCard("Cancelled", cancelledPct + "%", cancelled + " of " + orders.length + " orders");
}

// Website orders plus Iris orders in one newest-first list. The Iris rows are
// copies tagged with __src so the shared renderers know where to read from.
function allOrders() {
  let rows;
  if (state.sourceFilter === "WEBSITE") rows = state.orders.slice();
  else if (state.sourceFilter === "IRIS") rows = state.irisOrders.slice();
  else rows = state.orders.concat(state.irisOrders);

  return rows.sort(function (a, b) {
    const ta = new Date(orderDateOf(a) || 0).getTime() || 0;
    const tb = new Date(orderDateOf(b) || 0).getTime() || 0;
    return tb - ta;
  });
}

function orderStatusText(o) {
  return isIrisOrder(o) ? irisStatusLabel(o.status) : statusLabel(o.status);
}

// Payment gets its own labelled cell now, so the order-number cell doesn't
// repeat it.
function paymentCellText(o) {
  if (isIrisOrder(o)) return irisStatusLabel(o.payment_status || "Not recorded");
  if (o.paid_at) return "Paid";
  if (o.status === "PENDING_APPROVAL") return "Awaiting payment";
  return "—";
}

function renderOrders() {
  renderOrderStats();

  if (state.ordersLoading) {
    el.ordersList.innerHTML = '<p class="empty">Loading orders…</p>';
    return;
  }
  if (state.ordersError) {
    renderLoadError(el.ordersList, state.ordersError, loadOrders);
    return;
  }

  const irisNote = state.irisError
    ? '<p class="admin-table-note admin-table-note--warn">' + esc(IRIS_ERROR_TEXT) +
      ' — showing website orders only. <button type="button" class="btn-admin-ghost" data-iris-retry="1">Try again</button></p>'
    : (state.sourceFilter !== "WEBSITE" && state.irisOrders.length
      ? '<p class="admin-table-note">Iris orders are read-only and refresh every 30 seconds (the 200 newest).</p>'
      : "");

  const orders = allOrders().filter(function (o) {
    return orderMatchesFilter(o, state.statusFilter);
  });

  const bind = function () {
    el.ordersList.querySelectorAll("[data-iris-retry]").forEach(function (b) {
      b.addEventListener("click", function () { loadIris(); });
    });
  };

  if (!orders.length) {
    el.ordersList.innerHTML = irisNote + '<p class="empty">' +
      (allOrders().length ? "No orders match this filter." : "No orders yet.") +
      "</p>";
    bind();
    return;
  }

  el.ordersList.innerHTML =
    irisNote +
    '<div class="admin-table-wrap">' +
      '<table class="admin-table admin-table--orders">' +
        "<thead><tr>" +
          "<th>Date</th><th>Order ID</th><th>Items</th><th>Amount</th><th>Status</th><th>Payment</th><th>Contact</th><th></th>" +
        "</tr></thead>" +
        "<tbody>" +
          orders.map(function (o) {
            const total = totalOf(o);
            const unusual = !isIrisOrder(o) && total >= UNUSUAL_TOTAL
              ? '<span class="tag tag-unusual">Unusual</span>' : "";
            const cancelled = o.status === "CANCELLED" ? '<span class="tag tag-cancelled">Cancelled</span>' : "";
            return '<tr class="order-row" data-order-key="' + esc(orderKey(o)) + '">' +
              '<td data-label="Date">' + esc(formatDate(orderDateOf(o))) + "</td>" +
              '<td data-label="Order ID"><span class=\'order-number\'>' + esc(orderLabel(o)) + "</span>" +
                "<div class='order-card-tags'>" + sourceBadge(o) + unusual + cancelled + "</div></td>" +
              '<td class=\'admin-table-items\' data-label="Items">' + esc(itemsSummary(o)) + "</td>" +
              '<td class=\'admin-table-amount\' data-label="Amount">' + esc(amountTextOf(o)) + "</td>" +
              '<td data-label="Status"><span class="status ' + statusClass(o) + '">' + esc(orderStatusText(o)) + "</span></td>" +
              '<td data-label="Payment">' + esc(paymentCellText(o)) + "</td>" +
              '<td class=\'admin-table-contact\' data-label="Contact">' +
                callControlsHtml(orderPhoneOf(o), orderNameOf(o),
                  { type: "order", id: o.id, label: orderLabel(o) }, { compact: true }) +
              "</td>" +
              '<td data-label=""><a class=\'btn-admin-outline admin-view-btn\' href=\'#order/' + esc(orderKey(o)) + "'>View</a></td>" +
            "</tr>";
          }).join("") +
        "</tbody>" +
      "</table>" +
    "</div>";
  bind();
}

function customerGroups() {
  const groups = new Map();

  // Every field comes from the order rows themselves — the customers
  // page reads no other table.
  state.orders.forEach(function (o) {
    const key = customerKeyOf(o);
    if (!key) return;

    let g = groups.get(key);
    if (!g) {
      g = {
        key: key,
        name: "",
        email: "",
        phone: "",
        orders: 0,
        spent: 0,
        since: null,
        last: null
      };
      groups.set(key, g);
    }

    // Orders arrive newest first, so the first non-empty value wins.
    if (!g.name && o.customer_name) g.name = String(o.customer_name);
    if (!g.email && o.email) g.email = String(o.email);
    if (!g.phone && o.phone) g.phone = String(o.phone);

    g.orders += 1;
    if (isCounted(o)) g.spent += totalOf(o);

    const when = o.created_at ? new Date(o.created_at).getTime() : 0;
    if (when) {
      if (!g.since || when < g.since) g.since = when;
      if (!g.last || when > g.last) g.last = when;
    }
  });

  return Array.from(groups.values()).sort(function (a, b) {
    return b.spent - a.spent;
  });
}

function renderCustomers() {
  if (state.ordersLoading) {
    el.customersList.innerHTML = '<p class="empty">Loading customers…</p>';
    return;
  }
  if (state.ordersError) {
    renderLoadError(el.customersList, state.ordersError, loadOrders);
    return;
  }

  const q = state.customerSearch.trim().toLowerCase();
  const groups = customerGroups().filter(function (g) {
    if (!q) return true;
    return g.name.toLowerCase().indexOf(q) !== -1 ||
      g.phone.toLowerCase().indexOf(q) !== -1 ||
      g.email.toLowerCase().indexOf(q) !== -1;
  });

  if (!groups.length) {
    el.customersList.innerHTML = '<p class="empty">' +
      (state.orders.length ? "No customers match your search." : "No customers yet.") +
      "</p>";
    return;
  }

  el.customersList.innerHTML =
    '<p class="admin-table-note">Read-only — derived from order rows. ' +
      "Add, edit and delete are coming in phase 2.</p>" +
    '<div class="admin-table-wrap">' +
      '<table class="admin-table admin-table--customers">' +
        "<thead><tr>" +
          "<th>Name</th><th>Email</th><th>Phone</th><th>Orders</th>" +
          "<th>Total spent</th><th>Customer since</th><th>Actions</th>" +
        "</tr></thead>" +
        "<tbody>" +
          groups.map(function (g) {
            return "<tr>" +
              '<td data-label="Name">' + esc(g.name || "Unknown customer") + "</td>" +
              '<td data-label="Email">' + esc(g.email || "—") + "</td>" +
              '<td class=\'admin-table-contact\' data-label="Phone">' + callControlsHtml(g.phone, g.name, { type: "customer", id: g.key }, { compact: true }) + "</td>" +
              '<td data-label="Orders">' + g.orders + "</td>" +
              '<td class=\'admin-table-amount\' data-label="Total spent">' + money(g.spent) + "</td>" +
              '<td data-label="Customer since">' + (g.since ? esc(formatDate(new Date(g.since).toISOString())) : "—") + "</td>" +
              '<td class=\'admin-table-actions\' data-label="Actions">' +
                '<button type="button" class="btn-admin-outline" disabled title="Coming in phase 2">Add</button>' +
                '<button type="button" class="btn-admin-outline" disabled title="Coming in phase 2">Edit</button>' +
                '<button type="button" class="btn-admin-outline" disabled title="Coming in phase 2">Delete</button>' +
              "</td>" +
            "</tr>";
          }).join("") +
        "</tbody>" +
      "</table>" +
    "</div>";
}

function reservationCard(r) {
  const isPending = r.status === "PENDING";
  const isPaid = !!r.paid_at;
  const phone = r.phone || "";
  const busy = state.saving ? " disabled" : "";

  const notesHtml = r.notes
    ? '<p class="reservation-notes">' + esc(r.notes) + "</p>"
    : "";

  const paymentBlocked = isPending && !isPaid;
  const payNoteId = "resPayNote-" + r.id;

  let actionHtml = "";

  if (isPending) {
    actionHtml +=
      '<button type="button" class="btn-admin-primary res-action" data-action="confirm" data-res-id="' +
        esc(r.id) + '"' + (state.saving || paymentBlocked ? " disabled" : "") +
        (paymentBlocked ? ' aria-describedby="' + esc(payNoteId) + '"' : "") + ">Confirm</button>" +
      '<button type="button" class="btn-admin-danger res-action" data-action="cancel" data-res-id="' +
        esc(r.id) + '"' + busy + ">Cancel</button>";
  }

  if (!isPaid && r.status !== "CANCELLED") {
    actionHtml +=
      '<button type="button" class="btn-admin-outline res-action" data-action="paid" data-res-id="' +
        esc(r.id) + '"' + busy + ">Mark as paid</button>";
  }

  if (paymentBlocked) {
    actionHtml +=
      '<span class="order-action-note" id="' + esc(payNoteId) + '">' +
        "Mark as paid first" +
      "</span>";
  }

  const contactHtml = phone
    ? '<a class="btn-admin-outline" href="tel:' + esc(phoneIntl(phone)) + '">Call ' + esc(phone) + "</a>" +
      '<a class="btn-admin-outline" href="https://wa.me/' + esc(waNumber(phone)) + '" target="_blank" rel="noopener">WhatsApp</a>'
    : "";

  return '<article class="order-card reservation-card">' +
    '<div class="order-card-main">' +
      '<div class="order-card-top reservation-top">' +
        '<span class="order-card-customer reservation-name">' + esc(r.customer_name || "Unknown guest") + "</span>" +
        '<span class="reservation-badges">' +
          '<span class="status ' + resStatusClass(r.status) + '">' + esc(resStatusLabel(r.status)) + "</span>" +
          '<span class="tag ' + (isPaid ? "tag-paid" : "tag-awaiting") + '">' + (isPaid ? "Paid" : "Unpaid") + "</span>" +
        "</span>" +
      "</div>" +
      '<div class="order-card-meta">' + esc(phone || "No phone") + " · " + guestsLabel(r.party_size) + "</div>" +
      '<div class="order-card-meta">' + esc(formatDate(r.reservation_date)) + " at " + esc(r.reservation_time || "—") + "</div>" +
      notesHtml +
      (actionHtml || contactHtml
        ? '<div class="reservation-actions">' + actionHtml + contactHtml + "</div>"
        : "") +
    "</div>" +
  "</article>";
}

function renderReservations() {
  if (state.resLoading) {
    el.reservationsList.innerHTML = '<p class="empty">Loading reservations…</p>';
    return;
  }
  if (state.resError) {
    renderLoadError(el.reservationsList, state.resError, loadReservations);
    return;
  }

  const alertHtml = state.resActionError
    ? (isReservationPaymentRequiredError(state.resActionError)
        ? '<div class="admin-alert admin-alert-error" role="alert">' +
            "<strong>This reservation must be paid before it can be confirmed.</strong>" +
            '<p class="admin-alert-detail">Mark the reservation as paid, then confirm it.</p>' +
          "</div>"
        : '<div class="admin-alert admin-alert-error" role="alert">' +
            "<strong>Could not update the reservation.</strong>" +
            '<p class="admin-alert-detail">' + esc(errorText(state.resActionError)) + "</p>" +
          "</div>")
    : "";

  const list = state.reservations.filter(function (r) {
    return state.resFilter === "ALL" || r.status === state.resFilter;
  });

  if (!list.length) {
    el.reservationsList.innerHTML = alertHtml + '<p class="empty">' +
      (state.reservations.length ? "No reservations match this filter." : "No reservations yet.") +
      "</p>";
    return;
  }

  el.reservationsList.innerHTML = alertHtml + list.map(reservationCard).join("");
}

function renderActivity() {
  if (state.activityLoading) {
    el.activityList.innerHTML = '<p class="empty">Loading activity…</p>';
    return;
  }
  if (state.activityError) {
    renderLoadError(el.activityList, state.activityError, loadActivity);
    return;
  }
  if (!state.activity.length) {
    el.activityList.innerHTML = '<p class="empty">No activity yet.</p>';
    return;
  }

  el.activityList.innerHTML = state.activity.map(function (entry) {
    return '<div class="activity-item">' +
      '<div class="activity-main">' +
        '<div class="activity-action">' + esc(activityLabel(entry.action)) +
          (entry.note ? ' (' + esc(entry.note) + ')' : '') + "</div>" +
        '<div class="activity-target">' + esc(activityTarget(entry)) + "</div>" +
      "</div>" +
      '<div class="activity-meta">' +
        '<div class="activity-actor">' + esc(entry.actor_email || "Unknown admin") + "</div>" +
        '<div class="activity-time">' + esc(formatTime(entry.created_at)) + "</div>" +
      "</div>" +
    "</div>";
  }).join("");
}

function renderAll() {
  renderFilters();
  renderSourceFilters();
  renderReservationFilters();
  renderDashboard();
  renderOrders();
  renderOrderDetail();
  renderReservations();
  renderCustomers();
  renderMenu();
  renderActivity();
}

/* ── Sidebar + hash routing ── */
function parseRoute() {
  const raw = String(location.hash || "").replace(/^#\/?/, "");
  if (!raw) return { name: DEFAULT_ROUTE, param: null };
  const parts = raw.split("/");
  if (parts[0] === "order") return { name: "order", param: parts[1] || null };
  return ROUTES[parts[0]] ? { name: parts[0], param: null } : { name: DEFAULT_ROUTE, param: null };
}

function routeHash(name, param) {
  return name === "order" && param ? "#order/" + encodeURIComponent(param) : "#" + name;
}

function isNarrowScreen() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function setNavOpen(open) {
  if (!el.sidebar || el.menuBtn.hidden) return;
  const narrow = isNarrowScreen();

  if (narrow) {
    // Phones: the sidebar is an overlay, so only the open flag matters.
    document.body.classList.toggle("admin-nav-open", open);
    document.body.classList.remove("admin-nav-collapsed");
    el.sidebarBackdrop.hidden = !open;
  } else {
    // Desktop: the sidebar is persistent; the button collapses it away.
    document.body.classList.toggle("admin-nav-collapsed", !open);
    document.body.classList.remove("admin-nav-open");
    el.sidebarBackdrop.hidden = true;
  }
  el.menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

function navIsOpen() {
  if (isNarrowScreen()) return document.body.classList.contains("admin-nav-open");
  return !document.body.classList.contains("admin-nav-collapsed");
}

function toggleNav() {
  setNavOpen(!navIsOpen());
}

// Only the phone overlay closes after a page is picked; the desktop
// sidebar stays put.
function dismissNavOverlay() {
  if (isNarrowScreen() && document.body.classList.contains("admin-nav-open")) {
    document.body.classList.remove("admin-nav-open");
    el.sidebarBackdrop.hidden = true;
    el.menuBtn.setAttribute("aria-expanded", "false");
  }
}

function closeNav() {
  document.body.classList.remove("admin-nav-open", "admin-nav-collapsed", "admin-nav-shown");
  if (el.sidebarBackdrop) el.sidebarBackdrop.hidden = true;
  if (el.menuBtn) el.menuBtn.setAttribute("aria-expanded", "false");
}

function applyRoute(name, param, updateHash) {
  if (!ROUTES[name]) { name = DEFAULT_ROUTE; param = null; }

  const hash = routeHash(name, param);
  state.view = name;
  state.openOrderKey = name === "order" ? param : null;

  dismissNavOverlay();

  if (name === "orders") state.newOrders = 0;
  if (name === "reservations") state.newReservations = 0;
  updateBadges();

  const meta = ROUTES[name];
  if (el.pageTitle) {
    const order = name === "order" ? findOrder(state.openOrderKey) : null;
    el.pageTitle.textContent = order ? "Order " + orderLabel(order) : meta.title;
  }
  if (el.breadcrumb) el.breadcrumb.textContent = meta.crumbs.join(" / ");

  if (el.navOrderDetail) {
    el.navOrderDetail.href = state.openOrderKey ? hash : "#orders";
    el.navOrderDetail.classList.toggle("is-disabled", !state.openOrderKey);
    el.navOrderDetail.setAttribute("aria-disabled", state.openOrderKey ? "false" : "true");
  }
  document.querySelectorAll(".admin-sidebar-nav [data-route]").forEach(function (link) {
    link.classList.toggle("active", link.getAttribute("data-route") === name);
  });
  document.querySelectorAll(".admin-view").forEach(function (v) {
    v.classList.toggle("active", v.id === "view-" + name);
  });

  if (updateHash && location.hash !== hash) location.hash = hash;

  renderAll();
  window.scrollTo(0, 0);
}

function setRoute(name, param) {
  const hash = routeHash(name, param);
  if (location.hash === hash) applyRoute(name, param, false);
  else location.hash = hash;
}

/* ── Order detail page ── */
function findOrder(key) {
  if (key == null) return null;
  const want = String(key);
  if (want.indexOf("iris-") === 0) {
    const id = want.slice(5);
    return state.irisOrders.find(function (o) {
      return orderKey(o) === want || String(o.id) === id;
    }) || null;
  }
  return state.orders.find(function (o) {
    return orderKey(o) === want;
  }) || null;
}

function hideOrderError() {
  const box = document.getElementById("orderError");
  if (box) {
    box.hidden = true;
    box.textContent = "";
  }
}

function isPaymentRequiredError(err) {
  const text = [err && err.message, err && err.details, err && err.hint, errorText(err)]
    .filter(Boolean)
    .join(" ");
  return /must be paid before it can be approved/i.test(text);
}

function isReservationPaymentRequiredError(err) {
  const text = [err && err.message, err && err.details, err && err.hint, errorText(err)]
    .filter(Boolean)
    .join(" ");
  return /must be paid before it can be confirmed/i.test(text);
}

function showOrderError(err) {
  const box = document.getElementById("orderError");
  if (!box) return;
  if (isPaymentRequiredError(err)) {
    box.innerHTML = "<strong>Order must be paid before it can be approved.</strong>" +
      '<p class="admin-alert-detail">Mark the order as paid, then approve it.</p>';
  } else {
    box.innerHTML = "<strong>Could not update the order.</strong>" +
      '<p class="admin-alert-detail">' + esc(errorText(err)) + "</p>";
  }
  box.hidden = false;
}

function setOrderButtonsDisabled(disabled) {
  ["approveBtn", "rejectBtn", "markPaidBtn"].forEach(function (id) {
    const b = document.getElementById(id);
    if (b) b.disabled = disabled;
  });
  el.orderDetail.querySelectorAll(".order-next-status").forEach(function (b) {
    b.disabled = disabled;
  });
}

// The only forward step left in the simplified flow.
function orderNextActions(status) {
  if (ORDER_OUT_FROM.indexOf(status) === -1) return [];

  return [{
    status: "OUT_FOR_DELIVERY",
    label: ORDER_OUT_LABEL,
    primary: true
  }];
}

function isSameCustomer(a, b) {
  if (a.user_id && b.user_id) return String(a.user_id) === String(b.user_id);
  const pa = normalizePhone(a.phone);
  const pb = normalizePhone(b.phone);
  if (pa || pb) return pa !== "" && pa === pb;
  const ea = String(a.email || "").trim().toLowerCase();
  const eb = String(b.email || "").trim().toLowerCase();
  return !!ea && ea === eb;
}

// Status changes come from the activity log; the timestamps on the order
// row itself cover when it was placed and paid.
function statusHistory(o) {
  const events = [];

  if (o.created_at) events.push({ label: "Order placed", at: o.created_at });
  if (o.paid_at) events.push({ label: "Payment recorded", at: o.paid_at });

  state.activity.forEach(function (entry) {
    if (entry.target_type !== "order") return;
    if (String(entry.target_id) !== String(o.id)) return;
    events.push({
      label: activityLabel(entry.action) + (entry.note ? " — " + entry.note : ""),
      at: entry.created_at
    });
  });

  return events.sort(function (a, b) {
    return new Date(b.at).getTime() - new Date(a.at).getTime();
  });
}

function relatedOrdersHtml(o) {
  const others = state.orders.filter(function (x) {
    return x !== o && isSameCustomer(o, x);
  });

  if (!others.length) {
    return '<p class="empty">No other orders from this customer.</p>';
  }

  return '<div class="line-list">' + others.map(function (x) {
    return '<div class="line-item">' +
      "<span>" + esc(formatDate(x.created_at)) + " · " +
        '<a class="admin-inline-link" href="#order/' + esc(orderKey(x)) + '">' + esc(orderLabel(x)) + "</a>" +
        ' <span class="muted">' + esc(itemsSummary(x)) + "</span></span>" +
      "<span>" + money(totalOf(x)) +
        ' <span class="status ' + statusClass(x) + '">' + esc(statusLabel(x.status)) + "</span></span>" +
    "</div>";
  }).join("") + "</div>";
}

// Read-only view of an Iris order. Iris owns this flow, so there are no
// approve/payment controls here and nothing on this page writes to the
// iris_ tables.
function renderIrisOrderDetail(o) {
  const phone = o.customer_phone || "";
  const currency = o.currency;

  const itemsHtml = (Array.isArray(o.items) ? o.items : []).map(function (it) {
    const qty = Number(it.quantity) || 0;
    const unit = Number(it.unit_price_minor) || 0;
    return '<div class="line-item"><span>' + esc(it.name || "Item") +
      ' <span class="muted">× ' + qty + " @ " + esc(moneyMinor(unit, currency)) + "</span></span>" +
      "<span>" + esc(moneyMinor(unit * qty, currency)) + "</span></div>";
  }).join("");

  const backHref = "#orders";
  if (el.pageTitle) el.pageTitle.textContent = "Order " + orderLabel(o);

  el.orderDetail.innerHTML =
    '<p class="admin-back"><a class="admin-inline-link" href="' + backHref + '">&larr; Back to orders</a></p>' +
    '<h2>Order ' + esc(orderLabel(o)) + " " + sourceBadge(o) + "</h2>" +
    '<div class="detail-grid">' +
      "<div><span class='label'>Customer</span><div class='value'>" + esc(o.customer_name || "Unknown customer") + "</div></div>" +
      "<div><span class='label'>Phone</span><div class='value'>" + esc(phone || "—") + "</div></div>" +
      "<div><span class='label'>Email</span><div class='value'>" + esc(o.customer_email || "—") + "</div></div>" +
      "<div><span class='label'>Fulfilment</span><div class='value'>" + esc(prettyValue(o.fulfillment) || "—") + "</div></div>" +
      "<div><span class='label'>Address</span><div class='value'>" + esc(o.address || "—") + "</div></div>" +
      "<div><span class='label'>Requested</span><div class='value'>" + esc(o.requested_at ? formatTime(o.requested_at) : "—") + "</div></div>" +
    "</div>" +
    (o.notes
      ? "<h3>Notes</h3><p class='reservation-notes'>" + esc(o.notes) + "</p>"
      : "") +
    "<h3>Items</h3>" +
    '<div class="line-list">' + (itemsHtml || '<p class="empty">No items recorded.</p>') + "</div>" +
    (o.subtotal_minor !== undefined && o.subtotal_minor !== null
      ? '<div class="line-item"><span>Subtotal</span><span>' + esc(moneyMinor(o.subtotal_minor, currency)) + "</span></div>"
      : "") +
    '<div class="line-item total"><span>Total</span><span>' + esc(amountTextOf(o)) + "</span></div>" +
    "<h3>Status</h3>" +
    '<div class="admin-status-row"><span class="status ' + statusClass(o) + '">' + esc(irisStatusLabel(o.status)) + "</span>" +
      '<span class="tag ' + (isIrisPaid(o) ? "tag-paid" : "tag-awaiting") + '">' +
        esc(prettyValue(o.payment_status) || "No payment recorded") + "</span></div>" +
    '<section class="admin-soon admin-soon--inline">' +
      "<h3>Managed by Iris</h3>" +
      "<p>Managed by Iris. Approve and payment actions connect later.</p>" +
    "</section>" +
    '<div class="actions admin-contact-row">' +
      callControlsHtml(phone, o.customer_name, { type: "order", id: o.id, label: orderLabel(o) }) +
      whatsappControlHtml(phone) +
    "</div>";
}

function renderOrderDetail(order) {
  if (!el.orderDetail || state.view !== "order") return;

  if (state.ordersLoading) {
    el.orderDetail.innerHTML = '<p class="empty">Loading order…</p>';
    return;
  }

  // An Iris key only resolves once the Iris read has come back.
  if (!order && state.irisLoading && String(state.openOrderKey || "").indexOf("iris-") === 0) {
    el.orderDetail.innerHTML = '<p class="empty">Loading order…</p>';
    return;
  }

  const o = order || findOrder(state.openOrderKey);
  if (o && isIrisOrder(o)) {
    renderIrisOrderDetail(o);
    return;
  }
  if (!o) {
    el.orderDetail.innerHTML =
      "<h2>Order not found</h2>" +
      '<p class="empty">That order is not in the current list. It may have been placed after this page loaded.</p>' +
      '<div class="actions"><a class="btn-admin-outline" href="#orders">Back to orders</a></div>';
    return;
  }

  const items = itemsOf(o);
  const total = totalOf(o);
  const isUnusual = total >= UNUSUAL_TOTAL;
  const isPending = o.status === "PENDING_APPROVAL";
  const waitingForPayment = isUnpaidPending(o);
  const phone = o.phone || "";

  const itemsHtml = items.length
    ? items.map(function (it) {
        const qty = Number(it.qty) || 0;
        const price = Number(it.price) || 0;
        return '<div class="line-item"><span>' + esc(it.name || "Item") +
          ' <span class="muted">× ' + qty + " @ " + money(price) + "</span></span>" +
          "<span>" + money(price * qty) + "</span></div>";
      }).join("")
    : '<p class="empty">No items recorded.</p>';

  const unusualHtml = isUnusual
    ? '<div class="unusual-box"><strong>Unusual order</strong><p>Total is ' + money(total) +
      ", which is ₦100,000 or more.</p></div>"
    : "";

  const nextActions = orderNextActions(o.status);
  const actionButtons = [];

  if (isPending) {
    actionButtons.push('<button type="button" id="approveBtn" class="btn-admin-primary"' +
      (waitingForPayment ? ' disabled aria-describedby="approveNote"' : "") + ">Approve</button>");
    if (waitingForPayment) {
      actionButtons.push('<span class="order-action-note" id="approveNote">Waiting for payment</span>');
    }
    actionButtons.push('<button type="button" id="rejectBtn" class="btn-admin-danger">Reject</button>');
  }

  nextActions.forEach(function (next) {
    actionButtons.push('<button type="button" class="order-next-status ' +
      (next.primary ? "btn-admin-primary" : "btn-admin-outline") +
      '" data-next-status="' + next.status + '">' + esc(next.label) + "</button>");
  });

  if (!o.paid_at && o.status !== "CANCELLED" && o.status !== "REJECTED") {
    actionButtons.push('<button type="button" id="markPaidBtn" class="btn-admin-outline">Mark as paid</button>');
  }

  const actionsHtml = actionButtons.length
    ? '<div class="actions">' + actionButtons.join("") + "</div>"
    : "";

  const contactHtml =
    '<div class="actions admin-contact-row">' +
      callControlsHtml(phone, o.customer_name, { type: "order", id: o.id, label: orderLabel(o) }) +
      whatsappControlHtml(phone) +
    "</div>";

  const history = statusHistory(o);
  const historyHtml = history.length
    ? '<div class="line-list">' + history.map(function (e) {
        return '<div class="line-item"><span>' + esc(e.label) + "</span>" +
          '<span class="muted">' + esc(formatTime(e.at)) + "</span></div>";
      }).join("") + "</div>"
    : '<p class="empty">No status changes recorded yet.</p>';

  const backHref = "#orders";
  if (el.pageTitle) el.pageTitle.textContent = "Order " + orderLabel(o);

  el.orderDetail.innerHTML =
    '<p class="admin-back"><a class="admin-inline-link" href="' + backHref + '">&larr; Back to orders</a></p>' +
    "<h2>Order " + esc(orderLabel(o)) + "</h2>" +
    unusualHtml +
    '<div class="detail-grid">' +
      "<div><span class='label'>Customer</span><div class='value'>" + esc(o.customer_name || "Unknown customer") + "</div></div>" +
      "<div><span class='label'>Phone</span><div class='value'>" + esc(phone || "—") + "</div></div>" +
      "<div><span class='label'>Email</span><div class='value'>" + esc(o.email || "—") + "</div></div>" +
      "<div><span class='label'>Delivery address</span><div class='value'>" + esc(o.address || "—") + "</div></div>" +
    "</div>" +
    "<h3>Items</h3>" +
    '<div class="line-list">' + itemsHtml + "</div>" +
    '<div class="line-item total"><span>Total</span><span>' + money(total) + "</span></div>" +
    "<h3>Status</h3>" +
    '<div class="admin-status-row"><span class="status ' + statusClass(o) + '">' + esc(statusLabel(o.status)) + "</span>" +
      paymentBadge(o) + "</div>" +
    '<div id="orderError" class="admin-alert admin-alert-error" role="alert" hidden></div>' +
    actionsHtml +
    contactHtml +
    "<h3>Status history</h3>" + historyHtml +
    "<h3>Previous orders</h3>" + relatedOrdersHtml(o) +
    '<div class="admin-detail-panels">' +
      '<section class="admin-soon admin-soon--inline"><h3>Payment method</h3><p>Not connected yet.</p></section>' +
      '<section class="admin-soon admin-soon--inline"><h3>Unusual order warning</h3><p>Not connected yet.</p></section>' +
    "</div>";

  const approve = document.getElementById("approveBtn");
  if (approve) approve.addEventListener("click", function () { updateStatus(o, "APPROVED"); });

  const reject = document.getElementById("rejectBtn");
  if (reject) reject.addEventListener("click", function () { confirmReject(o); });

  const markPaid = document.getElementById("markPaidBtn");
  if (markPaid) markPaid.addEventListener("click", function () { confirmMarkPaid(o); });

  el.orderDetail.querySelectorAll(".order-next-status").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const next = btn.getAttribute("data-next-status");
      if (next === "OUT_FOR_DELIVERY") {
        confirmOutForDelivery(o);
      } else {
        updateStatus(o, next);
      }
    });
  });
}

async function updateStatus(order, status) {
  if (state.saving || !client) return;

  state.saving = true;
  hideOrderError();
  setOrderButtonsDisabled(true);

  let error = null;
  try {
    let query = client.from("orders").update({ status: status });
    query = order.id != null
      ? query.eq("id", order.id)
      : query.eq("order_no", order.order_no);

    const res = await query.select("id");
    if (res.error) {
      error = res.error;
    } else if (!res.data || !res.data.length) {
      error = { message: "The order was not updated. Your account may not have permission to change orders." };
    }
  } catch (err) {
    error = err;
  }

  state.saving = false;
  setOrderButtonsDisabled(false);

  if (error) {
    // Repaint first so an unpaid order's Approve button stays disabled,
    // then surface the database message (including "must be paid").
    renderOrderDetail(order);
    showOrderError(error);
    return;
  }

  order.status = status;
  renderOrders();
  renderCustomers();
  renderDashboard();
  renderOrderDetail(order);

  const action = ORDER_STATUS_ACTIONS[status] || null;
  if (!action) return;

  const log = await logActivity(action, "order", order.id);
  if (log.error) {
    toast("Order " + orderLabel(order) + " marked " + statusLabel(status).toLowerCase() +
      ". The activity log could not be updated.");
    return;
  }

  toast("Order " + orderLabel(order) + " marked " + statusLabel(status).toLowerCase() + ".");
  await loadActivity();
  renderOrderDetail(order);
}

function confirmReject(order) {
  openModal({
    title: "Reject order",
    body: "Reject " + orderLabel(order) + "? The order status will change to Rejected.",
    confirmLabel: "Reject order",
    onConfirm: function () { updateStatus(order, "REJECTED"); }
  });
}

function confirmOutForDelivery(order) {
  openModal({
    title: "Out for delivery",
    body: "Notify the customer that this order is on the way?",
    confirmLabel: "Notify customer",
    onConfirm: function () { updateStatus(order, "OUT_FOR_DELIVERY"); }
  });
}

function confirmMarkPaid(order) {
  openModal({
    title: "Mark as paid",
    body: "Confirm payment received?",
    confirmLabel: "Mark as paid",
    onConfirm: function () { markOrderPaid(order); }
  });
}

async function markOrderPaid(order) {
  if (state.saving || !client) return;

  state.saving = true;
  hideOrderError();
  setOrderButtonsDisabled(true);

  const paidAt = new Date().toISOString();
  let error = null;

  try {
    let query = client.from("orders").update({ paid_at: paidAt });
    query = order.id != null
      ? query.eq("id", order.id)
      : query.eq("order_no", order.order_no);

    const res = await query.select("id");
    if (res.error) {
      error = res.error;
    } else if (!res.data || !res.data.length) {
      error = { message: "The order was not updated. Your account may not have permission to change orders." };
    }
  } catch (err) {
    error = err;
  }

  state.saving = false;
  setOrderButtonsDisabled(false);

  if (error) {
    showOrderError(error);
    return;
  }

  order.paid_at = paidAt;
  renderOrders();
  renderCustomers();
  renderDashboard();
  renderOrderDetail(order);

  const log = await logActivity("ORDER_MARKED_PAID", "order", order.id);
  if (log.error) {
    toast("Order " + orderLabel(order) + " marked as paid. The activity log could not be updated.");
    return;
  }

  toast("Order " + orderLabel(order) + " marked as paid.");
  await loadActivity();
  renderOrderDetail(order);
}

/* ── Reservation actions ── */
async function updateReservationStatus(reservation, status) {
  if (state.saving || !client) return;

  state.saving = true;
  state.resActionError = null;
  renderReservations();

  const patch = status === "CANCELLED"
    ? { status: status, cancelled_by: "admin" }
    : { status: status };

  let error = null;
  try {
    const res = await client
      .from("reservations")
      .update(patch)
      .eq("id", reservation.id)
      .select("id");

    if (res.error) {
      error = res.error;
    } else if (!res.data || !res.data.length) {
      error = { message: "The reservation was not updated. Your account may not have permission to change reservations." };
    }
  } catch (err) {
    error = err;
  }

  state.saving = false;

  if (error) {
    state.resActionError = error;
    renderReservations();
    return;
  }

  reservation.status = status;
  renderReservations();

  const action = status === "CONFIRMED" ? "RESERVATION_CONFIRMED"
    : status === "CANCELLED" ? "RESERVATION_CANCELLED"
    : null;
  if (!action) return;

  const log = await logActivity(action, "reservation", reservation.id);
  if (log.error) {
    toast("Reservation " + resStatusLabel(status).toLowerCase() +
      ". The activity log could not be updated.");
    return;
  }

  toast("Reservation for " + (reservation.customer_name || "guest") + " " +
    resStatusLabel(status).toLowerCase() + ".");
  await loadActivity();
}

function confirmCancelReservation(reservation) {
  openModal({
    title: "Cancel reservation",
    body: "Cancel the reservation for " + (reservation.customer_name || "this guest") +
      " on " + formatDate(reservation.reservation_date) +
      " at " + (reservation.reservation_time || "the requested time") + "?",
    confirmLabel: "Cancel reservation",
    onConfirm: function () { updateReservationStatus(reservation, "CANCELLED"); }
  });
}

function confirmMarkReservationPaid(reservation) {
  openModal({
    title: "Mark as paid",
    body: "Mark this reservation as paid?",
    confirmLabel: "Yes, mark as paid",
    cancelLabel: "No",
    onConfirm: function () { markReservationPaid(reservation); }
  });
}

async function markReservationPaid(reservation) {
  if (state.saving || !client) return;

  state.saving = true;
  state.resActionError = null;
  renderReservations();

  const paidAt = new Date().toISOString();
  let error = null;

  try {
    const res = await client
      .from("reservations")
      .update({ paid_at: paidAt })
      .eq("id", reservation.id)
      .select("id");

    if (res.error) {
      error = res.error;
    } else if (!res.data || !res.data.length) {
      error = { message: "The reservation was not updated. Your account may not have permission to change reservations." };
    }
  } catch (err) {
    error = err;
  }

  state.saving = false;

  if (error) {
    state.resActionError = error;
    renderReservations();
    return;
  }

  reservation.paid_at = paidAt;
  renderReservations();

  const log = await logActivity("RESERVATION_MARKED_PAID", "reservation", reservation.id);
  if (log.error) {
    toast("Reservation marked as paid. The activity log could not be updated.");
    return;
  }

  toast("Reservation for " + (reservation.customer_name || "guest") + " marked as paid.");
  await loadActivity();
}

/* ── Menu actions ── */
async function setMenuAvailability(item, available) {
  if (!client || state.menuSavingId != null) return;

  state.menuActionError = null;
  state.menuSavingId = item.id;
  renderMenu();

  let error = null;
  try {
    const res = await client
      .from("menu_items")
      .update({ available: available })
      .eq("id", item.id);
    if (res.error) error = res.error;
  } catch (err) {
    error = err;
  }

  if (error) {
    state.menuActionError = error;
  } else {
    state.menu = state.menu.map(function (x) {
      if (String(x.id) !== String(item.id)) return x;
      const next = Object.assign({}, x);
      next.available = available;
      return next;
    });
    const log = await logActivity(
      "MENU_ITEM_AVAILABILITY_CHANGED",
      "menu_item",
      item.id,
      item.name + ": " + (available ? "Available" : "Unavailable")
    );
    if (log && log.error) state.menuActionError = log.error;
  }

  state.menuSavingId = null;
  renderMenu();
}

async function saveMenuRemarks(item, remarks) {
  if (!client || state.menuSavingRemarksId != null) return;

  const id = String(item.id);
  state.menuActionError = null;
  state.menuSavingRemarksId = item.id;
  state.menuRemarksDraft[id] = remarks;
  renderMenu();

  let error = null;
  try {
    const res = await client
      .from("menu_items")
      .update({ remarks: remarks })
      .eq("id", item.id);
    if (res.error) error = res.error;
  } catch (err) {
    error = err;
  }

  if (error) {
    state.menuActionError = error;
    state.menuRemarksDraft[id] = remarks;
  } else {
    state.menu = state.menu.map(function (x) {
      if (String(x.id) !== id) return x;
      const next = Object.assign({}, x);
      next.remarks = remarks;
      return next;
    });
    delete state.menuRemarksDraft[id];
  }

  state.menuSavingRemarksId = null;
  renderMenu();
}

/* ── Modal ── */
let modalCb = null;

function openModal(opts) {
  el.modalTitle.textContent = opts.title || "";
  el.modalBody.textContent = opts.body || "";
  el.modalFields.style.display = "none";
  el.modalFields.innerHTML = "";
  el.modalInput.style.display = "none";
  el.modalConfirm.textContent = opts.confirmLabel || "Confirm";
  el.modalCancel.textContent = opts.cancelLabel || "Cancel";
  modalCb = opts.onConfirm || null;
  el.modal.classList.add("open");
}

function closeModal() {
  el.modal.classList.remove("open");
  modalCb = null;
}

/* ── Toast ── */
let toastTimer = null;

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    el.toast.classList.remove("show");
  }, 3500);
}

/* ── Live new-order alerts (Realtime + 30s polling fallback) ── */
const BASE_TITLE = "Admin — Ember & Quill";
const LIVE_LABELS = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…"
};
const POLL_MS = 30000;
const ALERT_DISMISS_MS = 8000;

let channel = null;
let pollTimer = null;
let titleTimer = null;
let titleFlashOn = false;
let audioCtx = null;

// Cheap change detectors so a 30s poll never repaints (or steals focus)
// unless the underlying rows actually changed.
function ordersSignature(rows) {
  return (rows || []).map(function (o) {
    return [o.id, o.order_no, o.customer_name, o.phone, o.total, o.status, o.paid_at].join("|");
  }).join("~");
}

function reservationsSignature(rows) {
  return (rows || []).map(function (r) {
    return [r.id, r.customer_name, r.phone, r.party_size, r.reservation_date,
      r.reservation_time, r.notes, r.status, r.paid_at].join("|");
  }).join("~");
}

function activitySignature(rows) {
  return (rows || []).map(function (a) {
    return [a.id, a.actor_email, a.action, a.target_type, a.target_id, a.note, a.created_at].join("|");
  }).join("~");
}

function setLiveStatus(kind) {
  state.liveStatus = kind;
  if (!el.liveStatus) return;
  el.liveStatus.textContent = LIVE_LABELS[kind] || kind;
  el.liveStatus.className = "admin-live-status is-" + kind;
}

function updateBadges() {
  if (el.ordersBadge) {
    el.ordersBadge.textContent = String(state.newOrders);
    el.ordersBadge.hidden = state.newOrders <= 0;
  }
  if (el.reservationsBadge) {
    el.reservationsBadge.textContent = String(state.newReservations);
    el.reservationsBadge.hidden = state.newReservations <= 0;
  }
}

function alertTitleText() {
  return "(" + state.titleCount + ") " + state.titleLabel + " - Ember & Quill Admin";
}

function updateTitle() {
  const shouldFlash = state.titleCount > 0 && document.visibilityState === "hidden";

  if (!shouldFlash) {
    if (titleTimer) {
      clearInterval(titleTimer);
      titleTimer = null;
    }
    titleFlashOn = false;
    document.title = BASE_TITLE;
    return;
  }

  if (titleTimer) return;
  titleFlashOn = true;
  document.title = alertTitleText();
  titleTimer = setInterval(function () {
    titleFlashOn = !titleFlashOn;
    document.title = titleFlashOn ? alertTitleText() : BASE_TITLE;
  }, 1000);
}

function handleVisibilityChange() {
  // Back on the page: stop flashing and clear the unread title count.
  // Tab badges stay until their tab is actually opened.
  if (document.visibilityState === "visible") state.titleCount = 0;
  updateTitle();
}

/* Sound — a short two-tone beep, generated locally (no audio file). */
function ensureAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") {
      const p = audioCtx.resume();
      if (p && p.catch) p.catch(function () {});
    }
    return audioCtx;
  } catch (err) {
    return null;
  }
}

function playBeep() {
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1174.66, now + 0.11);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.32);
  } catch (err) {
    /* Sound is best-effort; never break an alert over it. */
  }
}

/* Browser notifications */
function updateAlertsButton() {
  if (!el.enableAlerts) return;
  const supported = "Notification" in window;
  el.enableAlerts.hidden = !supported || Notification.permission !== "default";
}

async function handleEnableAlerts() {
  if (!("Notification" in window)) {
    toast("This browser does not support notifications.");
    return;
  }
  let permission = "denied";
  try {
    permission = await Notification.requestPermission();
  } catch (err) {
    /* ignore */
  }
  updateAlertsButton();
  if (permission === "granted") toast("Browser alerts enabled.");
  else if (permission === "denied") toast("Browser alerts are blocked in your browser settings.");
}

function showSystemNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body: body, icon: "og-image.jpg" });
  } catch (err) {
    /* Some browsers only allow this via a service worker. */
  }
}

/* In-page toast stack at the top */
function positionAlertStack() {
  if (!el.alertStack) return;
  const bar = document.querySelector(".admin-topbar");
  const note = el.liveNote && !el.liveNote.hidden ? el.liveNote : null;
  const height = (bar ? bar.getBoundingClientRect().height : 0) +
    (note ? note.getBoundingClientRect().height : 0);
  el.alertStack.style.top = Math.max(8, Math.round(height + 8)) + "px";
}

function dismissAlert(btn) {
  if (!btn) return;
  if (btn.__timer) {
    clearTimeout(btn.__timer);
    btn.__timer = null;
  }
  if (btn.parentNode) btn.parentNode.removeChild(btn);
}

function clearTopAlerts() {
  if (el.alertStack) el.alertStack.innerHTML = "";
}

function showTopAlert(route, message) {
  if (!el.alertStack) return;
  positionAlertStack();

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "admin-alert-toast";
  btn.setAttribute("data-route", route);
  btn.textContent = message;
  btn.addEventListener("click", function () {
    setRoute(route);
    dismissAlert(btn);
  });

  el.alertStack.appendChild(btn);
  while (el.alertStack.children.length > 4) {
    dismissAlert(el.alertStack.firstChild);
  }
  btn.__timer = setTimeout(function () { dismissAlert(btn); }, ALERT_DISMISS_MS);
}

function handleNewOrder(row) {
  if (!row) return;
  const name = row.customer_name || "a customer";
  const message = "New order " + orderLabel(row) + " from " + name + ", " + money(row.total);

  playBeep();
  showTopAlert("orders", message);
  showSystemNotification("New order " + orderLabel(row), name + ", " + money(row.total));

  if (state.view !== "orders") {
    state.newOrders += 1;
    updateBadges();
  }
  if (document.visibilityState === "hidden") {
    state.titleCount += 1;
    state.titleLabel = "New order";
    updateTitle();
  }

  // Pull the authoritative row/order in, not just the payload.
  loadOrders({ silent: true });
}

function handleNewReservation(row) {
  if (!row) return;
  const name = row.customer_name || "a guest";
  const party = Number(row.party_size) || 0;
  const message = "New reservation from " + name + ", party of " + party;

  playBeep();
  showTopAlert("reservations", message);
  showSystemNotification("New reservation", name + ", party of " + party);

  if (state.view !== "reservations") {
    state.newReservations += 1;
    updateBadges();
  }
  if (document.visibilityState === "hidden") {
    state.titleCount += 1;
    state.titleLabel = "New reservation";
    updateTitle();
  }

  loadReservations({ silent: true });
}

function refreshOpenOrder() {
  if (state.openOrderKey == null || state.saving) return;
  const fresh = state.orders.find(function (o) {
    return orderKey(o) === state.openOrderKey;
  });
  if (fresh) renderOrderDetail(fresh);
}

function handleOrderUpdated(row, oldRow) {
  if (!row) return;

  const existing = state.orders.find(function (o) {
    return String(o.id) === String(row.id);
  });

  // A payment can arrive from the customer's page or another admin. Use
  // the row already on screen to detect empty → set; if it is not loaded,
  // only trust an old row that actually carries paid_at.
  let wasPaid = true;
  if (existing) wasPaid = !!existing.paid_at;
  else if (oldRow && Object.prototype.hasOwnProperty.call(oldRow, "paid_at")) wasPaid = !!oldRow.paid_at;

  if (row.paid_at && !wasPaid) {
    playBeep();
    showTopAlert("orders", "Payment received for " + orderLabel(row) + ", ready to approve");

    if (state.view !== "orders") {
      state.newOrders += 1;
      updateBadges();
    }

    loadOrders({ silent: true }).then(refreshOpenOrder);
    return;
  }

  if (row.status !== "CANCELLED" || row.cancelled_by !== "customer") return;
  if (existing && existing.status === "CANCELLED") return;

  playBeep();
  showTopAlert("orders", "Order " + orderLabel(row) + " was cancelled by the customer");

  loadOrders({ silent: true }).then(refreshOpenOrder);
  loadActivity({ silent: true });
}

function handleReservationUpdated(row) {
  if (!row) return;

  // A payment (or another change) arrived from another admin.
  if (row.status !== "CANCELLED" || row.cancelled_by !== "customer") {
    loadReservations({ silent: true });
    return;
  }

  const existing = state.reservations.find(function (r) {
    return String(r.id) === String(row.id);
  });
  if (existing && existing.status === "CANCELLED") return;

  const name = row.customer_name || "a guest";
  playBeep();
  showTopAlert(
    "reservations",
    "Reservation for " + name + " on " + formatDate(row.reservation_date) +
      " was cancelled by the customer"
  );

  loadReservations({ silent: true });
  loadActivity({ silent: true });
}

function startRealtime() {
  if (!client || channel) return;
  setLiveStatus("connecting");

  try {
    channel = client
      .channel("admin-live-alerts-" + Date.now())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, function (payload) {
        handleNewOrder(payload.new);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reservations" }, function (payload) {
        handleNewReservation(payload.new);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, function (payload) {
        handleOrderUpdated(payload.new, payload.old);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "reservations" }, function (payload) {
        handleReservationUpdated(payload.new);
      })
      .subscribe(function (status) {
        if (status === "SUBSCRIBED") {
          setLiveStatus("live");
          // Catch anything that arrived while (re)connecting.
          loadOrders({ silent: true });
          loadReservations({ silent: true });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setLiveStatus("reconnecting");
        }
      });
  } catch (err) {
    channel = null;
    setLiveStatus("reconnecting");
  }
}

function stopRealtime() {
  if (channel && client) {
    try {
      client.removeChannel(channel);
    } catch (err) {
      /* ignore */
    }
  }
  channel = null;
  setLiveStatus("connecting");
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(function () {
    if (!state.authed) return;
    loadOrders({ silent: true });
    loadReservations({ silent: true });
    loadActivity({ silent: true });
    // Iris has no realtime feed here; the same 30s beat re-reads it.
    loadIris({ silent: true });
  }, POLL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/* ── Boot & wiring ── */
async function boot() {
  if (!client) {
    showLogin("Could not connect to Supabase. Check your connection and reload the page.");
    return;
  }

  client.auth.onAuthStateChange(function (event, session) {
    // boot() below checks the session it restores itself.
    if (event === "INITIAL_SESSION" || authCheckInProgress) return;

    if (session) {
      if (!state.authed) verifyAndEnter(session);
    } else if (state.authed) {
      setLoggedOut();
    }
  });

  let session = null;
  try {
    const res = await client.auth.getSession();
    session = res.data ? res.data.session : null;
  } catch (err) {
    showLogin("Could not check your session. Please reload the page.");
    return;
  }

  if (session) await verifyAndEnter(session);
  else showLogin();
}

function syncNavAfterResize() {
  positionAlertStack();
  if (!state.authed) return;

  if (isNarrowScreen()) {
    // Desktop collapse state means nothing on a phone; the drawer is
    // always closed until it is opened explicitly.
    document.body.classList.remove("admin-nav-collapsed");
    el.sidebarBackdrop.hidden = !document.body.classList.contains("admin-nav-open");
  } else {
    document.body.classList.remove("admin-nav-open");
    el.sidebarBackdrop.hidden = true;
  }
  el.menuBtn.setAttribute("aria-expanded", navIsOpen() ? "true" : "false");
}

function init() {
  cacheElements();

  el.loginForm.addEventListener("submit", handleLogin);
  el.signOutBtn.addEventListener("click", handleSignOut);

  if (el.enableAlerts) el.enableAlerts.addEventListener("click", handleEnableAlerts);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("resize", syncNavAfterResize);
  // Browsers only allow audio after a gesture; unlock it on the first one.
  document.addEventListener("pointerdown", function () { ensureAudio(); }, { once: true });

  updateBadges();
  updateAlertsButton();
  updateTitle();

  el.menuBtn.addEventListener("click", toggleNav);
  el.sidebarClose.addEventListener("click", function () { setNavOpen(false); });
  el.sidebarBackdrop.addEventListener("click", function () { setNavOpen(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.authed && navIsOpen()) setNavOpen(false);
  });

  // The links navigate by themselves through their hash; this only closes
  // the phone overlay and blocks the "Detail" link when no order is open.
  document.querySelectorAll(".admin-sidebar-nav [data-route]").forEach(function (link) {
    link.addEventListener("click", function (e) {
      if (link.getAttribute("aria-disabled") === "true") {
        e.preventDefault();
        return;
      }
      dismissNavOverlay();
    });
  });

  window.addEventListener("hashchange", function () {
    if (!state.authed) return;
    const route = parseRoute();
    applyRoute(route.name, route.param, false);
  });

  el.customerSearch.addEventListener("input", function (e) {
    state.customerSearch = e.target.value;
    renderCustomers();
  });

  if (el.menuSearch) {
    el.menuSearch.addEventListener("input", function (e) {
      state.menuSearch = e.target.value;
      renderMenu();
    });
  }

  // Reservation buttons are re-rendered often, so delegate the clicks.
  el.reservationsList.addEventListener("click", function (e) {
    const btn = e.target.closest ? e.target.closest(".res-action") : null;
    if (!btn) return;
    const id = btn.getAttribute("data-res-id");
    const reservation = state.reservations.find(function (r) {
      return String(r.id) === String(id);
    });
    if (!reservation) return;

    const action = btn.getAttribute("data-action");

    if (action === "confirm") {
      updateReservationStatus(reservation, "CONFIRMED");
    } else if (action === "paid") {
      confirmMarkReservationPaid(reservation);
    } else {
      confirmCancelReservation(reservation);
    }
  });

  el.modalCancel.addEventListener("click", closeModal);
  el.modalConfirm.addEventListener("click", function () {
    const cb = modalCb;
    closeModal();
    if (cb) cb();
  });
  el.modal.addEventListener("click", function (e) {
    if (e.target === el.modal) closeModal();
  });

  bindCallControls();

  renderFilters();
  renderReservationFilters();
  boot();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
