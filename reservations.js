// ═══════════════════════════════════════════════════════════════
//  reservations.js — customer reservation requests
//  Validates the form, then INSERTs one row into
//  public.reservations. Customers can only insert — the row is
//  never read back, and `status` is omitted so it defaults to
//  PENDING.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var ui = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    ui.form = $('reservationForm');
    ui.name = $('resName');
    ui.phone = $('resPhone');
    ui.email = $('resEmail');
    ui.party = $('resParty');
    ui.date = $('resDate');
    ui.dateWords = $('resDateWords');
    ui.time = $('resTime');
    ui.notes = $('resNotes');
    ui.submit = $('reservationSubmit');
    ui.error = $('reservationError');
    ui.success = $('reservationSuccess');
    ui.tracking = $('reservationTracking');
    ui.trackingCode = $('reservationTrackingCode');
    ui.copyCode = $('copyReservationCode');
  }

  // ── Dates ──

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // Local calendar date as YYYY-MM-DD (matches <input type="date">)
  function dateString(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function todayString() {
    return dateString(new Date());
  }

  function tomorrowString() {
    var d = new Date();
    d.setDate(d.getDate() + 1);
    return dateString(d);
  }

  // "Saturday, 25 October 2026" — parsed locally so the weekday never shifts.
  function dateInWords(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!m) return '';

    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return '';

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

  function updateDateWords() {
    if (!ui.dateWords) return;
    ui.dateWords.textContent = dateInWords(ui.date ? ui.date.value : '');
  }

  function setDateFloor() {
    if (!ui.date) return;
    ui.date.min = todayString();
  }

  function setDefaultDate() {
    if (!ui.date) return;
    if (!ui.date.value) ui.date.value = tomorrowString();
    updateDateWords();
  }

  // ── Messages ──

  function hideMessages() {
    if (ui.error) {
      ui.error.hidden = true;
      ui.error.textContent = '';
    }
    if (ui.success) ui.success.hidden = true;
  }

  function showError(message, field) {
    if (ui.success) ui.success.hidden = true;
    if (ui.error) {
      ui.error.textContent = message;
      ui.error.hidden = false;
    }
    if (field && typeof field.focus === 'function') field.focus();
  }

  function showSuccess(trackingCode) {
    if (ui.error) {
      ui.error.hidden = true;
      ui.error.textContent = '';
    }
    if (!ui.success) return;

    if (ui.trackingCode) ui.trackingCode.textContent = trackingCode || '';
    if (ui.tracking) ui.tracking.hidden = !trackingCode;
    if (ui.copyCode) ui.copyCode.textContent = 'Copy';

    ui.success.hidden = false;
    if (typeof ui.success.focus === 'function') ui.success.focus();
  }

  function copyCode() {
    var code = ui.trackingCode ? ui.trackingCode.textContent : '';
    if (!code || typeof copyToClipboard !== 'function') return;

    copyToClipboard(code).then(function () {
      if (!ui.copyCode) return;
      ui.copyCode.textContent = 'Copied';
      setTimeout(function () {
        if (ui.copyCode) ui.copyCode.textContent = 'Copy';
      }, 2000);
    }).catch(function () {
      if (!ui.copyCode) return;
      ui.copyCode.textContent = 'Copy failed';
      setTimeout(function () {
        if (ui.copyCode) ui.copyCode.textContent = 'Copy';
      }, 2000);
    });
  }

  function setSubmitting(isSubmitting) {
    if (!ui.submit) return;
    ui.submit.disabled = isSubmitting;
    ui.submit.textContent = isSubmitting ? 'Sending request…' : 'Request Reservation';
    ui.submit.setAttribute('aria-busy', isSubmitting ? 'true' : 'false');
  }

  // ── Validation ──

  function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function readForm() {
    return {
      name: ui.name.value.trim(),
      phone: ui.phone.value.trim(),
      email: ui.email.value.trim(),
      party: ui.party.value.trim(),
      date: ui.date.value,
      time: ui.time.value.trim(),
      notes: ui.notes.value.trim()
    };
  }

  function validate(values) {
    if (!values.name) {
      return { message: 'Please enter your name.', field: ui.name };
    }
    if (!values.phone) {
      return { message: 'Please enter your phone number.', field: ui.phone };
    }
    if (values.phone.replace(/\D/g, '').length < 7) {
      return { message: 'Please enter a valid phone number.', field: ui.phone };
    }

    if (!values.party) {
      return { message: 'Please enter the number of guests.', field: ui.party };
    }
    var party = Number(values.party);
    if (!isFinite(party) || Math.floor(party) !== party || party < 1 || party > 50) {
      return { message: 'Please enter a party size between 1 and 50.', field: ui.party };
    }

    if (!values.date) {
      return { message: 'Please choose a date.', field: ui.date };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
      return { message: 'Please choose a valid date.', field: ui.date };
    }
    if (values.date < todayString()) {
      return { message: 'Please choose today or a future date.', field: ui.date };
    }

    if (!values.time) {
      return { message: 'Please enter a time.', field: ui.time };
    }

    if (values.email && !looksLikeEmail(values.email)) {
      return { message: 'Please enter a valid email address, or leave the email field blank.', field: ui.email };
    }

    return null;
  }

  // ── Submit ──

  async function submitReservation(event) {
    event.preventDefault();
    hideMessages();

    var values = readForm();
    var problem = validate(values);
    if (problem) {
      showError(problem.message, problem.field);
      return;
    }

    if (typeof supabaseClient === 'undefined' || !supabaseClient) {
      showError('Sorry, our reservation system is unavailable right now. Please call or WhatsApp us to book.');
      return;
    }

    setSubmitting(true);

    // Generated in the browser and stored with the reservation.
    var trackingCode = typeof generateTrackingCode === 'function'
      ? generateTrackingCode()
      : '';

    var error = null;
    try {
      // Insert only — no .select(), so the customer never reads the row back.
      // `status` is intentionally omitted so the column default (PENDING) applies.
      var result = await supabaseClient.from('reservations').insert({
        customer_name: values.name,
        phone: values.phone,
        email: values.email || null,
        party_size: Number(values.party),
        reservation_date: values.date,
        reservation_time: values.time,
        notes: values.notes || null,
        tracking_code: trackingCode || null
      });
      error = result.error;
    } catch (err) {
      error = err;
    }

    setSubmitting(false);

    if (error) {
      // Keep everything the customer typed so they can simply retry.
      showError("Sorry, we couldn't save your reservation just now. Your details are still here — please try again, or call or WhatsApp us.");
      return;
    }

    // Success: clear the form, restore tomorrow's date, show the code.
    ui.form.reset();
    setDateFloor();
    setDefaultDate();
    showSuccess(trackingCode);
  }

  // ── Init ──

  function init() {
    cacheElements();
    if (!ui.form) return;

    setDateFloor();
    setDefaultDate();

    if (ui.date) {
      ui.date.addEventListener('change', updateDateWords);
      ui.date.addEventListener('input', updateDateWords);
    }
    if (ui.copyCode) ui.copyCode.addEventListener('click', copyCode);

    ui.form.addEventListener('submit', submitReservation);
    ui.form.addEventListener('input', hideMessages);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
