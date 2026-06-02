// ═══════════════════════════════════════════════════════════════
//  HEMM Report — dashboard.js
//  Engineer dashboard controller — loaded in dashboard.html
//  Depends on: config.js, utils.js, supabase-client.js, auth.js,
//              sheets-export.js
// ═══════════════════════════════════════════════════════════════

'use strict';

/* ── State ─────────────────────────────────────────────────── */
let allReports       = {}; // id -> report object
let engFilterVal     = 'all';
let engDateFilter    = 'today';
let showingGrid      = false;

/* ── Initialization ────────────────────────────────────────── */
let dashboardSub = null;

async function initDashboard() {
  try {
    initSupabase();
    if (!isLoggedIn) return;

    await bootDashboard();
  } catch (err) {
    console.error('Dashboard init failed:', err);
  }
}

function stopDashboard() {
  try {
    if (dashboardSub && typeof dashboardSub.unsubscribe === 'function') {
      dashboardSub.unsubscribe();
    }
  } catch (_) {}
  dashboardSub = null;
  allReports = {};
}

/* ── Boot Dashboard ────────────────────────────────────────── */
async function bootDashboard() {
  const view = $('eng-view');
  if (view) view.classList.add('on');

  // Update role badge
  const roleBadge = $('role-badge');
  if (roleBadge) {
    roleBadge.textContent = currentRole.toUpperCase();
  }

  // Load Sheets Config
  await loadSheetsConfig();

  // Load initial reports
  await fetchInitialReports();

  // Subscribe to real-time updates
  dashboardSub = subscribeReports(handleRealtimeChange);
}

// ═══════════════════════════════════════════════════════════════
//  AUTHENTICATION & LOGIN MODAL
// ═══════════════════════════════════════════════════════════════

function showLoginModal() {
  if (typeof showStaffLoginModal === 'function') {
    showStaffLoginModal();
  }
}

// ═══════════════════════════════════════════════════════════════
//  DATA LOADER & SUBSCRIPTION
// ═══════════════════════════════════════════════════════════════

async function fetchInitialReports() {
  try {
    const { data, error } = await getReports();
    if (error) throw error;

    allReports = {};
    if (data) {
      data.forEach(r => {
        allReports[r.id] = r;
      });
    }
    renderEng();
  } catch (err) {
    console.error('Fetch initial reports failed:', err);
  }
}

function handleRealtimeChange(eventType, newRecord, oldRecord) {
  try {
    if (typeof USE_LOCAL_MOCK !== 'undefined' && USE_LOCAL_MOCK) {
      // In local mock mode, reload all reports from localStorage
      fetchInitialReports();
      return;
    }
    if (eventType === 'DELETE') {
      if (oldRecord && oldRecord.id) {
        delete allReports[oldRecord.id];
      }
    } else if (eventType === 'INSERT' || eventType === 'UPDATE') {
      if (newRecord) {
        // If the report is archived, remove it from dashboard view
        if (newRecord.archived_at) {
          delete allReports[newRecord.id];
        } else {
          allReports[newRecord.id] = newRecord;
        }
      }
    }
    renderEng();
  } catch (err) {
    console.error('Real-time handler error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
//  RENDER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function renderEng() {
  const container = $('rlist');
  if (!container) return;

  const list = Object.values(allReports).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // 1. Calculate Stats (before applying date/status filters)
  calculateMetrics(list);

  // 2. Apply Date Filter
  let filtered = applyDateFilter(list);

  // 3. Apply status/machine filters
  filtered = applyGeneralFilters(filtered);

  // Update date count label
  const countLabel = $('date-count');
  if (countLabel) {
    countLabel.textContent = `${filtered.length} रिपोर्ट (Reports)`;
  }

  // 4. Render Grid vs List
  if (showingGrid) {
    $('grid-container').style.display = 'block';
    container.style.display = 'none';
    renderGrid(filtered);
  } else {
    $('grid-container').style.display = 'none';
    container.style.display = 'flex';
    renderList(filtered, container);
  }
}

function calculateMetrics(list) {
  let total = list.length;
  let pending = 0;
  let reviewing = 0;
  let resolved = 0;
  let newCount = 0;

  list.forEach(r => {
    if (r.status === 'pending') {
      pending++;
      newCount++;
    } else if (r.status === 'reviewing') {
      reviewing++;
    } else if (r.status === 'resolved') {
      resolved++;
    }
  });

  const tEl = $('st-total');
  const nEl = $('st-new');
  const rvEl = $('st-review');
  const rsEl = $('st-resolved');
  const badge = $('new-badge');

  if (tEl) tEl.textContent = total;
  if (nEl) nEl.textContent = pending;
  if (rvEl) rvEl.textContent = reviewing;
  if (rsEl) rsEl.textContent = resolved;

  if (badge) {
    badge.textContent = `${newCount} NEW`;
    badge.classList.toggle('hide', newCount === 0);
  }
}

function applyDateFilter(list) {
  return list.filter(r => {
    const date = new Date(r.created_at);
    switch (engDateFilter) {
      case 'today':
        return isToday(date);
      case 'week':
        return isThisWeek(date);
      case 'month':
        return isThisMonth(date);
      default:
        return true;
    }
  });
}

function applyGeneralFilters(list) {
  if (engFilterVal === 'all') return list;

  return list.filter(r => {
    if (['pending', 'reviewing', 'resolved'].includes(engFilterVal)) {
      return r.status === engFilterVal;
    }
    if (engFilterVal === 'authorized') {
      return r.operator_auth === 'authorized';
    }
    if (engFilterVal === 'unauthorized') {
      return r.operator_auth === 'unauthorized';
    }
    // Otherwise filter by machine ID
    return r.machine === engFilterVal;
  });
}

/* ── Render Cards List ─────────────────────────────────────── */
function renderList(list, container) {
  if (!list.length) {
    container.innerHTML = `
      <div class="empty-v">
        <div style="font-size:48px">📡</div>
        <div style="color:var(--mut);font-family:var(--b);font-size:16px">कोई सुरक्षा रिपोर्ट नहीं मिली (No reports)</div>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(r => {
    const id = r.id;
    const door = escapeHtml(r.tipper_no);
    const mach = escapeHtml(r.machine);
    const problems = Array.isArray(r.problems) ? r.problems : [];
    const note = escapeHtml(r.note || '');
    const time = formatDateTime(r.created_at);
    const auth = r.operator_auth || 'unknown';
    const status = r.status || 'pending';

    // Auth badge class & text
    let authClass = 'auth-unk';
    let authLabel = '? NOT VERIFIED';
    if (auth === 'authorized') {
      authClass = 'auth-ok';
      authLabel = '🛡️ VERIFIED';
    } else if (auth === 'unauthorized') {
      authClass = 'auth-no';
      authLabel = '⚠️ UNVERIFIED';
    }

    // Status pill class
    const spClass = status === 'pending' ? 'sp-p' : status === 'reviewing' ? 'sp-r' : 'sp-d';

    // Operator details button if auth data exists
    const hasDetails = auth === 'authorized' || r.operator_name || r.operator_form_a;
    const opDetailBtn = hasDetails 
      ? `<button class="op-detail-btn" onclick="showOpDetail('${id}')">👷 Operator</button>`
      : '';

    // Action button highlights
    const apActive = status === 'pending' ? 'active' : '';
    const arActive = status === 'reviewing' ? 'active' : '';
    const adActive = status === 'resolved' ? 'active' : '';

    // Problems tags HTML
    const problemTags = problems.map(p => `<span class="r-tag">⚠️ ${escapeHtml(p)}</span>`).join('');

    return `
      <div class="rcard ${auth}" id="card-${id}">
        <div class="rt">
          <div>
            <div class="r-id">🚛 #${door}</div>
            <div class="r-mach">${mach} Tipper</div>
          </div>
          <div class="r-right">
            <span class="auth-badge ${authClass}">${authLabel}</span>
            <span class="spill ${spClass}">${status.toUpperCase()}</span>
          </div>
        </div>
        
        <div class="r-tags">
          ${problemTags || '<span class="r-tag ok">✅ ठीक (No faults)</span>'}
        </div>

        ${note ? `<div class="r-note">📝 <i>"${note}"</i></div>` : ''}

        <div class="rt" style="margin-top: 12px; align-items: center; border-top: 1px solid var(--bdr); padding-top: 10px;">
          <div class="r-time">🕐 ${time}</div>
          <div class="act-row">
            ${opDetailBtn}
            <button class="ab ap ${apActive}" onclick="setSt('${id}', 'pending')" title="Pending">🟠</button>
            <button class="ab ar ${arActive}" onclick="setSt('${id}', 'reviewing')" title="Reviewing">🟡</button>
            <button class="ab ad ${adActive}" onclick="setSt('${id}', 'resolved')" title="Resolved & Archive">🟢</button>
            ${isAdmin() ? `<button class="del-btn" onclick="delReport('${id}')" title="Delete Report">🗑️</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ── Render Safety Matrix Grid ──────────────────────────────── */
function renderGrid(list) {
  const table = $('safety-grid');
  if (!table) return;

  if (!list.length) {
    table.innerHTML = '<tr><td style="padding:20px;color:var(--mut);">No data to build grid</td></tr>';
    return;
  }

  // Get unique door numbers as rows
  const doorMap = {};
  list.forEach(r => {
    const door = r.tipper_no;
    if (!doorMap[door]) doorMap[door] = { machine: r.machine, issues: new Set() };
    if (r.problems && Array.isArray(r.problems)) {
      r.problems.forEach(p => doorMap[door].issues.add(p));
    }
  });

  const doors = Object.keys(doorMap).sort((a, b) => a - b);

  // Column Headers (DGMS features list)
  let headHtml = '<tr><th>Tipper #</th><th>Brand</th>';
  DGMS.forEach(f => {
    headHtml += `<th class="feat-th" title="${escapeHtml(f.e)}">${escapeHtml(f.i)}<br><span style="font-size:9px">${escapeHtml(f.e.slice(0, 8))}</span></th>`;
  });
  headHtml += '</tr>';

  // Table Body Rows
  let bodyHtml = '';
  doors.forEach(door => {
    const info = doorMap[door];
    let rowHtml = `<tr><td class="door-cell">#${escapeHtml(door)}</td><td style="font-family:var(--cd);font-size:11px;color:var(--mut);">${escapeHtml(info.machine)}</td>`;
    
    DGMS.forEach(f => {
      const hasIssue = info.issues.has(f.h);
      const cellClass = hasIssue ? 'feature-cell has-issue' : 'feature-cell';
      const cellVal = hasIssue ? '⚠️' : '✅';
      rowHtml += `<td class="${cellClass}">${cellVal}</td>`;
    });
    
    rowHtml += '</tr>';
    bodyHtml += rowHtml;
  });

  table.innerHTML = `<thead>${headHtml}</thead><tbody>${bodyHtml}</tbody>`;
}

// ═══════════════════════════════════════════════════════════════
//  STATUS & RECORD MANAGEMENT
// ═══════════════════════════════════════════════════════════════

async function setSt(reportId, newStatus) {
  if (!isLoggedIn) {
    showLoginModal();
    return;
  }

  const originalReport = allReports[reportId];
  if (!originalReport) return;

  try {
    // 1. If resolved, archive it
    if (newStatus === 'resolved') {
      const monthKey = getMonthKey(new Date());
      // Update locally first for snappiness
      delete allReports[reportId];
      renderEng();

      const { error } = await archiveReport(reportId, monthKey);
      if (error) throw error;
    } else {
      // Normal status update
      const { error } = await updateReportStatus(reportId, newStatus);
      if (error) throw error;
    }

    // 2. Propagate status change to Sheets (in background)
    try {
      updateStatusInSheet(reportId, newStatus);
    } catch (_) {}

  } catch (err) {
    console.error('Update status failed:', err);
    alert('त्रुटि — स्टेटस अपडेट विफल रहा (Update failed)');
    // Restore report on failure
    allReports[reportId] = originalReport;
    renderEng();
  }
}

async function delReport(reportId) {
  if (!isLoggedIn) {
    showLoginModal();
    return;
  }

  if (!isAdmin()) {
    alert('केवल व्यवस्थापक ही डिलीट कर सकते हैं (Admin only)');
    return;
  }

  if (!confirm('क्या आप सच में इस रिपोर्ट को स्थायी रूप से हटाना चाहते हैं?\nAre you sure you want to delete this report?')) {
    return;
  }

  const originalReport = allReports[reportId];
  delete allReports[reportId];
  renderEng();

  try {
    const { error } = await deleteReport(reportId);
    if (error) throw error;
  } catch (err) {
    console.error('Delete failed:', err);
    alert('हटाने में विफलता (Delete failed)');
    // Restore
    allReports[reportId] = originalReport;
    renderEng();
  }
}

// ═══════════════════════════════════════════════════════════════
//  OPERATOR DETAIL MODAL
// ═══════════════════════════════════════════════════════════════

function showOpDetail(reportId) {
  const r = allReports[reportId];
  if (!r) return;

  const modal = $('op-modal');
  const body  = $('op-modal-body');
  if (!modal || !body) return;

  const name   = escapeHtml(r.operator_name || '—');
  const formA  = escapeHtml(r.operator_form_a || '—');
  const dob    = r.operator_dob || '—'; // DOB format verification
  const desig  = escapeHtml(r.operator_designation || '—');
  const note   = escapeHtml(r.note || '—');
  const auth   = r.operator_auth || 'unknown';

  let authBanner = '';
  if (auth === 'authorized') {
    authBanner = '<div class="op-auth-banner ok">🛡️ सत्यापित ऑपरेटर — Verified Operator</div>';
  } else if (auth === 'unauthorized') {
    authBanner = '<div class="op-auth-banner no">⚠️ असत्यापित ऑपरेटर — Verification Failed</div>';
  } else {
    authBanner = '<div class="op-auth-banner unk">❔ सत्यापन नहीं किया गया — Not Verified</div>';
  }

  body.innerHTML = `
    ${authBanner}
    <div class="op-field">
      <div class="op-field-lbl">नाम / Name</div>
      <div class="op-field-val">${name}</div>
    </div>
    <div style="display:flex; gap:16px;">
      <div class="op-field" style="flex:1;">
        <div class="op-field-lbl">Form A #</div>
        <div class="op-field-val">${formA}</div>
      </div>
      <div class="op-field" style="flex:1;">
        <div class="op-field-lbl">जन्मतिथि / DOB</div>
        <div class="op-field-val">${dob}</div>
      </div>
    </div>
    <div class="op-field">
      <div class="op-field-lbl">पद / Designation</div>
      <div class="op-field-val">${desig}</div>
    </div>
    <div class="op-field">
      <div class="op-field-lbl">मशीन विवरण / Machine Details</div>
      <div class="op-field-val">${escapeHtml(r.machine)} Tipper (Door #${escapeHtml(r.tipper_no)})</div>
    </div>
    <div class="op-field">
      <div class="op-field-lbl">अतिरिक्त नोट / Note</div>
      <div class="op-field-val" style="font-size:13px; font-style:italic;">"${note}"</div>
    </div>
  `;

  modal.classList.remove('hidden');
}

function closeOpModal(event) {
  // If event is provided and clicked target is overlay itself, or if called with no arguments
  if (!event || event.target === $('op-modal')) {
    const modal = $('op-modal');
    if (modal) modal.classList.add('hidden');
  }
}

// ═══════════════════════════════════════════════════════════════
//  FILTERS & ACTIONS
// ═══════════════════════════════════════════════════════════════

function setFilter(filterVal, btn) {
  engFilterVal = filterVal;
  
  // Highlight clicked button
  const row = $('filt-row');
  if (row) {
    row.querySelectorAll('.fb').forEach(b => b.classList.remove('fa'));
  }
  if (btn) btn.classList.add('fa');

  renderEng();
}

function setDateFilter(period, btn) {
  engDateFilter = period;

  // Highlight date button
  const row = document.querySelector('.date-filt-row');
  if (row) {
    row.querySelectorAll('.fb').forEach(b => b.classList.remove('fa'));
  }
  if (btn) btn.classList.add('fa');

  renderEng();
}

function toggleGridView() {
  showingGrid = !showingGrid;
  const btn = $('grid-toggle-btn');
  if (btn) {
    btn.classList.toggle('active', showingGrid);
  }
  renderEng();
}

async function exportToSheetsBtn() {
  const btn = $('sheets-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Sending…';
  }

  // Get active reports based on current filters
  const list = Object.values(allReports).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  let filtered = applyDateFilter(list);
  filtered = applyGeneralFilters(filtered);

  if (!filtered.length) {
    alert('निर्यात के लिए कोई रिपोर्ट नहीं है। (No reports to export)');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '📋 Sheets';
    }
    return;
  }

  try {
    const result = await exportToSheets(filtered);
    if (result && result.success) {
      alert('सफलतापूर्वक Google Sheets पर भेजा गया! (Sent to Google Sheets)');
    } else {
      throw new Error(result ? result.error : 'Network error');
    }
  } catch (err) {
    console.error('Sheets export failed:', err);
    alert('भेजने में विफलता: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '📋 Sheets';
    }
  }
}

async function exitEng() {
  await signOut();
  window.location.href = 'index.html';
}
