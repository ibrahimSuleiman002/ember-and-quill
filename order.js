// ═══════════════════════════════════════════════════════════════
//  order.js — customer order flow
//  Renders the menu with quantity pickers, keeps the cart in
//  localStorage (so it survives the login box), then INSERTs one
//  row into public.orders. `user_id` is filled in by the database.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var CART_KEY = 'eq_cart_v1';

  // Cart lines: { name, price, qty }
  var cart = [];
  var ui = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    ui.menu = $('orderMenu');
    ui.form = $('orderForm');
    ui.name = $('orderName');
    ui.phone = $('orderPhone');
    ui.email = $('orderEmail');
    ui.address = $('orderAddress');
    ui.summary = $('orderSummary');
    ui.total = $('orderTotal');
    ui.count = $('orderCount');
    ui.submit = $('placeOrderBtn');
    ui.error = $('orderError');
    ui.success = $('orderSuccess');
    ui.statusLine = $('orderStatusLine');
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[ch];
    });
  }

  function menuItemByName(name) {
    for (var c = 0; c < siteConfig.menu.length; c++) {
      var items = siteConfig.menu[c].items;
      for (var i = 0; i < items.length; i++) {
        if (items[i].name === name) return items[i];
      }
    }
    return null;
  }

  // ── Cart state ──

  function cartLines() {
    return cart.filter(function (line) {
      return line.qty > 0;
    });
  }

  function cartCount() {
    return cartLines().reduce(function (sum, line) {
      return sum + line.qty;
    }, 0);
  }

  function cartTotal() {
    return cartLines().reduce(function (sum, line) {
      return sum + line.qty * line.price;
    }, 0);
  }

  function lineFor(name) {
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].name === name) return cart[i];
    }
    return null;
  }

  // The cart lives in localStorage so it survives the login box, a
  // page refresh, or a visit to another page.
  function loadCart() {
    var saved;

    try {
      saved = JSON.parse(window.localStorage.getItem(CART_KEY) || '[]');
    } catch (err) {
      return [];
    }

    if (!Array.isArray(saved)) return [];

    var restored = [];
    saved.forEach(function (entry) {
      if (!entry || typeof entry.name !== 'string') return;

      var item = menuItemByName(entry.name);
      if (!item) return;

      var qty = Math.floor(Number(entry.qty));
      if (!isFinite(qty) || qty < 1) return;

      restored.push({
        name: item.name,
        price: item.price,
        qty: Math.min(qty, 99)
      });
    });

    return restored;
  }

  function saveCart() {
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(cartLines()));
    } catch (err) {
      /* Private browsing can block storage — the in-memory cart still works. */
    }
  }

  function clearCart() {
    cart = [];
    try {
      window.localStorage.removeItem(CART_KEY);
    } catch (err) {
      /* ignore */
    }
  }

  function changeQty(name, delta) {
    var item = menuItemByName(name);
    if (!item) return;

    var line = lineFor(name);
    if (!line) {
      if (delta > 0) {
        cart.push({ name: item.name, price: item.price, qty: delta });
      }
    } else {
      line.qty += delta;
      if (line.qty <= 0) {
        cart = cart.filter(function (l) {
          return l.name !== name;
        });
      }
    }

    saveCart();
    hideMessages();
    renderCart();
    renderMenuQuantities();
  }

  // ── Rendering ──

  function renderMenuCard(item) {
    var name = esc(item.name);
    return '' +
      '<article class="menu-card">' +
        '<img class="menu-card-img" src="images/' + esc(item.image) + '" alt="' + name + ' — Ember & Quill menu photo" loading="lazy">' +
        '<div class="menu-card-body">' +
          '<h3 class="menu-card-name">' + name + '</h3>' +
          '<p class="menu-card-desc">' + esc(item.desc) + '</p>' +
          '<div class="menu-card-footer">' +
            '<span class="menu-card-price">' + fmtPrice(item.price) + '</span>' +
            '<div class="qty-stepper" role="group" aria-label="Quantity for ' + name + '">' +
              '<button type="button" class="qty-btn" data-action="minus" data-item-name="' + name + '" aria-label="Remove one ' + name + '">&minus;</button>' +
              '<span class="qty-value" data-item-name="' + name + '" aria-live="polite">0</span>' +
              '<button type="button" class="qty-btn" data-action="plus" data-item-name="' + name + '" aria-label="Add one ' + name + '">+</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function renderMenu() {
    if (!ui.menu) return;

    ui.menu.innerHTML = siteConfig.menu.map(function (category) {
      return '' +
        '<div class="menu-category">' +
          '<h3 class="menu-category-title">' + esc(category.category) + '</h3>' +
          '<div class="menu-cards">' +
            category.items.map(renderMenuCard).join('') +
          '</div>' +
        '</div>';
    }).join('');
  }

  function renderMenuQuantities() {
    if (!ui.menu) return;

    ui.menu.querySelectorAll('.qty-value').forEach(function (node) {
      var line = lineFor(node.getAttribute('data-item-name'));
      node.textContent = line ? String(line.qty) : '0';
    });

    ui.menu.querySelectorAll('[data-action="minus"]').forEach(function (btn) {
      var line = lineFor(btn.getAttribute('data-item-name'));
      btn.disabled = !line || line.qty <= 0;
    });
  }

  function renderCart() {
    var lines = cartLines();

    if (ui.summary) {
      if (!lines.length) {
        ui.summary.innerHTML = '<p class="order-empty">Your order is empty — add dishes from the menu above.</p>';
      } else {
        ui.summary.innerHTML = lines.map(function (line) {
          return '' +
            '<div class="order-line">' +
              '<span class="order-line-name">' + esc(line.name) +
                ' <span class="order-line-qty">&times;' + line.qty + '</span>' +
              '</span>' +
              '<span class="order-line-price">' + fmtPrice(line.price * line.qty) + '</span>' +
            '</div>';
        }).join('');
      }
    }

    if (ui.total) ui.total.textContent = fmtPrice(cartTotal());
    if (ui.count) ui.count.textContent = String(cartCount());
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

  // TEMPORARY (testing): friendly message plus the raw error details.
  function showSaveError(message, error) {
    if (ui.success) ui.success.hidden = true;
    if (!ui.error) return;

    ui.error.textContent = message;

    var lines = [];
    ['message', 'code', 'details', 'hint'].forEach(function (key) {
      var value = error ? error[key] : '';
      if (value) lines.push(key + ': ' + value);
    });

    if (lines.length) {
      var detail = document.createElement('p');
      detail.className = 'order-error-details';
      detail.style.cssText = 'margin:0.5rem 0 0;font-size:0.75rem;font-weight:400;color:#B8BEC4;white-space:pre-line;word-break:break-word;';
      detail.textContent = lines.join('\n');
      ui.error.appendChild(detail);
    }

    ui.error.hidden = false;
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

  // ── Live order status ──

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

  function updateStatusLine(order) {
    if (!ui.statusLine) return;
    var text = orderStatusText(order);
    if (ui.statusLine.textContent !== text) ui.statusLine.textContent = text;
  }

  var orderChannel = null;

  function stopOrderWatch() {
    if (orderChannel && typeof supabaseClient !== 'undefined' && supabaseClient) {
      try {
        supabaseClient.removeChannel(orderChannel);
      } catch (err) {
        /* ignore */
      }
    }
    orderChannel = null;
  }

  function watchOrder(id) {
    stopOrderWatch();
    if (!id || typeof supabaseClient === 'undefined' || !supabaseClient) return;

    orderChannel = supabaseClient
      .channel('order-live-' + id)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: 'id=eq.' + id
      }, function (payload) {
        if (payload && payload.new) updateStatusLine(payload.new);
      })
      .subscribe();
  }

  function setSubmitting(isSubmitting) {
    if (!ui.submit) return;
    ui.submit.disabled = isSubmitting;
    ui.submit.textContent = isSubmitting ? 'Placing order…' : 'Place Order';
    ui.submit.setAttribute('aria-busy', isSubmitting ? 'true' : 'false');
  }

  // ── Validation ──

  function readForm() {
    return {
      name: ui.name.value.trim(),
      phone: ui.phone.value.trim(),
      email: ui.email.value.trim(),
      address: ui.address.value.trim(),
      items: cartLines().map(function (line) {
        return { name: line.name, qty: line.qty, price: line.price };
      })
    };
  }

  function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
    if (!values.items.length) {
      return { message: 'Please add at least one item to your order.' };
    }
    if (!values.address) {
      return { message: 'Please enter your delivery address.', field: ui.address };
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
    fill(ui.address, saved.address);
  }

  // ── Submit ──

  async function continueOrder() {
    await prefillFromProfile(false);
    await sendOrder();
  }

  async function sendOrder() {
    hideMessages();

    var values = readForm();
    var problem = validate(values);
    if (problem) {
      showError(problem.message, problem.field);
      return;
    }

    if (typeof supabaseClient === 'undefined' || !supabaseClient) {
      showError('Sorry, our ordering system is unavailable right now. Please call or WhatsApp us to place your order.');
      return;
    }

    setSubmitting(true);

    // Generated in the browser and stored with the order, exactly as the
    // tracking page expects: code + phone number, no login needed.
    var trackingCode = typeof generateTrackingCode === 'function'
      ? generateTrackingCode()
      : '';

    var error = null;
    try {
      // `user_id` and `status` are intentionally omitted: the database fills
      // the owner from the session and defaults the status to PENDING_APPROVAL.
      var result = await supabaseClient.from('orders').insert({
        customer_name: values.name,
        phone: values.phone,
        email: values.email || null,
        address: values.address,
        items: values.items,
        total: cartTotal(),
        tracking_code: trackingCode || null
      });
      error = result.error;
    } catch (err) {
      error = err;
    }

    if (error) {
      console.error('Order insert failed:', error);
      setSubmitting(false);
      // Keep everything the customer typed so they can simply retry.
      showSaveError("Sorry, we couldn't save your order just now. Your details are still here — please try again, or call or WhatsApp us.", error);
      return;
    }

    // Read the row back so the status line can follow this one order.
    stopOrderWatch();
    var placed = null;
    if (trackingCode) {
      try {
        var found = await supabaseClient
          .from('orders')
          .select('id, status, paid_at')
          .eq('tracking_code', trackingCode)
          .maybeSingle();
        if (!found.error && found.data) placed = found.data;
      } catch (err) {
        placed = null;
      }
    }

    setSubmitting(false);

    // Success: clear the cart and the form, then show the code + live status.
    ui.form.reset();
    clearCart();
    renderCart();
    renderMenuQuantities();
    updateStatusLine(placed || { status: 'PENDING_APPROVAL', paid_at: null });
    showSuccess();
    if (placed && placed.id) watchOrder(placed.id);
  }

  async function placeOrder(event) {
    event.preventDefault();
    hideMessages();

    if (!cartLines().length) {
      showError('Please add at least one item to your order.');
      return;
    }

    if (typeof supabaseClient === 'undefined' || !supabaseClient) {
      showError('Sorry, our ordering system is unavailable right now. Please call or WhatsApp us to place your order.');
      return;
    }

    // The box only appears here — never on page load.
    if (typeof authUI !== 'undefined' && authUI) {
      await authUI.ready;

      if (!authUI.isLoggedIn()) {
        authUI.openLogin({
          reason: 'Log in or create an account to place your order. Your cart is saved.',
          onSuccess: continueOrder
        });
        return;
      }
    }

    sendOrder();
  }

  // ── Init ──

  function init() {
    cacheElements();
    if (!ui.menu || !ui.form) return;

    cart = loadCart();

    renderMenu();
    renderCart();
    renderMenuQuantities();

    ui.menu.addEventListener('click', function (event) {
      var btn = event.target.closest ? event.target.closest('.qty-btn') : null;
      if (!btn) return;
      changeQty(
        btn.getAttribute('data-item-name'),
        btn.getAttribute('data-action') === 'plus' ? 1 : -1
      );
    });

    ui.form.addEventListener('submit', placeOrder);
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
