// ═══════════════════════════════════════════════════════════════
//  Contact page — "Why are you contacting us?" WhatsApp picker
//  The number is never written here: WHATSAPP_NUMBER in site.js
//  derives it from siteConfig.phoneIntl.
// ═══════════════════════════════════════════════════════════════

const WA_REASONS = [
  { key: 'order', label: 'I want to place an order', request: 'I would like to place an order.' },
  { key: 'reservation', label: 'I want to make a reservation', request: 'I would like to make a reservation.' },
  { key: 'order-question', label: 'I have a question about my order', request: 'I have a question about my order.' },
  { key: 'catering', label: 'Catering or events enquiry', request: 'I would like to ask about catering or an event.' },
  { key: 'feedback', label: 'Feedback or a complaint', request: 'I would like to share some feedback.' },
  { key: 'other', label: 'Something else', request: '' }
];

function waFindReason(key) {
  for (const reason of WA_REASONS) {
    if (reason.key === key) return reason;
  }
  return null;
}

// "Hello Ember & Quill, my name is Ada. I would like to place an order."
// The name clause drops out cleanly when the field is left empty.
function waMessage(reason, name, text) {
  const who = (name || '').trim();
  const hello = `Hello ${siteConfig.name}` + (who ? `, my name is ${who}.` : '.');

  if (reason.key === 'other') {
    const body = (text || '').trim();
    return body ? `${hello} ${body}` : hello;
  }
  return `${hello} ${reason.request}`;
}

function initWhatsAppPicker() {
  const group = document.getElementById('waReasons');
  const followup = document.getElementById('waFollowup');
  const nameInput = document.getElementById('waName');
  const messageField = document.getElementById('waMessageField');
  const messageInput = document.getElementById('waMessage');
  const continueBtn = document.getElementById('waContinue');
  const note = document.getElementById('waNote');

  if (!group || !followup || !continueBtn) return;

  group.innerHTML = WA_REASONS.map((reason) => `
    <label class="wa-reason">
      <input type="radio" name="waReason" value="${reason.key}">
      <span>${reason.label}</span>
    </label>
  `).join('');

  let selected = null;

  const refresh = () => {
    if (!selected) return;
    const text = waMessage(selected, nameInput.value, messageInput.value);
    continueBtn.href = getWhatsAppLink(text);
    const needsMessage = selected.key === 'other' && !messageInput.value.trim();
    continueBtn.classList.toggle('is-disabled', needsMessage);
    continueBtn.setAttribute('aria-disabled', needsMessage ? 'true' : 'false');
    if (note) note.hidden = !needsMessage;
  };

  group.addEventListener('change', (e) => {
    const input = e.target;
    if (!input || input.name !== 'waReason') return;
    selected = waFindReason(input.value);
    followup.hidden = !selected;
    if (messageField) messageField.hidden = !selected || selected.key !== 'other';
    refresh();
  });

  nameInput.addEventListener('input', refresh);
  messageInput.addEventListener('input', refresh);

  continueBtn.addEventListener('click', (e) => {
    if (!selected || continueBtn.classList.contains('is-disabled')) {
      e.preventDefault();
    }
  });

  // The link starts with no href at all: site.js only wires smooth-scroll
  // to links that say href="#", and this one must keep its own meaning.
  continueBtn.href = getWhatsAppLink(waMessage(WA_REASONS[0], '', ''));
}

// Runs while the page is still parsing (this script sits at the end of the
// body), so the link is set up before any DOMContentLoaded handler sees it.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWhatsAppPicker);
} else {
  initWhatsAppPicker();
}
