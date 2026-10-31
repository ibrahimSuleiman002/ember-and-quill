// ═══════════════════════════════════════════════════════════════
//  my-orders.js — the customer's own orders and reservations
//  Reads only their rows (RLS), follows changes with Realtime,
//  and cancels through the cancel_my_* RPCs.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // The one client created in supabase-config.js, shared with auth.js.
  var client = window.eqSupabase || null;

  var orders = [];
  var reservations = [];
  var statuses = {};           // "order:<id>" → last known status
  var pendingCancel = null;
  var channel = null;
  var audioCtx = null;
  var toastTimer = null;
  var reloadTimer = null;
  var loading = false;
  var reloadAgain = false;
  var lastLoadOk = false;      // true only when the last load returned without errors
  var activeTab = null;        // 'orders' | 'reservations'
  var ui = {};

  var ORDER_LABELS = {
    PENDING_APPROVAL: 'Pending approval',
    APPROVED: 'Approved',
    PAID: 'Paid',
    PREPARING: 'Approved',
    OUT_FOR_DELIVERY: 'Out for delivery',
    DELIVERED: 'Delivered',
    REJECTED: 'Rejected',
    CANCELLED: 'Cancelled'
  };

  var RESERVATION_LABELS = {
    PENDING: 'Pending',
    CONFIRMED: 'Confirmed',
    CANCELLED: 'Cancelled'
  };

  var ORDER_STEPS = ['Received', 'Approved', 'Out for delivery'];
  var RESERVATION_STEPS = ['Received', 'Confirmed'];

  function $(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    ui.list = $('myOrdersList');
    ui.message = $('myOrdersMessage');
    ui.gate = $('myOrdersGate');
    ui.login = $('myOrdersLogin');
    ui.refresh = $('myOrdersRefresh');
    ui.loading = $('myOrdersLoading');
    ui.toast = $('myOrdersToast');
    ui.dialog = $('cancelDialog');
    ui.dialogTitle = $('cancelDialogTitle');
    ui.dialogBody = $('cancelDialogBody');
    ui.dialogYes = $('cancelDialogYes');
    ui.dialogNo = $('cancelDialogNo');
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[ch];
    });
  }

  function money(n) {
    var currency = (typeof siteConfig !== 'undefined' && siteConfig.currency)
      ? siteConfig.currency
      : '₦';
    return currency + (Number(n) || 0).toLocaleString('en-NG');
  }

  function orderLabel(order) {
    var n = order.order_no;
    if (n === null || n === undefined || n === '') return 'ORD-—';
    return 'ORD-' + String(n).padStart(4, '0');
  }

  function itemsOf(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        var parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        return [];
      }
    }
    return [];
  }

  function guestsLabel(n) {
    var value = Number(n) || 0;
    return value + (value === 1 ? ' guest' : ' guests');
  }

  function dateWords(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!m) return String(value || '—');

    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return String(value);

    try {
      return d.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    } catch (err) {
      return d.toDateString();
    }
  }

  function shortDate(value) {
    var d = new Date(value || '');
    if (isNaN(d.getTime())) return '';

    try {
      return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    } catch (err) {
      return d.toDateString();
    }
  }

  // Accepts "19:30", "19:30:00" or "7:30 PM".
  function timeWords(value) {
    var raw = String(value || '').trim();
    if (!raw) return '—';

    var m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/.exec(raw);
    if (!m) return raw;

    var hours = Number(m[1]);
    var minutes = m[2];
    var suffix = m[3] ? m[3].toUpperCase() : (hours >= 12 ? 'PM' : 'AM');
    var h12 = hours % 12 || 12;
    return h12 + ':' + minutes + ' ' + suffix;
  }

  function timestamp(value) {
    var t = new Date(value || '').getTime();
    return isNaN(t) ? 0 : t;
  }

  function reservationHeading(reservation) {
    var rawDate = String((reservation && reservation.reservation_date) || '');
    var time = timeWords(reservation && reservation.reservation_time);
    var dateLabel = '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(rawDate);

    if (m) {
      var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!isNaN(d.getTime())) {
        try {
          dateLabel = d.toLocaleDateString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short'
          }).replace(',', '');
        } catch (err) {
          dateLabel = d.toDateString();
        }
      }
    }

    if (!dateLabel) dateLabel = rawDate;

    var parts = ['Reservation'];
    if (dateLabel) parts.push(dateLabel);
    if (time && time !== '—') parts.push(time);
    return parts.join(', ');
  }

  function orderPillClass(status) {
    if (status === 'PENDING_APPROVAL') return 'is-pending';
    if (status === 'CANCELLED') return 'is-cancelled';
    if (status === 'REJECTED') return 'is-rejected';
    if (status === 'DELIVERED') return 'is-done';
    if (status === 'OUT_FOR_DELIVERY') return 'is-progress';
    return 'is-approved';
  }

  function reservationPillClass(status) {
    if (status === 'PENDING') return 'is-pending';
    if (status === 'CONFIRMED') return 'is-approved';
    return 'is-cancelled';
  }

  function statusIndex(status) {
    if (status === 'APPROVED' || status === 'PAID' || status === 'PREPARING') return 1;
    if (status === 'OUT_FOR_DELIVERY') return 2;
    if (status === 'DELIVERED') return 3;
    return 0;
  }

  function isPaid(order) {
    return !!(order && order.paid_at);
  }

  function orderStatusText(order) {
    var status = String((order && order.status) || '');

    if (status === 'CANCELLED') return 'This order was cancelled.';
    if (status === 'REJECTED') return 'Your order was rejected. Please call us if you need help.';
    if (status === 'OUT_FOR_DELIVERY') return 'Your order is on the way!';
    if (status === 'DELIVERED') return 'Delivered';
    if (status === 'APPROVED' || status === 'PREPARING') return 'Your order is approved';
    if (isPaid(order) || status === 'PAID') return 'Payment received';
    return 'Order received, waiting for payment';
  }

  function canCancelOrder(order) {
    var status = String(order.status || '');
    return !isPaid(order) && (status === 'PENDING_APPROVAL' || status === 'APPROVED');
  }

  function canCancelReservation(reservation) {
    var status = String(reservation.status || '');
    return status === 'PENDING' || status === 'CONFIRMED';
  }

  function isReservationPaid(reservation) {
    return !!(reservation && reservation.paid_at);
  }

  function reservationStatusText(reservation) {
    var status = String((reservation && reservation.status) || '');

    if (status === 'CANCELLED') return 'This reservation was cancelled.';
    if (status === 'CONFIRMED') return 'Your reservation is confirmed';
    if (isReservationPaid(reservation)) return 'Payment received';
    return 'Reservation received, waiting for payment';
  }

  function reservationProgressHtml(status) {
    var terminal = status === 'CANCELLED';
    var active = status === 'CONFIRMED' ? 1 : 0;

    return '<div class="track-progress" aria-label="Reservation progress">' +
      RESERVATION_STEPS.map(function (label, i) {
        var cls = 'track-step';
        if (i < active) cls += ' is-done';
        else if (i === active) cls += ' is-done' + (terminal ? '' : ' is-current');
        return '<div class="' + cls + '">' +
          '<span class="track-dot" aria-hidden="true"></span>' +
          '<span class="track-step-label">' + label + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function progressHtml(status) {
    var terminal = status === 'CANCELLED' || status === 'REJECTED';
    var active = statusIndex(status);

    return '<div class="track-progress" aria-label="Order progress">' +
      ORDER_STEPS.map(function (label, i) {
        var cls = 'track-step';
        if (i < active) cls += ' is-done';
        else if (i === active) cls += ' is-done' + (terminal ? '' : ' is-current');
        return '<div class="' + cls + '">' +
          '<span class="track-dot" aria-hidden="true"></span>' +
          '<span class="track-step-label">' + label + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function orderBanner(status) {
    if (status === 'OUT_FOR_DELIVERY') {
      return '<div class="track-banner is-on-the-way">Your order is on the way!</div>';
    }
    if (status === 'CANCELLED') {
      return '<div class="track-banner is-cancelled">This order was cancelled.</div>';
    }
    if (status === 'REJECTED') {
      return '<div class="track-banner is-rejected">This order was rejected. Please call us if you need help.</div>';
    }
    if (status === 'DELIVERED') {
      return '<div class="track-banner is-delivered">Delivered</div>';
    }
    return '';
  }

  function orderCard(order) {
    var status = String(order.status || '');
    var items = itemsOf(order.items);

    var itemsHtml = items.length
      ? items.map(function (item) {
          var qty = Number(item.qty) || 0;
          var price = Number(item.price) || 0;
          return '<div class="order-line">' +
            '<span class="order-line-name">' + esc(item.name || 'Item') +
              ' <span class="order-line-qty">×' + qty + '</span>' +
            '</span>' +
            '<span class="order-line-price">' + money(price * qty) + '</span>' +
          '</div>';
        }).join('')
      : '<p class="track-empty-line">No items recorded.</p>';

    var paidBadge = isPaid(order)
      ? '<span class="track-pill is-done">Payment received</span>'
      : '';

    var placed = shortDate(order.created_at);

    // The banner already spells out the terminal / on-the-way states.
    var banner = orderBanner(status);
    var statusText = orderStatusText(order);
    var statusLine = banner.indexOf(statusText) === -1
      ? '<p class="my-order-status">' + esc(statusText) + '</p>'
      : '';

    var cancelHtml = canCancelOrder(order)
      ? '<div class="my-order-actions">' +
          '<button type="button" class="btn btn-danger" data-cancel-order="' + esc(order.id) + '">Cancel order</button>' +
        '</div>'
      : '';

    return '<article class="track-card">' +
      '<div class="track-card-head">' +
        '<h2 class="track-card-title">Order ' + esc(orderLabel(order)) + '</h2>' +
        '<span class="track-pill ' + orderPillClass(status) + '">' +
          esc(ORDER_LABELS[status] || status || 'Unknown') +
        '</span>' +
        paidBadge +
      '</div>' +
      (placed ? '<p class="my-order-date">Placed ' + esc(placed) + '</p>' : '') +
      statusLine +
      banner +
      progressHtml(status) +
      '<div class="track-items">' + itemsHtml + '</div>' +
      '<div class="order-total-row">' +
        '<span>Total</span>' +
        '<span class="order-total-amount">' + money(order.total) + '</span>' +
      '</div>' +
      cancelHtml +
    '</article>';
  }

  function reservationCard(reservation) {
    var status = String(reservation.status || '');
    var banner = status === 'CANCELLED'
      ? '<div class="track-banner is-cancelled">This reservation was cancelled.</div>'
      : '';

    var paidBadge = isReservationPaid(reservation)
      ? '<span class="track-pill is-done">Payment received</span>'
      : '';

    var statusText = reservationStatusText(reservation);
    var statusLine = banner.indexOf(statusText) === -1
      ? '<p class="my-order-status">' + esc(statusText) + '</p>'
      : '';

    var cancelHtml = canCancelReservation(reservation)
      ? '<div class="my-order-actions">' +
          '<button type="button" class="btn btn-danger" data-cancel-reservation="' + esc(reservation.id) + '">Cancel reservation</button>' +
        '</div>'
      : '';

    return '<article class="track-card">' +
      '<div class="track-card-head">' +
        '<h2 class="track-card-title">' + esc(reservationHeading(reservation)) + '</h2>' +
        '<span class="track-pill ' + reservationPillClass(status) + '">' +
          esc(RESERVATION_LABELS[status] || status || 'Unknown') +
        '</span>' +
        paidBadge +
      '</div>' +
      statusLine +
      banner +
      reservationProgressHtml(status) +
      '<dl class="track-detail-grid">' +
        '<dt>Guests</dt><dd>' + esc(guestsLabel(reservation.party_size)) + '</dd>' +
        '<dt>Date</dt><dd>' + esc(dateWords(reservation.reservation_date)) + '</dd>' +
        '<dt>Time</dt><dd>' + esc(timeWords(reservation.reservation_time)) + '</dd>' +
        '<dt>Notes</dt><dd>' + (reservation.notes ? esc(reservation.notes) : '—') + '</dd>' +
      '</dl>' +
      cancelHtml +
    '</article>';
  }

  function tabButton(key, label, active) {
    return '<button type="button" class="acct-tab' + (active ? ' is-active' : '') + '"' +
      ' data-my-tab="' + key + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '"' +
      ' aria-controls="my-' + key + '-panel">' + label + '</button>';
  }

  function panelHtml(key, heading, body, empty, active) {
    return '<div class="my-orders-panel" id="my-' + key + '-panel" data-my-panel="' + key + '"' +
      ' role="tabpanel"' + (active ? '' : ' hidden') + '>' +
      '<div class="my-orders-head"><h2>' + heading + '</h2></div>' +
      (body || empty) +
    '</div>';
  }

  function emptyOrdersHtml() {
    return '<div class="my-orders-empty">' +
      '<p class="track-empty">You have no orders yet</p>' +
      '<a href="order.html" class="btn btn-primary">Order online</a>' +
    '</div>';
  }

  function emptyReservationsHtml() {
    return '<div class="my-orders-empty">' +
      '<p class="track-empty">You have no reservations yet</p>' +
      '<a href="reservations.html" class="btn btn-primary">Reserve a table</a>' +
    '</div>';
  }

  function newestTab() {
    if (!orders.length && !reservations.length) return 'orders';
    if (!orders.length) return 'reservations';
    if (!reservations.length) return 'orders';

    var newestOrder = orders.reduce(function (max, order) {
      return Math.max(max, timestamp(order.created_at));
    }, 0);
    var newestReservation = reservations.reduce(function (max, reservation) {
      return Math.max(max, timestamp(reservation.created_at));
    }, 0);

    return newestReservation > newestOrder ? 'reservations' : 'orders';
  }

  function setTab(tab) {
    if (tab !== 'orders' && tab !== 'reservations') return;
    activeTab = tab;

    var tabs = ui.list.querySelectorAll('[data-my-tab]');
    Array.prototype.forEach.call(tabs, function (btn) {
      var on = btn.getAttribute('data-my-tab') === tab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    var panels = ui.list.querySelectorAll('[data-my-panel]');
    Array.prototype.forEach.call(panels, function (panel) {
      panel.hidden = panel.getAttribute('data-my-panel') !== tab;
    });
  }

  function render() {
    if (!ui.list) return;

    if (!lastLoadOk) {
      ui.list.innerHTML = '';
      return;
    }

    var sortedOrders = orders.slice().sort(function (a, b) {
      return timestamp(b.created_at) - timestamp(a.created_at);
    });
    var sortedReservations = reservations.slice().sort(function (a, b) {
      return timestamp(b.created_at) - timestamp(a.created_at);
    });

    if (activeTab !== 'orders' && activeTab !== 'reservations') {
      activeTab = newestTab();
    }

    var ordersBody = sortedOrders.map(orderCard).join('');
    var reservationsBody = sortedReservations.map(reservationCard).join('');

    ui.list.innerHTML =
      '<div class="acct-tabs my-orders-tabs" role="tablist" aria-label="Orders and reservations">' +
        tabButton('orders', 'Orders', activeTab === 'orders') +
        tabButton('reservations', 'Reservations', activeTab === 'reservations') +
      '</div>' +
      panelHtml('orders', 'Orders (' + sortedOrders.length + ')', ordersBody, emptyOrdersHtml(), activeTab === 'orders') +
      panelHtml('reservations', 'Reservations (' + sortedReservations.length + ')', reservationsBody, emptyReservationsHtml(), activeTab === 'reservations');
  }

  // ── Messages / toast ───────────────────────────────────────

  function showMessage(text, kind) {
    if (!ui.message) return;
    ui.message.className = 'order-message' +
      (kind === 'error' ? ' order-error' : kind === 'success' ? ' order-success' : '');
    ui.message.textContent = text;
    ui.message.hidden = false;
  }

  function hideMessage() {
    if (!ui.message) return;
    ui.message.hidden = true;
    ui.message.textContent = '';
  }

  function errorText(err) {
    if (!err) return 'Unknown error.';
    if (typeof err === 'string') return err;
    return err.message || err.details || err.hint || String(err);
  }

  function showToast(text) {
    if (!ui.toast) return;
    ui.toast.textContent = text;
    ui.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (ui.toast) ui.toast.classList.remove('is-visible');
    }, 6000);
  }

  // ── Sound (best effort — browsers may block it until a gesture) ──

  function ensureAudio() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') {
        var resumed = audioCtx.resume();
        if (resumed && resumed.catch) resumed.catch(function () {});
      }
      return audioCtx;
    } catch (err) {
      return null;
    }
  }

  function playBeep() {
    try {
      var ctx = ensureAudio();
      if (!ctx) return;

      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch (err) {
      /* Sound is best-effort; never break the page over it. */
    }
  }

  function unlockAudio() {
    ensureAudio();
  }

  // ── Data ───────────────────────────────────────────────────

  function showGate(show) {
    if (!ui.gate) return;
    ui.gate.hidden = !show;
    if (ui.refresh) ui.refresh.disabled = show;
    if (show) {
      ui.list.innerHTML = '';
      ui.list.hidden = true;
      if (ui.loading) ui.loading.hidden = true;
    } else {
      ui.list.hidden = false;
    }
  }

  function failLoad(text) {
    lastLoadOk = false;
    reloadAgain = false;
    if (ui.list) ui.list.innerHTML = '';
    showMessage(text, 'error');
  }

  function reloadList() {
    if (!client || !authUI || !authUI.isLoggedIn()) return;
    hideMessage();
    loadAll();
  }

  async function loadAll() {
    if (!client || !authUI.isLoggedIn()) return;
    if (loading) {
      reloadAgain = true;
      return;
    }

    loading = true;
    if (ui.loading) ui.loading.hidden = false;

    var results;

    try {
      results = await Promise.all([
        client.from('orders')
          .select('id, order_no, items, total, status, paid_at, tracking_code, created_at')
          .order('created_at', { ascending: false })
          .limit(100),
        client.from('reservations')
          .select('id, party_size, reservation_date, reservation_time, notes, status, paid_at, tracking_code, created_at')
          .order('created_at', { ascending: false })
          .limit(100)
      ]);
    } catch (err) {
      loading = false;
      if (ui.loading) ui.loading.hidden = true;
      failLoad('Could not load your bookings. ' + errorText(err));
      return;
    }

    loading = false;
    if (ui.loading) ui.loading.hidden = true;

    var ordersRes = results[0];
    var reservationsRes = results[1];

    var problems = [];
    if (ordersRes.error) problems.push('orders: ' + errorText(ordersRes.error));
    if (reservationsRes.error) problems.push('reservations: ' + errorText(reservationsRes.error));

    if (problems.length) {
      failLoad('Could not load your bookings (' + problems.join('; ') + ').');
      return;
    }

    lastLoadOk = true;
    orders = ordersRes.data || [];
    reservations = reservationsRes.data || [];

    statuses = {};
    orders.forEach(function (order) {
      statuses['order:' + order.id] = String(order.status || '');
    });
    reservations.forEach(function (reservation) {
      statuses['reservation:' + reservation.id] = String(reservation.status || '');
    });

    showGate(false);
    render();

    if (reloadAgain) {
      reloadAgain = false;
      loadAll();
    }
  }

  // ── Realtime ───────────────────────────────────────────────

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () {
      loadAll();
    }, 350);
  }

  function onOrderChange(payload) {
    var row = payload && payload.new ? payload.new : null;
    if (!row || !row.id) return;

    if (payload.eventType === 'UPDATE' && row.status === 'OUT_FOR_DELIVERY') {
      var previous = statuses['order:' + row.id];
      if (previous && previous !== 'OUT_FOR_DELIVERY') {
        showToast('Your order is on the way!');
        playBeep();
      }
    }

    statuses['order:' + row.id] = String(row.status || '');
    scheduleReload();
  }

  function onReservationChange(payload) {
    var row = payload && payload.new ? payload.new : null;
    if (!row || !row.id) return;
    statuses['reservation:' + row.id] = String(row.status || '');
    scheduleReload();
  }

  function unsubscribe() {
    if (channel && client) {
      try {
        client.removeChannel(channel);
      } catch (err) {
        /* ignore */
      }
    }
    channel = null;
  }

  function subscribe() {
    if (!client || !authUI.isLoggedIn()) return;

    unsubscribe();

    var uid = authUI.getUser().id;

    channel = client
      .channel('my-orders-' + uid)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: 'user_id=eq.' + uid
      }, onOrderChange)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'reservations',
        filter: 'user_id=eq.' + uid
      }, onReservationChange)
      .subscribe();
  }

  // ── Cancel flow ────────────────────────────────────────────

  function askCancel(type, id) {
    if (!id) return;

    pendingCancel = { type: type, id: id };

    var paidReservation = false;
    if (type === 'reservation') {
      var found = reservations.filter(function (r) {
        return String(r.id) === String(id);
      })[0];
      paidReservation = !!(found && found.paid_at);
    }

    if (ui.dialogTitle) {
      ui.dialogTitle.textContent = type === 'order'
        ? 'Cancel this order?'
        : 'Cancel this reservation?';
    }
    if (ui.dialogBody) {
      ui.dialogBody.textContent = paidReservation
        ? 'Payment has already been made for this reservation. If you cancel, it will not be refunded. Are you sure you want to cancel?'
        : 'Are you sure you want to cancel?';
    }
    if (ui.dialogYes) {
      ui.dialogYes.textContent = paidReservation ? 'Yes, cancel (no refund)' : 'Yes, cancel';
    }

    ui.dialog.hidden = false;
    document.body.classList.add('acct-lock');

    if (ui.dialogNo) ui.dialogNo.focus();
  }

  function closeCancelDialog() {
    if (!ui.dialog) return;
    ui.dialog.hidden = true;
    document.body.classList.remove('acct-lock');
    pendingCancel = null;
  }

  var RESULT_MESSAGES = {
    CANCELLED: { text: 'Cancelled successfully.', kind: 'success' },
    CANCELLED_NO_REFUND: {
      text: 'Reservation cancelled. Because payment had been made, no refund applies.',
      kind: 'success'
    },
    ALREADY_CANCELLED: { text: 'This is already cancelled.', kind: 'neutral' },
    PAID: {
      text: 'Payment has been received for this order, so it can no longer be cancelled online. Please call 07063134521.',
      kind: 'error'
    },
    TOO_LATE: {
      text: 'This can no longer be cancelled online. Please call 07063134521.',
      kind: 'error'
    },
    NOT_FOUND: { text: 'Please log in again to continue.', kind: 'error' },
    NOT_LOGGED_IN: { text: 'Please log in again to continue.', kind: 'error' }
  };

  function handleCancelResult(code, type) {
    var result = RESULT_MESSAGES[code];

    if (code === 'CANCELLED' && type === 'reservation') {
      result = { text: 'Reservation cancelled.', kind: 'success' };
    }

    if (!result) {
      showMessage('We could not cancel this just now. Please call 07063134521.', 'error');
      return;
    }

    showMessage(result.text, result.kind);

    if (code === 'NOT_FOUND' || code === 'NOT_LOGGED_IN') {
      openLogin(true);
      return;
    }

    if (code === 'CANCELLED' || code === 'CANCELLED_NO_REFUND' || code === 'ALREADY_CANCELLED' || code === 'PAID' || code === 'TOO_LATE') {
      loadAll();
    }
  }

  async function confirmCancel() {
    var target = pendingCancel;
    if (!target) return;

    closeCancelDialog();

    if (!client) {
      showMessage('Cancelling is unavailable right now. Please call 07063134521.', 'error');
      return;
    }

    var rpc = target.type === 'order' ? 'cancel_my_order' : 'cancel_my_reservation';
    var args = target.type === 'order'
      ? { p_order_id: target.id }
      : { p_reservation_id: target.id };

    showMessage('Cancelling…', 'neutral');

    var out;
    try {
      out = await client.rpc(rpc, args);
    } catch (err) {
      out = { error: err };
    }

    if (out.error) {
      console.warn('Cancel failed:', out.error.message || out.error);
      showMessage('We could not cancel this just now. Please try again, or call 07063134521.', 'error');
      return;
    }

    handleCancelResult(String(out.data == null ? '' : out.data), target.type);
  }

  function openLogin(force) {
    if (!authUI) return;

    authUI.openLogin({
      force: !!force,
      tab: force ? 'login' : 'create',
      reason: 'Log in or create an account to see your orders.',
      onSuccess: function () {
        hideMessage();
        showGate(false);
        loadAll();
        subscribe();
      }
    });
  }

  // ── Events / boot ──────────────────────────────────────────

  function bindEvents() {
    ui.login.addEventListener('click', function () {
      openLogin();
    });

    if (ui.refresh) {
      ui.refresh.addEventListener('click', reloadList);
    }

    ui.list.addEventListener('click', function (event) {
      var tabBtn = event.target.closest ? event.target.closest('[data-my-tab]') : null;
      if (tabBtn) {
        setTab(tabBtn.getAttribute('data-my-tab'));
        return;
      }

      var orderBtn = event.target.closest ? event.target.closest('[data-cancel-order]') : null;
      if (orderBtn) {
        askCancel('order', orderBtn.getAttribute('data-cancel-order'));
        return;
      }

      var reservationBtn = event.target.closest ? event.target.closest('[data-cancel-reservation]') : null;
      if (reservationBtn) {
        askCancel('reservation', reservationBtn.getAttribute('data-cancel-reservation'));
      }
    });

    ui.dialogYes.addEventListener('click', confirmCancel);
    ui.dialogNo.addEventListener('click', closeCancelDialog);

    ui.dialog.addEventListener('mousedown', function (event) {
      if (event.target === ui.dialog) closeCancelDialog();
    });

    ui.dialog.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCancelDialog();
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') reloadList();
    });

    // Restored from the back/forward cache: the page was "reopened".
    window.addEventListener('pageshow', function (event) {
      if (event.persisted) reloadList();
    });

    document.addEventListener('pointerdown', unlockAudio, { once: true });
    document.addEventListener('keydown', unlockAudio, { once: true });

    if (authUI && typeof authUI.onChange === 'function') {
      authUI.onChange(function (user) {
        if (user) {
          showGate(false);
          loadAll();
          subscribe();
        } else {
          unsubscribe();
          orders = [];
          reservations = [];
          statuses = {};
          activeTab = null;
          lastLoadOk = false;
          hideMessage();
          render();
          showGate(true);
        }
      });
    }
  }

  async function init() {
    cacheElements();
    if (!ui.list) return;

    bindEvents();

    if (typeof authUI === 'undefined' || !authUI) {
      if (ui.loading) ui.loading.hidden = true;
      showMessage('Accounts are unavailable right now. Please call 07063134521.', 'error');
      return;
    }

    await authUI.ready;

    if (!client) {
      if (ui.loading) ui.loading.hidden = true;
      showMessage('Booking history is unavailable right now. Please call 07063134521.', 'error');
      return;
    }

    if (!authUI.isLoggedIn()) {
      // No popup on entry: the gate offers the same login box on demand.
      showGate(true);
      return;
    }

    showGate(false);
    await loadAll();
    subscribe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
