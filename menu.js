// ═══════════════════════════════════════════════════════════════
//  CONFIG — Edit this single object to rebrand the entire site
// ═══════════════════════════════════════════════════════════════

const siteConfig = {
  // Brand
  name: "Ember & Quill",
  tagline: "Modern Nigerian dining, crafted over fire",
  currency: "₦",

  // Contact & Hours
  address: "42 Ember Lane, Wuse II, Abuja, Nigeria",
  phone: "07063134521",
  phoneIntl: "+2347063134521",
  email: "hello@emberandquill.ng",

  hours: [
    { days: "Mon — Thu", time: "12:00 PM – 10:00 PM" },
    { days: "Fri — Sat", time: "12:00 PM – 11:00 PM" },
    { days: "Sunday", time: "11:00 AM – 9:00 PM" }
  ],

  // Home page highlights. The dish details themselves come from the
  // public.menu_public view, so availability is always current.
  highlights: [
    "Ember-Grilled Ribeye",
    "Full Chicken Suya",
    "Grilled Catfish",
    "Jollof Rice & Grilled Chicken",
    "Smoked Plantain & Ice Cream",
    "The Quill's Old Fashioned"
  ],

  // Reviews
  reviews: [
    { name: "Adaeze", rating: 5, text: "The suya wings were incredible — smoky, spicy, and perfectly charred. Best I've had in Abuja." },
    { name: "Tunde", rating: 5, text: "Booked for a birthday dinner. The ribeye was outstanding and the service was warm and attentive." },
    { name: "Ngozi", rating: 4, text: "Great atmosphere and the jollof rice is the real deal. Will definitely be back with friends." }
  ]
};

// ═══════════════════════════════════════════════════════════════
//  Public menu — reads the customer-safe public.menu_public view
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var PUBLIC_COLUMNS = 'id, slug, name, category, description, price, image_url, available, sort_order';
  var REFRESH_MS = 30000;

  function escapeHtml(value) {
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

  function imageSrc(item) {
    var raw = String((item && (item.image_url || item.image)) || '').trim();
    if (!raw) return '';
    if (/^(?:https?:)?\/\//i.test(raw) || raw.charAt(0) === '/' || raw.indexOf('images/') === 0) {
      return raw;
    }
    return 'images/' + raw;
  }

  function priceText(value) {
    var amount = Number(value) || 0;
    if (typeof window.fmtPrice === 'function') return window.fmtPrice(amount);
    return (siteConfig.currency || '₦') + amount.toLocaleString('en-NG');
  }

  function normalize(row) {
    var price = Number(row.price);
    return {
      id: row.id,
      slug: String(row.slug || ''),
      name: String(row.name || ''),
      category: String(row.category || 'Menu'),
      description: String(row.description || ''),
      price: isFinite(price) ? price : 0,
      image_url: imageSrc(row),
      available: row.available !== false,
      sort_order: Number(row.sort_order) || 0
    };
  }

  function load() {
    if (!window.eqSupabase) {
      return Promise.reject(new Error('The menu service is not available.'));
    }

    try {
      return Promise.resolve(
        window.eqSupabase
          .from('menu_public')
          .select(PUBLIC_COLUMNS)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true })
      ).then(function (result) {
        if (!result || result.error) {
          throw (result && result.error) || new Error('The menu could not be loaded.');
        }

        var rows = result.data || [];
        if (!rows.length) throw new Error('The menu is being updated.');

        return rows.map(normalize).sort(function (a, b) {
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
          return a.name.localeCompare(b.name);
        });
      });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function group(items) {
    var groups = [];
    var byCategory = {};

    (items || []).forEach(function (item) {
      var category = item.category || 'Menu';
      if (!byCategory[category]) {
        byCategory[category] = { category: category, items: [] };
        groups.push(byCategory[category]);
      }
      byCategory[category].items.push(item);
    });

    return groups;
  }

  // Full-menu cards show an Add button; once the dish is in the shared
  // cart the button becomes a −/+ stepper, same as the order page.
  function cardFooter(item, variant) {
    var price = priceText(item.price);
    if (variant === 'landing') {
      return '<div class="menu-card-price">' + price + '</div>';
    }
    if (!item.available) {
      return '<div class="menu-card-footer"><span class="menu-card-price">' + price + '</span></div>';
    }

    var name = escapeHtml(item.name);
    var qty = window.eqCart ? window.eqCart.qtyOf(item.name) : 0;

    if (qty > 0) {
      return '' +
        '<div class="menu-card-footer">' +
          '<span class="menu-card-price">' + price + '</span>' +
          '<div class="qty-stepper" role="group" aria-label="Quantity for ' + name + '">' +
            '<button type="button" class="qty-btn" data-action="minus" data-item-name="' + name + '" aria-label="Remove one ' + name + '">&minus;</button>' +
            '<span class="qty-value" data-item-name="' + name + '">' + qty + '</span>' +
            '<button type="button" class="qty-btn" data-action="plus" data-item-name="' + name + '" aria-label="Add one ' + name + '">+</button>' +
          '</div>' +
        '</div>';
    }

    return '' +
      '<div class="menu-card-footer">' +
        '<span class="menu-card-price">' + price + '</span>' +
        '<button type="button" class="menu-add-btn" data-add-name="' + name + '" data-add-price="' + (Number(item.price) || 0) + '">Add</button>' +
      '</div>';
  }

  function card(item, variant) {
    var unavailable = !item.available;
    var name = escapeHtml(item.name);
    var src = imageSrc(item);

    return '' +
      '<article class="menu-card' + (unavailable ? ' menu-card--unavailable' : '') + '" data-menu-slug="' + escapeHtml(item.slug) + '">' +
        (src ? '<img class="menu-card-img" src="' + escapeHtml(src) + '" alt="' + name + ' — Ember & Quill menu photo" loading="lazy">' : '') +
        '<div class="menu-card-body">' +
          (unavailable ? '<span class="menu-unavailable-badge">Unavailable</span>' : '') +
          '<h3 class="menu-card-name">' + name + '</h3>' +
          '<p class="menu-card-desc">' + escapeHtml(item.description) + '</p>' +
          cardFooter(item, variant) +
        '</div>' +
      '</article>';
  }

  // Accordion state survives the 30s menu re-render. Phones start with
  // only the first category open; wider screens start fully open.
  var catOpenState = {};

  function categoryOpen(cat, index) {
    if (!(cat in catOpenState)) {
      var phone = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
      catOpenState[cat] = !phone || index === 0;
    }
    return catOpenState[cat];
  }

  function accordionHead(cat, items, index) {
    var open = categoryOpen(cat, index);
    var name = escapeHtml(cat);
    return '' +
      '<h3 class="menu-category-title menu-cat-head">' +
        '<button type="button" class="menu-cat-toggle" data-cat-toggle="' + name + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
          '<span class="menu-cat-arrow" aria-hidden="true"></span>' +
          '<span class="menu-cat-name">' + name + '</span>' +
          '<span class="menu-cat-count">' + items.length + ' ' + (items.length === 1 ? 'dish' : 'dishes') + '</span>' +
          '<span class="menu-cat-cart" data-cat-cart="' + name + '" hidden>0</span>' +
        '</button>' +
      '</h3>';
  }

  function bindAccordions(container) {
    if (!container) return;
    Array.prototype.forEach.call(container.querySelectorAll('[data-cat-toggle]'), function (btn) {
      btn.addEventListener('click', function () {
        var cat = btn.getAttribute('data-cat-toggle');
        var open = !categoryOpen(cat, 0);
        catOpenState[cat] = open;
        var section = btn.closest('.menu-category');
        if (section) section.classList.toggle('cat-closed', !open);
        btn.setAttribute('aria-expanded', String(open));
      });
    });
  }

  function renderSections(items, variant) {
    var cardsClass = variant === 'landing' ? 'menu-cards menu-cards--landing' : 'menu-cards';
    var accordion = variant !== 'landing';

    return group(items).map(function (cat, index) {
      var body = '<div class="' + cardsClass + ' menu-cat-body">' +
        cat.items.map(function (item) { return card(item, variant); }).join('') +
        '</div>';

      if (!accordion) {
        return '' +
          '<section>' +
            '<div class="text-panel">' +
              '<h2 class="menu-category-title">' + escapeHtml(cat.category) + '</h2>' +
              body +
            '</div>' +
          '</section>';
      }

      return '' +
        '<section>' +
          '<div class="text-panel menu-category' + (categoryOpen(cat.category, index) ? '' : ' cat-closed') + '">' +
            accordionHead(cat.category, cat.items, index) +
            body +
          '</div>' +
        '</section>';
    }).join('');
  }

  function renderHighlights(items, names) {
    var byName = {};
    (items || []).forEach(function (item) { byName[item.name] = item; });

    return (names || []).map(function (name) {
      return byName[name];
    }).filter(Boolean).map(function (item) {
      var unavailable = !item.available;
      return '' +
        '<li class="menu-item' + (unavailable ? ' menu-item--unavailable' : '') + '">' +
          '<div class="menu-item-info">' +
            '<div class="menu-item-name">' + escapeHtml(item.name) +
              (unavailable ? ' <span class="menu-unavailable-badge">Unavailable</span>' : '') +
            '</div>' +
            '<div class="menu-item-desc">' + escapeHtml(item.description) + '</div>' +
          '</div>' +
          '<div class="menu-item-price">' + priceText(item.price) + '</div>' +
        '</li>';
    }).join('');
  }

  // Re-render every 30 seconds and whenever the tab is focused again.
  // A failed refresh is passed to `render` as (null, error) so the page
  // can show a friendly message instead of stale menu data.
  function watch(render) {
    var running = false;

    function run() {
      if (running) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

      running = true;
      load().then(function (items) {
        render(items, null);
      }).catch(function (err) {
        render(null, err || new Error('The menu could not be loaded.'));
      }).then(function () {
        running = false;
      });
    }

    run();
    window.setInterval(run, REFRESH_MS);
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'hidden') run();
    });

    return { refresh: run };
  }

  window.eqMenu = {
    load: load,
    group: group,
    imageSrc: imageSrc,
    priceText: priceText,
    renderSections: renderSections,
    renderHighlights: renderHighlights,
    cardFooter: cardFooter,
    bindAccordions: bindAccordions,
    watch: watch,
    escapeHtml: escapeHtml
  };
})();
