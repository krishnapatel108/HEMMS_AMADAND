// ═══════════════════════════════════════════════════════════════
//  HEMM Report — sheets-export.js
//  Google Sheets export via Apps Script
//  Apps Script URL loaded from Supabase config table (never hardcoded)
//  Depends: supabase-client.js (getConfig), config.js
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Apps Script URL (loaded at runtime, default to fallback) ──
let APPS_SCRIPT_URL = typeof FALLBACK_APPS_SCRIPT_URL !== 'undefined' ? FALLBACK_APPS_SCRIPT_URL : null;

// ── Retry Queue Constants ────────────────────────────────────
const SHEETS_QUEUE_KEY = 'hemm_sheets_retry_queue';
const SHEETS_MAX_RETRIES = 12;
const SHEETS_RETRY_INTERVAL_MS = 15000; // process queue every 15 seconds
const SHEETS_QUEUE_MAX_AGE_MS = 48 * 60 * 60 * 1000; // drop entries older than 48h
let _sheetsRetryTimer = null;

// ═══════════════════════════════════════════════════════════════
//  CONFIG LOADER
// ═══════════════════════════════════════════════════════════════

// Fetch the Apps Script deployment URL from the 'config' table
// Tries Supabase first, falls back to localStorage cache
async function loadSheetsConfig() {
  try {
    // Always load cached URL first so we have something immediately
    const cached = localStorage.getItem('hemm_apps_script_url') || (typeof FALLBACK_APPS_SCRIPT_URL !== 'undefined' ? FALLBACK_APPS_SCRIPT_URL : null);
    if (cached) APPS_SCRIPT_URL = cached;

    // Try to get fresh URL from Supabase (with 8s timeout for slow mobile)
    const configPromise = getConfig('apps_script_url');
    const timeoutPromise = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error('Config load timeout')); }, 8000);
    });

    const { data, error } = await Promise.race([configPromise, timeoutPromise]);
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

    // If the request failed for any reason, enqueue for retry
    if (!result.success) {
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
// Uses a simple fetch pattern with Content-Type: text/plain
// If fetch fails (network error, CORS redirect block, etc.), returns success: false
// so the report is reliably queued and retried by the background processor.
async function _postToAppsScript(payload) {
  if (!APPS_SCRIPT_URL) {
    return { success: false, error: 'No Apps Script URL configured' };
  }

  var body = JSON.stringify(payload);

  try {
    var response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: body,
    });

    // Try to parse Apps Script response
    try {
      var result = await response.json();
      if (result.ok === false || result.status === 'error') {
        return { success: false, error: result.message || result.error || 'Apps Script error' };
      }
      return { success: true, data: result };
    } catch (_) {
      // Response not readable (CORS blocks body) but request was sent
      // If HTTP status is OK, the request likely succeeded
      return { success: response.ok, data: null };
    }
  } catch (fetchErr) {
    console.error('_postToAppsScript fetch error:', fetchErr.message);
    return { success: false, error: fetchErr.message };
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

    if (result.success) {
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
