// ═══════════════════════════════════════════════════════════════
//  tracking-code.js — shared customer tracking helpers
//  Generates the 16-character code shown after an order or
//  reservation, normalises it for the track form, and copies it
//  to the clipboard.
// ═══════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  // No I, O, 0 or 1 — easier to read out over the phone.
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function generateTrackingCode() {
    var bytes = new Uint8Array(16);

    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      global.crypto.getRandomValues(bytes);
    } else {
      // Extremely old browsers only; every current browser has Web Crypto.
      for (var b = 0; b < bytes.length; b++) {
        bytes[b] = Math.floor(Math.random() * 256);
      }
    }

    var raw = '';
    for (var i = 0; i < bytes.length; i++) {
      raw += ALPHABET.charAt(bytes[i] % ALPHABET.length);
    }

    return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' +
      raw.slice(8, 12) + '-' + raw.slice(12, 16);
  }

  function normalizeTrackingCode(value) {
    var clean = String(value == null ? '' : value)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 16);

    return clean.replace(/(.{4})(?=.)/g, '$1-');
  }

  function copyToClipboard(text) {
    if (global.navigator && navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();

      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }

      document.body.removeChild(area);
      if (ok) resolve();
      else reject(new Error('Copy failed'));
    });
  }

  global.generateTrackingCode = generateTrackingCode;
  global.normalizeTrackingCode = normalizeTrackingCode;
  global.copyToClipboard = copyToClipboard;
})(window);
