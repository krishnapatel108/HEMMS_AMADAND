// ═══════════════════════════════════════════════════════════════
//  HEMM Report — sheets-export.js
//  Google Sheets export via Apps Script
//  Apps Script URL loaded from Supabase config table (never hardcoded)
//  Depends: supabase-client.js (getConfig), config.js
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Apps Script URL (loaded at runtime) ──────────────────────
let APPS_SCRIPT_URL = null;

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
  try {
    let finalId = reportIdOrReport;
    let finalReport = report;

    if (typeof reportIdOrReport === 'object' && reportIdOrReport !== null && !report) {
      finalReport = reportIdOrReport;
      finalId = reportIdOrReport.id || reportIdOrReport.firebaseKey || '';
    }

    if (!APPS_SCRIPT_URL) {
      const loaded = await loadSheetsConfig();
      if (!loaded) return { success: false, error: 'Apps Script URL not configured' };
    }

    const payload = {
      mode: 'append',
      firebaseKey: finalId,
      report: _formatReportForSheet(finalReport),
    };

    return await _postToAppsScript(payload);
  } catch (err) {
    console.error('appendReportToSheet:', err);
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
async function _postToAppsScript(payload) {
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      mode: 'no-cors',
    });

    // Apps Script with no-cors returns opaque response
    // We treat a completed fetch as success
    // For CORS-enabled deployments, parse the response:
    if (response.type !== 'opaque') {
      try {
        const result = await response.json();
        if (result.status === 'error') {
          return { success: false, error: result.message || 'Apps Script error' };
        }
        return { success: true, data: result };
      } catch (_) {
        // Non-JSON response but request completed
      }
    }

    return { success: true, data: null };
  } catch (err) {
    console.error('_postToAppsScript:', err);
    return { success: false, error: err.message };
  }
}
