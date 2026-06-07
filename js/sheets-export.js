// ═══════════════════════════════════════════════════════════════
//  HEMM Report — sheets-export.js
//  Google Sheets export via Apps Script
//  Apps Script URL loaded from Supabase config table (never hardcoded)
//  Depends: supabase-client.js (getConfig), config.js
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Apps Script URL (loaded at runtime) ──────────────────────
let APPS_SCRIPT_URL = null;

// ── Retry Queue Constants ────────────────────────────────────
const SHEETS_QUEUE_KEY = 'hemm_sheets_retry_queue';
const SHEETS_MAX_RETRIES = 8;
const SHEETS_RETRY_INTERVAL_MS = 20000; // process queue every 20 seconds
const SHEETS_QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // drop entries older than 24h
let _sheetsRetryTimer = null;

// ═══════════════════════════════════════════════════════════════
//  CONFIG LOADER
// ═══════════════════════════════════════════════════════════════

// Fetch the Apps Script deployment URL from the 'config' table
async function loadSheetsConfig() {
  try {
    // Try localStorage fallback first in case we're offline
    APPS_SCRIPT_URL = localStorage.getItem('hemm_apps_script_url');

    const { data, error } = await getConfig('apps_script_url');
    if (error) {
      console.warn('loadSheetsConfig Supabase error:', error.message);
      return !!APPS_SCRIPT_URL; // Return true if we have a cached URL
    }
    if (data && data.value) {
      APPS_SCRIPT_URL = data.value;
      localStorage.setItem('hemm_apps_script_url', APPS_SCRIPT_URL);
      return true;
    }
    return !!APPS_SCRIPT_URL;
  } catch (err) {
    console.warn('loadSheetsConfig catch:', err);
    return !!APPS_SCRIPT_URL;
  }
}

// ═══════════════════════════════════════════════════════════════
//  SINGLE REPORT — APPEND
// ═══════════════════════════════════════════════════════════════

// Append a single report to Google Sheets (called after operator submits)
// Supports both signature (reportId, report) and (report)
async function appendReportToSheet(reportIdOrReport, report) {
  let payload = null;
  try {
    let finalId = reportIdOrReport;
    let finalReport = report;

    if (typeof reportIdOrReport === 'object' && reportIdOrReport !== null && !report) {
      finalReport = reportIdOrReport;
      finalId = reportIdOrReport.id || reportIdOrReport.firebaseKey || '';
    }

    payload = {
      mode: 'append',
      firebaseKey: finalId,
      report: _formatReportForSheet(finalReport),
    };

    if (!APPS_SCRIPT_URL) {
      const loaded = await loadSheetsConfig();
      if (!loaded) {
        // URL not available — enqueue for automatic retry later
        _enqueueForRetry(payload);
        return { success: false, error: 'Apps Script URL not configured — queued for retry' };
      }
    }

    const result = await _postToAppsScript(payload);

    // If the request definitively failed (not opaque), enqueue for retry
    if (!result.success && !result.opaque) {
      _enqueueForRetry(payload);
    }

    return result;
  } catch (err) {
    console.error('appendReportToSheet:', err);
    // Enqueue for automatic retry on any exception
    if (payload) _enqueueForRetry(payload);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  BULK EXPORT — UPSERT
// ═══════════════════════════════════════════════════════════════

// Upsert multiple reports to Google Sheets (add new, update existing)
async function upsertReportsToSheet(reports) {
  try {
    if (!APPS_SCRIPT_URL) {
      const loaded = await loadSheetsConfig();
      if (!loaded) return { success: false, error: 'Apps Script URL not configured' };
    }

    const formatted = reports.map(r => ({
      ..._formatReportForSheet(r),
      firebaseKey: r.id || r.firebaseKey || '',
    }));

    const payload = {
      mode: 'upsert',
      reports: formatted,
    };

    return await _postToAppsScript(payload);
  } catch (err) {
    console.error('upsertReportsToSheet:', err);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  STATUS UPDATE
// ═══════════════════════════════════════════════════════════════

// Update only the status column for a specific report in the sheet
async function updateStatusInSheet(reportId, status) {
  try {
    if (!APPS_SCRIPT_URL) {
      const loaded = await loadSheetsConfig();
      if (!loaded) return { success: false, error: 'Apps Script URL not configured' };
    }

    const payload = {
      mode: 'update_status',
      firebaseKey: reportId,
      status: (status || 'pending').toUpperCase(),
      updatedAt: new Date().toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    };

    return await _postToAppsScript(payload);
  } catch (err) {
    console.error('updateStatusInSheet:', err);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  CONVENIENCE — Export All
// ═══════════════════════════════════════════════════════════════

// Export an array of reports to Google Sheets via upsert
async function exportToSheets(reports) {
  if (!reports || !reports.length) {
    return { success: false, error: 'No reports to export' };
  }
  return await upsertReportsToSheet(reports);
}

// ═══════════════════════════════════════════════════════════════
//  INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════

// Format a report object for the Apps Script payload
// Matches APPSSCRIPT.txt column layout expectations:
//   machine, tipperNo, problems (comma-separated Hindi names),
//   note, status, time, operatorName, operatorFormA, operatorAuth
function _formatReportForSheet(r) {
  // Build comma-separated problems string from the features array
  let problems = '';
  if (Array.isArray(r.problems)) {
    problems = r.problems.join(', ');
  } else if (typeof r.problems === 'string') {
    problems = r.problems;
  }

  return {
    machine:       r.machine || '—',
    tipperNo:      r.tipper_no || r.tipperNo || '—',
    problems:      problems,
    note:          r.note || '',
    status:        r.status || 'pending',
    time:          r.created_at || r.time || new Date().toISOString(),
    operatorName:  r.operator_name || r.operatorName || '—',
    operatorFormA: r.operator_form_a || r.operatorFormA || '—',
    operatorAuth:  r.operator_auth || r.operatorAuth || 'unknown',
    firebaseKey:   r.id || r.firebaseKey || '',
  };
}

// POST JSON payload to the Apps Script endpoint
// Strategy: try CORS mode first (can detect server errors), fall back to no-cors
async function _postToAppsScript(payload) {
  if (!APPS_SCRIPT_URL) {
    return { success: false, error: 'No Apps Script URL configured' };
  }

  const body = JSON.stringify(payload);

  // ── Attempt 1: CORS mode (full error visibility) ───────────
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
    });

    try {
      const result = await response.json();
      if (result.ok === false || result.status === 'error') {
        return { success: false, error: result.message || result.error || 'Apps Script error' };
      }
      return { success: true, data: result };
    } catch (_) {
      // Non-JSON response — treat HTTP status as indicator
      return { success: response.ok, data: null };
    }
  } catch (corsErr) {
    // ── Attempt 2: no-cors fallback (request goes through but response is opaque) ──
    try {
      await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body,
        mode: 'no-cors',
      });
      // Request was sent — response is opaque so we assume success
      return { success: true, data: null, opaque: true };
    } catch (networkErr) {
      // True network failure (offline, DNS error, etc.)
      console.error('_postToAppsScript network failure:', networkErr);
      return { success: false, error: networkErr.message };
    }
  }
}


// ═══════════════════════════════════════════════════════════════
//  RETRY QUEUE — Persistent automatic retry for failed syncs
//  Uses localStorage so pending retries survive page refresh
// ═══════════════════════════════════════════════════════════════

function _getRetryQueue() {
  try {
    return JSON.parse(localStorage.getItem(SHEETS_QUEUE_KEY) || '[]');
  } catch (_) {
    return [];
  }
}

function _saveRetryQueue(queue) {
  try {
    localStorage.setItem(SHEETS_QUEUE_KEY, JSON.stringify(queue));
  } catch (_) {}
}

function _enqueueForRetry(payload) {
  const queue = _getRetryQueue();

  // Deduplicate by firebaseKey to avoid sending same report twice
  const key = payload.firebaseKey || (payload.report && payload.report.firebaseKey) || '';
  if (key) {
    const exists = queue.some(item => {
      const ik = item.payload.firebaseKey || (item.payload.report && item.payload.report.firebaseKey) || '';
      return ik === key;
    });
    if (exists) return;
  }

  queue.push({
    payload: payload,
    retries: 0,
    addedAt: Date.now(),
    lastAttempt: 0,
  });
  _saveRetryQueue(queue);
  console.log('[Sheets Queue] Enqueued for retry. Queue size:', queue.length);
}

async function _processRetryQueue() {
  if (!navigator.onLine) return;

  // Ensure URL is loaded before processing
  if (!APPS_SCRIPT_URL) {
    const loaded = await loadSheetsConfig();
    if (!loaded) return;
  }

  const queue = _getRetryQueue();
  if (!queue.length) return;

  const now = Date.now();
  const remaining = [];
  let processed = 0;

  for (const item of queue) {
    // Drop items older than 24 hours
    if (now - item.addedAt > SHEETS_QUEUE_MAX_AGE_MS) {
      console.warn('[Sheets Queue] Dropping expired item:', item.payload.firebaseKey);
      continue;
    }

    // Exponential backoff: 3s, 6s, 12s, 24s, 48s, 96s, 3min, 5min
    const backoffMs = Math.min(3000 * Math.pow(2, item.retries), 300000);
    if (item.lastAttempt && (now - item.lastAttempt) < backoffMs) {
      remaining.push(item);
      continue;
    }

    const result = await _postToAppsScript(item.payload);

    if (result.success || result.opaque) {
      console.log('[Sheets Queue] Retry succeeded for:', item.payload.firebaseKey);
      processed++;
    } else {
      item.retries++;
      item.lastAttempt = now;
      if (item.retries < SHEETS_MAX_RETRIES) {
        remaining.push(item);
        console.warn('[Sheets Queue] Retry #' + item.retries + ' failed for:', item.payload.firebaseKey);
      } else {
        console.error('[Sheets Queue] Max retries reached, dropping:', item.payload.firebaseKey);
      }
    }
  }

  _saveRetryQueue(remaining);
  if (processed > 0) {
    console.log('[Sheets Queue] Processed ' + processed + ' items. Remaining:', remaining.length);
  }
}

// Start the background retry processor
function startSheetsRetryProcessor() {
  if (_sheetsRetryTimer) return;

  // Process any pending items shortly after startup
  setTimeout(function() { _processRetryQueue(); }, 3000);

  // Then check the queue periodically
  _sheetsRetryTimer = setInterval(_processRetryQueue, SHEETS_RETRY_INTERVAL_MS);

  // Also process when the device comes back online
  window.addEventListener('online', function() {
    setTimeout(function() { _processRetryQueue(); }, 2000);
  });
}
