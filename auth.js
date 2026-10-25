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

  var client = (typeof supabaseClient === 'undefined') ? null : supabaseClient;

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

    [ui.signupForm, ui.loginForm].forEach(function (form) {
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

    if (focus) {
      (create ? ui.name : ui.loginEmail).focus();
    }
  }

  function showMessage(text, type) {
    if (!ui.message) return;
    ui.message.className = 'order-message ' + (type === 'success' ? 'order-success' : 'order-error');
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
        setSession(res.data.session);
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

      setSession(res.data.session);
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
        // Do not await Supabase calls inside this callback.
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
    getProfile: getProfile,
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
