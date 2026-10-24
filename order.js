// ═══════════════════════════════════════════════════════════════
//  order.js — customer order flow
//  Renders the menu with quantity pickers, keeps a small in-memory
//  cart, then INSERTs one row into public.orders.
//  Customers can only insert — we never read the row back.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

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
    ui.tracking = $('orderTracking');
    ui.trackingCode = $('orderTrackingCode');
    ui.copyCode = $('copyOrderCode');
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

  // ── Submit ──

  async function placeOrder(event) {
    event.preventDefault();
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

    // Generated in the browser and stored with the order. The customer
    // needs this code plus their phone number to track or cancel later.
    var trackingCode = typeof generateTrackingCode === 'function'
      ? generateTrackingCode()
      : '';

    var error = null;
    try {
      // Insert only — no .select(), so the customer never reads the row back.
      // `status` is intentionally omitted so the column default
      // (PENDING_APPROVAL) applies.
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

    setSubmitting(false);

    if (error) {
      // Keep everything the customer typed so they can simply retry.
      showError("Sorry, we couldn't save your order just now. Your details are still here — please try again, or call or WhatsApp us.");
      return;
    }

    // Success: clear the cart and the form, then show the tracking code.
    ui.form.reset();
    cart = [];
    renderCart();
    renderMenuQuantities();
    showSuccess(trackingCode);
  }

  // ── Init ──

  function init() {
    cacheElements();
    if (!ui.menu || !ui.form) return;

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

    if (ui.copyCode) ui.copyCode.addEventListener('click', copyCode);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
