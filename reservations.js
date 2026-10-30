// ═══════════════════════════════════════════════════════════════
//  reservations.js — customer reservation requests
//  Validates the form, then INSERTs one row into
//  public.reservations. `user_id` is filled in by the database and
//  `status` defaults to PENDING. The login box appears only when the
//  visitor presses "Request Reservation".
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var ui = {};

  // The one client created in supabase-config.js, shared with auth.js.
  var client = window.eqSupabase || null;

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
    ui.statusLine = $('reservationStatusLine');
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

  function showSuccess() {
    if (ui.error) {
      ui.error.hidden = true;
      ui.error.textContent = '';
    }
    if (!ui.success) return;

    ui.success.hidden = false;
    if (typeof ui.success.focus === 'function') ui.success.focus();
  }

  function setSubmitting(isSubmitting) {
    if (!ui.submit) return;
    ui.submit.disabled = isSubmitting;
    ui.submit.textContent = isSubmitting ? 'Sending request…' : 'Request Reservation';
    ui.submit.setAttribute('aria-busy', isSubmitting ? 'true' : 'false');
  }

  // ── Live reservation status ──

  function isPaid(reservation) {
    return !!(reservation && reservation.paid_at);
  }

  function reservationStatusText(reservation) {
    var status = String((reservation && reservation.status) || '');

    if (status === 'CANCELLED') return 'This reservation was cancelled.';
    if (status === 'CONFIRMED') return 'Your reservation is confirmed';
    if (isPaid(reservation)) return 'Payment received';
    return 'Reservation received, waiting for payment';
  }

  function updateStatusLine(reservation) {
    if (!ui.statusLine) return;
    var text = reservationStatusText(reservation);
    if (ui.statusLine.textContent !== text) ui.statusLine.textContent = text;
  }

  var reservationChannel = null;

  function stopReservationWatch() {
    if (reservationChannel && client) {
      try {
        client.removeChannel(reservationChannel);
      } catch (err) {
        /* ignore */
      }
    }
    reservationChannel = null;
  }

  function watchReservation(id) {
    stopReservationWatch();
    if (!id || !client) return;

    reservationChannel = client
      .channel('reservation-live-' + id)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'reservations',
        filter: 'id=eq.' + id
      }, function (payload) {
        if (payload && payload.new) updateStatusLine(payload.new);
      })
      .subscribe();
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

  // ── Account prefill ──

  async function prefillFromProfile(onlyEmpty) {
    if (typeof authUI === 'undefined' || !authUI) return;

    var saved;

    try {
      saved = await authUI.getProfile();
    } catch (err) {
      return;
    }

    if (!saved) return;

    function fill(input, value) {
      if (!input || !value) return;
      if (onlyEmpty && input.value.trim()) return;
      input.value = value;
    }

    fill(ui.name, saved.full_name);
    fill(ui.phone, saved.phone);
    fill(ui.email, saved.email);
  }

  // ── Submit ──

  async function continueReservation() {
    await prefillFromProfile(true);
    await sendReservation();
  }

  // The session the insert will be sent with. Read straight from the client
  // so a session restored from storage, refreshed, or just created by the
  // login box is the one used. authUI.currentSession also syncs the header.
  async function activeSession() {
    if (typeof authUI !== 'undefined' && authUI && typeof authUI.currentSession === 'function') {
      return await authUI.currentSession();
    }

    try {
      var res = await client.auth.getSession();
      var live = res && res.data ? res.data.session : null;
      return live && live.user ? live : null;
    } catch (err) {
      return null;
    }
  }

  // A rejected JWT is only ever diagnosed from the database response, never
  // from an auth event or a pre-flight check.
  function isSessionError(error) {
    return typeof authUI !== 'undefined' && authUI && typeof authUI.isSessionError === 'function'
      ? authUI.isSessionError(error)
      : false;
  }

  async function insertReservation(payload) {
    try {
      var result = await client.from('reservations').insert(payload);
      return result.error || null;
    } catch (err) {
      return err;
    }
  }

  async function sendReservation() {
    hideMessages();

    var values = readForm();
    var problem = validate(values);
    if (problem) {
      showError(problem.message, problem.field);
      return;
    }

    if (!client) {
      showError('Sorry, our reservation system is unavailable right now. Please call or WhatsApp us to book.');
      return;
    }

    // The database runs this insert as whoever the session belongs to. With no
    // session PostgREST runs it as `anon`, which the grants refuse, so never
    // send it: ask for a login instead. The typed details stay put.
    var live = await activeSession();

    if (!live) {
      if (typeof authUI !== 'undefined' && authUI && typeof authUI.openLogin === 'function') {
        authUI.openLogin({
          tab: 'login',
          reason: 'Please log in to request a reservation. Your details are saved.',
          showAddress: false,
          onSuccess: continueReservation
        });
      } else {
        showError('Please log in to request a reservation. Reload the page if the login box does not open.');
      }
      return;
    }

    setSubmitting(true);

    // Generated in the browser and stored with the reservation, exactly as
    // the tracking page expects: code + phone number, no login needed.
    var trackingCode = typeof generateTrackingCode === 'function'
      ? generateTrackingCode()
      : '';

    // `user_id` and `status` are intentionally omitted: the database fills
    // the owner from the session and defaults the status to PENDING.
    var payload = {
      customer_name: values.name,
      phone: values.phone,
      email: values.email || null,
      party_size: Number(values.party),
      reservation_date: values.date,
      reservation_time: values.time,
      notes: values.notes || null,
      tracking_code: trackingCode || null
    };

    var error = await insertReservation(payload);

    // The database rejected the session (401 / JWT expired). Refresh once and
    // resend the same request; the customer is not asked to log in again.
    if (error && isSessionError(error)) {
      var recovered = typeof authUI !== 'undefined' && authUI && authUI.recoverSession
        ? await authUI.recoverSession()
        : false;

      if (recovered) error = await insertReservation(payload);
    }

    setSubmitting(false);

    if (error) {
      console.error('Reservation insert failed:', error);

      // Only here — after a real 401 and a failed refresh — ask for a login.
      if (isSessionError(error) && typeof authUI !== 'undefined' && authUI && authUI.promptSessionExpired) {
        authUI.promptSessionExpired(continueReservation);
        return;
      }

      // Keep everything the customer typed so they can simply retry.
      showError("Sorry, we couldn't save your reservation just now. Your details are still here — please try again, or call or WhatsApp us.");
      return;
    }

    // The reservation is saved: fill in any profile fields that are still
    // missing, using what the customer just typed.
    if (typeof authUI !== 'undefined' && authUI && typeof authUI.rememberCheckoutDetails === 'function') {
      authUI.rememberCheckoutDetails(values.name, values.phone);
    }

    // Read the row back so the status line can follow this reservation.
    stopReservationWatch();
    var placed = null;
    if (trackingCode) {
      try {
        var found = await client
          .from('reservations')
          .select('id, status, paid_at')
          .eq('tracking_code', trackingCode)
          .maybeSingle();
        if (!found.error && found.data) placed = found.data;
      } catch (err) {
        placed = null;
      }
    }

    // Success: clear the form, restore tomorrow's date, show the code.
    ui.form.reset();
    setDateFloor();
    setDefaultDate();
    updateStatusLine(placed || { status: 'PENDING', paid_at: null });
    showSuccess();
    if (placed && placed.id) watchReservation(placed.id);
  }

  async function submitReservation(event) {
    event.preventDefault();
    hideMessages();

    if (!client) {
      showError('Sorry, our reservation system is unavailable right now. Please call or WhatsApp us to book.');
      return;
    }

    // sendReservation checks the session immediately before the insert and
    // opens the login box if there is none. Nothing is shown on page load.
    sendReservation();
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

    ui.form.addEventListener('submit', submitReservation);
    ui.form.addEventListener('input', hideMessages);

    // Returning customers get their details ready without any prompt.
    if (typeof authUI !== 'undefined' && authUI) {
      authUI.ready.then(function () {
        if (authUI.isLoggedIn()) prefillFromProfile(true);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
