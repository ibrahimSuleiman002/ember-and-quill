// ═══════════════════════════════════════════════════════════════
//  auth.js — customer accounts + the shared login box
//
//  • No login UI is shown to visitors. The header only grows the
//    "Hi, <first name> / My orders / Log out" block once a session
//    exists.
//  • Visitors build their cart (localStorage) first. The login box
//    opens only when they press Place Order or Request Reservation,
//    or click "My orders" while logged out.
//  • Passwords are only ever sent to Supabase Auth. They are never
//    stored by our code, in localStorage or anywhere else.
//  • Sessions persist across visits (supabase-js persistSession).
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // The one client created in supabase-config.js. Never create another one
  // here: a second instance keeps its session in its own memory only, which
  // is how the login box and the order page end up disagreeing.
  var client = window.eqSupabase || null;

  var session = null;
  var user = null;
  var profile = null;
  var profileLoadedFor = null;
  var pending = null;          // { onSuccess, onCancel }
  var listeners = [];
  var lastFocus = null;
  var ui = {};

  var readyResolve;
  var ready = new Promise(function (resolve) {
    readyResolve = resolve;
  });

  var PROFILE_FIELDS = 'full_name, phone, address';

  function $(id) {
    return document.getElementById(id);
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

  function firstName(value) {
    var parts = String(value || '').trim().split(/\s+/);
    return parts.length && parts[0] ? parts[0] : '';
  }

  function emailOf() {
    return (user && user.email) ? user.email : '';
  }

  function metadata() {
    return (user && user.user_metadata) ? user.user_metadata : {};
  }

  function displayName() {
    return (profile && profile.full_name) || metadata().full_name || '';
  }

  function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  // ── Session / profile state ─────────────────────────────────

  function setSession(nextSession) {
    session = nextSession || null;
    user = session ? session.user : null;

    if (!user) {
      profile = null;
      profileLoadedFor = null;
    }

    renderHeader();
    listeners.forEach(function (fn) {
      try {
        fn(user, profile);
      } catch (err) {
        /* a broken listener must not break auth */
      }
    });
  }

  async function loadProfile(force) {
    if (!client || !user) return null;
    if (!force && profileLoadedFor === user.id) return profile;

    profileLoadedFor = user.id;
    profile = null;

    try {
      var res = await client
        .from('profiles')
        .select(PROFILE_FIELDS)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!res.error && res.data) profile = res.data;
    } catch (err) {
      /* profiles table may not be set up yet — metadata fallback below */
    }

    renderHeader();
    return profile;
  }

  function profileFromMetadata() {
    var meta = metadata();
    return {
      full_name: meta.full_name || '',
      phone: meta.phone || '',
      address: meta.address || '',
      email: emailOf()
    };
  }

  async function getProfile() {
    await ready;
    if (!user) return null;

    var saved = await loadProfile(false);
    var fallback = profileFromMetadata();

    return {
      full_name: (saved && saved.full_name) || fallback.full_name,
      phone: (saved && saved.phone) || fallback.phone,
      address: (saved && saved.address) || fallback.address,
      email: emailOf()
    };
  }

  async function saveProfile(values) {
    if (!user) return null;

    var cache = {
      full_name: values.full_name,
      phone: values.phone,
      address: values.address || null
    };

    profile = cache;
    profileLoadedFor = user.id;

    if (!client) return cache;

    try {
      var res = await client.from('profiles').upsert({
        user_id: user.id,
        full_name: values.full_name,
        phone: values.phone,
        address: values.address || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

      if (res.error) {
        // The account still works; checkout just falls back to what the
        // customer typed. (Usually means the SQL in supabase/accounts.sql
        // has not been run yet.)
        console.warn('Could not save the customer profile:', res.error.message);
      }
    } catch (err) {
      console.warn('Could not save the customer profile:', err);
    }

    return cache;
  }

  // ── Header ───────────────────────────────────────────────────

  function renderHeader() {
    var navLinks = $('navLinks');
    if (!navLinks) return;

    var existing = $('navAccount');

    if (!user) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }

    if (!existing) {
      existing = document.createElement('li');
      existing.id = 'navAccount';
      existing.className = 'nav-account';
      navLinks.appendChild(existing);
    }

    var name = firstName(displayName()) || firstName(emailOf().split('@')[0]);

    existing.innerHTML =
      (name ? '<span class="nav-greeting">Hi, ' + esc(name) + '</span>' : '') +
      '<a href="my-orders.html" data-requires-auth>My orders</a>' +
      '<button type="button" class="nav-logout" id="navLogout">Log out</button>';

    var logout = $('navLogout');
    if (logout) logout.addEventListener('click', signOut);
  }

  // ── Login box markup ────────────────────────────────────────

  function injectBox() {
    if ($('acctBox')) {
      cacheBox();
      return;
    }

    var box = document.createElement('div');
    box.id = 'acctBox';
    box.className = 'acct-backdrop';
    box.hidden = true;

    box.innerHTML = '' +
      '<div class="acct-card" id="acctCard" role="dialog" aria-modal="true" aria-labelledby="acctTitle">' +
        '<button type="button" class="acct-close" id="acctClose" aria-label="Close">&times;</button>' +
        '<p class="acct-brand">' + esc((typeof siteConfig !== 'undefined' && siteConfig.name) || 'Ember & Quill') + '</p>' +
        '<h2 class="acct-title" id="acctTitle">Your account</h2>' +
        '<p class="acct-reason" id="acctReason" hidden></p>' +

        '<div class="acct-tabs" role="tablist" aria-label="Account">' +
          '<button type="button" class="acct-tab is-active" id="acctTabCreate" role="tab" aria-selected="true" aria-controls="acctPanelCreate" data-acct-tab="create">Create account</button>' +
          '<button type="button" class="acct-tab" id="acctTabLogin" role="tab" aria-selected="false" aria-controls="acctPanelLogin" data-acct-tab="login" tabindex="-1">Log in</button>' +
        '</div>' +

        '<div class="order-message" id="acctMessage" role="alert" hidden></div>' +

        '<div id="acctPanelCreate" role="tabpanel" aria-labelledby="acctTabCreate">' +
          '<form id="acctSignupForm" class="acct-form" novalidate>' +
            '<div class="order-field">' +
              '<label for="acctName">Full name</label>' +
              '<input class="order-input" id="acctName" name="full_name" type="text" autocomplete="name" placeholder="e.g. Ada Obi" required>' +
            '</div>' +
            '<div class="order-field">' +
              '<label for="acctPhone">Phone number</label>' +
              '<input class="order-input" id="acctPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="e.g. 0803 123 4567" required>' +
            '</div>' +
            '<div class="order-field">' +
              '<label for="acctEmail">Email</label>' +
              '<input class="order-input" id="acctEmail" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>' +
            '</div>' +
            '<div class="order-field">' +
              '<label for="acctPassword">Password</label>' +
              '<input class="order-input" id="acctPassword" name="password" type="password" autocomplete="new-password" placeholder="At least 6 characters" minlength="6" required>' +
            '</div>' +
            '<div class="order-field">' +
              '<label for="acctAddress">Delivery address <span class="order-optional">(optional)</span></label>' +
              '<input class="order-input" id="acctAddress" name="address" type="text" autocomplete="street-address" placeholder="Street, area, city">' +
            '</div>' +
            '<button type="submit" id="acctSignupBtn" class="btn btn-primary acct-submit">Create account</button>' +
          '</form>' +
        '</div>' +

        '<div id="acctPanelLogin" role="tabpanel" aria-labelledby="acctTabLogin" hidden>' +
          '<form id="acctLoginForm" class="acct-form" novalidate>' +
            '<div class="order-field">' +
              '<label for="acctLoginEmail">Email</label>' +
              '<input class="order-input" id="acctLoginEmail" name="email" type="email" autocomplete="username" placeholder="you@example.com" required>' +
            '</div>' +
            '<div class="order-field">' +
              '<label for="acctLoginPassword">Password</label>' +
              '<input class="order-input" id="acctLoginPassword" name="password" type="password" autocomplete="current-password" placeholder="Your password" required>' +
            '</div>' +
            '<button type="submit" id="acctLoginBtn" class="btn btn-primary acct-submit">Log in</button>' +
            '<p class="acct-forgot"><button type="button" class="acct-link" id="acctForgot">Forgot password?</button></p>' +
          '</form>' +

          '<form id="acctForgotForm" class="acct-form" novalidate hidden>' +
            '<p class="acct-hint">Enter the email address you used for your account and we will send you a link to choose a new password.</p>' +
            '<div class="order-field">' +
              '<label for="acctForgotEmail">Email</label>' +
              '<input class="order-input" id="acctForgotEmail" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>' +
            '</div>' +
            '<button type="submit" id="acctForgotBtn" class="btn btn-primary acct-submit">Send reset link</button>' +
            '<p class="acct-forgot"><button type="button" class="acct-link" id="acctBackToLogin">Back to log in</button></p>' +
          '</form>' +
        '</div>' +

        '<p class="acct-note">Your password is handled securely by Supabase. We never see or store it.</p>' +
      '</div>';

    document.body.appendChild(box);
    cacheBox();
    bindBox();
  }

  function cacheBox() {
    ui.box = $('acctBox');
    ui.card = $('acctCard');
    ui.close = $('acctClose');
    ui.reason = $('acctReason');
    ui.message = $('acctMessage');
    ui.tabCreate = $('acctTabCreate');
    ui.tabLogin = $('acctTabLogin');
    ui.panelCreate = $('acctPanelCreate');
    ui.panelLogin = $('acctPanelLogin');
    ui.signupForm = $('acctSignupForm');
    ui.signupBtn = $('acctSignupBtn');
    ui.name = $('acctName');
    ui.phone = $('acctPhone');
    ui.email = $('acctEmail');
    ui.password = $('acctPassword');
    ui.address = $('acctAddress');
    ui.loginForm = $('acctLoginForm');
    ui.loginBtn = $('acctLoginBtn');
    ui.loginEmail = $('acctLoginEmail');
    ui.loginPassword = $('acctLoginPassword');
    ui.forgotLink = $('acctForgot');
    ui.forgotForm = $('acctForgotForm');
    ui.forgotBtn = $('acctForgotBtn');
    ui.forgotEmail = $('acctForgotEmail');
    ui.backToLogin = $('acctBackToLogin');
  }

  function bindBox() {
    if (!ui.box) return;

    ui.close.addEventListener('click', function () {
      closeBox(true);
    });

    ui.box.addEventListener('mousedown', function (event) {
      if (event.target === ui.box) closeBox(true);
    });

    ui.tabCreate.addEventListener('click', function () {
      switchTab('create', true);
    });
    ui.tabLogin.addEventListener('click', function () {
      switchTab('login', true);
    });

    [ui.tabCreate, ui.tabLogin].forEach(function (tab) {
      tab.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        var next = tab === ui.tabCreate ? 'login' : 'create';
        switchTab(next, true);
        (next === 'login' ? ui.tabLogin : ui.tabCreate).focus();
      });
    });

    ui.signupForm.addEventListener('submit', handleSignup);
    ui.loginForm.addEventListener('submit', handleLogin);
    ui.forgotForm.addEventListener('submit', handleForgot);
    ui.forgotLink.addEventListener('click', showForgotForm);
    ui.backToLogin.addEventListener('click', showLoginForm);

    [ui.signupForm, ui.loginForm, ui.forgotForm].forEach(function (form) {
      form.addEventListener('input', hideMessage);
    });

    ui.box.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeBox(true);
        return;
      }
      if (event.key !== 'Tab') return;

      var focusables = Array.prototype.filter.call(
        ui.box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
        function (node) {
          return !node.disabled && node.offsetParent !== null;
        }
      );

      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function switchTab(tab, focus) {
    var create = tab !== 'login';

    ui.tabCreate.classList.toggle('is-active', create);
    ui.tabLogin.classList.toggle('is-active', !create);
    ui.tabCreate.setAttribute('aria-selected', create ? 'true' : 'false');
    ui.tabLogin.setAttribute('aria-selected', create ? 'false' : 'true');
    ui.tabCreate.setAttribute('tabindex', create ? '0' : '-1');
    ui.tabLogin.setAttribute('tabindex', create ? '-1' : '0');
    ui.panelCreate.hidden = !create;
    ui.panelLogin.hidden = create;

    // Returning to Log in always lands on the login form, not the reset form.
    if (!create) {
      ui.forgotForm.hidden = true;
      ui.loginForm.hidden = false;
    }

    if (focus) {
      (create ? ui.name : ui.loginEmail).focus();
    }
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

  function openLogin(options) {
    options = options || {};

    if (!ui.box) injectBox();
    if (!ui.box) return;

    if (user && !options.force && typeof options.onSuccess === 'function') {
      options.onSuccess(profile || profileFromMetadata());
      return;
    }

    pending = {
      onSuccess: options.onSuccess,
      onCancel: options.onCancel
    };

    ui.reason.textContent = options.reason || '';
    ui.reason.hidden = !options.reason;
    hideMessage();

    ui.signupForm.reset();
    ui.loginForm.reset();
    ui.forgotForm.reset();
    ui.forgotForm.hidden = true;
    ui.loginForm.hidden = false;
    if (options.email && ui.loginEmail) ui.loginEmail.value = options.email;

    switchTab(options.tab === 'login' ? 'login' : 'create', false);

    lastFocus = document.activeElement;
    ui.box.hidden = false;
    document.body.classList.add('acct-lock');

    setTimeout(function () {
      var target = options.tab === 'login' ? ui.loginEmail : ui.name;
      if (target) target.focus();
    }, 30);
  }

  function hideBox() {
    if (!ui.box) return;
    ui.box.hidden = true;
    document.body.classList.remove('acct-lock');

    // Never leave a typed password sitting in the page after closing.
    if (ui.password) ui.password.value = '';
    if (ui.loginPassword) ui.loginPassword.value = '';

    if (lastFocus && typeof lastFocus.focus === 'function') {
      try {
        lastFocus.focus();
      } catch (err) {
        /* ignore */
      }
    }
    lastFocus = null;
  }

  function closeBox(cancelled) {
    if (!ui.box || ui.box.hidden) return;

    hideBox();

    var action = pending;
    pending = null;

    if (cancelled && action && typeof action.onCancel === 'function') {
      try {
        action.onCancel();
      } catch (err) {
        /* ignore */
      }
    }
  }

  function finishLogin() {
    var action = pending;
    pending = null;
    hideBox();

    if (action && typeof action.onSuccess === 'function') {
      try {
        action.onSuccess(profile || profileFromMetadata());
      } catch (err) {
        console.warn('Post-login action failed:', err);
      }
    }
  }

  // ── Sign up / log in ────────────────────────────────────────

  function friendlyAuthError(error) {
    var raw = (error && error.message) ? String(error.message) : '';
    var msg = raw.toLowerCase();

    if (msg.indexOf('invalid login credentials') >= 0) return 'Email or password is incorrect.';
    if (msg.indexOf('email not confirmed') >= 0) return 'Please confirm your email address first — check your inbox for the link.';
    if (msg.indexOf('already registered') >= 0 || msg.indexOf('already been registered') >= 0) {
      return 'An account with this email already exists. Please use Log in.';
    }
    if (msg.indexOf('password should be at least') >= 0) return 'Your password must be at least 6 characters.';
    if (msg.indexOf('rate limit') >= 0 || msg.indexOf('too many') >= 0) {
      return 'Too many attempts just now. Please wait a moment and try again.';
    }
    if (msg.indexOf('unable to validate email') >= 0 || msg.indexOf('invalid email') >= 0) {
      return 'Please enter a valid email address.';
    }

    return raw || 'Something went wrong. Please try again.';
  }

  function readSignup() {
    return {
      full_name: ui.name.value.trim(),
      phone: ui.phone.value.trim(),
      email: ui.email.value.trim(),
      password: ui.password.value,
      address: ui.address.value.trim()
    };
  }

  function validateSignup(values) {
    if (!values.full_name) return 'Please enter your full name.';
    if (!values.phone) return 'Please enter your phone number.';
    if (values.phone.replace(/\D/g, '').length < 7) return 'Please enter a valid phone number.';
    if (!values.email) return 'Please enter your email address.';
    if (!looksLikeEmail(values.email)) return 'Please enter a valid email address.';
    if (!values.password) return 'Please choose a password.';
    if (values.password.length < 6) return 'Your password must be at least 6 characters.';
    return null;
  }

  async function handleSignup(event) {
    event.preventDefault();
    hideMessage();

    var values = readSignup();
    var problem = validateSignup(values);

    if (problem) {
      showMessage(problem, 'error');
      return;
    }

    if (!client) {
      showMessage('Accounts are unavailable right now. Please call or WhatsApp us.', 'error');
      return;
    }

    setBusy(ui.signupBtn, true, 'Creating account…', 'Create account');

    try {
      var res = await client.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          data: {
            full_name: values.full_name,
            phone: values.phone,
            address: values.address || null
          }
        }
      });

      if (res.error) {
        showMessage(friendlyAuthError(res.error), 'error');
        return;
      }

      if (res.data && res.data.session) {
        // Only trust the sign-up once the client can hand the session back.
        var stored = await currentSession();

        if (!stored) {
          setSession(null);
          ui.loginEmail.value = values.email;
          showMessage('Your account was created, but we could not keep you logged in. Please log in to continue — your cart is saved.', 'error');
          switchTab('login', false);
          return;
        }

        await saveProfile(values);
        finishLogin();
        return;
      }

      // No session means this Supabase project asks new customers to
      // confirm their email before signing in. Keep their cart and send
      // them to the Log in tab once they have clicked the link.
      var identities = res.data && res.data.user && res.data.user.identities;
      if (Array.isArray(identities) && identities.length === 0) {
        ui.loginEmail.value = values.email;
        showMessage('An account with this email already exists. Please use Log in.', 'error');
        switchTab('login', false);
        return;
      }

      ui.loginEmail.value = values.email;
      showMessage('Account created. Check your email to confirm it, then log in here — your cart is saved.', 'success');
      switchTab('login', false);
    } catch (err) {
      showMessage(friendlyAuthError(err), 'error');
    } finally {
      setBusy(ui.signupBtn, false, 'Creating account…', 'Create account');
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    hideMessage();

    var email = ui.loginEmail.value.trim();
    var password = ui.loginPassword.value;

    if (!email) {
      showMessage('Please enter your email address.', 'error');
      return;
    }
    if (!looksLikeEmail(email)) {
      showMessage('Please enter a valid email address.', 'error');
      return;
    }
    if (!password) {
      showMessage('Please enter your password.', 'error');
      return;
    }

    if (!client) {
      showMessage('Logging in is unavailable right now. Please call or WhatsApp us.', 'error');
      return;
    }

    setBusy(ui.loginBtn, true, 'Logging in…', 'Log in');

    try {
      var res = await client.auth.signInWithPassword({ email: email, password: password });

      if (res.error) {
        showMessage(friendlyAuthError(res.error), 'error');
        return;
      }

      // signInWithPassword reports success, but the insert is only sent as
      // the customer if the client really holds a session afterwards.
      var stored = await currentSession();

      if (!stored) {
        setSession(null);
        showMessage('We could not keep you logged in. Please check that this browser allows storage for this site, then try again.', 'error');
        return;
      }

      await loadProfile(true);

      var saved = await loadProfile(false);
      if (!saved) {
        // First login for an older account: keep the details fresh.
        var meta = metadata();
        if (meta.full_name || meta.phone || meta.address) {
          await saveProfile({
            full_name: meta.full_name || '',
            phone: meta.phone || '',
            address: meta.address || ''
          });
        }
      }

      finishLogin();
    } catch (err) {
      showMessage(friendlyAuthError(err), 'error');
    } finally {
      setBusy(ui.loginBtn, false, 'Logging in…', 'Log in');
    }
  }

  async function signOut() {
    closeBox(true);

    if (client) {
      try {
        await client.auth.signOut();
      } catch (err) {
        /* still clear the local view below */
      }
    }

    setSession(null);
    profile = null;
    profileLoadedFor = null;

    if (document.body && document.body.getAttribute('data-page') === 'my-orders') {
      window.location.href = 'index.html';
    }
  }

  // ── Forgotten password ──────────────────────────────────────

  function showForgotForm() {
    hideMessage();
    var typed = ui.loginEmail.value.trim();
    if (typed && ui.forgotEmail) ui.forgotEmail.value = typed;
    ui.loginForm.hidden = true;
    ui.forgotForm.hidden = false;
    if (ui.forgotEmail) ui.forgotEmail.focus();
  }

  function showLoginForm() {
    hideMessage();
    ui.forgotForm.hidden = true;
    ui.loginForm.hidden = false;
    var typed = ui.forgotEmail ? ui.forgotEmail.value.trim() : '';
    if (typed && ui.loginEmail && !ui.loginEmail.value.trim()) ui.loginEmail.value = typed;
    if (ui.loginPassword) ui.loginPassword.focus();
  }

  async function handleForgot(event) {
    event.preventDefault();
    hideMessage();

    var email = ui.forgotEmail.value.trim();

    if (!email) {
      showMessage('Please enter your email address.', 'error');
      return;
    }
    if (!looksLikeEmail(email)) {
      showMessage('Please enter a valid email address.', 'error');
      return;
    }
    if (!client) {
      showMessage('Password resets are unavailable right now. Please call or WhatsApp us.', 'error');
      return;
    }

    setBusy(ui.forgotBtn, true, 'Sending…', 'Send reset link');

    // The same answer goes out whether or not an account exists, so the
    // box cannot be used to discover which emails are registered.
    try {
      await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password.html'
      });
    } catch (err) {
      /* the neutral confirmation below is shown either way */
    }

    setBusy(ui.forgotBtn, false, 'Sending…', 'Send reset link');
    showMessage('If that email has an account, we have sent a reset link.', 'info');
  }

  // ── Session truth ───────────────────────────────────────────

  // The session the next database request will carry. Always read it from
  // the client (which owns localStorage and refreshes tokens) rather than
  // from our cached copy, so a restored, refreshed or just-created session
  // is the one actually used. Returns null when there is genuinely none and
  // clears the cached user, so the page never shows "Hi, …" without one.
  async function currentSession() {
    if (!client) return null;

    try {
      var res = await client.auth.getSession();
      var live = res && res.data ? res.data.session : null;
      if (live && live.user) {
        setSession(live);
        return live;
      }
    } catch (err) {
      /* treat a failed read as "no session" */
    }

    setSession(null);
    return null;
  }

  // ── Rejected sessions ───────────────────────────────────────

  // PostgREST rejects an expired/invalid JWT with 401 and code PGRST301.
  function isSessionError(error) {
    if (!error) return false;

    var code = String(error.code || '');
    var message = String(error.message || '').toLowerCase();

    if (code === 'PGRST301' || code === '401') return true;
    if (message.indexOf('jwt') >= 0) return true;
    if (message.indexOf('token') >= 0 && message.indexOf('expired') >= 0) return true;
    return message.indexOf('session') >= 0 &&
      (message.indexOf('expired') >= 0 || message.indexOf('invalid') >= 0);
  }

  // Only called after the database itself rejected the request, never to
  // pre-check a fresh login. A successful refresh updates the shared session
  // so the caller can resend the same insert.
  async function recoverSession() {
    if (!client) return false;

    try {
      var res = await client.auth.refreshSession();
      if (res && !res.error && res.data && res.data.session) {
        setSession(res.data.session);
        return true;
      }
    } catch (err) {
      /* fall through: the refresh token is gone */
    }

    setSession(null);
    return false;
  }

  function promptSessionExpired(onSuccess) {
    openLogin({
      tab: 'login',
      reason: 'Your session expired. Please log in again to continue — your cart is saved.',
      onSuccess: onSuccess
    });
  }

  // ── Footer / header links ───────────────────────────────────

  function bindAuthLinks() {
    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0 ||
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      var link = event.target && event.target.closest
        ? event.target.closest('a[data-requires-auth]')
        : null;
      if (!link) return;

      var href = link.getAttribute('href');
      if (!href) return;

      // Always pause navigation; if a session exists we resume it below.
      event.preventDefault();

      ready.then(function () {
        if (user) {
          window.location.href = href;
          return;
        }

        openLogin({
          reason: 'Log in or create an account to see your orders.',
          onSuccess: function () {
            window.location.href = href;
          }
        });
      });
    });
  }

  // ── Boot ────────────────────────────────────────────────────

  async function init() {
    injectBox();
    bindAuthLinks();

    if (!client) {
      readyResolve();
      return;
    }

    try {
      var res = await client.auth.getSession();
      setSession(res && res.data ? res.data.session : null);

      if (user) {
        await loadProfile(true);
        renderHeader();
      }

      client.auth.onAuthStateChange(function (event, nextSession) {
        // Do not await Supabase calls inside this callback. Auth events only
        // update the page state; they are never treated as an expired session.
        setSession(nextSession);

        if (nextSession && nextSession.user) {
          loadProfile(true).then(renderHeader);
        }
      });
    } catch (err) {
      console.warn('Could not restore the customer session:', err);
    }

    readyResolve();
  }

  window.authUI = {
    ready: ready,
    isLoggedIn: function () {
      return !!user;
    },
    getUser: function () {
      return user;
    },
    getSession: function () {
      return session;
    },
    currentSession: currentSession,
    getProfile: getProfile,
    isSessionError: isSessionError,
    recoverSession: recoverSession,
    promptSessionExpired: promptSessionExpired,
    openLogin: openLogin,
    closeLogin: function () {
      closeBox(true);
    },
    signOut: signOut,
    ensure: function (options) {
      options = options || {};
      ready.then(function () {
        if (user) {
          if (typeof options.onSuccess === 'function') options.onSuccess(profile || profileFromMetadata());
        } else {
          openLogin(options);
        }
      });
    },
    mountHeader: renderHeader,
    onChange: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
