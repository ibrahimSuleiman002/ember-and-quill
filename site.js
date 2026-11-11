// ═══════════════════════════════════════════════════════════════
//  Shared nav/footer renderer + brand helper for all pages
// ═══════════════════════════════════════════════════════════════

// The single place the WhatsApp number is derived. wa.me wants the
// international number as digits only: country code first, no "+",
// no spaces, no trunk "0". Change siteConfig.phoneIntl in menu.js and
// every WhatsApp link on the site follows.
const WHATSAPP_NUMBER = siteConfig.phoneIntl.replace(/[^0-9]/g, "");

// ═══════════════════════════════════════════════════════════════
//  Checkout setting — automatic accounts
//
//  AUTO_ACCOUNT = true   a logged-out customer's "Place order" opens the
//                        account on the spot: an invisible random password,
//                        a set-up link by email, then a redirect to My orders
//                        with the banner.
//  AUTO_ACCOUNT = false  the original behaviour: nothing is created behind
//                        the customer's back and no email is sent. The login
//                        popup asks them to create an account or log in, and
//                        the order goes through once they have.
//
//  Switching this back to true needs no other change — the auto-account code
//  (ensureOrderSession, sendPasswordSetUpLink, rememberAutoAccount) is still
//  in this file, it just does not run while the setting is false.
// ═══════════════════════════════════════════════════════════════

const AUTO_ACCOUNT = false;

// ═══════════════════════════════════════════════════════════════
//  Shared cart — one cart for the whole site (menu, order, panel)
//  Kept in memory and mirrored to localStorage so it survives
//  page changes. Unavailable dishes are never allowed in: the
//  pages that know the menu prune the cart when they load it.
// ═══════════════════════════════════════════════════════════════

const eqCart = (function () {
  const CART_KEY = 'eq_cart_v1';
  let lines = [];
  const listeners = [];

  function emit() {
    listeners.forEach(fn => { try { fn(); } catch (err) { /* one bad listener must not stop the rest */ } });
  }

  function write() {
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(lines));
    } catch (err) {
      /* Private browsing can block storage — the in-memory cart still works. */
    }
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(CART_KEY) || '[]');
    if (Array.isArray(saved)) {
      saved.forEach(entry => {
        if (!entry || typeof entry.name !== 'string') return;
        const qty = Math.floor(Number(entry.qty));
        if (!isFinite(qty) || qty < 1) return;
        const price = Number(entry.price);
        lines.push({ name: entry.name, price: isFinite(price) ? price : 0, qty: Math.min(qty, 99) });
      });
    }
  } catch (err) {
    lines = [];
  }

  return {
    lines() { return lines.filter(l => l.qty > 0); },
    lineFor(name) { return lines.find(l => l.name === name) || null; },
    qtyOf(name) { const l = this.lineFor(name); return l ? l.qty : 0; },
    count() { return this.lines().reduce((sum, l) => sum + l.qty, 0); },
    total() { return this.lines().reduce((sum, l) => sum + l.qty * l.price, 0); },
    change(name, price, delta) {
      const line = this.lineFor(name);
      if (!line) {
        if (delta > 0) lines.push({ name: name, price: price, qty: Math.min(delta, 99) });
      } else {
        line.qty = Math.min(line.qty + delta, 99);
        if (line.qty <= 0) lines = lines.filter(l => l.name !== name);
      }
      write();
      emit();
    },
    remove(name) {
      lines = lines.filter(l => l.name !== name);
      write();
      emit();
    },
    // Drop every line the predicate rejects; returns the removed lines.
    prune(predicate) {
      const kept = [];
      const removed = [];
      lines.forEach(l => (predicate(l) ? kept : removed).push(l));
      if (removed.length) {
        lines = kept;
        write();
        emit();
      }
      return removed;
    },
    // Persist after in-place line edits (e.g. a price change) without emitting.
    save() { write(); },
    clear() {
      lines = [];
      try { window.localStorage.removeItem(CART_KEY); } catch (err) { /* ignore */ }
      emit();
    },
    onChange(fn) { listeners.push(fn); }
  };
})();

window.eqCart = eqCart;

function escapeText(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function updateCartBadge() {
  const badge = document.getElementById('navCartBadge');
  if (!badge) return;
  const n = eqCart.count();
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = n === 0;
}

// ═══════════════════════════════════════════════════════════════
//  Cart panel = checkout. Dishes, total, the same compact details
//  form the order page used (same validation, same prefill), and a
//  fixed bottom "Place order" bar. The submit path below is the
//  order page's original one, moved here so every page shares it.
// ═══════════════════════════════════════════════════════════════

const CART_PANEL_HTML = `
  <aside class="cart-panel" id="cartPanel" role="dialog" aria-modal="false" aria-label="Cart and checkout" aria-hidden="true">
    <div class="cart-panel-head">
      <h2 class="cart-panel-title">Your cart <span class="cart-panel-count" id="cartPanelCount"></span></h2>
      <button type="button" class="cart-panel-close" id="cartPanelClose" aria-label="Close cart">&times;</button>
    </div>
    <div class="cart-panel-body" id="cartPanelBody">
      <div id="cartLines"></div>
      <div class="cart-details" id="cartDetails" hidden>
        <h3 class="cart-details-title">Your details</h3>
        <div class="cart-field">
          <label for="cartName">Full name</label>
          <input class="order-input" id="cartName" type="text" autocomplete="name" placeholder="e.g. Ada Obi">
        </div>
        <div class="cart-field">
          <label for="cartPhone">Phone number</label>
          <input class="order-input" id="cartPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="e.g. 0803 123 4567">
        </div>
        <div class="cart-field">
          <label for="cartEmail">Email</label>
          <input class="order-input" id="cartEmail" type="email" autocomplete="email" placeholder="you@example.com">
          ${AUTO_ACCOUNT
            ? '<p class="cart-field-hint">Used to create your account so you can track this order.</p>'
            : ''}
        </div>
        <div class="cart-field">
          <label for="cartAddress">Delivery address</label>
          <input class="order-input" id="cartAddress" type="text" autocomplete="street-address" placeholder="Street, area, city">
        </div>
      </div>
      <div class="cart-message cart-message-error" id="cartError" role="alert" hidden>
        <span id="cartErrorText"></span>
        <button type="button" class="btn btn-primary cart-error-login" id="cartErrorLogin" hidden>Log in</button>
      </div>
      <div class="cart-message cart-message-success" id="cartSuccess" role="status" aria-live="polite" tabindex="-1" hidden>
        <p class="cart-success-title">Order placed!</p>
        <p class="cart-success-text" id="cartStatusLine"></p>
      </div>
    </div>
    <div class="cart-panel-foot" id="cartPanelFoot" hidden>
      <div class="cart-foot-row"><span>Total</span><span id="cartPanelTotal">₦0</span></div>
      <button type="button" class="btn btn-primary cart-place-btn" id="cartPlaceBtn">Place order <span class="cart-place-total" id="cartPlaceTotal">₦0</span></button>
    </div>
  </aside>`;

const CART_TOAST_HTML = `
  <div class="cart-toast" id="cartToast" role="status" aria-live="polite" hidden>
    <span class="cart-toast-text" id="cartToastText"></span>
    <button type="button" class="cart-toast-view" id="cartToastView">View cart</button>
  </div>`;

const CART_STICKY_HTML = `
  <button type="button" class="cart-sticky-bar" id="cartStickyBar" hidden>
    <span class="cart-sticky-info"><span id="cartStickyCount">0 items</span> · <span id="cartStickyTotal">₦0</span></span>
    <span class="cart-sticky-cta">View cart &amp; place order</span>
  </button>`;

function renderCartLines() {
  const box = document.getElementById('cartLines');
  if (!box) return;
  const lines = eqCart.lines();

  if (!lines.length) {
    box.innerHTML = '<p class="cart-empty">Your cart is empty — add dishes from the menu</p>';
  } else {
    box.innerHTML = lines.map(line => {
      const name = escapeText(line.name);
      return `
        <div class="cart-line">
          <div class="cart-line-top">
            <span class="cart-line-name">${name}</span>
            <button type="button" class="cart-line-remove" data-cart-remove="${name}" aria-label="Remove ${name} from cart">Remove</button>
          </div>
          <div class="cart-line-bottom">
            <div class="qty-stepper">
              <button type="button" class="qty-btn" data-cart-minus="${name}" aria-label="Remove one ${name}">&minus;</button>
              <span class="qty-value">${line.qty}</span>
              <button type="button" class="qty-btn" data-cart-plus="${name}" aria-label="Add one ${name}">+</button>
            </div>
            <span class="cart-line-price">${fmtPrice(line.price * line.qty)}</span>
          </div>
        </div>`;
    }).join('');
  }

  const details = document.getElementById('cartDetails');
  if (details) details.hidden = !lines.length;
  const foot = document.getElementById('cartPanelFoot');
  if (foot) foot.hidden = !lines.length;
  const countEl = document.getElementById('cartPanelCount');
  if (countEl) countEl.textContent = lines.length ? String(eqCart.count()) : '';
  updateCartFoot();
}

function updateCartFoot() {
  const total = fmtPrice(eqCart.total());
  const totalEl = document.getElementById('cartPanelTotal');
  if (totalEl) totalEl.textContent = total;
  const placeTotal = document.getElementById('cartPlaceTotal');
  if (placeTotal) placeTotal.textContent = total;
}

function updateStickyBar() {
  const bar = document.getElementById('cartStickyBar');
  if (!bar) return;
  const page = document.body.dataset.page || '';
  const n = eqCart.count();
  const show = (page === 'menu' || page === 'order') && n > 0;
  bar.hidden = !show;
  if (show) {
    document.getElementById('cartStickyCount').textContent = n + (n === 1 ? ' item' : ' items');
    document.getElementById('cartStickyTotal').textContent = fmtPrice(eqCart.total());
  }
}

function isNavOpen() {
  const navLinks = document.getElementById('navLinks');
  return !!(navLinks && navLinks.classList.contains('active'));
}

function isCartOpen() {
  const panel = document.getElementById('cartPanel');
  return !!(panel && panel.classList.contains('open'));
}

function setBackdrop(open) {
  const backdrop = document.getElementById('siteBackdrop');
  if (backdrop) backdrop.classList.toggle('open', open);
}

function closeNavMenu() {
  const navLinks = document.getElementById('navLinks');
  const hamburger = document.getElementById('hamburger');
  if (navLinks) navLinks.classList.remove('active');
  if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
}

function openCartPanel(open) {
  const panel = document.getElementById('cartPanel');
  if (!panel) return;
  if (!open && panel.contains(document.activeElement)) document.activeElement.blur();
  panel.classList.toggle('open', open);
  panel.setAttribute('aria-hidden', String(!open));
  const cartBtn = document.getElementById('navCart');
  if (cartBtn) cartBtn.setAttribute('aria-expanded', String(open));
  if (open) {
    renderCartLines();
    prefillCartFromProfile();
  }
  setBackdrop(open || isNavOpen());
}

// ── Added-to-cart feedback: toast, badge bounce, fly dot ──

let cartToastTimer = null;

function showCartToast(name) {
  const toast = document.getElementById('cartToast');
  const text = document.getElementById('cartToastText');
  if (!toast || !text) return;
  text.textContent = name + ' added to cart';
  toast.hidden = false;
  toast.classList.add('cart-toast--show');
  if (cartToastTimer) clearTimeout(cartToastTimer);
  cartToastTimer = setTimeout(() => {
    toast.classList.remove('cart-toast--show');
    toast.hidden = true;
  }, 2500);
}

function bounceCartBadge() {
  const badge = document.getElementById('navCartBadge');
  const btn = document.getElementById('navCart');
  if (!btn) return;
  btn.classList.remove('cart-bounce');
  void btn.offsetWidth;
  btn.classList.add('cart-bounce');
  if (badge) {
    badge.classList.remove('cart-bounce');
    void badge.offsetWidth;
    badge.classList.add('cart-bounce');
  }
}

function flyDotToCart(sourceEl) {
  if (!sourceEl || !sourceEl.getBoundingClientRect) return;
  const cartBtn = document.getElementById('navCart');
  if (!cartBtn) return;
  const from = sourceEl.getBoundingClientRect();
  const to = cartBtn.getBoundingClientRect();
  const dot = document.createElement('span');
  dot.className = 'cart-fly-dot';
  dot.setAttribute('aria-hidden', 'true');
  dot.style.left = (from.left + from.width / 2) + 'px';
  dot.style.top = (from.top + from.height / 2) + 'px';
  document.body.appendChild(dot);
  requestAnimationFrame(() => {
    dot.style.transform = `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${to.top + to.height / 2 - (from.top + from.height / 2)}px) scale(0.4)`;
    dot.style.opacity = '0.2';
  });
  setTimeout(() => dot.remove(), 600);
}

// Called by menu.html / order.html when a dish is added.
window.eqCartFeedback = function (name, sourceEl) {
  bounceCartBadge();
  showCartToast(name);
  flyDotToCart(sourceEl);
};

// ═══════════════════════════════════════════════════════════════
//  Checkout — the order page's original submit logic, unchanged in
//  behaviour: same validation, session handling (login box only when
//  the insert really lacks a session), insert, tracking code, live
//  status. Reads the panel fields; writes panel messages.
// ═══════════════════════════════════════════════════════════════

let checkoutSubmitting = false;
let orderChannel = null;

function cartField(id) {
  return document.getElementById(id);
}

function readCartForm() {
  return {
    name: cartField('cartName') ? cartField('cartName').value.trim() : '',
    phone: cartField('cartPhone') ? cartField('cartPhone').value.trim() : '',
    email: cartField('cartEmail') ? cartField('cartEmail').value.trim() : '',
    address: cartField('cartAddress') ? cartField('cartAddress').value.trim() : '',
    items: eqCart.lines().map(line => ({ name: line.name, qty: line.qty, price: line.price }))
  };
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateCartOrder(values) {
  if (!values.items.length) return { message: 'Please add at least one item to your order.' };
  if (!values.name) return { message: 'Please enter your name.', field: 'cartName' };
  if (!values.phone) return { message: 'Please enter your phone number.', field: 'cartPhone' };
  if (values.phone.replace(/\D/g, '').length < 7) return { message: 'Please enter a valid phone number.', field: 'cartPhone' };
  if (!values.address) return { message: 'Please enter your delivery address.', field: 'cartAddress' };
  // An email is only a must when the order itself opens the account;
  // otherwise the customer gives one in the login popup and it is filled
  // into this form from their profile afterwards.
  const loggedIn = typeof authUI !== 'undefined' && authUI && typeof authUI.isLoggedIn === 'function' && authUI.isLoggedIn();
  if (AUTO_ACCOUNT && !loggedIn && !values.email) return { message: 'Please enter your email address — we use it to create your account and send order updates.', field: 'cartEmail' };
  if (values.email && !looksLikeEmail(values.email)) return { message: 'Please enter a valid email address.', field: 'cartEmail' };
  return null;
}

function hideCartMessages() {
  const error = cartField('cartError');
  if (error) { error.hidden = true; }
  const errorText = cartField('cartErrorText');
  if (errorText) errorText.textContent = '';
  const loginBtn = cartField('cartErrorLogin');
  if (loginBtn) loginBtn.hidden = true;
  const success = cartField('cartSuccess');
  if (success) success.hidden = true;
}

function showCartError(message, fieldId) {
  const success = cartField('cartSuccess');
  if (success) success.hidden = true;
  const errorText = cartField('cartErrorText');
  if (errorText) errorText.textContent = message;
  const loginBtn = cartField('cartErrorLogin');
  if (loginBtn) loginBtn.hidden = true;
  const error = cartField('cartError');
  if (error) { error.hidden = false; }
  if (fieldId) {
    const field = cartField(fieldId);
    if (field && typeof field.focus === 'function') field.focus();
  }
}

// The cases where the panel offers a login action instead of an error:
// the email already has an account, or a fresh one still needs its email
// confirmed. Cart and typed details are left untouched.
let loginPromptEmail = '';

function showCartLoginPrompt(message) {
  loginPromptEmail = cartField('cartEmail') ? cartField('cartEmail').value.trim() : '';
  showCartError(message, 'cartEmail');
  const loginBtn = cartField('cartErrorLogin');
  if (loginBtn) loginBtn.hidden = false;
}

// AUTO_ACCOUNT = false: instead of opening an account for a logged-out
// customer, hand them the login popup. Nothing is created and no email is
// sent by us. The cart and everything they typed stay in the panel, and
// closing the popup brings them straight back to it with "Place order"
// still there — their own email now prefills the form, and their profile
// fills in whatever is still empty.
function askCustomerToLogin(email) {
  if (typeof authUI === 'undefined' || !authUI || typeof authUI.openLogin !== 'function') {
    showCartError('Sorry, our ordering system is unavailable right now. Please call or WhatsApp us to place your order.');
    return;
  }

  authUI.openLogin({
    email: email,
    reason: 'Please log in to place your order. Your cart and details are saved.',
    onSuccess: function () { openCartPanel(true); }
  });
}

function showCartSuccess() {
  const error = cartField('cartError');
  if (error) error.hidden = true;
  const success = cartField('cartSuccess');
  if (!success) return;
  success.hidden = false;
  if (typeof success.focus === 'function') success.focus();
}

function isPaidOrder(order) {
  return !!(order && order.paid_at);
}

function orderStatusText(order) {
  const status = String((order && order.status) || '');
  if (status === 'CANCELLED') return 'This order was cancelled.';
  if (status === 'REJECTED') return 'Your order was rejected. Please call us if you need help.';
  if (status === 'OUT_FOR_DELIVERY') return 'Your order is on the way!';
  if (status === 'DELIVERED') return 'Delivered';
  if (status === 'APPROVED' || status === 'PREPARING') return 'Your order is approved';
  if (isPaidOrder(order) || status === 'PAID') return 'Payment received';
  return 'Order received, waiting for payment';
}

function updateCartStatusLine(order) {
  const line = cartField('cartStatusLine');
  if (!line) return;
  const text = orderStatusText(order);
  if (line.textContent !== text) line.textContent = text;
}

function stopOrderWatch() {
  const client = window.eqSupabase;
  if (orderChannel && client) {
    try { client.removeChannel(orderChannel); } catch (err) { /* ignore */ }
  }
  orderChannel = null;
}

function watchOrder(id) {
  stopOrderWatch();
  const client = window.eqSupabase;
  if (!id || !client) return;
  orderChannel = client
    .channel('order-live-' + id)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'orders',
      filter: 'id=eq.' + id
    }, payload => {
      if (payload && payload.new) updateCartStatusLine(payload.new);
    })
    .subscribe();
}

function setCartSubmitting(isSubmitting) {
  checkoutSubmitting = isSubmitting;
  const btn = cartField('cartPlaceBtn');
  if (!btn) return;
  btn.disabled = isSubmitting;
  btn.innerHTML = isSubmitting
    ? 'Placing order…'
    : 'Place order <span class="cart-place-total" id="cartPlaceTotal">' + fmtPrice(eqCart.total()) + '</span>';
}

// The session the insert will be sent with. Read straight from the client
// so a session restored from storage, refreshed, or just created by the
// login box is the one used.
async function activeSession() {
  const client = window.eqSupabase;
  if (typeof authUI !== 'undefined' && authUI && typeof authUI.currentSession === 'function') {
    return await authUI.currentSession();
  }
  try {
    const res = await client.auth.getSession();
    const live = res && res.data ? res.data.session : null;
    return live && live.user ? live : null;
  } catch (err) {
    return null;
  }
}

function isSessionError(error) {
  return typeof authUI !== 'undefined' && authUI && typeof authUI.isSessionError === 'function'
    ? authUI.isSessionError(error)
    : false;
}

function isUnavailableError(error) {
  const message = (error && (error.message || error.details || error.hint)) || '';
  return /one or more dishes are unavailable/i.test(message);
}

async function insertOrder(payload) {
  const client = window.eqSupabase;
  try {
    const result = await client.from('orders').insert(payload);
    return result.error || null;
  } catch (err) {
    return err;
  }
}

async function prefillCartFromProfile() {
  if (typeof authUI === 'undefined' || !authUI) return;

  let saved;
  try {
    saved = await authUI.getProfile();
  } catch (err) {
    return;
  }
  if (!saved) return;

  const fill = (id, value) => {
    const input = cartField(id);
    if (!input || !value || input.value.trim()) return;
    input.value = value;
  };

  fill('cartName', saved.full_name);
  fill('cartPhone', saved.phone);
  fill('cartEmail', saved.email);
  fill('cartAddress', saved.address);
}

// A password the customer never sees: used once to open the session that
// owns the order. 32 characters from crypto.getRandomValues.
function randomAccountPassword() {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-#*+';
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += charset[bytes[i] % charset.length];
  return out;
}

// Orders belong to an account (the database refuses anon inserts), so a
// logged-out customer gets one on the spot: signUp with the email they
// typed plus an invisible random password, and their name, phone and
// address in the metadata — the database copies those into the profile row
// (handle_new_customer in supabase/accounts.sql), which is what prefills
// the next order.
// signUp does not always hand the session back, so the very same password
// is used for one immediate sign-in — the flow ends the same way a manual
// login does. No session, no order: { ok: false, reason } tells the caller
// which friendly message to show.
function sessionOf(res) {
  const session = res && res.data ? res.data.session : null;
  return session && session.user ? session : null;
}

async function ensureOrderSession(values) {
  const client = window.eqSupabase;
  const password = randomAccountPassword();

  let res;
  try {
    res = await client.auth.signUp({
      email: values.email,
      password: password,
      options: {
        data: {
          full_name: values.name,
          phone: values.phone,
          address: values.address
        }
      }
    });
  } catch (err) {
    res = { error: err, data: {} };
  }

  let session = sessionOf(res);
  const signUpMessage = ((res.error && res.error.message) || '').toLowerCase();

  if (session) return { ok: true, session: session };

  if (signUpMessage.indexOf('already registered') >= 0 || signUpMessage.indexOf('already been registered') >= 0) {
    return { ok: false, reason: 'exists' };
  }

  // When the project asks new customers to confirm their email, Supabase
  // hides "already registered" behind a masked sign-up: no identities
  // means the address is taken.
  const identities = res.data && res.data.user ? res.data.user.identities : undefined;
  if (Array.isArray(identities) && identities.length === 0) return { ok: false, reason: 'exists' };

  let signRes;
  try {
    signRes = await client.auth.signInWithPassword({ email: values.email, password: password });
  } catch (err) {
    signRes = { error: err, data: {} };
  }

  session = sessionOf(signRes);
  if (session) return { ok: true, session: session };

  const signInMessage = ((signRes.error && signRes.error.message) || '').toLowerCase();
  if (signUpMessage.indexOf('email not confirmed') >= 0 || signInMessage.indexOf('email not confirmed') >= 0) {
    return { ok: false, reason: 'confirm' };
  }
  // The address belongs to an account this password cannot open.
  if (signInMessage.indexOf('invalid login credentials') >= 0) return { ok: false, reason: 'exists' };

  return { ok: false, reason: 'down' };
}

// The set-password link must never hold up the login or the redirect, so
// this runs without waiting and swallows every failure. The account is
// reachable through "Forgot password" regardless.
function sendPasswordSetUpLink(email) {
  const client = window.eqSupabase;
  const url = window.location.protocol + '//' + window.location.host + '/reset-password.html';
  try {
    client.auth.resetPasswordForEmail(email, { redirectTo: url }).then(res => {
      if (res && res.error) console.warn('Password set-up email failed:', res.error.message);
    });
  } catch (err) {
    console.warn('Password set-up email failed:', err);
  }
}

// Passed to my-orders.html through this tab only: the banner wording and
// which card to highlight. Read once, then dropped.
const AUTO_ACCOUNT_KEY = 'eq_auto_account_v1';

function rememberAutoAccount(email, orderId) {
  try {
    window.sessionStorage.setItem(AUTO_ACCOUNT_KEY, JSON.stringify({ email: email, orderId: orderId || null }));
  } catch (err) {
    /* Private browsing can block storage — the order and session are safe. */
  }
}

async function placeOrderFromCart() {
  if (checkoutSubmitting) return;
  hideCartMessages();

  // A signed-in customer should not have to type what we already have on
  // file: if the profile read on page load hasn't landed yet, wait for it
  // now. It is cached, so this is a no-op in the normal case.
  if (typeof authUI !== 'undefined' && authUI && authUI.isLoggedIn()) {
    await prefillCartFromProfile();
  }

  const values = readCartForm();
  const problem = validateCartOrder(values);
  if (problem) {
    showCartError(problem.message, problem.field);
    return;
  }

  if (!window.eqSupabase) {
    showCartError('Sorry, our ordering system is unavailable right now. Please call or WhatsApp us to place your order.');
    return;
  }

  // Nothing reaches the database until a session exists: the insert belongs
  // to an account. With AUTO_ACCOUNT on, a logged-out customer is given one
  // by this order; with it off, they are asked to log in or sign up first.
  setCartSubmitting(true);

  let autoCreated = false;
  const live = await activeSession();
  if (!live) {
    if (!AUTO_ACCOUNT) {
      setCartSubmitting(false);
      askCustomerToLogin(values.email);
      return;
    }

    const account = await ensureOrderSession(values);
    if (!account.ok) {
      setCartSubmitting(false);
      if (account.reason === 'exists') showCartLoginPrompt('You already have an account with this email. Please log in to continue — your cart and details are saved.');
      else if (account.reason === 'confirm') showCartLoginPrompt('Please confirm your email address first — we sent a link to ' + values.email + '. Then log in to place your order; your cart and details are saved.');
      else showCartError('Sorry, our ordering system is unavailable right now. Please call or WhatsApp us to place your order.');
      return;
    }
    autoCreated = true;
  }

  // Generated in the browser and stored with the order, exactly as the
  // tracking page expects: code + phone number, no login needed.
  const trackingCode = typeof generateTrackingCode === 'function' ? generateTrackingCode() : '';

  // `user_id` and `status` are intentionally omitted: the database fills
  // the owner from the session and defaults the status to PENDING_APPROVAL.
  const payload = {
    customer_name: values.name,
    phone: values.phone,
    email: values.email || null,
    address: values.address,
    items: values.items,
    total: eqCart.total(),
    tracking_code: trackingCode || null
  };

  let error = await insertOrder(payload);

  // The database rejected the session (401 / JWT expired). Refresh once
  // and resend the same order; the customer is not asked to log in again.
  if (error && isSessionError(error)) {
    const recovered = typeof authUI !== 'undefined' && authUI && authUI.recoverSession
      ? await authUI.recoverSession()
      : false;
    if (recovered) error = await insertOrder(payload);
  }

  if (error) {
    console.error('Order insert failed:', error);
    setCartSubmitting(false);

    if (isUnavailableError(error)) {
      showCartError('One or more dishes are unavailable. Please review your order and try again.');
      // The menu pages re-read the menu and prune the cart when they hear this.
      document.dispatchEvent(new CustomEvent('eq:unavailable'));
      return;
    }

    // Only here — after a real 401 and a failed refresh — ask for a login.
    if (isSessionError(error) && typeof authUI !== 'undefined' && authUI && authUI.promptSessionExpired) {
      authUI.promptSessionExpired(placeOrderFromCart);
      return;
    }

    // Keep everything the customer typed so they can simply retry.
    showCartError("Sorry, we couldn't save your order just now. Your details are still here — please try again, or call or WhatsApp us.");
    return;
  }

  // The order is saved: fill in any profile fields that are still missing.
  if (typeof authUI !== 'undefined' && authUI && typeof authUI.rememberCheckoutDetails === 'function') {
    authUI.rememberCheckoutDetails(values.name, values.phone, values.address);
  }

  // Read the row back so the status line can follow this one order.
  stopOrderWatch();
  let placed = null;
  if (trackingCode) {
    try {
      const found = await window.eqSupabase
        .from('orders')
        .select('id, status, paid_at')
        .eq('tracking_code', trackingCode)
        .maybeSingle();
      if (!found.error && found.data) placed = found.data;
    } catch (err) {
      placed = null;
    }
  }

  setCartSubmitting(false);

  // Success: clear the cart and the form, then show the live status.
  ['cartName', 'cartPhone', 'cartEmail', 'cartAddress'].forEach(id => {
    const input = cartField(id);
    if (input) input.value = '';
  });
  eqCart.clear();
  renderCartLines();
  if (autoCreated) {
    // Signed in with a real session and the order is theirs: send the
    // set-password link, then hand over to My orders — the same screen a
    // logged-in customer would see, with this order highlighted.
    sendPasswordSetUpLink(values.email);
    rememberAutoAccount(values.email, placed && placed.id);
    openCartPanel(false);
    window.location.href = 'my-orders.html';
    return;
  }
  updateCartStatusLine(placed || { status: 'PENDING_APPROVAL', paid_at: null });
  showCartSuccess();
  if (placed && placed.id) watchOrder(placed.id);
}

function mountCartChrome() {
  if (document.getElementById('cartPanel')) return;

  const tpl = document.createElement('template');
  tpl.innerHTML = CART_PANEL_HTML + CART_TOAST_HTML + CART_STICKY_HTML;
  while (tpl.content.firstChild) document.body.appendChild(tpl.content.firstChild);

  document.getElementById('cartPanelClose').addEventListener('click', () => openCartPanel(false));

  document.getElementById('cartPanel').addEventListener('click', event => {
    const plus = event.target.closest('[data-cart-plus]');
    const minus = event.target.closest('[data-cart-minus]');
    const remove = event.target.closest('[data-cart-remove]');
    if (plus) {
      const line = eqCart.lineFor(plus.getAttribute('data-cart-plus'));
      if (line) eqCart.change(line.name, line.price, 1);
    } else if (minus) {
      const line = eqCart.lineFor(minus.getAttribute('data-cart-minus'));
      if (line) eqCart.change(line.name, line.price, -1);
    } else if (remove) {
      eqCart.remove(remove.getAttribute('data-cart-remove'));
    }
  });

  document.getElementById('cartPlaceBtn').addEventListener('click', placeOrderFromCart);

  document.getElementById('cartErrorLogin').addEventListener('click', () => {
    if (typeof authUI !== 'undefined' && authUI && typeof authUI.openLogin === 'function') {
      authUI.openLogin({
        tab: 'login',
        email: loginPromptEmail,
        reason: 'Log in to place your order — your cart and details are saved.'
      });
    }
  });

  document.getElementById('cartToastView').addEventListener('click', () => openCartPanel(true));

  document.getElementById('cartStickyBar').addEventListener('click', () => openCartPanel(true));

  const cartBtn = document.getElementById('navCart');
  if (cartBtn) {
    cartBtn.addEventListener('click', () => {
      const open = !isCartOpen();
      if (open) closeNavMenu();
      openCartPanel(open);
    });
  }
}

// The cart glyph, defined once: renderNav() below is the only header markup,
// and every page renders its nav through it.
const CART_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>';

function renderNav(activePage) {
  const pages = [
    { href: 'index.html', label: 'Home', key: 'home' },
    { href: 'menu.html', label: 'Menu', key: 'menu' },
    { href: 'about.html', label: 'About', key: 'about' },
    { href: 'gallery.html', label: 'Gallery', key: 'gallery' },
    { href: 'contact.html', label: 'Contact', key: 'contact' }
  ];

  const linksHTML = pages.map(p =>
    `<li><a href="${p.href}" class="${p.key === activePage ? 'active' : ''}">${p.label}</a></li>`
  ).join('');

  return `
    <nav id="navbar">
      <a href="index.html" class="nav-logo" id="navLogo"></a>
      <ul class="nav-links" id="navLinks">
        ${linksHTML}
        <li><a href="order.html" class="nav-order">Order Online</a></li>
        <li><a href="reservations.html" class="nav-reserve">Reserve</a></li>
      </ul>
      <div class="nav-right">
        <button class="nav-cart" id="navCart" aria-label="Open your cart" aria-expanded="false">
          ${CART_ICON_SVG}
          <span class="nav-cart-badge" id="navCartBadge" hidden>0</span>
        </button>
        <button class="hamburger" id="hamburger" aria-label="Toggle menu" aria-expanded="false">
          <span></span>
          <span></span>
          <span></span>
        </button>
      </div>
    </nav>
    <div class="site-backdrop" id="siteBackdrop"></div>
  `;
}

function renderFooter() {
  return `
    <footer>
      <div class="footer-inner">
        <div class="footer-logo" id="footerLogo"></div>
        <ul class="footer-links">
          <li><a href="index.html">Home</a></li>
          <li><a href="about.html">About</a></li>
          <li><a href="menu.html">Menu</a></li>
          <li><a href="gallery.html">Gallery</a></li>
          <li><a href="reservations.html">Reservations</a></li>
          <li><a href="contact.html">Contact</a></li>
          <li><a href="privacy.html">Privacy Policy</a></li>
        </ul>
        <p class="footer-copy" id="footerCopy"></p>
      </div>
    </footer>
  `;
}

function renderBrand() {
  const nameParts = siteConfig.name.split(' & ');
  return nameParts.length > 1
    ? `${nameParts[0]} <span>&</span> ${nameParts[1]}`
    : siteConfig.name.replace(/&/, '<span>&</span>');
}

function initChrome(activePage) {
  // Inject nav
  const navMount = document.getElementById('nav-mount');
  if (navMount) navMount.innerHTML = renderNav(activePage);

  // Inject footer
  const footerMount = document.getElementById('footer-mount');
  if (footerMount) footerMount.innerHTML = renderFooter();

  // Brand
  const nameHTML = renderBrand();
  ['navLogo', 'footerLogo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = nameHTML;
  });

  const copy = document.getElementById('footerCopy');
  if (copy) copy.innerHTML = `&copy; ${new Date().getFullYear()} ${siteConfig.name}. All rights reserved. | ${siteConfig.phone}`;

  // Customer account items: nothing for visitors. Once auth.js has restored
  // a session it adds the greeting first, the account link after Gallery,
  // and Log out last.
  if (window.authUI && typeof window.authUI.mountHeader === 'function') {
    window.authUI.mountHeader();
  }

  // Hamburger — tap outside (backdrop), a link, or Escape closes it.
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      const open = !navLinks.classList.contains('active');
      if (open) openCartPanel(false);
      navLinks.classList.toggle('active', open);
      hamburger.setAttribute('aria-expanded', String(open));
      setBackdrop(open || isCartOpen());
    });
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        closeNavMenu();
        setBackdrop(isCartOpen());
      });
    });
  }

  // Shared cart: badge, checkout panel, sticky bar, backdrop dismissal.
  mountCartChrome();
  updateCartBadge();
  updateStickyBar();
  eqCart.onChange(() => {
    updateCartBadge();
    renderCartLines();
    updateStickyBar();
  });

  const backdrop = document.getElementById('siteBackdrop');
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeNavMenu();
      openCartPanel(false);
      setBackdrop(false);
    });
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeNavMenu();
    openCartPanel(false);
    setBackdrop(false);
  });
}

function fmtPrice(n) {
  return siteConfig.currency + n.toLocaleString('en-NG');
}

// Shared full-menu renderer. menu.html and the landing page both call
// this with rows loaded from the customer-safe public.menu_public view.
// `variant === 'landing'` opts into the responsive photo-card grid.
function renderMenuSections(items, variant) {
  if (!window.eqMenu) return '';
  return window.eqMenu.renderSections(items, variant);
}

function getWhatsAppLink(message) {
  const msg = message || "Hello, I'd like to place an order.";
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
}

function renderCallButtons() {
  const callHTML = `Call ${siteConfig.phone}`;
  const waHTML = `WhatsApp ${siteConfig.phone}`;
  const telHref = `tel:${siteConfig.phoneIntl}`;

  const btn = (id, href, text, cls) => {
    const el = document.getElementById(id);
    if (el) { el.href = href; el.textContent = text; }
  };

  btn('callBtn1', telHref, callHTML);
  btn('waBtn1', `https://wa.me/${WHATSAPP_NUMBER}`, waHTML);
  btn('callBtn2', telHref, callHTML);
  btn('waBtn2', `https://wa.me/${WHATSAPP_NUMBER}`, waHTML);
  btn('callBtn3', telHref, callHTML);
  btn('waBtn3', `https://wa.me/${WHATSAPP_NUMBER}`, waHTML);
}

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page || '';
  initChrome(page);
  renderCallButtons();

  // Smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        const navHeight = 64;
        const targetPosition = target.getBoundingClientRect().top + window.scrollY - navHeight;
        window.scrollTo({ top: targetPosition, behavior: 'smooth' });
      }
    });
  });
});
