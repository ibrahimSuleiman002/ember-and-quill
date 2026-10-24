// ═══════════════════════════════════════════════════════════════
//  Shared nav/footer renderer + brand helper for all pages
// ═══════════════════════════════════════════════════════════════

function renderNav(activePage) {
  const pages = [
    { href: 'index.html', label: 'Home', key: 'home' },
    { href: 'about.html', label: 'About', key: 'about' },
    { href: 'menu.html', label: 'Menu', key: 'menu' },
    { href: 'gallery.html', label: 'Gallery', key: 'gallery' },
    { href: 'reservations.html', label: 'Reservations', key: 'reservations' },
    { href: 'contact.html', label: 'Contact', key: 'contact' }
  ];

  const linksHTML = pages.map(p =>
    `<li><a href="${p.href}" class="${p.key === activePage ? 'active' : ''}">${p.label}</a></li>`
  ).join('');

  return `
    <nav id="navbar">
      <a href="index.html" class="nav-logo" id="navLogo"></a>
      <button class="hamburger" id="hamburger" aria-label="Toggle menu" aria-expanded="false">
        <span></span>
        <span></span>
        <span></span>
      </button>
      <ul class="nav-links" id="navLinks">
        ${linksHTML}
        <li><a href="order.html" class="nav-order">Order Online</a></li>
        <li><a href="reservations.html" class="nav-reserve">Reserve</a></li>
      </ul>
    </nav>
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

  // Hamburger
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      navLinks.classList.toggle('active');
      const expanded = hamburger.getAttribute('aria-expanded') === 'true';
      hamburger.setAttribute('aria-expanded', String(!expanded));
    });
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('active');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }
}

function fmtPrice(n) {
  return siteConfig.currency + n.toLocaleString('en-NG');
}

function getWhatsAppLink(message) {
  const waNumber = siteConfig.phoneIntl.replace('+', '');
  const msg = message || "Hello, I'd like to place an order.";
  return `https://wa.me/${waNumber}?text=${encodeURIComponent(msg)}`;
}

function renderCallButtons() {
  const callHTML = `Call ${siteConfig.phone}`;
  const waHTML = `WhatsApp ${siteConfig.phone}`;
  const telHref = `tel:${siteConfig.phoneIntl}`;
  const waNumber = siteConfig.phoneIntl.replace('+', '');

  const btn = (id, href, text, cls) => {
    const el = document.getElementById(id);
    if (el) { el.href = href; el.textContent = text; }
  };

  btn('callBtn1', telHref, callHTML);
  btn('waBtn1', `https://wa.me/${waNumber}`, waHTML);
  btn('callBtn2', telHref, callHTML);
  btn('waBtn2', `https://wa.me/${waNumber}`, waHTML);
  btn('callBtn3', telHref, callHTML);
  btn('waBtn3', `https://wa.me/${waNumber}`, waHTML);
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
