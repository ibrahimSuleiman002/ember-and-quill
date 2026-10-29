// ═══════════════════════════════════════════════════════════════
//  cancel.js — customer cancellation
//  Visitors never read the tables. They only call the Supabase
//  RPCs: track_order, track_reservation, cancel_order and
//  cancel_reservation. This page shows a short read-only summary
//  and only offers a cancel button when the booking allows it.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var client = window.eqSupabase || null;
  var ui = {};
  var current = null;        // { code, phone, order, reservation }
  var busy = false;

  var NOT_FOUND = 'We could not find that booking. Check the code and phone number.';
  var PAID = 'Payment has been received for this order, so it can no longer be cancelled online. Please call 07063134521.';
  var TOO_LATE = 'This can no longer be cancelled online. Please call 07063134521.';
  var UNAVAILABLE = 'Cancellation is unavailable right now. Please call us on 07063134521.';

  var ORDER_LABELS = {
    PENDING_APPROVAL: 'Pending approval',
    APPROVED: 'Approved',
    PAID: 'Paid',
    PREPARING: 'Preparing',
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

  function $(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    ui.form = $('cancelForm');
    ui.code = $('cancelCode');
    ui.phone = $('cancelPhone');
    ui.find = $('cancelFind');
    ui.error = $('cancelError');
    ui.message = $('cancelMessage');
    ui.results = $('cancelResults');
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

  function orderPillClass(status) {
    if (status === 'PENDING_APPROVAL') return 'is-pending';
    if (status === 'CANCELLED') return 'is-cancelled';
    if (status === 'REJECTED') return 'is-rejected';
    if (status === 'DELIVERED') return 'is-done';
    if (status === 'OUT_FOR_DELIVERY') return 'is-progress';
    return 'is-approved'; // includes PAID and legacy PREPARING
  }

  function reservationPillClass(status) {
    if (status === 'PENDING') return 'is-pending';
    if (status === 'CONFIRMED') return 'is-approved';
    return 'is-cancelled';
  }

  function isPaid(order) {
    return !!(order && order.paid_at);
  }

  function canCancelOrder(order) {
    var status = String(order.status || '');
    return !isPaid(order) && (status === 'PENDING_APPROVAL' || status === 'APPROVED');
  }

  function canCancelReservation(reservation) {
    var status = String(reservation.status || '');
    return status === 'PENDING' || status === 'CONFIRMED';
  }

  function orderBlocked(order) {
    var status = String(order.status || '');

    if (status === 'CANCELLED') {
      return { text: 'This is already cancelled.', kind: 'cancelled' };
    }
    if (order._cancelBlocked === 'PAID' || isPaid(order)) {
      return { text: PAID, kind: 'rejected' };
    }
    if (order._cancelBlocked === 'TOO_LATE' || status === 'OUT_FOR_DELIVERY') {
      return { text: TOO_LATE, kind: 'rejected' };
    }
    return null;
  }

  function reservationBlocked(reservation) {
    if (String(reservation.status || '') === 'CANCELLED') {
      return { text: 'This is already cancelled.', kind: 'cancelled' };
    }
    if (reservation._cancelBlocked === 'PAID') {
      return { text: PAID, kind: 'rejected' };
    }
    if (reservation._cancelBlocked === 'TOO_LATE') {
      return { text: TOO_LATE, kind: 'rejected' };
    }
    return null;
  }

  function bannerHtml(blocked) {
    if (!blocked) return '';
    return '<div class="track-banner ' +
      (blocked.kind === 'cancelled' ? 'is-cancelled' : 'is-rejected') + '">' +
      esc(blocked.text) + '</div>';
  }

  function orderSummary(order) {
    var status = String(order.status || '');
    var paidBadge = isPaid(order)
      ? '<span class="track-pill is-done">Payment received</span>'
      : '';
    var blocked = orderBlocked(order);
    var canCancel = !blocked && canCancelOrder(order);
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

    return '<article class="track-card">' +
      '<div class="track-card-head">' +
        '<h2 class="track-card-title">Order ' + esc(orderLabel(order)) + '</h2>' +
        '<span class="track-pill ' + orderPillClass(status) + '">' +
          esc(ORDER_LABELS[status] || status || 'Unknown') +
        '</span>' +
        paidBadge +
      '</div>' +
      bannerHtml(blocked) +
      '<div class="track-items">' + itemsHtml + '</div>' +
      '<div class="order-total-row">' +
        '<span>Total</span>' +
        '<span class="order-total-amount">' + money(order.total) + '</span>' +
      '</div>' +
      (canCancel
        ? '<button type="button" class="btn track-cancel" data-cancel="order">Cancel this order</button>'
        : '') +
    '</article>';
  }

  function reservationSummary(reservation) {
    var status = String(reservation.status || '');
    var blocked = reservationBlocked(reservation);
    var canCancel = !blocked && canCancelReservation(reservation);

    return '<article class="track-card">' +
      '<div class="track-card-head">' +
        '<h2 class="track-card-title">Reservation</h2>' +
        '<span class="track-pill ' + reservationPillClass(status) + '">' +
          esc(RESERVATION_LABELS[status] || status || 'Unknown') +
        '</span>' +
      '</div>' +
      bannerHtml(blocked) +
      '<dl class="track-detail-grid">' +
        '<dt>Name</dt><dd>' + esc(reservation.customer_name || '—') + '</dd>' +
        '<dt>Date</dt><dd>' + esc(dateWords(reservation.reservation_date)) + '</dd>' +
        '<dt>Time</dt><dd>' + esc(timeWords(reservation.reservation_time)) + '</dd>' +
        '<dt>Guests</dt><dd>' + esc(guestsLabel(reservation.party_size)) + '</dd>' +
      '</dl>' +
      (canCancel
        ? '<button type="button" class="btn track-cancel" data-cancel="reservation">Cancel this reservation</button>'
        : '') +
    '</article>';
  }

  function renderResults() {
    if (!current) return;

    var html = '';
    if (current.order) html += orderSummary(current.order);
    if (current.reservation) html += reservationSummary(current.reservation);

    ui.results.innerHTML = html;
    ui.results.hidden = false;
  }

  function firstRow(data) {
    if (Array.isArray(data)) return data.length ? data[0] : null;
    if (data && typeof data === 'object') return data;
    return null;
  }

  function scalarText(data) {
    var value = Array.isArray(data) ? data[0] : data;
    if (value == null) return '';
    if (typeof value === 'object') {
      return String(value.cancel_order || value.cancel_reservation || value.status || '');
    }
    return String(value);
  }

  async function fetchBooking(code, phone) {
    if (!client) return { error: new Error('unavailable') };

    try {
      var out = await Promise.all([
        client.rpc('track_order', { p_code: code, p_phone: phone }),
        client.rpc('track_reservation', { p_code: code, p_phone: phone })
      ]);

      if (out[0].error || out[1].error) {
        return { error: out[0].error || out[1].error };
      }

      return {
        order: firstRow(out[0].data),
        reservation: firstRow(out[1].data)
      };
    } catch (err) {
      return { error: err };
    }
  }

  function setFinding(value) {
    busy = value;
    if (!ui.find) return;
    ui.find.disabled = value;
    ui.find.textContent = value ? 'Finding…' : 'Find my booking';
    ui.find.setAttribute('aria-busy', value ? 'true' : 'false');
  }

  function showError(message, field) {
    if (!ui.error) return;
    ui.error.textContent = message;
    ui.error.hidden = false;
    if (field && typeof field.focus === 'function') field.focus();
  }

  function hideError() {
    if (!ui.error) return;
    ui.error.hidden = true;
    ui.error.textContent = '';
  }

  function showMessage(message, kind) {
    if (!ui.message) return;
    ui.message.textContent = message;
    ui.message.className = 'order-message ' + (kind === 'success' ? 'order-success' : 'order-error');
    ui.message.hidden = false;
  }

  function hideMessage() {
    if (!ui.message) return;
    ui.message.hidden = true;
    ui.message.textContent = '';
    ui.message.className = 'order-message';
  }

  async function findBooking(event) {
    if (event) event.preventDefault();
    if (busy) return;

    hideError();
    hideMessage();

    var code = normalizeTrackingCode(ui.code.value);
    ui.code.value = code;
    var phone = ui.phone.value.trim();

    if (!code) {
      showError('Please enter your tracking code.', ui.code);
      return;
    }
    if (code.replace(/-/g, '').length !== 16) {
      showError('Please enter the full 16-character tracking code.', ui.code);
      return;
    }
    if (!phone) {
      showError('Please enter your phone number.', ui.phone);
      return;
    }
    if (phone.replace(/\D/g, '').length < 7) {
      showError('Please enter a valid phone number.', ui.phone);
      return;
    }
    if (!client) {
      showError(UNAVAILABLE);
      return;
    }

    setFinding(true);
    var result = await fetchBooking(code, phone);
    setFinding(false);

    if (result.error) {
      showError(UNAVAILABLE);
      return;
    }

    if (!result.order && !result.reservation) {
      current = null;
      ui.results.innerHTML = '<p class="track-empty">' + NOT_FOUND + '</p>';
      ui.results.hidden = false;
      return;
    }

    current = {
      code: code,
      phone: phone,
      order: result.order,
      reservation: result.reservation
    };
    renderResults();
  }

  async function cancelBooking(type, button) {
    if (!current || busy || !client) return;

    busy = true;
    if (ui.find) ui.find.disabled = true;
    if (button) button.disabled = true;

    var rpcName = type === 'order' ? 'cancel_order' : 'cancel_reservation';
    var result;

    try {
      result = await client.rpc(rpcName, {
        p_code: current.code,
        p_phone: current.phone
      });
    } catch (err) {
      result = { error: err };
    }

    busy = false;
    if (ui.find) ui.find.disabled = false;
    if (button && document.body.contains(button)) button.disabled = false;

    if (result.error) {
      showMessage(UNAVAILABLE, 'error');
      return;
    }

    var outcome = scalarText(result.data);

    if (outcome === 'CANCELLED') {
      showMessage('Cancelled successfully.', 'success');
      if (type === 'order' && current.order) current.order.status = 'CANCELLED';
      if (type === 'reservation' && current.reservation) current.reservation.status = 'CANCELLED';
      renderResults();
    } else if (outcome === 'ALREADY_CANCELLED') {
      showMessage('This is already cancelled.', 'success');
      if (type === 'order' && current.order) current.order.status = 'CANCELLED';
      if (type === 'reservation' && current.reservation) current.reservation.status = 'CANCELLED';
      renderResults();
    } else if (outcome === 'NOT_FOUND') {
      showMessage(NOT_FOUND, 'error');
      current = null;
      ui.results.innerHTML = '';
      ui.results.hidden = true;
    } else if (outcome === 'PAID') {
      showMessage(PAID, 'error');
      if (type === 'order' && current.order) {
        if (!current.order.paid_at) current.order.paid_at = new Date().toISOString();
        current.order._cancelBlocked = 'PAID';
      }
      if (type === 'reservation' && current.reservation) {
        current.reservation._cancelBlocked = 'PAID';
      }
      renderResults();
    } else if (outcome === 'TOO_LATE') {
      showMessage(TOO_LATE, 'error');
      if (type === 'order' && current.order) current.order._cancelBlocked = 'TOO_LATE';
      if (type === 'reservation' && current.reservation) current.reservation._cancelBlocked = 'TOO_LATE';
      renderResults();
    } else {
      showMessage(UNAVAILABLE, 'error');
    }
  }

  function bindEvents() {
    ui.form.addEventListener('submit', findBooking);

    ui.code.addEventListener('input', function () {
      var formatted = normalizeTrackingCode(ui.code.value);
      if (ui.code.value !== formatted) ui.code.value = formatted;
      hideError();
    });

    ui.phone.addEventListener('input', hideError);

    ui.results.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-cancel]') : null;
      if (!button || busy) return;
      if (!window.confirm('Are you sure?')) return;
      cancelBooking(button.getAttribute('data-cancel'), button);
    });
  }

  function init() {
    cacheElements();
    if (!ui.form) return;
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
