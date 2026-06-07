// ═══════════════════════════════════════════════════════════════
//  HEMM Report — operator.js
//  Main operator reporting flow — loaded last in index.html
//  Depends: config.js, utils.js, supabase-client.js, auth.js,
//           sheets-export.js
// ═══════════════════════════════════════════════════════════════

'use strict';

/* ── STATE ────────────────────────────────────────────────── */
let machine      = '';
let tipperNo     = '';
let selFeat      = new Set();
let isListening  = false;
let recognition  = null;
let lastReport   = null;
let opAuthTries  = 0;
let opAuthData   = null;
let waNumber     = '';

/* ── CACHED DOM ELEMENTS ──────────────────────────────────── */
const $ = id => document.getElementById(id);

/* ── INIT ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // 2. Supabase
    if (typeof initSupabase === 'function') await initSupabase();

    // 2b. Pre-load Google Sheets config URL so it's ready before any report submit
    if (typeof loadSheetsConfig === 'function') {
      loadSheetsConfig().then(() => {
        if (typeof startSheetsRetryProcessor === 'function') startSheetsRetryProcessor();
      }).catch(() => {});
    }

    // 3. Auth — restore staff or operator session
    if (typeof initAuth === 'function') {
      const authRes = await initAuth();
      if (authRes && authRes.success && (authRes.role === 'engineer' || authRes.role === 'admin')) {
        // Staff member already logged in — load dashboard directly
        if (typeof initDashboard === 'function') await initDashboard();
        if (typeof initAdminPanel === 'function') await initAdminPanel();
        
        buildFeatureGrid();
        buildMachineList();
        loadWANumber();
        updateConnDot();
        
        goTo('s-dashboard');
        
        setTimeout(() => {
          const ls = $('load-screen');
          if (ls) ls.classList.add('hide');
        }, 400);
        return;
      }
    }

    // Default to operator login
    if (typeof signInAnonymous === 'function' &&
        typeof isLoggedIn !== 'undefined' && !isLoggedIn) {
      await signInAnonymous();
    }

    // 4. Connection dot
    updateConnDot();

    // 5. Load WhatsApp number from config
    loadWANumber();

    // 6. Build feature grid
    buildFeatureGrid();

    // 7. Build machine list
    buildMachineList();

    // 8. Handle direct dashboard link parameter
    const urlParams = new URLSearchParams(window.location.search);
    const wantsDashboard = urlParams.get('goto') === 'dashboard' || urlParams.get('goto') === 'admin';

    // 9. Hide loading screen
    setTimeout(() => {
      const ls = $('load-screen');
      if (ls) { ls.classList.add('hide'); }
      
      if (wantsDashboard && (!isLoggedIn || currentRole === 'operator')) {
        showStaffLoginModal();
      }
    }, 400);

  } catch (err) {
    console.error('Init error:', err);
    const lm = $('load-msg');
    if (lm) lm.textContent = 'Error — कृपया रीफ्रेश करें';
  }
});


/* ═══════════════════════════════════════════════════════════════
   CONNECTION STATUS
   ═══════════════════════════════════════════════════════════════ */

function updateConnDot() {
  const dot = $('conn-dot');
  if (!dot) return;
  const online = navigator.onLine;
  dot.classList.toggle('ok', online);
  dot.classList.toggle('err', !online);
}

window.addEventListener('online', updateConnDot);
window.addEventListener('offline', updateConnDot);


/* ═══════════════════════════════════════════════════════════════
   WHATSAPP CONFIG
   ═══════════════════════════════════════════════════════════════ */

async function loadWANumber() {
  try {
    if (typeof getConfig === 'function') {
      const cfg = await getConfig();
      if (cfg && cfg.whatsapp_number) {
        waNumber = String(cfg.whatsapp_number).replace(/\D/g, '');
      }
    }
  } catch (_) { /* non-critical */ }
}


/* ═══════════════════════════════════════════════════════════════
   SCREEN NAVIGATION
   ═══════════════════════════════════════════════════════════════ */

function goTo(screenId) {
  // Hide all screens
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));

  // Show target
  const target = $(screenId);
  if (target) {
    target.classList.add('on');
    target.scrollTop = 0;
  }

  // Operator header visibility toggle
  const mainHdr = document.querySelector('.hdr');
  if (mainHdr) {
    if (screenId === 's-dashboard') {
      mainHdr.style.display = 'none';
    } else {
      mainHdr.style.display = 'flex';
      
      const hdrRight = $('hdr-right');
      if (hdrRight) {
        // Hide engineer button on auth/done screens
        const hideOn = ['s-auth', 's-done'];
        hdrRight.style.display = hideOn.includes(screenId) ? 'none' : 'flex';
      }
    }
  }

  // If going to confirm → build it
  if (screenId === 's-conf') buildConfirm();

  // If going to dashboard → adjust tab visibility
  if (screenId === 's-dashboard') {
    updateDashboardTabsForRole();
  }

  // Update progress bar
  updateProgress(screenId);
}


/* ── Progress Bar ──────────────────────────────────────────── */
function updateProgress(screenId) {
  const steps = ['s-mach', 's-num', 's-prob', 's-conf'];
  const idx = steps.indexOf(screenId);
  document.querySelectorAll('.prog-s').forEach((bar, i) => {
    bar.classList.remove('done', 'active');
    if (i < idx)  bar.classList.add('done');
    if (i === idx) bar.classList.add('active');
  });
}


/* ═══════════════════════════════════════════════════════════════
   MACHINE SELECTION (STEP 1)
   ═══════════════════════════════════════════════════════════════ */

function buildMachineList() {
  const list = $('mach-list');
  if (!list) return;

  list.innerHTML = '';
  MACHINES.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'mach-btn';
    btn.setAttribute('data-m', m.id);
    btn.id = 'mach-' + m.id;
    btn.setAttribute('aria-label', m.id + ' - ' + m.hindi);
    btn.innerHTML =
      '<span class="mach-ico">' + escapeHtml(m.emoji) + '</span>' +
      '<span class="mach-info">' +
        '<span class="mach-name">' + escapeHtml(m.id) + '</span>' +
        '<span class="mach-sub">' + escapeHtml(m.hindi) + '</span>' +
      '</span>' +
      '<span class="mach-chk">✓</span>';
    btn.addEventListener('click', () => selMach(btn));
    list.appendChild(btn);
  });
}

function selMach(btn) {
  // Deselect all
  document.querySelectorAll('.mach-btn').forEach(b => b.classList.remove('sel'));

  // Select clicked
  btn.classList.add('sel');
  machine = btn.getAttribute('data-m');

  // Enable next
  const nxt = $('btn-mach-nxt');
  if (nxt) nxt.disabled = false;

  // Update pill on numpad screen
  const pill = $('t-pill');
  const machData = MACHINES.find(m => m.id === machine);
  if (pill && machData) {
    pill.textContent = machData.emoji + ' ' + machine;
  }
}


/* ═══════════════════════════════════════════════════════════════
   NUMPAD — DOOR / TIPPER NUMBER (STEP 2)
   ═══════════════════════════════════════════════════════════════ */

function np(key) {
  if (key === 'C') {
    tipperNo = '';
  } else if (key === '⌫') {
    tipperNo = tipperNo.slice(0, -1);
  } else {
    if (tipperNo.length >= 5) return; // max 5 digits
    tipperNo += key;
  }

  // Update display
  const disp = $('t-disp');
  if (disp) {
    disp.textContent = tipperNo || '—';
    disp.classList.toggle('has', tipperNo.length > 0);
  }

  // Enable/disable next
  const nxt = $('btn-num-nxt');
  if (nxt) nxt.disabled = tipperNo.length === 0;

  // Update problem-screen pill
  updateProbPill();
}

function updateProbPill() {
  const pill = $('prob-pill');
  if (!pill) return;
  const machData = MACHINES.find(m => m.id === machine);
  const emoji = machData ? machData.emoji : '🚛';
  pill.textContent = emoji + ' ' + machine + ' #' + (tipperNo || '—');
}


/* ═══════════════════════════════════════════════════════════════
   FEATURE GRID — DGMS SAFETY FEATURES (STEP 3)
   ═══════════════════════════════════════════════════════════════ */

function buildFeatureGrid() {
  const grid = $('feat-grid');
  if (!grid) return;

  grid.innerHTML = '';
  DGMS.forEach((feat, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'feat-wrap';

    // Feature button
    const btn = document.createElement('button');
    btn.className = 'feat-btn';
    btn.id = 'feat-' + idx;
    btn.setAttribute('data-h', feat.h);
    btn.setAttribute('aria-label', feat.h + ' — ' + feat.e);
    btn.innerHTML =
      '<span class="f-ico">' + escapeHtml(feat.i) + '</span>' +
      '<span class="f-h">' + escapeHtml(feat.h) + '</span>' +
      '<span class="f-e">' + escapeHtml(feat.e) + '</span>';
    btn.addEventListener('click', () => toggleFeat(btn));

    // Info button
    const info = document.createElement('button');
    info.className = 'info-btn';
    info.id = 'info-' + idx;
    info.setAttribute('aria-label', 'जानकारी — ' + feat.e);
    info.textContent = 'ℹ';
    info.addEventListener('click', (e) => {
      e.stopPropagation();
      showInfo(idx);
    });

    wrap.appendChild(btn);
    wrap.appendChild(info);
    grid.appendChild(wrap);
  });
}

function toggleFeat(btn) {
  const h = btn.getAttribute('data-h');
  if (selFeat.has(h)) {
    selFeat.delete(h);
    btn.classList.remove('sel');
  } else {
    selFeat.add(h);
    btn.classList.add('sel');
  }
  chkP();
  updateFeatCount();
}

function updateFeatCount() {
  const counter = $('feat-count');
  if (counter) {
    counter.textContent = selFeat.size > 0
      ? selFeat.size + ' selected / चयनित'
      : '';
  }
}

function chkP() {
  const nxt = $('btn-prob-nxt');
  const note = $('note-ta');
  const hasText = note && note.value.trim().length > 0;
  if (nxt) nxt.disabled = selFeat.size === 0 && !hasText;
}


/* ═══════════════════════════════════════════════════════════════
   INFO MODAL
   ═══════════════════════════════════════════════════════════════ */

function showInfo(idx) {
  const feat = DGMS[idx];
  if (!feat) return;

  const modal = $('info-modal');
  if (!modal) return;

  $('info-ico').textContent = feat.i;
  $('info-title').textContent = feat.h;
  $('info-eng').textContent = feat.e;
  $('info-what-txt').textContent = feat.what;
  $('info-why-txt').textContent = feat.why;

  modal.classList.remove('hidden');
}

function closeInfo() {
  const modal = $('info-modal');
  if (modal) modal.classList.add('hidden');
}


/* ═══════════════════════════════════════════════════════════════
   VOICE INPUT — SPEECH RECOGNITION
   ═══════════════════════════════════════════════════════════════ */

function toggleMic() {
  const SpeechAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechAPI) {
    alert('आपका ब्राउज़र वॉइस इनपुट सपोर्ट नहीं करता।\nYour browser does not support voice input.');
    return;
  }

  const micBtn = $('mic-btn');
  const tag    = $('listen-tag');
  const ta     = $('note-ta');

  if (isListening && recognition) {
    // Stop
    recognition.stop();
    isListening = false;
    if (micBtn) micBtn.classList.remove('live');
    if (tag) tag.textContent = '';
    return;
  }

  // Start
  recognition = new SpeechAPI();
  recognition.lang = 'hi-IN';
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.onstart = () => {
    isListening = true;
    if (micBtn) micBtn.classList.add('live');
    if (tag) tag.textContent = '🎙 सुन रहा है… Listening…';
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    if (ta) {
      ta.value = ta.value
        ? ta.value + ' ' + transcript
        : transcript;
    }
    chkP();
  };

  recognition.onerror = (e) => {
    console.error('Speech error:', e.error);
    isListening = false;
    if (micBtn) micBtn.classList.remove('live');
    if (tag) tag.textContent = '';
    if (e.error === 'not-allowed') {
      alert('माइक्रोफ़ोन अनुमति दें।\nPlease allow microphone permission.');
    }
  };

  recognition.onend = () => {
    isListening = false;
    if (micBtn) micBtn.classList.remove('live');
    if (tag) tag.textContent = '';
  };

  recognition.start();
}


/* ═══════════════════════════════════════════════════════════════
   CONFIRM SCREEN
   ═══════════════════════════════════════════════════════════════ */

function buildConfirm() {
  const machData = MACHINES.find(m => m.id === machine);
  const emoji = machData ? machData.emoji : '🚛';

  // ID
  const confId = $('conf-id');
  if (confId) confId.textContent = emoji + ' ' + escapeHtml(machine) + ' — DOOR #' + escapeHtml(tipperNo);

  // Machine + Door
  const confM = $('conf-m');
  if (confM) confM.textContent = escapeHtml(machine) + ' #' + escapeHtml(tipperNo);

  // Features
  const confFeat = $('conf-feat');
  if (confFeat) {
    if (selFeat.size > 0) {
      let html = '<div class="conf-feat-list">';
      selFeat.forEach(h => {
        const feat = DGMS.find(f => f.h === h);
        const ico = feat ? feat.i : '⚠️';
        html += '<span class="conf-feat-tag">' + escapeHtml(ico) + ' ' + escapeHtml(h) + '</span>';
      });
      html += '</div>';
      confFeat.innerHTML = html;
    } else {
      confFeat.innerHTML = '<span style="color:var(--mut)">—</span>';
    }
  }

  // Note
  const confNote = $('conf-note');
  const noteVal = $('note-ta') ? $('note-ta').value.trim() : '';
  if (confNote) {
    confNote.textContent = noteVal ? escapeHtml(noteVal) : '— कोई नोट नहीं / No note —';
  }
}


/* ═══════════════════════════════════════════════════════════════
   OPERATOR AUTH
   ═══════════════════════════════════════════════════════════════ */

function goToOpAuth() {
  opAuthTries = 0;
  opAuthData  = null;

  // Reset form
  const fa  = $('auth-forma');
  const dob = $('auth-dob');
  const msg = $('auth-msg');
  const skip = $('btn-auth-skip');

  if (fa)  { fa.value = '';  fa.classList.remove('err', 'ok'); }
  if (dob) { dob.value = ''; dob.classList.remove('err', 'ok'); }
  if (msg) { msg.textContent = ''; msg.className = 'auth-msg'; }
  if (skip) skip.classList.remove('show');

  // Reset dots
  document.querySelectorAll('.try-dot').forEach(d => d.classList.remove('used'));

  goTo('s-auth');
}

async function tryOpLogin() {
  const fa  = $('auth-forma');
  const dob = $('auth-dob');
  const msg = $('auth-msg');
  const goBtn = $('btn-auth-go');

  if (!fa || !dob) return;

  const formA = sanitizeText(fa.value, 20).trim();
  const dobVal = sanitizeText(dob.value, 8).trim();

  // Validate Form A
  if (!isValidFormA(formA)) {
    fa.classList.add('err');
    if (msg) { msg.textContent = 'सही Form A नम्बर डालें / Enter valid Form A'; msg.className = 'auth-msg err'; }
    return;
  }

  // Validate DOB
  if (!isValidDOB(dobVal)) {
    dob.classList.add('err');
    if (msg) { msg.textContent = 'जन्मतिथि 8 अंकों में (DDMMYYYY) / DOB in 8 digits'; msg.className = 'auth-msg err'; }
    return;
  }

  // Reset styles
  fa.classList.remove('err', 'ok');
  dob.classList.remove('err', 'ok');
  if (msg) { msg.textContent = 'जाँच रहा है… Verifying…'; msg.className = 'auth-msg'; }
  if (goBtn) goBtn.disabled = true;

  try {
    const dobFormatted = parseDOB(dobVal);
    let result = null;

    if (typeof verifyOperator === 'function') {
      result = await verifyOperator(formA, dobFormatted);
    }

    if (result && result.id) {
      // SUCCESS
      fa.classList.add('ok');
      dob.classList.add('ok');
      if (msg) {
        msg.textContent = '✅ ' + escapeHtml(result.name || 'Operator') + ' — सत्यापित / Verified';
        msg.className = 'auth-msg ok';
      }

      opAuthData = {
        auth: 'authorized',
        name: result.name || '',
        designation: result.designation || '',
        formA: formA,
        dob: dobFormatted
      };

      // Small delay then submit
      setTimeout(() => doSubmit(opAuthData), 800);

    } else {
      // FAIL
      opAuthTries++;
      markTryDot(opAuthTries);

      fa.classList.add('err');
      dob.classList.add('err');

      const remaining = MAX_AUTH_TRIES - opAuthTries;
      if (msg) {
        msg.textContent = '❌ मिलान नहीं हुआ / No match — ' + remaining + ' प्रयास शेष';
        msg.className = 'auth-msg err';
      }

      // Show skip after 2 fails
      if (opAuthTries >= 2) {
        const skip = $('btn-auth-skip');
        if (skip) skip.classList.add('show');
      }

      // Auto-submit after max tries
      if (opAuthTries >= MAX_AUTH_TRIES) {
        if (msg) {
          msg.textContent = '⚠️ अधिकतम प्रयास — रिपोर्ट बिना सत्यापन भेजी जा रही है';
          msg.className = 'auth-msg warn';
        }
        setTimeout(() => forceSubmitUnauth(), 1200);
      }
    }
  } catch (err) {
    console.error('Auth error:', err);
    if (msg) {
      msg.textContent = '⚠️ सर्वर त्रुटि / Server error — पुनः प्रयास करें';
      msg.className = 'auth-msg err';
    }
  } finally {
    if (goBtn) goBtn.disabled = false;
  }
}

function markTryDot(tryNum) {
  const dot = $('try-dot-' + tryNum);
  if (dot) dot.classList.add('used');
}

function forceSubmitUnauth() {
  if (opAuthTries < 2) return; // Safety: only after 2+ fails
  opAuthData = { auth: 'unauthorized', name: '', designation: '', formA: '', dob: '' };
  doSubmit(opAuthData);
}


/* ═══════════════════════════════════════════════════════════════
   SUBMIT REPORT
   ═══════════════════════════════════════════════════════════════ */

async function doSubmit(authInfo) {
  // Rate-limit check
  if (!canSubmitReport()) {
    const msg = $('auth-msg');
    if (msg) {
      msg.textContent = '⚠️ बहुत अधिक रिपोर्ट — कृपया प्रतीक्षा करें / Too many reports';
      msg.className = 'auth-msg warn';
    }
    return;
  }

  const noteVal = $('note-ta') ? sanitizeText($('note-ta').value, 300) : '';
  const problems = Array.from(selFeat);
  const now = new Date().toISOString();

  const report = {
    id: uuid4(),
    machine:        machine,
    tipper_no:      tipperNo,
    problems:       problems,
    note:           noteVal,
    status:         'pending',
    operator_auth:  authInfo.auth,
    operator_name:  authInfo.name,
    operator_designation: authInfo.designation,
    operator_form_a: authInfo.formA,
    created_at:     now
  };

  lastReport = report;

  // Navigate to done screen first (optimistic)
  showDoneScreen(report);

  // Trigger Google Sheets append immediately and concurrently! (Fire-and-forget, independent of Supabase)
  if (typeof appendReportToSheet === 'function') {
    appendReportToSheet(report).then(res => {
      console.log('Immediate Google Sheets sync response:', res);
    }).catch(e => {
      console.error('Immediate Google Sheets sync error:', e);
    });
  }

  // Send to Supabase
  try {
    const syncTag = $('sync-tag');
    if (syncTag) {
      syncTag.className = 'sync-tag s-ing';
      syncTag.textContent = '⏳ भेज रहा है… Syncing…';
    }

    if (typeof submitReport === 'function') {
      await submitReport(report);
    }

    if (syncTag) {
      syncTag.className = 'sync-tag s-ok';
      syncTag.textContent = '✅ सर्वर पर भेजा गया / Synced';
    }

  } catch (err) {
    console.error('Submit error:', err);
    const syncTag = $('sync-tag');
    if (syncTag) {
      syncTag.className = 'sync-tag s-err';
      syncTag.innerHTML = '❌ भेजने में त्रुटि / Sync failed — <a href="#" onclick="retrySubmit();return false" style="color:var(--or);text-decoration:underline">पुनः प्रयास / Retry</a>';
    }
  }
}


/* ── Retry Submit ──────────────────────────────────────────── */
async function retrySubmit() {
  if (!lastReport) return;
  try {
    const syncTag = $('sync-tag');
    if (syncTag) {
      syncTag.className = 'sync-tag s-ing';
      syncTag.textContent = '⏳ पुनः भेज रहा है… Retrying…';
    }

    if (typeof submitReport === 'function') {
      await submitReport(lastReport);
    }

    if (syncTag) {
      syncTag.className = 'sync-tag s-ok';
      syncTag.textContent = '✅ सर्वर पर भेजा गया / Synced';
    }
  } catch (err) {
    console.error('Retry error:', err);
    const syncTag = $('sync-tag');
    if (syncTag) {
      syncTag.className = 'sync-tag s-err';
      syncTag.innerHTML = '❌ पुनः विफल / Failed again — <a href="#" onclick="retrySubmit();return false" style="color:var(--or);text-decoration:underline">Retry</a>';
    }
  }
}


/* ═══════════════════════════════════════════════════════════════
   DONE SCREEN
   ═══════════════════════════════════════════════════════════════ */

function showDoneScreen(report) {
  goTo('s-done');

  // Auth badge
  const authBadge = $('done-auth-badge');
  if (authBadge) {
    if (report.operator_auth === 'authorized') {
      authBadge.className = 'auth-badge auth-ok';
      authBadge.innerHTML = '🛡 सत्यापित / VERIFIED';
    } else {
      authBadge.className = 'auth-badge auth-no';
      authBadge.innerHTML = '⚠ असत्यापित / UNVERIFIED';
    }
  }

  // Report ID
  const doneId = $('done-id');
  if (doneId) doneId.textContent = 'REPORT ID: ' + escapeHtml(report.id.slice(0, 8)).toUpperCase();

  // Details
  const doneP = $('done-p');
  if (doneP) {
    let txt = escapeHtml(report.machine) + ' #' + escapeHtml(report.tipper_no) + '\n';
    if (report.problems.length > 0) {
      txt += report.problems.map(p => '• ' + escapeHtml(p)).join('\n');
    }
    if (report.note) {
      txt += '\n📝 ' + escapeHtml(report.note);
    }
    doneP.textContent = txt;
    doneP.style.whiteSpace = 'pre-wrap';
  }

  // Operator name if authorized
  const doneName = $('done-name');
  if (doneName) {
    if (report.operator_name) {
      doneName.textContent = '👷 ' + escapeHtml(report.operator_name);
      doneName.style.display = 'block';
    } else {
      doneName.style.display = 'none';
    }
  }
}


/* ═══════════════════════════════════════════════════════════════
   WHATSAPP SHARE
   ═══════════════════════════════════════════════════════════════ */

function sendWA() {
  if (!lastReport) return;

  const r = lastReport;
  let msg = '⚠️ *HEMM सुरक्षा रिपोर्ट*\n';
  msg += '🏗 *Safety Report — Amadand Mine*\n\n';
  msg += '🚛 *मशीन / Machine:* ' + r.machine + '\n';
  msg += '🔢 *डोर नं / Door #:* ' + r.tipper_no + '\n\n';

  if (r.problems.length > 0) {
    msg += '⚙️ *समस्याएँ / Issues:*\n';
    r.problems.forEach(p => {
      const feat = DGMS.find(f => f.h === p);
      const ico = feat ? feat.i : '⚠️';
      const eng = feat ? feat.e : p;
      msg += ico + ' ' + p + ' (' + eng + ')\n';
    });
    msg += '\n';
  }

  if (r.note) {
    msg += '📝 *नोट / Note:* ' + r.note + '\n\n';
  }

  msg += '👷 *ऑपरेटर / Operator:* ';
  if (r.operator_auth === 'authorized') {
    msg += r.operator_name + ' ✅\n';
  } else {
    msg += 'असत्यापित / Unverified ⚠️\n';
  }

  msg += '\n🕐 ' + formatDateTime(r.created_at);

  const encoded = encodeURIComponent(msg);
  const phone = waNumber || '';
  const url = phone
    ? 'https://wa.me/' + phone + '?text=' + encoded
    : 'https://wa.me/?text=' + encoded;

  window.open(url, '_blank');
}


/* ═══════════════════════════════════════════════════════════════
   RESET — NEW REPORT
   ═══════════════════════════════════════════════════════════════ */

function resetAll() {
  // State
  machine     = '';
  tipperNo    = '';
  selFeat     = new Set();
  isListening = false;
  lastReport  = null;
  opAuthTries = 0;
  opAuthData  = null;

  // Stop speech if active
  if (recognition) {
    try { recognition.stop(); } catch (_) {}
    recognition = null;
  }

  // Clear UI
  document.querySelectorAll('.mach-btn').forEach(b => b.classList.remove('sel'));
  const nxtMach = $('btn-mach-nxt');
  if (nxtMach) nxtMach.disabled = true;

  const disp = $('t-disp');
  if (disp) { disp.textContent = '—'; disp.classList.remove('has'); }
  const nxtNum = $('btn-num-nxt');
  if (nxtNum) nxtNum.disabled = true;

  document.querySelectorAll('.feat-btn').forEach(b => b.classList.remove('sel'));
  const nxtProb = $('btn-prob-nxt');
  if (nxtProb) nxtProb.disabled = true;

  const note = $('note-ta');
  if (note) note.value = '';

  const mic = $('mic-btn');
  if (mic) mic.classList.remove('live');

  const tag = $('listen-tag');
  if (tag) tag.textContent = '';

  const counter = $('feat-count');
  if (counter) counter.textContent = '';

  // Progress
  document.querySelectorAll('.prog-s').forEach(b => {
    b.classList.remove('done', 'active');
  });

  // Go home
  goTo('s-home');
}


/* ═══════════════════════════════════════════════════════════════
   STAFF LOGIN & DASHBOARD ROUTING
   ═══════════════════════════════════════════════════════════════ */

let staffLoginAttempts = 0;
const MAX_STAFF_LOGIN_ATTEMPTS = 3;
const STAFF_LOCKOUT_SECONDS = 60;
let staffLockoutTimer = null;
let staffLockoutRemaining = 0;

function showStaffLoginModal() {
  const modal = $('staff-login-modal');
  if (modal) {
    modal.classList.remove('hidden');
    // Clear inputs and error
    const u = $('staff-login-id');
    const p = $('staff-login-pass');
    const err = $('staff-login-err');
    if (u) u.value = '';
    if (p) p.value = '';
    if (err) { err.textContent = ''; err.classList.remove('on'); }
    resetStaffLoginDots();
  }
}

function hideStaffLoginModal() {
  const modal = $('staff-login-modal');
  if (modal) modal.classList.add('hidden');
}

function resetStaffLoginDots() {
  document.querySelectorAll('.staff-att-dot').forEach(d => {
    d.classList.remove('used', 'ok');
  });
}

function markStaffDotUsed(index) {
  const dots = document.querySelectorAll('.staff-att-dot');
  if (dots[index]) dots[index].classList.add('used');
}

function markStaffDotsOk() {
  document.querySelectorAll('.staff-att-dot').forEach(d => {
    d.classList.remove('used');
    d.classList.add('ok');
  });
}

function startStaffLockout() {
  staffLockoutRemaining = STAFF_LOCKOUT_SECONDS;
  const lockBanner = $('staff-lock-banner');
  const loginBtn = $('staff-login-btn');
  const errEl = $('staff-login-err');

  if (errEl) errEl.classList.remove('on');
  if (lockBanner) lockBanner.classList.add('on');
  if (loginBtn) loginBtn.disabled = true;

  updateStaffLockTimer();
  staffLockoutTimer = setInterval(() => {
    staffLockoutRemaining--;
    updateStaffLockTimer();

    if (staffLockoutRemaining <= 0) {
      clearInterval(staffLockoutTimer);
      staffLockoutTimer = null;
      staffLoginAttempts = 0;
      resetStaffLoginDots();
      if (lockBanner) lockBanner.classList.remove('on');
      if (loginBtn) loginBtn.disabled = false;
    }
  }, 1000);
}

function updateStaffLockTimer() {
  const timer = $('staff-lock-timer');
  if (timer) {
    const m = Math.floor(staffLockoutRemaining / 60);
    const s = staffLockoutRemaining % 60;
    timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }
}

async function handleStaffLogin() {
  const staffInput = $('staff-login-id');
  const passInput  = $('staff-login-pass');
  const loginBtn   = $('staff-login-btn');
  const errorEl    = $('staff-login-err');
  const card       = document.querySelector('.staff-login-card');

  if (!staffInput || !passInput) return;
  if (staffLockoutRemaining > 0) return;

  const staffId = staffInput.value.trim();
  const password = passInput.value;

  if (!staffId || !password) {
    showStaffLoginError('Staff ID और Password दोनों दर्ज करें।');
    return;
  }

  if (loginBtn) loginBtn.disabled = true;
  showStaffLoginError('लॉगिन जाँच रहे हैं… Verifying…');

  try {
    const email = staffId + '@hemm.local';
    const result = await signInWithCredentials(email, password);

    if (result && result.error) {
      throw new Error(result.error.message || 'Login failed');
    }

    if (result.role !== 'engineer' && result.role !== 'admin') {
      await signOut();
      showStaffLoginError('⚠️ इस खाते के पास अधिकार नहीं है।');
      if (loginBtn) loginBtn.disabled = false;
      return;
    }

    // Success
    markStaffDotsOk();
    if (errorEl) errorEl.classList.remove('on');
    
    setTimeout(async () => {
      hideStaffLoginModal();
      
      // Boot components
      if (typeof initDashboard === 'function') await initDashboard();
      if (typeof initAdminPanel === 'function') await initAdminPanel();
      
      goTo('s-dashboard');
    }, 600);

  } catch (err) {
    staffLoginAttempts++;
    markStaffDotUsed(staffLoginAttempts - 1);

    if (card) {
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
    }

    if (staffLoginAttempts >= MAX_STAFF_LOGIN_ATTEMPTS) {
      startStaffLockout();
    } else {
      const remaining = MAX_STAFF_LOGIN_ATTEMPTS - staffLoginAttempts;
      showStaffLoginError(
        `गलत क्रेडेंशियल — ${remaining} प्रयास शेष (Invalid credentials)<br>` +
        `<small style="color:var(--re);font-size:11px;opacity:0.8;">ℹ️ ${escapeHtml(err.message)}</small>`
      );
    }
    if (loginBtn) loginBtn.disabled = false;
  }
}

function showStaffLoginError(msg) {
  const el = $('staff-login-err');
  if (el) {
    el.innerHTML = msg;
    el.classList.add('on');
  }
}

// Allow Enter key on password field
function handleStaffLoginKeypress(e) {
  if (e.key === 'Enter') handleStaffLogin();
}

async function exitDashboard() {
  if (typeof signOut === 'function') await signOut();
  if (typeof stopDashboard === 'function') stopDashboard();
  goTo('s-home');
}

function switchDashboardTab(tabName) {
  // Prevent non-admins from accessing admin tabs
  if (tabName !== 'reports' && (typeof currentRole === 'undefined' || currentRole !== 'admin')) {
    return;
  }

  // Update active tab styling
  document.querySelectorAll('.dash-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
  });

  // Update active panel visibility
  document.querySelectorAll('.dash-panel').forEach(p => {
    p.classList.toggle('active', p.id === 'panel-' + tabName);
  });

  // Trigger loading of data for specific tabs
  if (tabName === 'creds') {
    if (typeof loadCredentials === 'function') {
      loadCredentials();
    } else if (typeof renderCredentialsList === 'function') {
      renderCredentialsList();
    }
  } else if (tabName === 'reports') {
    if (typeof fetchInitialReports === 'function') {
      fetchInitialReports();
    } else if (typeof renderEng === 'function') {
      renderEng();
    }
  } else if (tabName === 'alerts') {
    if (typeof loadAdminReports === 'function' && typeof renderAlerts === 'function') {
      loadAdminReports().then(() => renderAlerts());
    } else if (typeof renderAlerts === 'function') {
      renderAlerts();
    }
  } else if (tabName === 'archive') {
    if (typeof populateArchiveMonths === 'function') populateArchiveMonths();
  }
}

function updateDashboardTabsForRole() {
  const isAdminUser = (typeof currentRole !== 'undefined' && currentRole === 'admin');
  
  // Tab buttons
  const credsTab = document.querySelector('.dash-tab[data-tab="creds"]');
  const alertsTab = document.querySelector('.dash-tab[data-tab="alerts"]');
  const archiveTab = document.querySelector('.dash-tab[data-tab="archive"]');
  
  if (credsTab) credsTab.style.display = isAdminUser ? 'inline-block' : 'none';
  if (alertsTab) alertsTab.style.display = isAdminUser ? 'inline-block' : 'none';
  if (archiveTab) archiveTab.style.display = isAdminUser ? 'inline-block' : 'none';
  
  // If not admin, make sure we switch to reports tab by default
  if (!isAdminUser) {
    switchDashboardTab('reports');
  }
}
