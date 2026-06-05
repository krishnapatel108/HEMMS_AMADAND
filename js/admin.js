// ═══════════════════════════════════════════════════════════════
//  HEMM Report — admin.js
//  Admin panel — restricted access controller
//  Depends on: config.js, utils.js, supabase-client.js, auth.js
// ═══════════════════════════════════════════════════════════════

'use strict';

/* ── State ─────────────────────────────────────────────────── */
let adminFilter      = 'all';
let adminReports     = [];
let adminCredentials = [];
let archiveData      = [];
let archiveSearchText = '';

/* ── Initialization ────────────────────────────────────────── */
async function initAdminPanel() {
  try {
    initSupabase();
    if (!isLoggedIn) return;

    await bootAdmin();
  } catch (err) {
    console.error('Admin init failed:', err);
  }
}

/* ── Boot Admin Panel ──────────────────────────────────────── */
async function bootAdmin() {
  const view = $('admin-view');
  if (view) view.classList.add('on');

  // Load all data in parallel
  await Promise.allSettled([
    loadCredentials(),
    loadAdminReports(),
    populateArchiveMonths()
  ]);
}

/* ═══════════════════════════════════════════════════════════════
   TABS
   ═══════════════════════════════════════════════════════════════ */
function switchAdminTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.admin-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });

  // Update panels
  document.querySelectorAll('.admin-panel').forEach(p => {
    p.classList.toggle('on', p.id === 'panel-' + tabName);
  });
}

/* ═══════════════════════════════════════════════════════════════
   CREDENTIALS TAB
   ═══════════════════════════════════════════════════════════════ */
async function loadCredentials() {
  try {
    if (typeof USE_LOCAL_MOCK !== 'undefined' && USE_LOCAL_MOCK) {
      const stored = localStorage.getItem('hemm_mock_staff_accounts');
      if (!stored) {
        // Initialize with default admin and engineer
        const defaultAccounts = [];
        localStorage.setItem('hemm_mock_staff_accounts', JSON.stringify(defaultAccounts));
        adminCredentials = defaultAccounts;
      } else {
        adminCredentials = JSON.parse(stored);
      }
      renderCredentialsList();
      return;
    }

    const { data, error } = await SB
      .from('staff_accounts')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    adminCredentials = data || [];
    renderCredentialsList();
  } catch (err) {
    console.error('Load credentials failed:', err);
    adminCredentials = [];
    renderCredentialsList();
  }
}

function renderCredentialsList() {
  const container = $('cred-list');
  if (!container) return;

  if (!adminCredentials.length) {
    container.innerHTML =
      '<div class="admin-empty">' +
        '<div class="admin-empty-icon">👤</div>' +
        'कोई credential नहीं मिला<br>No credentials found' +
      '</div>';
    return;
  }

  container.innerHTML = adminCredentials.map(cred => {
    const sid   = escapeHtml(cred.staff_id);
    const role  = escapeHtml(cred.role);
    const label = escapeHtml(cred.label || '');
    const date  = cred.created_at ? formatDateTime(cred.created_at) : '—';
    const roleClass = role === 'admin' ? 'admin' : 'engineer';
    const key = storeReport(cred);

    return (
      '<div class="cred-item" id="cred-' + sid + '">' +
        '<div class="cred-info">' +
          '<div class="cred-id">' + sid + '</div>' +
          '<div class="cred-label">' +
            (label ? label + ' · ' : '') + date +
          '</div>' +
        '</div>' +
        '<span class="cred-role-badge ' + roleClass + '">' +
          role.toUpperCase() +
        '</span>' +
        '<button class="cred-del-btn" onclick="confirmDeleteCred(\'' + sid + '\')" ' +
          'aria-label="Delete ' + sid + '" title="Delete">✕</button>' +
      '</div>'
    );
  }).join('');
}

async function addNewCredential() {
  const staffInput   = $('new-staff-id');
  const passInput    = $('new-password');
  const confirmInput = $('new-password-confirm');
  const roleSelect   = $('new-role');
  const labelInput   = $('new-label');
  const msgEl        = $('cred-add-msg');
  const addBtn       = $('cred-add-btn');

  if (!staffInput || !passInput || !confirmInput || !roleSelect) return;

  const staffId  = staffInput.value.trim();
  const password = passInput.value;
  const confirm  = confirmInput.value;
  const role     = roleSelect.value;
  const label    = labelInput ? labelInput.value.trim() : '';

  // Validation
  if (!staffId) {
    showCredMsg('Staff ID आवश्यक है — Staff ID is required', false);
    return;
  }

  if (password.length < 8) {
    showCredMsg('Password कम से कम 8 अक्षर — Minimum 8 characters', false);
    return;
  }

  if (password !== confirm) {
    showCredMsg('Password मेल नहीं खाता — Passwords do not match', false);
    return;
  }

  if (!['engineer', 'admin'].includes(role)) {
    showCredMsg('भूमिका चुनें — Select a role', false);
    return;
  }

  if (addBtn) addBtn.disabled = true;

  try {
    if (typeof USE_LOCAL_MOCK !== 'undefined' && USE_LOCAL_MOCK) {
      // Mock creation
      const stored = localStorage.getItem('hemm_mock_staff_accounts');
      const accounts = stored ? JSON.parse(stored) : [];
      
      // Check if already exists
      if (accounts.some(a => a.staff_id.toLowerCase() === staffId.toLowerCase())) {
        throw new Error('Staff ID already exists');
      }

      const newAccount = {
        staff_id: staffId,
        role: role,
        label: sanitizeText(label, 100),
        created_at: new Date().toISOString()
      };
      
      accounts.unshift(newAccount);
      localStorage.setItem('hemm_mock_staff_accounts', JSON.stringify(accounts));

      const mockPasswords = JSON.parse(localStorage.getItem('hemm_mock_passwords') || '{}');
      mockPasswords[staffId.toLowerCase()] = password;
      localStorage.setItem('hemm_mock_passwords', JSON.stringify(mockPasswords));

      showCredMsg('✅ Credential बनाया गया — Credential created successfully', true);

      // Clear form
      staffInput.value = '';
      passInput.value = '';
      confirmInput.value = '';
      if (labelInput) labelInput.value = '';

      // Reload list
      await loadCredentials();
      if (addBtn) addBtn.disabled = false;
      return;
    }

    // Create user in Supabase Auth
    const email = staffId + '@hemm.local';
    const { data: signUpData, error: signUpErr } = await SB.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { staff_id: staffId, role: role }
      }
    });

    if (signUpErr) throw signUpErr;

    // Insert into staff_accounts table
    const { error: insertErr } = await SB
      .from('staff_accounts')
      .insert({
        staff_id: staffId,
        role: role,
        label: sanitizeText(label, 100),
        auth_uid: signUpData?.user?.id || null
      });

    if (insertErr) throw insertErr;

    showCredMsg('✅ Credential बनाया गया — Credential created successfully', true);

    // Clear form
    staffInput.value = '';
    passInput.value = '';
    confirmInput.value = '';
    if (labelInput) labelInput.value = '';

    // Reload list
    await loadCredentials();

  } catch (err) {
    console.error('Add credential failed:', err);
    const msg = err.message || 'Unknown error';
    showCredMsg('❌ विफल — Failed: ' + escapeHtml(msg), false);
  }

  if (addBtn) addBtn.disabled = false;
}

function showCredMsg(msg, success) {
  const el = $('cred-add-msg');
  if (!el) return;
  el.className = 'admin-success-msg ' + (success ? 'ok' : 'err');
  el.innerHTML = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function confirmDeleteCred(staffId) {
  const modal    = $('admin-confirm-modal');
  const titleEl  = $('confirm-title');
  const textEl   = $('confirm-text');
  const okBtn    = $('confirm-ok-btn');

  if (!modal) return;

  const safe = escapeHtml(staffId);
  if (titleEl) titleEl.textContent = 'Delete Credential';
  if (textEl)  textEl.innerHTML =
    'क्या आप <b>' + safe + '</b> को हटाना चाहते हैं?<br>' +
    'Delete credential <b>' + safe + '</b>?';

  if (okBtn) {
    okBtn.onclick = () => {
      deleteCred(staffId);
      closeConfirmModal();
    };
  }

  modal.classList.remove('hidden');
}

function closeConfirmModal() {
  const modal = $('admin-confirm-modal');
  if (modal) modal.classList.add('hidden');
}

async function deleteCred(staffId) {
  try {
    if (typeof USE_LOCAL_MOCK !== 'undefined' && USE_LOCAL_MOCK) {
      const stored = localStorage.getItem('hemm_mock_staff_accounts');
      const accounts = stored ? JSON.parse(stored) : [];
      const filtered = accounts.filter(a => a.staff_id.toLowerCase() !== staffId.toLowerCase());
      localStorage.setItem('hemm_mock_staff_accounts', JSON.stringify(filtered));

      // Also clean up password
      const mockPasswords = JSON.parse(localStorage.getItem('hemm_mock_passwords') || '{}');
      delete mockPasswords[staffId.toLowerCase()];
      localStorage.setItem('hemm_mock_passwords', JSON.stringify(mockPasswords));

      showCredMsg('✅ Credential हटाया गया — Credential removed', true);
      await loadCredentials();
      return;
    }

    const { error } = await SB
      .from('staff_accounts')
      .delete()
      .eq('staff_id', staffId);

    if (error) throw error;

    showCredMsg('✅ Credential हटाया गया — Credential removed', true);
    await loadCredentials();
  } catch (err) {
    console.error('Delete credential failed:', err);
    showCredMsg('❌ हटाने में विफल — Delete failed', false);
  }
}

/* ═══════════════════════════════════════════════════════════════
   REPORTS TAB
   ═══════════════════════════════════════════════════════════════ */
async function loadAdminReports() {
  try {
    const data = await getReports();
    adminReports = data || [];
    renderAdminReports();
    updateAlertsBadge();
  } catch (err) {
    console.error('Load reports failed:', err);
    adminReports = [];
    renderAdminReports();
  }
}

function setAdminFilter(filterVal, btn) {
  adminFilter = filterVal;

  // Update button states
  document.querySelectorAll('.afb').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');

  renderAdminReports();
}

function renderAdminReports() {
  const container = $('admin-report-list');
  const countEl   = $('admin-report-count');
  if (!container) return;

  let filtered = adminReports;

  switch (adminFilter) {
    case 'pending':
      filtered = filtered.filter(r => r.status === 'pending');
      break;
    case 'reviewing':
      filtered = filtered.filter(r => r.status === 'reviewing');
      break;
    case 'resolved':
      filtered = filtered.filter(r => r.status === 'resolved');
      break;
    case 'unauthorized':
      filtered = filtered.filter(r => r.operator_auth === 'unauthorized');
      break;
    case 'authorized':
      filtered = filtered.filter(r => r.operator_auth === 'authorized');
      break;
  }

  if (countEl) {
    countEl.textContent = filtered.length + ' report' + (filtered.length !== 1 ? 's' : '');
  }

  if (!filtered.length) {
    container.innerHTML =
      '<div class="admin-empty">' +
        '<div class="admin-empty-icon">📋</div>' +
        'कोई रिपोर्ट नहीं मिली<br>No reports found' +
      '</div>';
    return;
  }

  container.innerHTML = filtered.map(r => buildAdminReportCard(r)).join('');
}

function buildAdminReportCard(r) {
  const doorNo  = escapeHtml(r.tipper_no || r.door_no);
  const machine = escapeHtml(r.machine);
  const status  = r.status || 'pending';
  const auth    = r.operator_auth || 'unknown';
  const time    = r.created_at ? formatDateTime(r.created_at) : '—';
  const opName  = escapeHtml(r.operator_name);
  const opId    = escapeHtml(r.operator_id || r.form_a_no);

  // Auth badge
  let authBadge = '';
  if (auth === 'authorized') {
    authBadge = '<span class="auth-badge auth-ok">✓ AUTHORIZED</span>';
  } else if (auth === 'unauthorized') {
    authBadge = '<span class="auth-badge auth-no">✕ UNAUTHORIZED</span>';
  } else {
    authBadge = '<span class="auth-badge auth-unk">? UNKNOWN</span>';
  }

  // Status pill
  const spClass = status === 'pending' ? 'sp-p' : status === 'reviewing' ? 'sp-r' : 'sp-d';
  const spLabel = status.charAt(0).toUpperCase() + status.slice(1);

  // Auth card class
  const cardClass = auth === 'unauthorized' ? ' unauthorized' : auth === 'authorized' ? ' authorized' : '';

  // Problems
  let problemsHtml = '';
  if (r.problems && r.problems.length) {
    const safe = Array.isArray(r.problems)
      ? r.problems.map(p => escapeHtml(p)).join(', ')
      : escapeHtml(r.problems);
    problemsHtml =
      '<div class="admin-rcard-problems">' +
        '⚠️ ' + safe +
      '</div>';
  }

  return (
    '<div class="admin-rcard' + cardClass + '">' +
      '<div class="admin-rcard-hdr">' +
        '<div>' +
          '<div class="admin-rcard-id">🚛 #' + doorNo + '</div>' +
          '<div class="admin-rcard-machine">' + machine + '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">' +
          authBadge +
          '<span class="spill ' + spClass + '">' + escapeHtml(spLabel) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="admin-rcard-body">' +
        '<div class="admin-rcard-row">' +
          '<span class="label">Operator</span> ' +
          (opName !== '—' ? opName : '') +
          (opId !== '—' ? ' (' + opId + ')' : '') +
        '</div>' +
        problemsHtml +
      '</div>' +
      '<div class="admin-rcard-time">' + escapeHtml(time) + '</div>' +
    '</div>'
  );
}

/* ═══════════════════════════════════════════════════════════════
   ALERTS TAB
   ═══════════════════════════════════════════════════════════════ */
function updateAlertsBadge() {
  const badge = $('alerts-badge');
  const count = adminReports.filter(r => r.operator_auth === 'unauthorized').length;
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
}

function renderAlerts() {
  const container = $('alerts-list');
  const countEl   = $('alerts-count');
  if (!container) return;

  const unauthorized = adminReports.filter(r => r.operator_auth === 'unauthorized');

  if (countEl) {
    countEl.innerHTML =
      '<span class="unauth-count-badge">' + unauthorized.length + '</span>' +
      ' अनधिकृत ऑपरेटर — Unauthorized operators';
  }

  if (!unauthorized.length) {
    container.innerHTML =
      '<div class="admin-empty">' +
        '<div class="admin-empty-icon">✅</div>' +
        'कोई अनधिकृत ऑपरेटर नहीं<br>No unauthorized operators found' +
      '</div>';
    return;
  }

  container.innerHTML = unauthorized.map(r => buildAdminReportCard(r)).join('');
}

/* ═══════════════════════════════════════════════════════════════
   ARCHIVE TAB
   ═══════════════════════════════════════════════════════════════ */
async function populateArchiveMonths() {
  try {
    const months = await getArchiveMonths();
    const select = $('archive-month-select');
    if (!select || !months) return;

    select.innerHTML =
      '<option value="">— महीना चुनें / Select Month —</option>' +
      months.map(m =>
        '<option value="' + escapeHtml(m) + '">' + escapeHtml(getMonthLabel(m)) + '</option>'
      ).join('');
  } catch (err) {
    console.error('Populate archive months failed:', err);
  }
}

async function loadArchiveMonth() {
  const select = $('archive-month-select');
  if (!select || !select.value) return;

  try {
    const data = await getArchivedReports(select.value);
    archiveData = data || [];
    archiveSearchText = '';
    const searchInput = $('archive-search');
    if (searchInput) searchInput.value = '';
    renderArchive();
  } catch (err) {
    console.error('Load archive failed:', err);
    archiveData = [];
    renderArchive();
  }
}

function filterArchive() {
  const searchInput = $('archive-search');
  archiveSearchText = searchInput ? searchInput.value.trim().toLowerCase() : '';
  renderArchive();
}

function renderArchive() {
  const container = $('archive-list');
  const statsEl   = $('archive-stats');
  const expBtn    = $('arc-export-btn');
  if (!container) return;

  let filtered = archiveData;
  if (expBtn) {
    expBtn.style.display = filtered.length ? 'block' : 'none';
  }

  if (archiveSearchText) {
    filtered = filtered.filter(r => {
      const tipperNo = (r.tipper_no || r.door_no || '').toLowerCase();
      const machine  = (r.machine || '').toLowerCase();
      const opName   = (r.operator_name || '').toLowerCase();
      return tipperNo.includes(archiveSearchText) ||
             machine.includes(archiveSearchText) ||
             opName.includes(archiveSearchText);
    });
  }

  // Stats
  if (statsEl) {
    const total = filtered.length;
    const auth  = filtered.filter(r => r.operator_auth === 'authorized').length;
    const unauth = filtered.filter(r => r.operator_auth === 'unauthorized').length;

    statsEl.innerHTML =
      '<div class="archive-stat-row">' +
        '<div class="archive-stat-box">' +
          '<div class="archive-stat-n total">' + total + '</div>' +
          '<div class="archive-stat-l">कुल / Total</div>' +
        '</div>' +
        '<div class="archive-stat-box">' +
          '<div class="archive-stat-n auth">' + auth + '</div>' +
          '<div class="archive-stat-l">अधिकृत / Auth</div>' +
        '</div>' +
        '<div class="archive-stat-box">' +
          '<div class="archive-stat-n unauth">' + unauth + '</div>' +
          '<div class="archive-stat-l">अनधिकृत / Unauth</div>' +
        '</div>' +
      '</div>';
  }

  if (!filtered.length) {
    container.innerHTML =
      '<div class="admin-empty">' +
        '<div class="admin-empty-icon">🗃️</div>' +
        'कोई संग्रहित रिपोर्ट नहीं<br>No archived reports' +
      '</div>';
    return;
  }

  container.innerHTML = filtered.map(r => buildAdminReportCard(r)).join('');
}

function exportArchiveToCSV() {
  if (!archiveData.length) {
    return;
  }

  const select = $('archive-month-select');
  const monthLabel = select && select.value ? getMonthLabel(select.value) : 'archive';

  const headers = [
    'Tipper No', 'Machine', 'Status', 'Operator Auth',
    'Operator Name', 'Operator ID', 'Problems', 'Created At'
  ];

  const rows = archiveData.map(r => [
    r.tipper_no || r.door_no || '',
    r.machine || '',
    r.status || '',
    r.operator_auth || '',
    r.operator_name || '',
    r.operator_id || r.form_a_no || '',
    Array.isArray(r.problems) ? r.problems.join('; ') : (r.problems || ''),
    r.created_at || ''
  ]);

  downloadCSV('HEMM_Archive_' + monthLabel.replace(/\s/g, '_') + '.csv', headers, rows);
}

/* ═══════════════════════════════════════════════════════════════
   EXIT
   ═══════════════════════════════════════════════════════════════ */
function exitAdmin() {
  window.location.href = 'dashboard.html';
}

/* ═══════════════════════════════════════════════════════════════
   TAB CLICK HANDLERS  (wired to onclick in HTML)
   Render tab-specific data when switching to it
   ═══════════════════════════════════════════════════════════════ */
function onTabSwitch(tabName) {
  switchAdminTab(tabName);

  switch (tabName) {
    case 'creds':
      renderCredentialsList();
      break;
    case 'reports':
      loadAdminReports();
      break;
    case 'alerts':
      loadAdminReports().then(() => renderAlerts());
      break;
    case 'archive':
      // Archive renders on month select
      break;
  }
}
