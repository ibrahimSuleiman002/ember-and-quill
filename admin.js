"use strict";

// ═══════════════════════════════════════════════════════════════
//  SAMPLE DATA
//  This dashboard runs entirely on the sample data below — there is
//  no backend. To connect a real API, replace `sampleData` with a
//  fetch() and keep the same field names.
//  NOTE: no card numbers, CVVs or expiry dates are ever stored here;
//  only a card brand and the last 4 digits are kept. Approving an
//  order does NOT charge anything — it only changes local sample data.
// ═══════════════════════════════════════════════════════════════
const sampleData = {
  restaurant: { name: "Ember & Quill", currency: "₦" },

  customers: [
    {
      id: "c1",
      name: "Adaeze Okafor",
      phone: "07012345001",
      email: "adaeze.okafor@example.com",
      addresses: [
        { type: "Home", text: "12 Akin Adesola Street, Victoria Island, Lagos" },
        { type: "Office", text: "45 Adeola Odeku Street, Victoria Island, Lagos" }
      ],
      payment: { brand: "Visa", last4: "4821" }
    },
    {
      id: "c2",
      name: "Tunde Balogun",
      phone: "07012345002",
      email: "tunde.balogun@example.com",
      addresses: [
        { type: "Home", text: "8 Ahmadu Bello Way, Wuse, Abuja" }
      ],
      payment: { brand: "Mastercard", last4: "9034" }
    },
    {
      id: "c3",
      name: "Ngozi Eze",
      phone: "07012345003",
      email: "ngozi.eze@example.com",
      addresses: [
        { type: "Home", text: "22 Opebi Road, Ikeja, Lagos" },
        { type: "Office", text: "14 Bishop Oluwole Street, Lagos Island, Lagos" }
      ],
      payment: { brand: "Visa", last4: "1188" }
    },
    {
      id: "c4",
      name: "Chidi Nwosu",
      phone: "07012345004",
      email: "chidi.nwosu@example.com",
      addresses: [
        { type: "Home", text: "5 Maitama Sule Street, Kano" }
      ],
      payment: { brand: "Verve", last4: "5567" }
    },
    {
      id: "c5",
      name: "Fatima Bello",
      phone: "07012345005",
      email: "fatima.bello@example.com",
      addresses: [
        { type: "Home", text: "31 Wuse Zone 5, Abuja" }
      ],
      payment: { brand: "Mastercard", last4: "7742" }
    }
  ],

  orders: [
    {
      id: "o1",
      number: "ORD-1041",
      customerId: "c2",
      time: "2026-10-20 13:40",
      status: "PAID",
      addressType: "Home",
      address: "8 Ahmadu Bello Way, Wuse, Abuja",
      items: [
        { name: "Grilled Catfish", qty: 1, price: 12500 },
        { name: "Chapman", qty: 2, price: 2500 }
      ],
      total: 17500,
      unusual: null,
      rejectReason: null
    },
    {
      id: "o2",
      number: "ORD-1042",
      customerId: "c1",
      time: "2026-10-20 14:05",
      status: "PENDING_APPROVAL",
      addressType: "Office",
      address: "45 Adeola Odeku Street, Victoria Island, Lagos",
      items: [
        { name: "Jollof Rice & Grilled Chicken", qty: 2, price: 8500 },
        { name: "Zobo Spritz", qty: 4, price: 3000 }
      ],
      total: 29000,
      unusual: null,
      rejectReason: null
    },
    {
      id: "o3",
      number: "ORD-1043",
      customerId: "c3",
      time: "2026-10-20 14:22",
      status: "APPROVED",
      addressType: "Home",
      address: "22 Opebi Road, Ikeja, Lagos",
      items: [
        { name: "Pepper Snails", qty: 1, price: 6500 },
        { name: "Banga Soup & Starch", qty: 1, price: 9500 },
        { name: "Ginger Beer", qty: 2, price: 1800 }
      ],
      total: 19600,
      unusual: null,
      rejectReason: null
    },
    {
      id: "o4",
      number: "ORD-1044",
      customerId: "c4",
      time: "2026-10-20 14:35",
      status: "PENDING_APPROVAL",
      addressType: "Home",
      address: "5 Maitama Sule Street, Kano",
      items: [
        { name: "Premium Striploin", qty: 4, price: 25000 },
        { name: "Palm Wine Sangria", qty: 4, price: 6500 },
        { name: "Chin Chin Cheesecake", qty: 4, price: 5500 }
      ],
      total: 148000,
      unusual: { reason: "Order is 4x larger than usual" },
      rejectReason: null
    },
    {
      id: "o5",
      number: "ORD-1045",
      customerId: "c5",
      time: "2026-10-20 14:48",
      status: "PENDING_APPROVAL",
      addressType: "Home",
      address: "31 Wuse Zone 5, Abuja",
      items: [
        { name: "Fresh Mango Juice", qty: 1, price: 2000 }
      ],
      total: 2000,
      unusual: { reason: "New address, first time" },
      rejectReason: null
    },
    {
      id: "o6",
      number: "ORD-1046",
      customerId: "c1",
      time: "2026-10-20 15:02",
      status: "REJECTED",
      addressType: "Office",
      address: "45 Adeola Odeku Street, Victoria Island, Lagos",
      items: [
        { name: "Suya-Spiced Wings", qty: 2, price: 4500 },
        { name: "The Quill's Old Fashioned", qty: 1, price: 8000 }
      ],
      total: 17000,
      unusual: null,
      rejectReason: "Item out of stock"
    },
    {
      id: "o7",
      number: "ORD-1047",
      customerId: "c2",
      time: "2026-10-20 15:15",
      status: "PAID",
      addressType: "Home",
      address: "8 Ahmadu Bello Way, Wuse, Abuja",
      items: [
        { name: "Egusi Soup & Pounded Yam", qty: 1, price: 10500 },
        { name: "Akara Waffles", qty: 1, price: 4500 }
      ],
      total: 15000,
      unusual: null,
      rejectReason: null
    },
    {
      id: "o8",
      number: "ORD-1048",
      customerId: "c3",
      time: "2026-10-20 15:30",
      status: "CANCELLED",
      addressType: "Office",
      address: "14 Bishop Oluwole Street, Lagos Island, Lagos",
      items: [
        { name: "Grilled Prawn Skewers", qty: 1, price: 7500 }
      ],
      total: 7500,
      unusual: null,
      rejectReason: null
    }
  ],

  activity: [
    { time: "2026-10-20 15:31", actor: "System", message: "Order ORD-1048 cancelled by customer" },
    { time: "2026-10-20 15:16", actor: "Admin", message: "Order ORD-1047 status changed to Paid" },
    { time: "2026-10-20 15:03", actor: "Admin", message: "Order ORD-1046 rejected — Item out of stock" },
    { time: "2026-10-20 14:49", actor: "System", message: "New order ORD-1045 received" },
    { time: "2026-10-20 14:36", actor: "System", message: "New order ORD-1044 received" },
    { time: "2026-10-20 14:23", actor: "Admin", message: "Order ORD-1043 status changed to Approved" }
  ]
};

const STATUS_ORDER = ["PENDING_APPROVAL", "APPROVED", "PAID", "REJECTED", "CANCELLED"];
const STATUS_LABELS = {
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  PAID: "Paid",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled"
};

const state = {
  view: "orders",
  statusFilter: "ALL",
  customerSearch: ""
};

/* ── Helpers ── */
function money(n) {
  return sampleData.restaurant.currency + n.toLocaleString("en-NG");
}
function pad2(n) { return String(n).padStart(2, "0"); }
function nowStamp() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}
function findCustomer(id) { return sampleData.customers.find(function (c) { return c.id === id; }); }
function findOrder(id) { return sampleData.orders.find(function (o) { return o.id === id; }); }
function statusLabel(s) { return STATUS_LABELS[s] || s; }
function phoneIntl(p) { return "+234" + String(p).replace(/^0/, ""); }
function waNumber(p) { return "234" + String(p).replace(/^0/, ""); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
  });
}
function log(message, actor) {
  sampleData.activity.unshift({ time: nowStamp(), actor: actor || "Admin", message: message });
  renderActivity();
}

/* ── Element refs ── */
const el = {
  filters: document.getElementById("statusFilters"),
  ordersList: document.getElementById("ordersList"),
  customersList: document.getElementById("customersList"),
  activityList: document.getElementById("activityList"),
  customerSearch: document.getElementById("customerSearch"),
  addCustomerBtn: document.getElementById("addCustomerBtn"),
  panel: document.getElementById("panel"),
  panelContent: document.getElementById("panelContent"),
  panelBackdrop: document.getElementById("panelBackdrop"),
  panelClose: document.getElementById("panelClose"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  modalBody: document.getElementById("modalBody"),
  modalFields: document.getElementById("modalFields"),
  modalInput: document.getElementById("modalInput"),
  modalCancel: document.getElementById("modalCancel"),
  modalConfirm: document.getElementById("modalConfirm"),
  toast: document.getElementById("toast")
};

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

function renderOrders() {
  const orders = sampleData.orders
    .filter(function (o) { return state.statusFilter === "ALL" || o.status === state.statusFilter; })
    .slice()
    .sort(function (a, b) { return b.time.localeCompare(a.time); });

  if (!orders.length) {
    el.ordersList.innerHTML = '<p class="empty">No orders match this filter.</p>';
    return;
  }

  el.ordersList.innerHTML = orders.map(function (o) {
    const c = findCustomer(o.customerId);
    const unusual = o.unusual ? '<span class="tag tag-unusual">Unusual</span>' : "";
    return '<button type="button" class="order-card" data-order-id="' + o.id + '">' +
      '<div class="order-card-main">' +
        '<div class="order-card-top"><span class="order-number">' + esc(o.number) + "</span>" + unusual + "</div>" +
        '<div class="order-card-customer">' + esc(c ? c.name : "Unknown customer") + "</div>" +
        '<div class="order-card-meta">' + esc(o.time) + "</div>" +
      "</div>" +
      '<div class="order-card-side">' +
        '<div class="order-total">' + money(o.total) + "</div>" +
        '<span class="status status-' + o.status + '">' + esc(statusLabel(o.status)) + "</span>" +
      "</div>" +
    "</button>";
  }).join("");

  el.ordersList.querySelectorAll(".order-card").forEach(function (card) {
    card.addEventListener("click", function () { openOrder(card.getAttribute("data-order-id")); });
  });
}

function renderCustomers() {
  const q = state.customerSearch.trim().toLowerCase();
  const list = sampleData.customers.filter(function (c) {
    if (!q) return true;
    return c.name.toLowerCase().indexOf(q) !== -1 ||
      c.phone.indexOf(q) !== -1 ||
      c.email.toLowerCase().indexOf(q) !== -1;
  });

  if (!list.length) {
    el.customersList.innerHTML = '<p class="empty">No customers found.</p>';
    return;
  }

  el.customersList.innerHTML = list.map(function (c) {
    const orderCount = sampleData.orders.filter(function (o) { return o.customerId === c.id; }).length;
    return '<button type="button" class="customer-card" data-customer-id="' + c.id + '">' +
      '<div class="order-card-main">' +
        '<div class="order-card-customer">' + esc(c.name) + "</div>" +
        '<div class="order-card-meta">' + esc(c.phone) + "</div>" +
        '<div class="order-card-meta">' + esc(c.email) + "</div>" +
        '<div class="order-card-meta">' + orderCount + " order" + (orderCount === 1 ? "" : "s") + "</div>" +
      "</div>" +
    "</button>";
  }).join("");

  el.customersList.querySelectorAll(".customer-card").forEach(function (card) {
    card.addEventListener("click", function () { openCustomer(card.getAttribute("data-customer-id")); });
  });
}

function renderActivity() {
  el.activityList.innerHTML = sampleData.activity.map(function (a) {
    return '<div class="activity-item">' +
      '<div class="activity-time">' + esc(a.time) + "</div>" +
      '<div class="activity-msg"><strong>' + esc(a.actor) + "</strong> " + esc(a.message) + "</div>" +
    "</div>";
  }).join("") || '<p class="empty">No activity yet.</p>';
}

function renderAll() {
  renderFilters();
  if (state.view === "orders") renderOrders();
  if (state.view === "customers") renderCustomers();
  if (state.view === "activity") renderActivity();
}

/* ── Panel ── */
function openPanel() {
  el.panel.classList.add("open");
  el.panelBackdrop.classList.add("open");
}
function closePanel() {
  el.panel.classList.remove("open");
  el.panelBackdrop.classList.remove("open");
}

function openOrder(id) {
  const o = findOrder(id);
  const c = findCustomer(o.customerId);
  const prev = sampleData.orders.filter(function (x) {
    return x.customerId === o.customerId && x.id !== o.id;
  });

  const itemsHtml = o.items.map(function (it) {
    return '<div class="line-item"><span>' + esc(it.name) + ' <span class="muted">&times;' + it.qty + "</span></span>" +
      "<span>" + money(it.price * it.qty) + "</span></div>";
  }).join("");

  const prevHtml = prev.length
    ? prev.map(function (p) {
        return '<div class="line-item"><span>' + esc(p.number) + "</span>" +
          '<span class="status status-' + p.status + '">' + esc(statusLabel(p.status)) + "</span></div>";
      }).join("")
    : '<p class="empty">No previous orders.</p>';

  const unusualHtml = o.unusual
    ? '<div class="unusual-box"><strong>Unusual order</strong><p>' + esc(o.unusual.reason) + "</p></div>"
    : "";

  const statusOptions = STATUS_ORDER.map(function (s) {
    return '<option value="' + s + '"' + (o.status === s ? " selected" : "") + ">" + esc(statusLabel(s)) + "</option>";
  }).join("");

  const rejectHtml = o.rejectReason
    ? '<div class="unusual-box"><strong>Rejection reason</strong><p>' + esc(o.rejectReason) + "</p></div>"
    : "";

  el.panelContent.innerHTML =
    "<h2>Order " + esc(o.number) + "</h2>" +
    unusualHtml +
    rejectHtml +
    '<div class="detail-grid">' +
      "<div><span class='label'>Customer</span><div class='value'>" + esc(c.name) + "</div></div>" +
      "<div><span class='label'>Phone</span><div class='value'>" + esc(c.phone) + "</div></div>" +
      "<div><span class='label'>Email</span><div class='value'>" + esc(c.email) + "</div></div>" +
      "<div><span class='label'>Deliver to</span><div class='value'>" + esc(o.addressType) + " — " + esc(o.address) + "</div></div>" +
    "</div>" +
    "<h3>Items</h3>" +
    '<div class="line-list">' + itemsHtml + "</div>" +
    '<div class="line-item total"><span>Total</span><span>' + money(o.total) + "</span></div>" +
    '<div class="detail-grid">' +
      "<div><span class='label'>Payment</span><div class='value'>Card ending ****" + esc(c.payment.last4) + "</div></div>" +
      "<div><span class='label'>Status</span><div><select id='statusSelect' class='admin-select'>" + statusOptions + "</select></div></div>" +
    "</div>" +
    "<h3>Previous orders</h3>" +
    '<div class="line-list">' + prevHtml + "</div>" +
    '<div class="actions">' +
      '<button type="button" id="approveBtn" class="btn-admin-primary">Approve</button>' +
      '<button type="button" id="rejectBtn" class="btn-admin-danger">Reject</button>' +
      '<button type="button" id="flagBtn" class="btn-admin-ghost">Flag as unusual</button>' +
    "</div>" +
    '<div class="actions">' +
      '<a class="btn-admin-outline" href="tel:' + phoneIntl(c.phone) + '">Call ' + esc(c.phone) + "</a>" +
      '<a class="btn-admin-outline" href="https://wa.me/' + waNumber(c.phone) + '" target="_blank" rel="noopener">WhatsApp</a>' +
    "</div>";

  document.getElementById("statusSelect").addEventListener("change", function (e) {
    changeStatus(o.id, e.target.value);
  });
  document.getElementById("approveBtn").addEventListener("click", function () { approveOrder(o.id); });
  document.getElementById("rejectBtn").addEventListener("click", function () { rejectOrder(o.id); });
  document.getElementById("flagBtn").addEventListener("click", function () { flagOrder(o.id); });

  openPanel();
}

function openCustomer(id) {
  const c = findCustomer(id);
  const orders = sampleData.orders
    .filter(function (o) { return o.customerId === id; })
    .slice()
    .sort(function (a, b) { return b.time.localeCompare(a.time); });

  const addrHtml = c.addresses.map(function (a) {
    return '<div class="line-item"><span>' + esc(a.type) + "</span><span>" + esc(a.text) + "</span></div>";
  }).join("");

  const ordHtml = orders.length
    ? orders.map(function (o) {
        return '<div class="line-item"><span>' + esc(o.number) + ' <span class="muted">' + esc(o.time) + "</span></span>" +
          "<span>" + money(o.total) + ' <span class="status status-' + o.status + '">' + esc(statusLabel(o.status)) + "</span></span></div>";
      }).join("")
    : '<p class="empty">No orders yet.</p>';

  el.panelContent.innerHTML =
    "<h2>" + esc(c.name) + "</h2>" +
    '<div class="detail-grid">' +
      "<div><span class='label'>Phone</span><div class='value'>" + esc(c.phone) + "</div></div>" +
      "<div><span class='label'>Email</span><div class='value'>" + esc(c.email) + "</div></div>" +
      "<div><span class='label'>Payment</span><div class='value'>" + esc(c.payment.brand) + " ending ****" + esc(c.payment.last4) + "</div></div>" +
    "</div>" +
    "<h3>Saved addresses</h3>" +
    '<div class="line-list">' + addrHtml + "</div>" +
    "<h3>Orders</h3>" +
    '<div class="line-list">' + ordHtml + "</div>" +
    '<div class="actions">' +
      '<button type="button" id="editCustomerBtn" class="btn-admin-primary">Edit</button>' +
      '<button type="button" id="deleteCustomerBtn" class="btn-admin-danger">Delete</button>' +
    "</div>" +
    '<div class="actions">' +
      '<a class="btn-admin-outline" href="tel:' + phoneIntl(c.phone) + '">Call</a>' +
      '<a class="btn-admin-outline" href="https://wa.me/' + waNumber(c.phone) + '" target="_blank" rel="noopener">WhatsApp</a>' +
    "</div>";

  document.getElementById("editCustomerBtn").addEventListener("click", function () { editCustomer(id); });
  document.getElementById("deleteCustomerBtn").addEventListener("click", function () { deleteCustomer(id); });

  openPanel();
}

/* ── Modal ── */
let modalCb = null;

function openModal(opts) {
  el.modalTitle.textContent = opts.title || "";
  el.modalBody.textContent = opts.body || "";

  if (opts.fields) {
    el.modalFields.style.display = "block";
    el.modalFields.innerHTML = opts.fields.map(function (f) {
      if (f.type === "select") {
        const options = f.options.map(function (o) {
          return '<option value="' + esc(o) + '"' + (o === f.value ? " selected" : "") + ">" + esc(o) + "</option>";
        }).join("");
        return '<label class="modal-field"><span>' + esc(f.label) + '</span><select data-key="' + f.key + '" class="admin-select">' + options + "</select></label>";
      }
      return '<label class="modal-field"><span>' + esc(f.label) + '</span><input data-key="' + f.key + '" class="admin-input" type="text" value="' + esc(f.value || "") + '"></label>';
    }).join("");
  } else {
    el.modalFields.style.display = "none";
    el.modalFields.innerHTML = "";
  }

  el.modalInput.style.display = opts.textarea ? "block" : "none";
  el.modalInput.value = opts.textareaValue || "";
  el.modalConfirm.textContent = opts.confirmLabel || "Confirm";
  modalCb = opts.onConfirm;
  el.modal.classList.add("open");
}

function closeModal() {
  el.modal.classList.remove("open");
  modalCb = null;
}

function readModal() {
  const vals = {};
  el.modalFields.querySelectorAll("[data-key]").forEach(function (input) {
    vals[input.getAttribute("data-key")] = input.value.trim();
  });
  const ta = el.modalInput;
  const reason = ta.style.display === "none" ? "" : ta.value.trim();
  return { vals: vals, reason: reason };
}

/* ── Toast ── */
let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.toast.classList.remove("show"); }, 3500);
}

/* ── Actions ── */
function changeStatus(id, status) {
  const o = findOrder(id);
  if (!o || o.status === status) return;
  o.status = status;
  log("Order " + o.number + " status changed to " + statusLabel(status));
  renderOrders();
  openOrder(id);
}

function approveOrder(id) {
  const o = findOrder(id);
  o.status = "PAID";
  log("Order " + o.number + " approved — status set to PAID (sample only)");
  toast("Sample only: no payment was taken.");
  renderOrders();
  openOrder(id);
}

function rejectOrder(id) {
  const o = findOrder(id);
  openModal({
    title: "Reject order",
    body: "Provide a reason for rejecting " + o.number + ".",
    textarea: true,
    confirmLabel: "Reject order",
    onConfirm: function (vals, reason) {
      o.status = "REJECTED";
      o.rejectReason = reason || "No reason given";
      log("Order " + o.number + " rejected — " + o.rejectReason);
      renderOrders();
      openOrder(id);
    }
  });
}

function flagOrder(id) {
  const o = findOrder(id);
  openModal({
    title: "Flag as unusual",
    body: "Why is " + o.number + " unusual?",
    textarea: true,
    confirmLabel: "Flag order",
    onConfirm: function (vals, reason) {
      o.unusual = { reason: reason || "Flagged as unusual" };
      log("Order " + o.number + " flagged as unusual — " + o.unusual.reason);
      renderOrders();
      openOrder(id);
    }
  });
}

function addCustomer() {
  openModal({
    title: "Add customer",
    body: "Enter the customer details. Card details are stored as brand and last 4 digits only.",
    fields: [
      { key: "name", label: "Name", value: "" },
      { key: "phone", label: "Phone", value: "" },
      { key: "email", label: "Email", value: "" },
      { key: "addressType", label: "Address type", type: "select", options: ["Home", "Office"], value: "Home" },
      { key: "addressText", label: "Address", value: "" },
      { key: "cardBrand", label: "Card brand", type: "select", options: ["Visa", "Mastercard", "Verve"], value: "Visa" },
      { key: "cardLast4", label: "Card last 4 digits", value: "" }
    ],
    confirmLabel: "Add customer",
    onConfirm: function (vals) {
      const c = {
        id: "c" + Date.now(),
        name: vals.name || "New customer",
        phone: vals.phone || "",
        email: vals.email || "",
        addresses: [{ type: vals.addressType || "Home", text: vals.addressText || "" }],
        payment: { brand: vals.cardBrand || "Visa", last4: (vals.cardLast4 || "").slice(-4) }
      };
      sampleData.customers.push(c);
      log("Added customer " + c.name);
      renderCustomers();
      toast("Customer added (sample data only).");
    }
  });
}

function editCustomer(id) {
  const c = findCustomer(id);
  if (!c) return;
  openModal({
    title: "Edit customer",
    body: "Update the customer details.",
    fields: [
      { key: "name", label: "Name", value: c.name },
      { key: "phone", label: "Phone", value: c.phone },
      { key: "email", label: "Email", value: c.email },
      { key: "addressType", label: "Address type", type: "select", options: ["Home", "Office"], value: c.addresses[0] ? c.addresses[0].type : "Home" },
      { key: "addressText", label: "Address", value: c.addresses[0] ? c.addresses[0].text : "" },
      { key: "cardBrand", label: "Card brand", type: "select", options: ["Visa", "Mastercard", "Verve"], value: c.payment.brand },
      { key: "cardLast4", label: "Card last 4 digits", value: c.payment.last4 }
    ],
    confirmLabel: "Save changes",
    onConfirm: function (vals) {
      c.name = vals.name || c.name;
      c.phone = vals.phone || c.phone;
      c.email = vals.email || c.email;
      if (c.addresses[0]) {
        c.addresses[0].type = vals.addressType || c.addresses[0].type;
        c.addresses[0].text = vals.addressText || c.addresses[0].text;
      } else {
        c.addresses = [{ type: vals.addressType || "Home", text: vals.addressText || "" }];
      }
      c.payment.brand = vals.cardBrand || c.payment.brand;
      c.payment.last4 = (vals.cardLast4 || c.payment.last4).slice(-4);
      log("Edited customer " + c.name);
      renderCustomers();
      openCustomer(id);
      toast("Customer updated (sample data only).");
    }
  });
}

function deleteCustomer(id) {
  const c = findCustomer(id);
  if (!c) return;
  openModal({
    title: "Delete customer",
    body: "Delete " + c.name + "? This cannot be undone. Their orders will remain in the sample data.",
    confirmLabel: "Delete",
    onConfirm: function () {
      sampleData.customers = sampleData.customers.filter(function (x) { return x.id !== id; });
      log("Deleted customer " + c.name);
      closePanel();
      renderCustomers();
      toast("Customer deleted (sample data only).");
    }
  });
}

/* ── Init ── */
function init() {
  renderAll();

  document.querySelectorAll(".admin-tabs button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.view = btn.getAttribute("data-view");
      document.querySelectorAll(".admin-tabs button").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
      document.querySelectorAll(".admin-view").forEach(function (v) {
        v.classList.toggle("active", v.id === "view-" + state.view);
      });
      renderAll();
    });
  });

  el.customerSearch.addEventListener("input", function (e) {
    state.customerSearch = e.target.value;
    renderCustomers();
  });

  el.addCustomerBtn.addEventListener("click", addCustomer);
  el.panelClose.addEventListener("click", closePanel);
  el.panelBackdrop.addEventListener("click", closePanel);
  el.modalCancel.addEventListener("click", closeModal);

  el.modalConfirm.addEventListener("click", function () {
    const data = readModal();
    const cb = modalCb;
    closeModal();
    if (cb) cb(data.vals, data.reason);
  });
}

init();
