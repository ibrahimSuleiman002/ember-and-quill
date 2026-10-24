"use strict";

// ═══════════════════════════════════════════════════════════════
//  Ember & Quill — Admin dashboard
//  Live data from Supabase (public.orders). No sample data.
//  Admin users sign in with Supabase Auth; the session persists
//  across refreshes. Customers can only insert orders — this page
//  reads and updates them as an authenticated admin.
// ═══════════════════════════════════════════════════════════════

const client = (typeof supabaseClient === "undefined") ? null : supabaseClient;

const STATUS_ORDER = ["PENDING_APPROVAL", "APPROVED", "PAID", "REJECTED", "CANCELLED"];
const STATUS_LABELS = {
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  PAID: "Paid",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled"
};

const UNUSUAL_TOTAL = 100000;

const state = {
  view: "orders",
  statusFilter: "ALL",
  customerSearch: "",
  orders: [],
  loading: false,
  loadError: null,
  saving: false,
  authed: false
};

/* ── Helpers ── */
function money(n) {
  return "₦" + (Number(n) || 0).toLocaleString("en-NG");
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
  return STATUS_ORDER.indexOf(o.status) !== -1 ? "status-" + o.status : "status-UNKNOWN";
}

function orderLabel(o) {
  const n = o.order_no;
  if (n === null || n === undefined || n === "") return "ORD-—";
  return "ORD-" + String(n).padStart(4, "0");
}

function orderKey(o) {
  return String(o.id != null ? o.id : o.order_no);
}

function totalOf(o) {
  return Number(o.total) || 0;
}

function itemsOf(o) {
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

  el.tabs = document.getElementById("adminTabs");
  el.session = document.getElementById("adminSession");
  el.userEmail = document.getElementById("adminUserEmail");
  el.signOutBtn = document.getElementById("signOutBtn");
  el.liveNote = document.getElementById("liveNote");
  el.main = document.getElementById("adminMain");

  el.filters = document.getElementById("statusFilters");
  el.ordersList = document.getElementById("ordersList");
  el.customersList = document.getElementById("customersList");
  el.activityList = document.getElementById("activityList");
  el.customerSearch = document.getElementById("customerSearch");

  el.panel = document.getElementById("panel");
  el.panelContent = document.getElementById("panelContent");
  el.panelBackdrop = document.getElementById("panelBackdrop");
  el.panelClose = document.getElementById("panelClose");

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
  el.tabs.hidden = true;
  el.session.hidden = true;
  el.liveNote.hidden = true;
  if (message) showLoginError(message);
  else hideLoginError();
}

function setLoggedOut() {
  state.authed = false;
  state.orders = [];
  state.loadError = null;
  state.loading = false;
  state.saving = false;
  state.statusFilter = "ALL";
  state.customerSearch = "";
  if (el.customerSearch) el.customerSearch.value = "";
  closePanel();
  closeModal();
  if (el.loginForm) el.loginForm.reset();
  setView("orders");
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
  el.tabs.hidden = false;
  el.session.hidden = false;
  el.liveNote.hidden = false;
  hideLoginError();
  setView("orders");
  loadOrders();
}

function setLoginBusy(busy) {
  if (!el.loginBtn) return;
  el.loginBtn.disabled = busy;
  el.loginBtn.textContent = busy ? "Signing in…" : "Sign in";
  el.loginBtn.setAttribute("aria-busy", busy ? "true" : "false");
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
  setLoginBusy(false);

  if (result.error) {
    showLoginError(loginErrorMessage(result.error));
    el.loginPassword.value = "";
    el.loginPassword.focus();
    return;
  }

  el.loginPassword.value = "";
  if (result.data && result.data.session) setAuthed(result.data.session);
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
async function loadOrders() {
  if (!client) return;
  state.loading = true;
  state.loadError = null;
  renderOrders();

  try {
    const res = await client
      .from("orders")
      .select("id, order_no, customer_name, phone, email, address, items, total, status, created_at")
      .order("created_at", { ascending: false, nullsFirst: false });

    if (res.error) {
      state.loadError = res.error;
      state.orders = [];
    } else {
      state.orders = res.data || [];
    }
  } catch (err) {
    state.loadError = err;
    state.orders = [];
  }

  state.loading = false;
  renderAll();
}

/* ── Rendering ── */
function renderFilters() {
  const opts = ["ALL"].concat(STATUS_ORDER);
  el.filters.innerHTML = opts.map(function (s) {
    return '<button type="button" class="filter-btn' + (state.statusFilter === s ? " active" : "") +
      '" data-status="' + s + '">' + (s === "ALL" ? "All" : esc(statusLabel(s))) + "</button>";
  }).join("");

  el.filters.querySelectorAll(".filter-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      state.statusFilter = b.getAttribute("data-status");
      renderFilters();
      renderOrders();
    });
  });
}

function renderLoadError(container) {
  container.innerHTML =
    '<div class="admin-alert admin-alert-error" role="alert">' +
      "<strong>Could not load data from Supabase.</strong>" +
      '<p class="admin-alert-detail">' + esc(errorText(state.loadError)) + "</p>" +
      '<button type="button" class="btn-admin-ghost" data-retry="1">Try again</button>' +
    "</div>";

  const retry = container.querySelector("[data-retry]");
  if (retry) retry.addEventListener("click", loadOrders);
}

function renderOrders() {
  if (state.loading) {
    el.ordersList.innerHTML = '<p class="empty">Loading orders…</p>';
    return;
  }
  if (state.loadError) {
    renderLoadError(el.ordersList);
    return;
  }

  const orders = state.orders.filter(function (o) {
    return state.statusFilter === "ALL" || o.status === state.statusFilter;
  });

  if (!orders.length) {
    el.ordersList.innerHTML = '<p class="empty">' +
      (state.orders.length ? "No orders match this filter." : "No orders yet.") +
      "</p>";
    return;
  }

  el.ordersList.innerHTML = orders.map(function (o) {
    const total = totalOf(o);
    const unusual = total >= UNUSUAL_TOTAL ? '<span class="tag tag-unusual">Unusual</span>' : "";
    return '<button type="button" class="order-card" data-order-key="' + esc(orderKey(o)) + '">' +
      '<div class="order-card-main">' +
        '<div class="order-card-top"><span class="order-number">' + esc(orderLabel(o)) + "</span>" + unusual + "</div>" +
        '<div class="order-card-customer">' + esc(o.customer_name || "Unknown customer") + "</div>" +
        '<div class="order-card-meta">' + esc(formatTime(o.created_at)) + "</div>" +
      "</div>" +
      '<div class="order-card-side">' +
        '<div class="order-total">' + money(total) + "</div>" +
        '<span class="status ' + statusClass(o) + '">' + esc(statusLabel(o.status)) + "</span>" +
      "</div>" +
    "</button>";
  }).join("");

  el.ordersList.querySelectorAll(".order-card").forEach(function (card) {
    card.addEventListener("click", function () {
      openOrder(card.getAttribute("data-order-key"));
    });
  });
}

function customerGroups() {
  const groups = new Map();

  state.orders.forEach(function (o) {
    const phone = String(o.phone || "").trim();
    if (!phone) return;

    let g = groups.get(phone);
    if (!g) {
      g = {
        phone: phone,
        name: o.customer_name || "Unknown customer",
        orders: 0,
        total: 0
      };
      groups.set(phone, g);
    }
    g.orders += 1;
    g.total += totalOf(o);
  });

  return Array.from(groups.values()).sort(function (a, b) {
    return b.total - a.total;
  });
}

function renderCustomers() {
  if (state.loading) {
    el.customersList.innerHTML = '<p class="empty">Loading customers…</p>';
    return;
  }
  if (state.loadError) {
    renderLoadError(el.customersList);
    return;
  }

  const q = state.customerSearch.trim().toLowerCase();
  const groups = customerGroups().filter(function (g) {
    if (!q) return true;
    return g.name.toLowerCase().indexOf(q) !== -1 || g.phone.toLowerCase().indexOf(q) !== -1;
  });

  if (!groups.length) {
    el.customersList.innerHTML = '<p class="empty">No customers found.</p>';
    return;
  }

  el.customersList.innerHTML = groups.map(function (g) {
    return '<div class="customer-card admin-static-card">' +
      '<div class="order-card-main">' +
        '<div class="order-card-customer">' + esc(g.name) + "</div>" +
        '<div class="order-card-meta">' + esc(g.phone) + "</div>" +
        '<div class="order-card-meta">' + g.orders + " order" + (g.orders === 1 ? "" : "s") + "</div>" +
      "</div>" +
      '<div class="order-card-side">' +
        '<div class="order-total">' + money(g.total) + "</div>" +
        '<div class="order-card-meta">Total spent</div>' +
      "</div>" +
    "</div>";
  }).join("");
}

function renderActivity() {
  el.activityList.innerHTML = '<p class="empty">Activity log is not connected yet.</p>';
}

function renderAll() {
  renderFilters();
  renderOrders();
  renderCustomers();
  renderActivity();
}

/* ── Tabs ── */
function setView(view) {
  state.view = view;
  document.querySelectorAll(".admin-tabs button").forEach(function (b) {
    b.classList.toggle("active", b.getAttribute("data-view") === view);
  });
  document.querySelectorAll(".admin-view").forEach(function (v) {
    v.classList.toggle("active", v.id === "view-" + view);
  });
  renderAll();
}

/* ── Details panel ── */
function openPanel() {
  el.panel.classList.add("open");
  el.panelBackdrop.classList.add("open");
}

function closePanel() {
  el.panel.classList.remove("open");
  el.panelBackdrop.classList.remove("open");
}

function hidePanelError() {
  const box = document.getElementById("panelError");
  if (box) {
    box.hidden = true;
    box.textContent = "";
  }
}

function showPanelError(err) {
  const box = document.getElementById("panelError");
  if (!box) return;
  box.innerHTML = "<strong>Could not update the order.</strong>" +
    '<p class="admin-alert-detail">' + esc(errorText(err)) + "</p>";
  box.hidden = false;
}

function setPanelButtonsDisabled(disabled) {
  ["approveBtn", "rejectBtn"].forEach(function (id) {
    const b = document.getElementById(id);
    if (b) b.disabled = disabled;
  });
}

function openOrder(key) {
  const o = state.orders.find(function (x) {
    return orderKey(x) === String(key);
  });
  if (!o) return;
  renderOrderPanel(o);
  openPanel();
}

function renderOrderPanel(o) {
  const items = itemsOf(o);
  const total = totalOf(o);
  const isUnusual = total >= UNUSUAL_TOTAL;
  const isPending = o.status === "PENDING_APPROVAL";
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

  const actionHtml = isPending
    ? '<div class="actions">' +
        '<button type="button" id="approveBtn" class="btn-admin-primary">Approve</button>' +
        '<button type="button" id="rejectBtn" class="btn-admin-danger">Reject</button>' +
      "</div>"
    : "";

  const contactHtml = phone
    ? '<div class="actions">' +
        '<a class="btn-admin-outline" href="tel:' + esc(phoneIntl(phone)) + '">Call ' + esc(phone) + "</a>" +
        '<a class="btn-admin-outline" href="https://wa.me/' + esc(waNumber(phone)) + '" target="_blank" rel="noopener">WhatsApp</a>' +
      "</div>"
    : "";

  el.panelContent.innerHTML =
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
    '<div class="admin-status-row"><span class="status ' + statusClass(o) + '">' + esc(statusLabel(o.status)) + "</span></div>" +
    '<div id="panelError" class="admin-alert admin-alert-error" role="alert" hidden></div>' +
    actionHtml +
    contactHtml;

  const approve = document.getElementById("approveBtn");
  if (approve) approve.addEventListener("click", function () { updateStatus(o, "APPROVED"); });

  const reject = document.getElementById("rejectBtn");
  if (reject) reject.addEventListener("click", function () { confirmReject(o); });
}

async function updateStatus(order, status) {
  if (state.saving || !client) return;

  state.saving = true;
  hidePanelError();
  setPanelButtonsDisabled(true);

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
  setPanelButtonsDisabled(false);

  if (error) {
    showPanelError(error);
    return;
  }

  order.status = status;
  toast("Order " + orderLabel(order) + " marked " + statusLabel(status).toLowerCase() + ".");
  renderOrders();
  renderCustomers();
  renderOrderPanel(order);
}

function confirmReject(order) {
  openModal({
    title: "Reject order",
    body: "Reject " + orderLabel(order) + "? The order status will change to Rejected.",
    confirmLabel: "Reject order",
    onConfirm: function () { updateStatus(order, "REJECTED"); }
  });
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

/* ── Boot & wiring ── */
async function boot() {
  if (!client) {
    showLogin("Could not connect to Supabase. Check your connection and reload the page.");
    return;
  }

  client.auth.onAuthStateChange(function (_event, session) {
    if (session) {
      if (!state.authed) setAuthed(session);
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

  if (session) setAuthed(session);
  else showLogin();
}

function init() {
  cacheElements();

  el.loginForm.addEventListener("submit", handleLogin);
  el.signOutBtn.addEventListener("click", handleSignOut);

  document.querySelectorAll(".admin-tabs button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setView(btn.getAttribute("data-view"));
    });
  });

  el.customerSearch.addEventListener("input", function (e) {
    state.customerSearch = e.target.value;
    renderCustomers();
  });

  el.panelClose.addEventListener("click", closePanel);
  el.panelBackdrop.addEventListener("click", closePanel);

  el.modalCancel.addEventListener("click", closeModal);
  el.modalConfirm.addEventListener("click", function () {
    const cb = modalCb;
    closeModal();
    if (cb) cb();
  });
  el.modal.addEventListener("click", function (e) {
    if (e.target === el.modal) closeModal();
  });

  renderFilters();
  boot();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
