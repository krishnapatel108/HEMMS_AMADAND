// ═══════════════════════════════════════════════════════════════
//  HEMM Report — utils.js
//  Shared utility functions — security, validation, formatting
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── XSS Protection ───────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '—';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Input Validation ─────────────────────────────────────────
function sanitizeText(str, maxLen) {
  if (!str) return '';
  return String(str).trim().substring(0, maxLen || 300);
}

function isValidTipperNo(no) {
  return typeof no === 'string' && /^[0-9]{1,5}$/.test(no);
}

function isValidMachine(m) {
  return MACHINES.some(mach => mach.id === m);
}

function isValidDOB(ddmmyyyy) {
  if (!ddmmyyyy || ddmmyyyy.length !== 8) return false;
  return /^[0-9]{8}$/.test(ddmmyyyy);
}

function isValidFormA(fa) {
  if (!fa) return false;
  // Allow alphanumeric + slash (e.g. "125", "511/A")
  return /^[a-zA-Z0-9/\s]{1,20}$/.test(fa.trim());
}

function isValidStatus(s) {
  return ['pending', 'reviewing', 'resolved'].includes(s);
}

// ── Date Parsing ─────────────────────────────────────────────
function parseDOB(ddmmyyyy) {
  if (!isValidDOB(ddmmyyyy)) return null;
  const dd = ddmmyyyy.slice(0, 2);
  const mm = ddmmyyyy.slice(2, 4);
  const yyyy = ddmmyyyy.slice(4, 8);
  return `${yyyy}-${mm}-${dd}`;
}

// ── Date Formatting ──────────────────────────────────────────
function formatDateTime(isoStr) {
  try {
    return new Date(isoStr).toLocaleString('en-IN', {
      dateStyle: 'medium', timeStyle: 'short'
    });
  } catch (_) {
    return '—';
  }
}

function formatDateShort(isoStr) {
  try {
    return new Date(isoStr).toLocaleDateString('en-IN', { dateStyle: 'medium' });
  } catch (_) {
    return '—';
  }
}

function getMonthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthLabel(monthKey) {
  const [y, m] = monthKey.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

// ── Date Filter Helpers ──────────────────────────────────────
function isToday(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function isThisWeek(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  return d >= startOfWeek;
}

function isThisMonth(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

// ── Rate Limiter ─────────────────────────────────────────────
const _submitLog = [];
function canSubmitReport() {
  const now = Date.now();
  while (_submitLog.length && now - _submitLog[0] > RATE_LIMIT_WINDOW_MS) {
    _submitLog.shift();
  }
  if (_submitLog.length >= RATE_LIMIT_MAX) return false;
  _submitLog.push(now);
  return true;
}

// ── Debounce / Throttle ──────────────────────────────────────
function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

function throttle(fn, ms) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn.apply(this, args);
    }
  };
}

// ── Safe Report Store (avoids JSON in onclick — XSS) ─────────
const _reportStore = new Map();
let _reportStoreIdx = 0;
function storeReport(r) {
  const key = 'r_' + (_reportStoreIdx++);
  _reportStore.set(key, r);
  return key;
}
function getStoredReport(key) {
  return _reportStore.get(key) || {};
}

// ── UUID v4 generator (fallback if crypto not available) ─────
function uuid4() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Disable console in production ────────────────────────────
function disableConsole() {
  const noop = () => {};
  console.log = noop;
  console.warn = noop;
  console.info = noop;
  // Keep console.error for critical failures
}

// ── CSV Export Helper ────────────────────────────────────────
function downloadCSV(filename, headers, rows) {
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell =>
      '"' + String(cell || '').replace(/"/g, '""') + '"'
    ).join(','))
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
