// ═══════════════════════════════════════════════════════════════
//  reset-password.js — the page the recovery email link opens
//
//  A valid link signs the customer in with a recovery session
//  (detectSessionInUrl in supabase-config.js), which is what lets
//  auth.updateUser({ password }) save the new password.
//  An expired or reused link produces an error in the URL fragment
//  instead of a session; that case asks for a fresh link.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Read the fragment before supabase-js consumes it.
  var link = { recovery: false, error: '' };

  try {
    var rawHash = window.location.hash ? window.location.hash.replace(/^#/, '') : '';
    if (rawHash) {
      var params = new URLSearchParams(rawHash);
      if (params.get('type') === 'recovery' || params.get('access_token')) link.recovery = true;
      if (params.get('error') || params.get('error_code')) {
        link.error = params.get('error_description') || 'invalid';
      }
    }
  } catch (err) {
    link.error = '';
  }

  var client = window.eqSupabase || null;
  var ui = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cache() {
    ui.intro = $('resetIntro');
    ui.message = $('resetMessage');
    ui.form = $('resetForm');
    ui.password = $('resetPassword');
    ui.confirm = $('resetConfirm');
    ui.submit = $('resetSubmit');
    ui.done = $('resetDone');
    ui.invalid = $('resetInvalid');
    ui.invalidText = $('resetInvalidText');
    ui.resendForm = $('resetResendForm');
    ui.email = $('resetEmail');
    ui.resendBtn = $('resetResendBtn');
  }

  function showMessage(text, type) {
    if (!ui.message) return;
    var tone = type === 'success' ? 'order-success' : (type === 'info' ? 'order-info' : 'order-error');
    ui.message.className = 'order-message ' + tone;
    ui.message.textContent = text;
    ui.message.hidden = false;
  }

  function hideMessage() {
    if (!ui.message) return;
    ui.message.hidden = true;
    ui.message.textContent = '';
  }

  function setBusy(button, busy, busyLabel, idleLabel) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? busyLabel : idleLabel;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function showForm() {
    hideMessage();
    if (ui.intro) ui.intro.hidden = false;
    if (ui.form) ui.form.hidden = false;
    if (ui.done) ui.done.hidden = true;
    if (ui.invalid) ui.invalid.hidden = true;
    if (ui.password) ui.password.focus();
  }

  function showDone() {
    hideMessage();
    if (ui.intro) ui.intro.hidden = true;
    if (ui.form) ui.form.hidden = true;
    if (ui.invalid) ui.invalid.hidden = true;
    if (ui.done) {
      ui.done.hidden = false;
      if (typeof ui.done.focus === 'function') ui.done.focus();
    }
  }

  var INVALID_TEXT = 'This password reset link is invalid or has expired. Request a new one below and we will email it to you.';

  function showInvalid(text) {
    hideMessage();
    if (ui.intro) ui.intro.hidden = true;
    if (ui.form) ui.form.hidden = true;
    if (ui.done) ui.done.hidden = true;
    if (ui.invalidText) ui.invalidText.textContent = text || INVALID_TEXT;
    if (ui.invalid) ui.invalid.hidden = false;
  }

  async function changePassword(event) {
    event.preventDefault();
    hideMessage();

    var password = ui.password.value;
    var confirm = ui.confirm.value;

    if (!password) {
      showMessage('Please choose a new password.', 'error');
      ui.password.focus();
      return;
    }
    if (password.length < 8) {
      showMessage('Your new password must be at least 8 characters.', 'error');
      ui.password.focus();
      return;
    }
    if (password !== confirm) {
      showMessage('The two passwords do not match.', 'error');
      ui.confirm.focus();
      return;
    }
    if (!client) {
      showMessage('Password changes are unavailable right now. Please call or WhatsApp us.', 'error');
      return;
    }

    setBusy(ui.submit, true, 'Changing password…', 'Change password');

    var result;
    try {
      result = await client.auth.updateUser({ password: password });
    } catch (err) {
      result = { error: err };
    }

    setBusy(ui.submit, false, 'Changing password…', 'Change password');

    if (result && result.error) {
      var message = String(result.error.message || '');
      if (/session|jwt|expired|not logged/i.test(message)) {
        // The recovery session ran out between opening the page and saving.
        showInvalid();
        return;
      }
      showMessage('We could not change your password just now. Please try again, or request a new link.', 'error');
      return;
    }

    ui.form.reset();
    showDone();
  }

  async function resendLink(event) {
    event.preventDefault();
    hideMessage();

    var email = ui.email.value.trim();

    if (!email) {
      showMessage('Please enter your email address.', 'error');
      ui.email.focus();
      return;
    }
    if (!looksLikeEmail(email)) {
      showMessage('Please enter a valid email address.', 'error');
      ui.email.focus();
      return;
    }
    if (!client) {
      showMessage('Password resets are unavailable right now. Please call or WhatsApp us.', 'error');
      return;
    }

    setBusy(ui.resendBtn, true, 'Sending…', 'Send a new link');

    // Same answer whether or not an account exists.
    try {
      await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password.html'
      });
    } catch (err) {
      /* the neutral confirmation below is shown either way */
    }

    setBusy(ui.resendBtn, false, 'Sending…', 'Send a new link');
    showMessage('If that email has an account, we have sent a reset link.', 'info');
  }

  function bind() {
    ui.form.addEventListener('submit', changePassword);
    ui.resendForm.addEventListener('submit', resendLink);

    [ui.form, ui.resendForm].forEach(function (form) {
      form.addEventListener('input', hideMessage);
    });
  }

  async function init() {
    cache();
    if (!ui.form) return;

    bind();

    if (!client) {
      showInvalid('Password resets are unavailable right now. Please call or WhatsApp us.');
      return;
    }

    // Wait for auth.js: its getSession call is what exchanges the
    // recovery link for a session.
    if (typeof authUI !== 'undefined' && authUI && authUI.ready) {
      try {
        await authUI.ready;
      } catch (err) {
        /* fall through to the direct check below */
      }
    }

    if (link.error && !link.recovery) {
      showInvalid();
      return;
    }

    var result = null;
    try {
      result = await client.auth.getSession();
    } catch (err) {
      result = null;
    }

    var session = result && result.data ? result.data.session : null;

    if (session && session.user) {
      showForm();
      return;
    }

    showInvalid();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
