// ═══════════════════════════════════════════════════════════════
//  track.js — customer tracking and cancellation
//  Visitors never read the tables. They only call the Supabase
//  RPCs: track_order, track_reservation, cancel_order and
//  cancel_reservation. The result is refreshed every 15 seconds
//  while a booking is on screen.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var client = (typeof supabaseClient === 'undefined') ? null : supabaseClient;
  var ui = {};
  var current = null;        // { code, phone, order, reservation }
  var refreshTimer = null;
  var busy = false;          // a check or cancel request is running
  var refreshing = false;
  var checkSeq = 0;

  var NOT_FOUND = 'We could not find that booking. Check the code and phone number.';
  var TOO_LATE = 'This can no longer be cancelled online. Please call 07063134521.';
  var UNAVAILABLE = 'Tracking is unavailable right now. Please call us on 07063134521.';

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

  var ORDER_STEPS = ['Received', 'Approved', 'Preparing', 'Out for delivery', 'Delivered'];

  function $(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    ui.form = $('trackForm');
    ui.code = $('trackCode');
    ui.phone = $('trackPhone');
    ui.submit = $('trackSubmit');
    ui.error = $('trackError');
    ui.message = $('trackMessage');
    ui.results = $('trackResults');
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

  // reservation_date is a plain YYYY-MM-DD date.
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

  function orderPillClass(status) {
    if (status === 'PENDING_APPROVAL') return 'is-pending';
    if (status === 'CANCELLED') return 'is-cancelled';
    if (status === 'REJECTED') return 'is-rejected';
    if (status === 'DELIVERED') return 'is-done';
    if (status === 'PREPARING' || status === 'OUT_FOR_DELIVERY') return 'is-progress';
    return 'is-approved';
  }

  function reservationPillClass(status) {
    if (status === 'PENDING') return 'is-pending';
    if (status === 'CONFIRMED') return 'is-approved';
    return 'is-cancelled';
  }

  function statusIndex(status) {
    if (status === 'APPROVED' || status === 'PAID') return 1;
    if (status === 'PREPARING') return 2;
    if (status === 'OUT_FOR_DELIVERY') return 3;
    if (status === 'DELIVERED') return 4;
    return 0; // PENDING_APPROVAL, plus terminal states
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

  function orderCard(order) {
    var status = String(order.status || '');
    var banner = '';

    if (status === 'CANCELLED') {
      banner = '<div class="track-banner is-cancelled">This order was cancelled.</div>';
    } else if (status === 'REJECTED') {
      banner = '<div class="track-banner is-rejected">This order was rejected. Please call us if you need help.</div>';
    }

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

    var canCancel = status === 'PENDING_APPROVAL' || status === 'APPROVED';
    var cancelHtml = canCancel
      ? '<button type="button" class="btn track-cancel" data-cancel="order">Cancel order</button>'
      : '';

    return '<article class="track-card">' +
      '<div class="track-card-head">' +
        '<h2 class="track-card-title">Order ' + esc(orderLabel(order)) + '</h2>' +
        '<span class="track-pill ' + orderPillClass(status) + '">' +
          esc(ORDER_LABELS[status] || status || 'Unknown') +
        '</span>' +
      '</div>' +
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

    var canCancel = status === 'PENDING' || status === 'CONFIRMED';
    var cancelHtml = canCancel
      ? '<button type="button" class="btn track-cancel" data-cancel="reservation">Cancel reservation</button>'
      : '';

    var notesHtml = '<dt>Notes</dt><dd>' +
      (reservation.notes ? esc(reservation.notes) : '—') + '</dd>';

    return '<article class="track-card">' +
      '<div class="track-card-head">' +
        '<h2 class="track-card-title">Reservation</h2>' +
        '<span class="track-pill ' + reservationPillClass(status) + '">' +
          esc(RESERVATION_LABELS[status] || status || 'Unknown') +
        '</span>' +
      '</div>' +
      banner +
      '<dl class="track-detail-grid">' +
        '<dt>Name</dt><dd>' + esc(reservation.customer_name || '—') + '</dd>' +
        '<dt>Guests</dt><dd>' + esc(guestsLabel(reservation.party_size)) + '</dd>' +
        '<dt>Date</dt><dd>' + esc(dateWords(reservation.reservation_date)) + '</dd>' +
        '<dt>Time</dt><dd>' + esc(timeWords(reservation.reservation_time)) + '</dd>' +
        notesHtml +
      '</dl>' +
      cancelHtml +
    '</article>';
  }

  function renderResults() {
    if (!current) return;

    var html = '';
    if (current.order) html += orderCard(current.order);
    if (current.reservation) html += reservationCard(current.reservation);

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

  function bookingSignature(order, reservation) {
    var orderPart = order
      ? [order.status, order.order_no, order.total].join('|')
      : '';
    var resPart = reservation
      ? [reservation.status, reservation.reservation_date,
          reservation.reservation_time, reservation.party_size].join('|')
      : '';
    return orderPart + '~' + resPart;
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

  function setBusy(value, label) {
    busy = value;
    if (!ui.submit) return;
    ui.submit.disabled = value;
    ui.submit.textContent = value ? (label || 'Checking…') : 'Check';
    ui.submit.setAttribute('aria-busy', value ? 'true' : 'false');
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

  async function checkBooking(event) {
    if (event) event.preventDefault();

    hideError();
    hideMessage();
    stopRefresh();

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

    var seq = ++checkSeq;
    setBusy(true, 'Checking…');
    var result = await fetchBooking(code, phone);

    if (seq !== checkSeq) return;
    setBusy(false);

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
    startRefresh();
  }

  async function refreshNow(forceRender) {
    if (!current || busy || refreshing) return false;

    refreshing = true;
    var before = bookingSignature(current.order, current.reservation);
    var result = await fetchBooking(current.code, current.phone);
    refreshing = false;

    if (result.error) return false;
    if (!result.order && !result.reservation) return false;

    current.order = result.order;
    current.reservation = result.reservation;

    if (forceRender ||
        bookingSignature(result.order, result.reservation) !== before) {
      renderResults();
    }

    return true;
  }

  function startRefresh() {
    stopRefresh();
    refreshTimer = setInterval(function () {
      if (document.visibilityState === 'hidden') return;
      refreshNow(false);
    }, 15000);
  }

  function stopRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  async function cancelBooking(type, button) {
    if (!current || busy || !client) return;

    setBusy(true, 'Please wait…');
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

    setBusy(false);

    if (result.error) {
      showMessage(UNAVAILABLE, 'error');
    } else {
      var outcome = scalarText(result.data);

      if (outcome === 'CANCELLED') {
        showMessage('Cancelled successfully.', 'success');
        var refreshed = await refreshNow(false);
        if (!refreshed) {
          if (type === 'order' && current && current.order) {
            current.order.status = 'CANCELLED';
          }
          if (type === 'reservation' && current && current.reservation) {
            current.reservation.status = 'CANCELLED';
          }
          renderResults();
        }
      } else if (outcome === 'ALREADY_CANCELLED') {
        showMessage('This is already cancelled.', 'success');
        var refreshedAlready = await refreshNow(false);
        if (!refreshedAlready) {
          if (type === 'order' && current && current.order) {
            current.order.status = 'CANCELLED';
          }
          if (type === 'reservation' && current && current.reservation) {
            current.reservation.status = 'CANCELLED';
          }
          renderResults();
        }
      } else if (outcome === 'NOT_FOUND') {
        showMessage(NOT_FOUND, 'error');
        stopRefresh();
        current = null;
        ui.results.innerHTML = '';
        ui.results.hidden = true;
      } else if (outcome === 'TOO_LATE') {
        showMessage(TOO_LATE, 'error');
        await refreshNow(false);
      } else {
        showMessage(UNAVAILABLE, 'error');
      }
    }

    // If the card was not re-rendered, let the customer try again.
    if (button && document.body.contains(button)) button.disabled = false;
  }

  function bindEvents() {
    ui.form.addEventListener('submit', checkBooking);

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

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && current) refreshNow(false);
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
