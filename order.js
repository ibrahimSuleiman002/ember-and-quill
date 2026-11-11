// ═══════════════════════════════════════════════════════════════
//  order.js — dish picking on the order page
//  Renders the menu with quantity steppers on top of the shared
//  site-wide cart (window.eqCart in site.js). Checkout — details
//  form, validation, submit and live status — lives in the cart
//  panel, also in site.js, so this page keeps no form of its own.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var menuItems = [];
  var menuByName = {};
  var ui = {};
  var catOpenState = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    ui.menu = $('orderMenu');
    ui.menuNotice = $('orderMenuNotice');
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
    return menuByName[name] || null;
  }

  function setMenuItems(items) {
    menuItems = items || [];
    menuByName = {};
    menuItems.forEach(function (item) {
      menuByName[item.name] = item;
    });
  }

  function showMenuNotice(message) {
    if (!ui.menuNotice) return;
    ui.menuNotice.textContent = message;
    ui.menuNotice.hidden = false;
  }

  function hideMenuNotice() {
    if (!ui.menuNotice) return;
    ui.menuNotice.hidden = true;
    ui.menuNotice.textContent = '';
  }

  // A dish that becomes unavailable is removed from the shared cart and
  // the customer is told exactly which line disappeared.
  function reconcileCart() {
    var removed = [];
    var seen = {};
    var priceChanged = false;

    eqCart.lines().forEach(function (line) {
      var item = menuItemByName(line.name);
      if (item && item.available && line.price !== item.price) {
        line.price = item.price;
        priceChanged = true;
      }
    });

    eqCart.prune(function (line) {
      var item = menuItemByName(line.name);
      if (item && item.available) return true;
      if (!seen[line.name]) {
        seen[line.name] = true;
        removed.push(line.name);
      }
      return false;
    });

    if (priceChanged) eqCart.save();

    if (removed.length) {
      showMenuNotice(
        'Removed from your order because ' + (removed.length === 1 ? 'it is' : 'they are') +
        ' no longer available: ' + removed.join(', ') + '.'
      );
    } else {
      hideMenuNotice();
    }
  }

  function menuErrorHtml() {
    return '<div class="menu-load-error" role="alert">' +
      '<strong>We could not load the menu right now.</strong>' +
      '<p>Please refresh the page or try again in a moment.</p>' +
    '</div>';
  }

  // Unavailable dishes can never enter the cart, from here or anywhere else.
  function changeQty(name, delta, sourceEl) {
    var item = menuItemByName(name);
    if (!item || !item.available) {
      showMenuNotice('This dish is currently unavailable.');
      return;
    }

    eqCart.change(item.name, item.price, delta);
    if (delta > 0 && window.eqCartFeedback) {
      window.eqCartFeedback(item.name, sourceEl);
    }
  }

  // ── Rendering ──

  function renderMenuCard(item) {
    var unavailable = !item.available;
    var name = esc(item.name);
    var src = window.eqMenu ? window.eqMenu.imageSrc(item) : '';

    return '' +
      '<article class="menu-card' + (unavailable ? ' menu-card--unavailable' : '') + '">' +
        (src ? '<img class="menu-card-img" src="' + esc(src) + '" alt="' + name + ' — Ember & Quill menu photo" loading="lazy">' : '') +
        '<div class="menu-card-body">' +
          (unavailable ? '<span class="menu-unavailable-badge">Unavailable</span>' : '') +
          '<h3 class="menu-card-name">' + name + '</h3>' +
          '<p class="menu-card-desc">' + esc(item.description) + '</p>' +
          '<div class="menu-card-footer">' +
            '<span class="menu-card-price">' + fmtPrice(item.price) + '</span>' +
            '<div class="qty-stepper" role="group" aria-label="Quantity for ' + name + '">' +
              '<button type="button" class="qty-btn" data-action="minus" data-item-name="' + name + '" aria-label="Remove one ' + name + '" disabled>&minus;</button>' +
              '<span class="qty-value" data-item-name="' + name + '" aria-live="polite">0</span>' +
              '<button type="button" class="qty-btn" data-action="plus" data-item-name="' + name + '" aria-label="Add one ' + name + '"' + (unavailable ? ' disabled' : '') + '>+</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  // Phones start with only the first category open; wider screens
  // start fully open. State survives the 30s menu re-render.
  function categoryOpen(cat, index) {
    if (!(cat in catOpenState)) {
      var phone = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
      catOpenState[cat] = !phone || index === 0;
    }
    return catOpenState[cat];
  }

  function renderMenu() {
    if (!ui.menu) return;

    if (!menuItems.length) {
      ui.menu.innerHTML = '<p class="order-empty">No dishes are available right now.</p>';
      return;
    }

    var groups = window.eqMenu ? window.eqMenu.group(menuItems) : [];

    ui.menu.innerHTML = groups.map(function (category, index) {
      var open = categoryOpen(category.category, index);
      var cat = esc(category.category);
      var count = category.items.length;

      return '' +
        '<div class="menu-category' + (open ? '' : ' cat-closed') + '">' +
          '<h3 class="menu-category-title menu-cat-head">' +
            '<button type="button" class="menu-cat-toggle" data-cat-toggle="' + cat + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
              '<span class="menu-cat-arrow" aria-hidden="true"></span>' +
              '<span class="menu-cat-name">' + cat + '</span>' +
              '<span class="menu-cat-count">' + count + ' ' + (count === 1 ? 'dish' : 'dishes') + '</span>' +
              '<span class="menu-cat-cart" data-cat-cart="' + cat + '" hidden>0</span>' +
            '</button>' +
          '</h3>' +
          '<div class="menu-cards menu-cat-body">' +
            category.items.map(renderMenuCard).join('') +
          '</div>' +
        '</div>';
    }).join('');

    updateCategoryBadges();
  }

  function updateCategoryBadges() {
    if (!ui.menu) return;

    var totals = {};
    eqCart.lines().forEach(function (line) {
      var item = menuByName[line.name];
      if (item) {
        var cat = String(item.category || 'Menu');
        totals[cat] = (totals[cat] || 0) + line.qty;
      }
    });

    ui.menu.querySelectorAll('[data-cat-cart]').forEach(function (node) {
      var n = totals[node.getAttribute('data-cat-cart')] || 0;
      node.textContent = String(n);
      node.hidden = n === 0;
    });
  }

  function renderMenuQuantities() {
    if (!ui.menu) return;

    ui.menu.querySelectorAll('.qty-value').forEach(function (node) {
      var line = eqCart.lineFor(node.getAttribute('data-item-name'));
      node.textContent = line ? String(line.qty) : '0';
    });

    ui.menu.querySelectorAll('[data-action="minus"]').forEach(function (btn) {
      var line = eqCart.lineFor(btn.getAttribute('data-item-name'));
      btn.disabled = !line || line.qty <= 0;
    });

    ui.menu.querySelectorAll('[data-action="plus"]').forEach(function (btn) {
      var item = menuItemByName(btn.getAttribute('data-item-name'));
      btn.disabled = !item || !item.available;
    });
  }

  function applyMenu(items) {
    setMenuItems(items);
    reconcileCart();
    renderMenu();
    renderMenuQuantities();
  }

  function handleMenuData(items, error) {
    if (error) {
      menuItems = [];
      menuByName = {};
      if (ui.menu) ui.menu.innerHTML = menuErrorHtml();
      return;
    }
    applyMenu(items);
  }

  function refreshMenuAfterUnavailable() {
    if (!window.eqMenu) return;
    window.eqMenu.load().then(function (items) {
      applyMenu(items);
    }).catch(function () {
      /* The regular 30s/focus refresh will try again. */
    });
  }

  // ── Init ──

  function init() {
    cacheElements();
    if (!ui.menu || !window.eqCart) return;

    ui.menu.innerHTML = '<p class="menu-loading">Loading menu…</p>';

    // The cart panel or the menu page can change the cart at any time —
    // keep this page's steppers and category badges in sync.
    eqCart.onChange(function () {
      renderMenuQuantities();
      updateCategoryBadges();
    });

    if (window.eqMenu) {
      window.eqMenu.watch(handleMenuData);
    } else {
      handleMenuData(null, new Error('The menu could not be loaded.'));
    }

    ui.menu.addEventListener('click', function (event) {
      var toggle = event.target.closest ? event.target.closest('[data-cat-toggle]') : null;
      if (toggle) {
        var cat = toggle.getAttribute('data-cat-toggle');
        var isOpen = catOpenState[cat] !== false;
        catOpenState[cat] = !isOpen;
        var section = toggle.closest('.menu-category');
        if (section) section.classList.toggle('cat-closed', isOpen);
        toggle.setAttribute('aria-expanded', String(!isOpen));
        return;
      }

      var btn = event.target.closest ? event.target.closest('.qty-btn') : null;
      if (!btn) return;
      changeQty(
        btn.getAttribute('data-item-name'),
        btn.getAttribute('data-action') === 'plus' ? 1 : -1,
        btn
      );
    });

    // The cart panel hit the database's availability check — re-read the
    // menu so the cart gets pruned and the customer sees which line went.
    document.addEventListener('eq:unavailable', refreshMenuAfterUnavailable);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
