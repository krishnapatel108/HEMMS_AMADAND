// ═══════════════════════════════════════════════════════════════
//  BEML 240T Dumper AI PM System — app.js
//  Primary Page Controller, Breakdown Log, and UI Coordinator
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Application State ──
let simulator = null;
let currentDumperNo = 'BD-2401';
let currentOperatorReport = {}; // holds active operator checklist values for this dumper
let activeBreakdownId = null;   // holds currently selected breakdown in timeline

// Initial fleet data load/save
function getFleet() {
  const local = localStorage.getItem('beml_fleet');
  if (local) return JSON.parse(local);
  
  // Default seed fleet with customized RUL offsets
  const seed = [
    { id: 'bd-2401', dumper_no: 'BD-2401', model: 'BH205E-AC', engine_model: 'Cummins QSK60', current_hours: 4820.50, avg_hours_per_day: 14.50, last_pm_type: '250 Hr', last_pm_hours: 4750.00, last_pm_date: new Date(Date.now() - 5*24*60*60*1000).toISOString(), status: 'operational', last_oil_change: 4750.00, last_filter_change: 4500.00, last_tire_change: 0.00 },
    { id: 'bd-2402', dumper_no: 'BD-2402', model: 'BH205E-AC', engine_model: 'Cummins QSK60', current_hours: 1235.00, avg_hours_per_day: 15.00, last_pm_type: '50 Hr', last_pm_hours: 1200.00, last_pm_date: new Date(Date.now() - 2*24*60*60*1000).toISOString(), status: 'operational', last_oil_change: 1000.00, last_filter_change: 1000.00, last_tire_change: 0.00 },
    { id: 'bd-2403', dumper_no: 'BD-2403', model: 'BH205E-AC', engine_model: 'Cummins QSK60', current_hours: 3150.00, avg_hours_per_day: 12.00, last_pm_type: '1000 Hr', last_pm_hours: 3000.00, last_pm_date: new Date(Date.now() - 12*24*60*60*1000).toISOString(), status: 'operational', last_oil_change: 3000.00, last_filter_change: 3000.00, last_tire_change: 0.00 }
  ];
  localStorage.setItem('beml_fleet', JSON.stringify(seed));
  return seed;
}

function saveFleet(fleet) {
  localStorage.setItem('beml_fleet', JSON.stringify(fleet));
}

// ── Init Core ──
document.addEventListener('DOMContentLoaded', () => {
  // 1. Start Sensor Telemetry Simulator
  simulator = new SensorSimulator();
  simulator.start();
  
  // 2. Initialize UI Tabs
  switchTab('dashboard');

  // 3. Render Standards Reference Tables
  renderStandardsTable();
  renderFaultCodesReference();

  // 4. Render initial fleet lists
  updateFleetDashboard();
  loadAuditLogs();

  // 5. Register Telemetry Tick Event (Every 1 Second)
  simulator.registerCallback((data) => {
    onTelemetryTick(data);
  });

  // Load dropdown lists
  loadOpDumperSelectDetails();
  loadBreakdownDumperSelect();
  
  // Render active breakdowns log
  renderBreakdownsList();

  // 6. Load saved AI model settings if present
  const savedThreshold = localStorage.getItem('beml_reliability_threshold');
  if (savedThreshold) {
    const slider = document.getElementById('reliability-slider');
    if (slider) slider.value = savedThreshold;
    const display = document.getElementById('reliability-slider-val');
    if (display) display.textContent = `${savedThreshold}%`;
  }
  const savedModel = localStorage.getItem('beml_trained_model');
  if (savedModel) {
    try {
      const model = JSON.parse(savedModel);
      renderLearnedRules(model);
    } catch(e) {}
  }
});

// ── Navigation tabs toggle ──
function switchTab(tabId) {
  document.querySelectorAll('.side-nav .nav-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.querySelectorAll('.main-content .tab-panel').forEach(panel => {
    if (panel.id === `panel-${tabId}`) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  });

  // Load dropdown selectors dynamically if tab requires it
  if (tabId === 'breakdowns') {
    loadBreakdownDumperSelect();
    renderBreakdownsList();
  }
}

// ── Telemetry Tick Updates ──
function onTelemetryTick(data) {
  // Update header parameters
  document.getElementById('tel-feed-no').textContent = data.dumper_no;
  document.getElementById('tel-feed-smu').textContent = data.smu.toFixed(2);
  document.getElementById('tel-feed-rpm').textContent = data.rpm;

  // Sync simulated SMU hours back to fleet registry state
  const fleet = getFleet();
  const dumper = fleet.find(d => d.dumper_no === data.dumper_no);
  if (dumper) {
    dumper.current_hours = data.smu;
    saveFleet(fleet);
    
    // Smoothly update hours card on Dashboard in real-time
    const smuLabel = document.getElementById(`smu-val-${dumper.id}`);
    if (smuLabel) {
      smuLabel.textContent = `${data.smu.toFixed(2)} hrs`;
    }
  }

  // Update Telemetry tab progress bars and color warnings
  updateTelemetryGauges(data.telemetry);

  // Run AI Diagnostics Engine (MSF: correlates telemetry and current operator reports)
  const opReport = currentOperatorReport[data.dumper_no] || {};
  const diagnosis = AIEngine.diagnose(data.telemetry, opReport);
  
  // Render AI diagnostics report
  renderAIDiagnosticReport(diagnosis);
}

// Dynamic dashboard dials and gauges builder
function updateTelemetryGauges(tel) {
  const gauges = [
    { key: 'oilPressure', id: 'oil-press', max: 8.0 },
    { key: 'coolantTemp', id: 'coolant-temp', max: 120.0 },
    { key: 'exhaustTemp', id: 'exhaust-temp', max: 800.0 },
    { key: 'boostPressure', id: 'boost-press', max: 4.0 },
    { key: 'blowbyPressure', id: 'blowby-press', max: 15.0 },
    { key: 'alternatorVoltage', id: 'alt-volt', max: 1200.0 },
    { key: 'wheelMotorTempL', id: 'wheel-motor-l', max: 140.0 },
    { key: 'wheelMotorTempR', id: 'wheel-motor-r', max: 140.0 },
    { key: 'gridTemp', id: 'grid-temp', max: 300.0 },
    { key: 'systemPressure', id: 'steering-press', max: 300.0 }
  ];

  gauges.forEach(g => {
    const value = tel[g.key];
    const valText = document.getElementById(`val-${g.id}`);
    const bar = document.getElementById(`bar-${g.id}`);
    const card = document.getElementById(`gauge-${g.id}`);

    if (valText && bar && card) {
      valText.textContent = value.toFixed(g.key === 'rpm' ? 0 : 2);
      
      // Calculate bar width percentage
      const pct = Math.min(100, (value / g.max) * 100);
      bar.style.width = `${pct}%`;

      // Cross check boundaries for visual class warnings
      const limit = lookupSensorStandard(g.key);
      if (limit) {
        card.classList.remove('warning', 'critical');
        if (value >= limit.critHigh || (limit.critLow && value <= limit.critLow)) {
          card.classList.add('critical');
        } else if (value >= limit.highAlarm || (limit.lowAlarm && value <= limit.lowAlarm)) {
          card.classList.add('warning');
        }
      }
    }
  });
}

function lookupSensorStandard(key) {
  // Map key names to OEM standard categories
  if (OEM_STANDARDS.engine[key]) return OEM_STANDARDS.engine[key];
  if (OEM_STANDARDS.driveSystem[key]) return OEM_STANDARDS.driveSystem[key];
  if (OEM_STANDARDS.hydraulic[key]) return OEM_STANDARDS.hydraulic[key];
  return null;
}

// Renders the AI Analysis sidebar
function renderAIDiagnosticReport(diag) {
  const container = document.getElementById('ai-realtime-diagnostics-output');
  if (!container) return;

  let findingsHtml = '';
  if (diag.findings.length === 0) {
    findingsHtml = '<li>✔️ No active sensor anomalies detected.</li>';
  } else {
    diag.findings.forEach(f => {
      const cls = diag.severity === 'critical' ? 'crit' : 'warn';
      findingsHtml += `<li class="${cls}">${f}</li>`;
    });
  }

  let actionsHtml = '';
  if (diag.actions.length === 0) {
    actionsHtml = '<li>✔️ Continue standard hauling cycle operations.</li>';
  } else {
    diag.actions.forEach(a => {
      actionsHtml += `<li>${a}</li>`;
    });
  }

  container.innerHTML = `
    <div class="ai-report-status-bar ${diag.severity !== 'healthy' ? diag.severity : ''}">
      FLEET HEALTH: ${diag.severity.toUpperCase()}
    </div>
    
    <div>
      <div class="ai-section-title">Detected Anomalies</div>
      <ul class="ai-list-group">
        ${findingsHtml}
      </ul>
    </div>

    <div>
      <div class="ai-section-title">Root Cause Analysis</div>
      <p class="ai-desc-text">${diag.rootCause}</p>
    </div>

    <div>
      <div class="ai-section-title">Immediate Actions Required</div>
      <ul class="ai-list-group" style="font-weight:700;">
        ${actionsHtml}
      </ul>
    </div>

    <div>
      <div class="ai-section-title">Workshop Repair Protocol</div>
      <div class="ai-guide-box">${diag.troubleshoot}</div>
    </div>
  `;
}

// Trigger fault injector presets from buttons
function triggerSimulatorFault(faultType) {
  simulator.triggerFault(faultType);

  // Update active button state styling
  document.querySelectorAll('.inj-buttons .inj-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  const activeBtn = document.getElementById(`inj-${faultType}`);
  if (activeBtn) activeBtn.classList.add('active');
}

// ── Fleet Dashboard Controller ──
function updateFleetDashboard() {
  const grid = document.getElementById('dashboard-dumper-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const fleet = getFleet();
  let opsCount = 0;
  let pmCount = 0;
  let bdCount = 0;

  fleet.forEach(d => {
    // Generate RUL numbers based on elapsed change hours
    const rul = AIEngine.calculateRUL(d.current_hours, 84, 1.5, false, {
      lastOil: d.last_oil_change || 0,
      lastFilter: d.last_filter_change || 0,
      lastTire: d.last_tire_change || 0
    });

    // Count states
    if (d.status === 'operational') opsCount++;
    else if (d.status === 'maintenance') pmCount++;
    else bdCount++;

    const nextPm = calculateNextPMHours(d.current_hours);

    const card = document.createElement('div');
    card.className = `dumper-card status-${d.status}`;
    card.innerHTML = `
      <div class="dumper-card-header">
        <div class="dumper-title-box">
          <h3>${d.dumper_no}</h3>
          <span>${d.model} · ${d.engine_model}</span>
        </div>
        <span class="dumper-status-badge">${d.status}</span>
      </div>

      <div style="font-size:13px; margin-bottom: 10px; display:flex; justify-content:space-between;">
        <span>Current SMU:</span>
        <strong id="smu-val-${d.id}">${d.current_hours.toFixed(2)} hrs</strong>
      </div>
      
      <div style="font-size:12px; color:var(--beml-gold); font-weight:700; margin-bottom: 15px;">
        ⏱️ Next PM Target: ${nextPm.type} in ${(nextPm.hours - d.current_hours).toFixed(2)} hrs
      </div>

      <div class="rul-header">Consumable Wear & Remaining Useful Life (RUL):</div>
      <div class="rul-item-row">
        
        <!-- Oil -->
        <div class="rul-bar-group">
          <div class="rul-bar-lbl">
            <span>Engine Lube Oil (RUL)</span>
            <span>${rul.oil.hours} hrs (${rul.oil.health}%)</span>
          </div>
          <div class="rul-bar-outer">
            <div class="rul-bar-inner" style="width: ${rul.oil.health}%; background-color: ${getRULColor(rul.oil.health)};"></div>
          </div>
        </div>

        <!-- Filters -->
        <div class="rul-bar-group">
          <div class="rul-bar-lbl">
            <span>Air cleaner elements</span>
            <span>${rul.filters.hours} hrs (${rul.filters.health}%)</span>
          </div>
          <div class="rul-bar-outer">
            <div class="rul-bar-inner" style="width: ${rul.filters.health}%; background-color: ${getRULColor(rul.filters.health)};"></div>
          </div>
        </div>

        <!-- Tires -->
        <div class="rul-bar-group">
          <div class="rul-bar-lbl">
            <span>37R57 Tire Tread wear</span>
            <span>${rul.tires.hours} hrs (${rul.tires.health}%)</span>
          </div>
          <div class="rul-bar-outer">
            <div class="rul-bar-inner" style="width: ${rul.tires.health}%; background-color: ${getRULColor(rul.tires.health)};"></div>
          </div>
        </div>

      </div>

      <div class="card-footer-buttons">
        <button class="card-btn" onclick="selectDumperForTelemetry('${d.dumper_no}')">🔬 Sensor desk</button>
        <button class="card-btn" onclick="openOperatorFormFor('${d.dumper_no}')">👷 Pre-start sheet</button>
      </div>
    `;
    grid.appendChild(card);
  });

  // Update counters
  document.getElementById('kpi-fleet-size').textContent = fleet.length;
  document.getElementById('kpi-fleet-ops').textContent = opsCount;
  document.getElementById('kpi-fleet-pm').textContent = pmCount;
  document.getElementById('kpi-fleet-bd').textContent = bdCount;

  // Calculate fleet availability percentage
  const avail = ((opsCount / fleet.length) * 100).toFixed(0);
  document.getElementById('fleet-avail-pct').textContent = `${avail}%`;
}

function getRULColor(health) {
  if (health < 15) return 'var(--status-crit)';
  if (health < 40) return 'var(--status-warn)';
  return 'var(--status-ok)';
}

function calculateNextPMHours(hours) {
  const base = Math.ceil(hours / 250) * 250;
  let type = '250 Hr Minor';
  if (base % 1000 === 0) type = '1000 Hr PM-1';
  if (base % 2000 === 0) type = '2000 Hr PM-2';
  if (base % 6000 === 0) type = '6000 Hr Overhaul';
  return { type, hours: base };
}

// Redirect helpers from cards
function selectDumperForTelemetry(dumperNo) {
  currentDumperNo = dumperNo;
  simulator.currentDumper = dumperNo;
  
  // Update simulator SMU reference
  const fleet = getFleet();
  const d = fleet.find(item => item.dumper_no === dumperNo);
  if (d) {
    simulator.smu = d.current_hours;
  }
  
  switchTab('telemetry');
}

function openOperatorFormFor(dumperNo) {
  const select = document.getElementById('op-dumper-select');
  if (select) select.value = dumperNo;
  switchTab('operator');
}

// ── Operator Shift check submissions ──
function loadOpDumperSelectDetails() {
  const select = document.getElementById('op-dumper-select');
  if (!select) return;
  select.innerHTML = '';
  
  const fleet = getFleet();
  fleet.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.dumper_no;
    opt.textContent = `${d.dumper_no} (QSK60 AC)`;
    select.appendChild(opt);
  });
}

function submitOperatorForm(e) {
  e.preventDefault();
  
  const dumperNo = document.getElementById('op-dumper-select').value;
  const opName = document.getElementById('op-name').value.trim();
  const formA = document.getElementById('op-forma').value.trim();

  // Read checkbox values
  const report = {
    oilDripping: document.getElementById('chk-leakage').checked,
    tireDamage: document.getElementById('chk-tire').checked,
    seatbeltWarning: document.getElementById('chk-seatbelt').checked,
    afdssDischarged: document.getElementById('chk-afdss').checked,
    steeringStiff: document.getElementById('chk-steering').checked,
    operator: opName,
    formA: formA,
    timestamp: new Date().toISOString()
  };

  // Cache operator report in memory for active sensor diagnostics overlay
  currentOperatorReport[dumperNo] = report;

  // Persist logs in browser LocalStorage
  const logs = JSON.parse(localStorage.getItem('beml_operator_logs') || '[]');
  logs.unshift({ dumper_no: dumperNo, ...report });
  localStorage.setItem('beml_operator_logs', JSON.stringify(logs));

  // Reset form
  document.getElementById('operator-shift-form').reset();
  
  alert(`Compliance check sheet successfully submitted for ${dumperNo}. Saved to GM Shift Audit Log.`);
  
  // Reload logs and swap screen to dashboard to see results
  loadAuditLogs();
  updateFleetDashboard();
  switchTab('dashboard');
}

// Loads DGMS compliance checklist logs
function loadAuditLogs() {
  const tbody = document.getElementById('audit-logs-list');
  if (!tbody) return;
  tbody.innerHTML = '';

  const logs = JSON.parse(localStorage.getItem('beml_operator_logs') || '[]');
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="no-logs">No shift checks logged for this shift yet.</td></tr>';
    return;
  }

  logs.forEach(l => {
    const time = new Date(l.timestamp).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit'
    });
    
    // Check compliance status
    let complStatus = 'safe';
    let complTxt = 'Compliant';
    
    const fails = [];
    if (l.oilDripping) fails.push('Lube leak');
    if (l.tireDamage) fails.push('Tire cuts');
    if (l.seatbeltWarning) fails.push('Seatbelt Alarm');
    if (l.afdssDischarged) fails.push('AFDSS Discharged');
    if (l.steeringStiff) fails.push('Stiff Steering');

    if (fails.length > 0) {
      complStatus = fails.some(f => f.includes('AFDSS') || f.includes('Tire')) ? 'crit' : 'warn';
      complTxt = fails.some(f => f.includes('AFDSS') || f.includes('Tire')) ? 'STOP WORK' : 'Warning Alert';
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${time}</td>
      <td style="font-weight:700;">${l.dumper_no}</td>
      <td>${l.operator} (${l.formA})</td>
      <td style="color: ${fails.length > 0 ? 'var(--status-crit)' : '#eee'}">${fails.length > 0 ? fails.join(', ') : 'None'}</td>
      <td>${l.oilDripping ? '⚠️ Yes' : 'No'}</td>
      <td><span class="comp-badge ${complStatus}">${complTxt}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Chatbot Diagnostics Co-Pilot ──
function clearChat() {
  const container = document.getElementById('chat-messages-container');
  if (container) {
    container.innerHTML = `
      <div class="chat-msg bot">
        Conversation cleared. How can I assist you with maintenance troubleshooting for your QSK60 engine or AC traction grids today?
      </div>
    `;
  }
}

function handleChatKeyPress(e) {
  if (e.key === 'Enter') {
    submitChatMessage();
  }
}

function submitChatMessage() {
  const input = document.getElementById('copilot-chat-input');
  if (!input || !input.value.trim()) return;

  const query = input.value.trim();
  input.value = '';

  appendUserChatBubble(query);

  // Generate bot response
  setTimeout(() => {
    const reply = parseBotResponse(query);
    appendBotChatBubble(reply);
  }, 400);
}

function sendQuickQuery(queryText) {
  appendUserChatBubble(queryText);
  setTimeout(() => {
    const reply = parseBotResponse(queryText);
    appendBotChatBubble(reply);
  }, 450);
}

function appendUserChatBubble(text) {
  const box = document.getElementById('chat-messages-container');
  if (!box) return;

  const div = document.createElement('div');
  div.className = 'chat-msg user';
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function appendBotChatBubble(text) {
  const box = document.getElementById('chat-messages-container');
  if (!box) return;

  const div = document.createElement('div');
  div.className = 'chat-msg bot';
  div.innerHTML = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function parseBotResponse(query) {
  const q = query.toLowerCase();

  // Search keyword database
  if (q.includes('cummins') && q.includes('415')) {
    const fc = CUMMINS_FAULT_CODES['415'];
    return `<b>Diagnostic Key: Cummins Fault Code ${fc.code}</b><br>
    <strong>System:</strong> ${fc.sys}<br>
    <strong>Description:</strong> ${fc.desc}<br>
    <strong>Symptoms:</strong> ${fc.symptom}<br>
    <strong>Troubleshooting Steps:</strong><br>
    1. Stop engine immediately. Do NOT run.<br>
    2. Check physical oil levels. Top up using 15W-40 oil.<br>
    3. Clean lubrication safety pressure regulator valves.<br>
    4. Connect diagnostic computer to verify pressure sender sensor voltage.`;
  }

  if (q.includes('suspension') || q.includes('nitrogen') || q.includes('strut')) {
    return `<b>OEM Engineering Protocol: Charging BEML 240T Suspension Cylinders (Front/Rear)</b><br>
    Maintaining suspension pressure prevents major stress load frame cracks.
    <br><br>
    <strong>Check Procedure:</strong><br>
    1. Measure chrome piston rod extension. Nominal height unladen is <b>190mm</b>.<br>
    2. Inspect gland wiper seals for active hydraulic fluid leaks.<br>
    <br>
    <strong>Recharging Instructions (Safety Check):</strong><br>
    1. Park dumper on flat concrete workshop floor. Install body lock pins.<br>
    2. Discharge all residual gas pressure completely by slowly opening the valve core.<br>
    3. Pump specified volume of hydraulic suspension oil into charging valve until overflowing from level plug port. Seal plug.<br>
    4. Attach high-pressure nitrogen charging hose with dual regulators.<br>
    5. Recharge strut with Nitrogen gas slowly until cylinder extends to <b>190mm</b> (front nominal 28 bar, rear nominal 30 bar).<br>
    6. Run soap bubbles test on gas valve to inspect for gas leaks.`;
  }

  if (q.includes('megger') || q.includes('insulation') || q.includes('traction motor') || q.includes('wheel motor')) {
    const fc = GE_FAULT_CODES['522'];
    return `<b>GE AC Traction Motor: Insulation Resistance (Megger) Test Procedure</b><br>
    To diagnose a GE drive ground fault code (Code 522), run the following insulation test:
    <br><br>
    <strong>⚠️ WARNING: Disconnect high-voltage cables from inverter cabinets before running megger. Ensure system capacitors are fully discharged.</strong>
    <br><br>
    <strong>Test Steps:</strong><br>
    1. Clean mud and coal dust accumulation from motor connection box terminals using clean solvent.<br>
    2. Connect <b>500V or 1000V DC</b> insulation tester (Megger) negative lead to motor frame chassis, positive lead to phase windings terminal block.<br>
    3. Run test for exactly 1 minute. Record resistance value.<br>
    4. Nominal winding insulation must read at least <b>100 Megohms</b> at 40°C.<br>
    5. If resistance reads below <b>5 Megohms</b>, the stator core is damaged by water ingress or heat. Dry windings using heaters or replace stator assembly.`;
  }

  if (q.includes('steering') || q.includes('sluggish') || q.includes('accumulators') || q.includes('stiff')) {
    return `<b>Hydraulic Steering Circuit Diagnosing: Stiff or Sluggish Action</b><br>
    Steering system demands full pressure (195 bar) for safety compliance under load.
    <br><br>
    <strong>Troubleshooting Matrix:</strong><br>
    1. <b>Test Steering Pressure:</b> Connect test gauge to pilot block manifold. Check for 195 bar under full steering lock. If below 170 bar, adjust relief valve spool.<br>
    2. <b>Check Accumulator Charge:</b> Stiff steering at low engine idle indicate emergency accumulators gas drop. Pre-charge pressure must be 90 bar. Replace accumulator bladder if ruptured.<br>
    3. <b>Priority Valve:</b> Clean and inspect priority flow divider valve. A sticking valve spool starves the steering pump circuit.`;
  }

  return `I have parsed your query regarding "${query}".
  <br><br>
  For detailed BEML PM procedures, ask about:
  - <b>"How to charge nitrogen in front suspension cylinders?"</b>
  - <b>"QSK60 low oil pressure fault code 415 troubleshooting"</b>
  - <b>"GE AC traction motor winding insulation test procedure"</b>
  - <b>"Steering stiff at low idle speed checks"</b>`;
}

// ── OEM Standards Renderers ──
function renderStandardsTable() {
  const tbody = document.getElementById('standards-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const groups = ['engine', 'driveSystem', 'hydraulic'];
  groups.forEach(gKey => {
    const group = OEM_STANDARDS[gKey];
    for (const [key, std] of Object.entries(group)) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:700; color:var(--txt-muted); text-transform:capitalize;">${gKey}</td>
        <td style="color:#fff; font-weight:600;">${std.name}</td>
        <td>${std.minNominal} - ${std.maxNominal}</td>
        <td>${std.lowAlarm || '—'} / ${std.highAlarm || '—'}</td>
        <td style="color:var(--status-crit); font-weight:700;">${std.critLow || '—'} / ${std.critHigh || '—'}</td>
        <td>${std.unit}</td>
      `;
      tbody.appendChild(tr);
    }
  });
}

function renderFaultCodesReference() {
  const cumminsList = document.getElementById('cummins-fc-ref-list');
  const geList = document.getElementById('ge-fc-ref-list');

  if (cumminsList) {
    cumminsList.innerHTML = '';
    for (const [code, fc] of Object.entries(CUMMINS_FAULT_CODES)) {
      const el = document.createElement('div');
      el.className = 'fc-item';
      el.innerHTML = `
        <div class="fc-header-row">
          <span class="fc-badge">CODE ${fc.code}</span>
          <span style="font-size:11px; color:var(--txt-muted); font-weight:700;">${fc.sys}</span>
        </div>
        <div class="fc-desc">${fc.desc}</div>
        <div class="fc-detail-text"><strong>Symptoms:</strong> ${fc.symptom}</div>
        <div class="fc-detail-text" style="color:var(--beml-gold);"><strong>Action:</strong> ${fc.action}</div>
      `;
      cumminsList.appendChild(el);
    }
  }

  if (geList) {
    geList.innerHTML = '';
    for (const [code, fc] of Object.entries(GE_FAULT_CODES)) {
      const el = document.createElement('div');
      el.className = 'fc-item';
      el.innerHTML = `
        <div class="fc-header-row">
          <span class="fc-badge">CODE ${fc.code}</span>
          <span style="font-size:11px; color:var(--txt-muted); font-weight:700;">${fc.sys}</span>
        </div>
        <div class="fc-desc">${fc.desc}</div>
        <div class="fc-detail-text"><strong>Symptoms:</strong> ${fc.symptom}</div>
        <div class="fc-detail-text" style="color:var(--beml-gold);"><strong>Action:</strong> ${fc.action}</div>
      `;
      geList.appendChild(el);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  BREAKDOWN WORKSPACE CONTROLLERS
// ═══════════════════════════════════════════════════════════════

// Populate dumper dropdown on Breakdown form
function loadBreakdownDumperSelect() {
  const select = document.getElementById('bd-dumper-select');
  if (!select) return;
  select.innerHTML = '';
  
  const fleet = getFleet();
  fleet.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.dumper_no;
    opt.textContent = `${d.dumper_no} (${d.status.toUpperCase()})`;
    select.appendChild(opt);
  });
}

// Submits a new active breakdown incident
function logNewBreakdown(e) {
  e.preventDefault();
  
  const dumperNo = document.getElementById('bd-dumper-select').value;
  const system = document.getElementById('bd-system-select').value;
  const severity = document.getElementById('bd-severity-select').value;
  const symptom = document.getElementById('bd-symptom-input').value.trim();

  if (!symptom) return;

  const fleet = getFleet();
  const dumper = fleet.find(d => d.dumper_no === dumperNo);
  if (!dumper) return;

  // 1. Force dumper status in fleet registry to Breakdown or Maintenance
  dumper.status = severity.includes('Total') ? 'breakdown' : 'maintenance';
  saveFleet(fleet);

  // 2. Log breakdown record
  const breakdownId = 'bd-' + Math.random().toString(36).substr(2, 9);
  const newIncident = {
    id: breakdownId,
    dumper_no: dumperNo,
    system: system,
    severity: severity,
    symptom: symptom,
    status: 'Diagnostics', // initial state
    logged_at: new Date().toISOString(),
    resolved_at: null
  };

  const breakdowns = JSON.parse(localStorage.getItem('beml_breakdowns') || '[]');
  breakdowns.unshift(newIncident);
  localStorage.setItem('beml_breakdowns', JSON.stringify(breakdowns));

  // 3. Create first timeline entry
  const timelineId = 'tl-' + Math.random().toString(36).substr(2, 9);
  const firstLog = {
    id: timelineId,
    breakdown_id: breakdownId,
    timestamp: new Date().toISOString(),
    text: `🚨 Incident logged. Sub-system affected: ${system}. Severity: ${severity}. Primary Symptom: "${symptom}". Status set to Diagnostics.`
  };
  const timeline = JSON.parse(localStorage.getItem('beml_breakdown_timeline') || '[]');
  timeline.unshift(firstLog);
  localStorage.setItem('beml_breakdown_timeline', JSON.stringify(timeline));

  // Reset form inputs
  document.getElementById('new-breakdown-form').reset();

  alert(`Incident successfully logged for ${dumperNo}. Dumper status updated.`);

  // Refresh view tables and load details
  updateFleetDashboard();
  loadBreakdownDumperSelect();
  renderBreakdownsList();
  selectBreakdown(breakdownId);
}

// Renders the list of active breakdowns on the left column
function renderBreakdownsList() {
  const container = document.getElementById('active-breakdowns-container');
  if (!container) return;
  container.innerHTML = '';

  const breakdowns = JSON.parse(localStorage.getItem('beml_breakdowns') || '[]');
  const active = breakdowns.filter(b => !b.resolved_at);

  if (active.length === 0) {
    container.innerHTML = '<div style="color:var(--txt-muted); text-align:center; padding: 20px; font-size:12px;">No active breakdowns logged.</div>';
    return;
  }

  active.forEach(b => {
    const card = document.createElement('div');
    
    // Determine severity class
    let sevClass = 'severity-warning';
    if (b.severity.includes('Shutdown')) sevClass = 'severity-shutdown';
    if (b.severity.includes('Total')) sevClass = 'severity-total';

    const isSelected = activeBreakdownId === b.id;
    card.className = `active-incident-card ${sevClass} ${isSelected ? 'sel' : ''}`;
    
    const minutesElapsed = Math.round((new Date() - new Date(b.logged_at)) / (60 * 1000));
    const timeStr = minutesElapsed === 0 ? 'Just now' : `${minutesElapsed} mins ago`;

    card.innerHTML = `
      <div>
        <div class="incident-dumper-no">
          ${b.dumper_no} <span class="incident-system">${b.system}</span>
        </div>
        <div class="incident-symptom">"${b.symptom}"</div>
        <div style="font-size:10px; color:var(--txt-muted); margin-top:6px;">Logged: ${timeStr}</div>
      </div>
      <div>
        <span class="incident-status-tag">${b.status}</span>
      </div>
    `;
    
    card.onclick = () => selectBreakdown(b.id);
    container.appendChild(card);
  });
}

// Selects an incident card and displays the timeline panel
function selectBreakdown(id) {
  activeBreakdownId = id;
  
  // Update selection highlight
  renderBreakdownsList();

  const breakdowns = JSON.parse(localStorage.getItem('beml_breakdowns') || '[]');
  const incident = breakdowns.find(b => b.id === id);

  const workspace = document.getElementById('timeline-workspace');
  const emptyWorkspace = document.getElementById('timeline-empty-workspace');

  if (incident && workspace && emptyWorkspace) {
    emptyWorkspace.style.display = 'none';
    workspace.style.display = 'flex';

    // Populate header details
    document.getElementById('timeline-dumper-no').textContent = incident.dumper_no;
    
    const symptomEl = document.getElementById('timeline-symptom');
    symptomEl.textContent = `Symptom: "${incident.symptom}" (System: ${incident.system})`;
    
    const badge = document.getElementById('timeline-severity-badge');
    badge.textContent = incident.severity;
    
    badge.className = 'timeline-badge';
    if (incident.severity.includes('Shutdown') || incident.severity.includes('Total')) {
      badge.classList.add('critical');
    } else {
      badge.classList.add('warning');
    }

    // Reset replaced checkboxes
    document.getElementById('part-oil').checked = false;
    document.getElementById('part-filters').checked = false;
    document.getElementById('part-tires').checked = false;
    document.getElementById('part-windings').checked = false;

    // Load timeline logs list
    renderTimelineFeed(id);
  }
}

// Renders the vertical action progress updates
function renderTimelineFeed(breakdownId) {
  const container = document.getElementById('timeline-feed-list');
  if (!container) return;
  container.innerHTML = '';

  const timeline = JSON.parse(localStorage.getItem('beml_breakdown_timeline') || '[]');
  const logs = timeline.filter(t => t.breakdown_id === breakdownId);

  if (logs.length === 0) {
    container.innerHTML = '<div style="color:var(--txt-muted); font-size:11px; padding:10px 0;">No updates posted.</div>';
    return;
  }

  // Render logs (sorted chronological for top-down timeline)
  const sortedLogs = [...logs].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));

  sortedLogs.forEach(log => {
    const item = document.createElement('div');
    const isResolvedLog = log.text.includes('Resolved') || log.text.includes('Operational');
    item.className = `timeline-item ${isResolvedLog ? 'status-resolved' : ''}`;
    
    const timeStr = new Date(log.timestamp).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    item.innerHTML = `
      <div class="timeline-time">${timeStr}</div>
      <div class="timeline-content">${log.text}</div>
    `;
    container.appendChild(item);
  });
  
  // Scroll to bottom of timeline
  container.scrollTop = container.scrollHeight;
}

// Submits a minute progress update note
function submitTimelineUpdate() {
  if (!activeBreakdownId) return;

  const noteInput = document.getElementById('timeline-note-input');
  if (!noteInput || !noteInput.value.trim()) return;

  const text = noteInput.value.trim();
  noteInput.value = '';

  const timelineId = 'tl-' + Math.random().toString(36).substr(2, 9);
  const newLog = {
    id: timelineId,
    breakdown_id: activeBreakdownId,
    timestamp: new Date().toISOString(),
    text: `🔧 ${text}`
  };

  const timeline = JSON.parse(localStorage.getItem('beml_breakdown_timeline') || '[]');
  timeline.unshift(newLog);
  localStorage.setItem('beml_breakdown_timeline', JSON.stringify(timeline));

  // If update comments on actions, we can change status dynamically
  const breakdowns = JSON.parse(localStorage.getItem('beml_breakdowns') || '[]');
  const incident = breakdowns.find(b => b.id === activeBreakdownId);
  if (incident) {
    const lowerText = text.toLowerCase();
    if (lowerText.includes('waiting') || lowerText.includes('spares') || lowerText.includes('part')) {
      incident.status = 'Waiting Spares';
    } else if (lowerText.includes('testing') || lowerText.includes('check')) {
      incident.status = 'Testing';
    } else {
      incident.status = 'Wrenching';
    }
    localStorage.setItem('beml_breakdowns', JSON.stringify(breakdowns));
    
    // Refresh left incident cards status badges
    renderBreakdownsList();
  }

  // Refresh timeline list
  renderTimelineFeed(activeBreakdownId);
}

// Completes repairs and resets the dumper's status and RUL values
function resolveActiveBreakdown() {
  if (!activeBreakdownId) return;

  const breakdowns = JSON.parse(localStorage.getItem('beml_breakdowns') || '[]');
  const incident = breakdowns.find(b => b.id === activeBreakdownId);
  if (!incident) return;

  const fleet = getFleet();
  const dumper = fleet.find(d => d.dumper_no === incident.dumper_no);
  if (!dumper) return;

  // 1. Mark breakdown resolved in storage
  incident.resolved_at = new Date().toISOString();
  incident.status = 'Resolved';
  localStorage.setItem('beml_breakdowns', JSON.stringify(breakdowns));

  // 2. Identify checkboxed replacements and reset RUL offsets
  const oilReplaced = document.getElementById('part-oil').checked;
  const filtersReplaced = document.getElementById('part-filters').checked;
  const tiresReplaced = document.getElementById('part-tires').checked;
  const windingsReplaced = document.getElementById('part-windings').checked;

  const partsList = [];
  if (oilReplaced) {
    dumper.last_oil_change = dumper.current_hours;
    partsList.push('Engine Oil');
  }
  if (filtersReplaced) {
    dumper.last_filter_change = dumper.current_hours;
    partsList.push('Air Filters');
  }
  if (tiresReplaced) {
    dumper.last_tire_change = dumper.current_hours;
    partsList.push('37R57 Tires');
  }
  if (windingsReplaced) {
    // windings are a core redesign life, reset reduces elapsed load hours
    dumper.current_hours = 0.00; // reset SMU hours frame (rare overhaul)
    partsList.push('Traction Stators');
  }

  // 3. Reset dumper registry state back to Operational
  dumper.status = 'operational';
  saveFleet(fleet);

  // 4. Log resolution timeline event
  const timelineId = 'tl-' + Math.random().toString(36).substr(2, 9);
  const resolveText = `✔️ Breakdown Resolved. Parts replaced: ${partsList.length > 0 ? partsList.join(', ') : 'None (Inspected/Adjusted)'}. Dumper status updated to Operational.`;
  
  const timeline = JSON.parse(localStorage.getItem('beml_breakdown_timeline') || '[]');
  timeline.unshift({
    id: timelineId,
    breakdown_id: activeBreakdownId,
    timestamp: new Date().toISOString(),
    text: resolveText
  });
  localStorage.setItem('beml_breakdown_timeline', JSON.stringify(timeline));

  // Notify engineer
  alert(`Dumper ${dumper.dumper_no} successfully returned to active service. Availability KPI recalculated.`);

  // Reset workspace layouts
  activeBreakdownId = null;
  document.getElementById('timeline-workspace').style.display = 'none';
  document.getElementById('timeline-empty-workspace').style.display = 'flex';

  // Refresh dashboards and list dropdowns
  updateFleetDashboard();
  loadBreakdownDumperSelect();
  renderBreakdownsList();
}

// ═══════════════════════════════════════════════════════════════
//  AI TRAINING DESK HANDLERS
// ═══════════════════════════════════════════════════════════════

// Update displayed reliability threshold percentage
function updateReliabilitySliderVal(val) {
  document.getElementById('reliability-slider-val').textContent = `${val}%`;
  localStorage.setItem('beml_reliability_threshold', val);
  
  // Re-run diagnostics on active telemetery tick to update alerts live
  if (simulator && simulator.values) {
    const data = {
      dumper_no: simulator.currentDumper,
      status: simulator.status,
      rpm: simulator.rpm,
      smu: simulator.smu,
      activeFault: simulator.activeFault,
      telemetry: { ...simulator.values }
    };
    onTelemetryTick(data);
  }
}

// Populates textarea with a synthetic 1-year historical CSV log
function loadSampleCSV() {
  const headers = "dumper_no,fault_system,operator_stiff_steering,operator_oil_dripping,operator_tire_damage,operator_afdss_red,engine_oil_pressure,engine_coolant_temp,engine_exhaust_temp,turbo_boost_pressure,crankcase_blowby,main_alternator_voltage,wheel_motor_temp_l,wheel_motor_temp_r,retarder_grid_temp,hydraulic_pump_pressure,steering_accumulator_pressure,suspension_pressure_front,suspension_pressure_rear\n";
  
  let csv = headers;
  
  // 1. Normal running conditions (35 records)
  for (let i = 0; i < 35; i++) {
    const oil = (3.5 + Math.random() * 1.5).toFixed(2);
    const coolant = (80 + Math.random() * 10).toFixed(1);
    const exhaust = (450 + Math.random() * 70).toFixed(0);
    const boost = (2.0 + Math.random() * 0.7).toFixed(2);
    const blowby = (0.5 + Math.random() * 2.0).toFixed(2);
    const alt = (700 + Math.random() * 200).toFixed(0);
    const wmL = (76 + Math.random() * 10).toFixed(1);
    const wmR = (75 + Math.random() * 11).toFixed(1);
    const grid = (80 + Math.random() * 50).toFixed(0);
    const hyd = (180 + Math.random() * 25).toFixed(0);
    const acc = (85 + Math.random() * 8).toFixed(1);
    const sf = (25 + Math.random() * 6).toFixed(1);
    const sr = (26 + Math.random() * 7).toFixed(1);
    csv += `BD-2401,Normal,0,0,0,0,${oil},${coolant},${exhaust},${boost},${blowby},${alt},${wmL},${wmR},${grid},${hyd},${acc},${sf},${sr}\n`;
  }
  
  // 2. Engine fault scenarios (overheating, low pressure, oil leaks) (15 records)
  for (let i = 0; i < 15; i++) {
    const isOverheat = Math.random() > 0.4;
    const oil = isOverheat ? (3.1 + Math.random() * 0.9).toFixed(2) : (1.7 + Math.random() * 0.4).toFixed(2);
    const coolant = isOverheat ? (96 + Math.random() * 5).toFixed(1) : (84 + Math.random() * 6).toFixed(1);
    const exhaust = isOverheat ? (605 + Math.random() * 30).toFixed(0) : (460 + Math.random() * 50).toFixed(0);
    const boost = isOverheat ? (1.4 + Math.random() * 0.3).toFixed(2) : (2.1 + Math.random() * 0.4).toFixed(2);
    const blowby = (1.0 + Math.random() * 8.5).toFixed(2);
    const alt = (710 + Math.random() * 90).toFixed(0);
    const wm = (77 + Math.random() * 10).toFixed(1);
    const grid = (81 + Math.random() * 25).toFixed(0);
    const hyd = (188 + Math.random() * 15).toFixed(0);
    const acc = (87 + Math.random() * 5).toFixed(1);
    const sf = (26 + Math.random() * 4).toFixed(1);
    const sr = (27 + Math.random() * 5).toFixed(1);
    const oilLeak = isOverheat ? 0 : 1;
    csv += `BD-2401,Engine,0,${oilLeak},0,0,${oil},${coolant},${exhaust},${boost},${blowby},${alt},${wm},${wm},${grid},${hyd},${acc},${sf},${sr}\n`;
  }

  // 3. Drive System failures (motor overtemperature, grid overtemperature) (15 records)
  for (let i = 0; i < 15; i++) {
    const isGrid = Math.random() > 0.5;
    const oil = (3.6 + Math.random() * 1.0).toFixed(2);
    const coolant = (81 + Math.random() * 8).toFixed(1);
    const exhaust = (455 + Math.random() * 55).toFixed(0);
    const boost = (2.1 + Math.random() * 0.4).toFixed(2);
    const blowby = (1.0 + Math.random() * 1.6).toFixed(2);
    const alt = isGrid ? (850 + Math.random() * 150).toFixed(0) : (700 + Math.random() * 90).toFixed(0);
    const wmR = (76 + Math.random() * 8).toFixed(1);
    const wmL = isGrid ? (81 + Math.random() * 11).toFixed(1) : (107 + Math.random() * 7).toFixed(1);
    const grid = isGrid ? (215 + Math.random() * 30).toFixed(0) : (82 + Math.random() * 20).toFixed(0);
    const hyd = (186 + Math.random() * 12).toFixed(0);
    const acc = (86 + Math.random() * 5).toFixed(1);
    const sf = (25 + Math.random() * 5).toFixed(1);
    const sr = (28 + Math.random() * 5).toFixed(1);
    csv += `BD-2402,Drive System,0,0,0,0,${oil},${coolant},${exhaust},${boost},${blowby},${alt},${wmL},${wmR},${grid},${hyd},${acc},${sf},${sr}\n`;
  }

  // 4. Hydraulics system failure (stiff steering + low N2 precharge) (15 records)
  for (let i = 0; i < 15; i++) {
    const oil = (3.8 + Math.random() * 0.7).toFixed(2);
    const coolant = (84 + Math.random() * 5).toFixed(1);
    const exhaust = (465 + Math.random() * 35).toFixed(0);
    const boost = (2.2 + Math.random() * 0.3).toFixed(2);
    const blowby = (1.1 + Math.random() * 1.2).toFixed(2);
    const alt = (715 + Math.random() * 75).toFixed(0);
    const wm = (78 + Math.random() * 7).toFixed(1);
    const grid = (82 + Math.random() * 18).toFixed(0);
    const hyd = (165 + Math.random() * 18).toFixed(0);
    const acc = (67 + Math.random() * 7).toFixed(1);
    const sf = (26 + Math.random() * 4).toFixed(1);
    const sr = (27 + Math.random() * 4).toFixed(1);
    csv += `BD-2403,Hydraulics,1,0,0,0,${oil},${coolant},${exhaust},${boost},${blowby},${alt},${wm},${wm},${grid},${hyd},${acc},${sf},${sr}\n`;
  }

  // 5. Suspension strut low pressure failures (15 records)
  for (let i = 0; i < 15; i++) {
    const oil = (3.9 + Math.random() * 0.5).toFixed(2);
    const coolant = (83 + Math.random() * 4).toFixed(1);
    const exhaust = (460 + Math.random() * 25).toFixed(0);
    const boost = (2.1 + Math.random() * 0.2).toFixed(2);
    const blowby = (0.9 + Math.random() * 0.9).toFixed(2);
    const alt = (705 + Math.random() * 45).toFixed(0);
    const wm = (79 + Math.random() * 5).toFixed(1);
    const grid = (84 + Math.random() * 10).toFixed(0);
    const hyd = (191 + Math.random() * 8).toFixed(0);
    const acc = (88 + Math.random() * 3).toFixed(1);
    const sf = (12 + Math.random() * 4).toFixed(1);
    const sr = (13 + Math.random() * 4).toFixed(1);
    csv += `BD-2401,Suspension,0,0,0,0,${oil},${coolant},${exhaust},${boost},${blowby},${alt},${wm},${wm},${grid},${hyd},${acc},${sf},${sr}\n`;
  }

  document.getElementById('csv-input').value = csv;
}

// Parses CSV dataset, splits train/test partitions, trains Bayes classifier, and runs evaluation
function trainAIModel() {
  const csvText = document.getElementById('csv-input').value.trim();
  if (!csvText) {
    alert('⚠️ Please paste or load CSV breakdown data first!');
    return;
  }

  try {
    const lines = csvText.split('\n');
    if (lines.length < 2) {
      alert('⚠️ Invalid CSV structure. Make sure headers are present.');
      return;
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const dataset = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(',');
      if (cols.length < headers.length) continue;

      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = cols[idx].trim();
      });
      dataset.push(obj);
    }

    if (dataset.length < 5) {
      alert('⚠️ Training data requires at least 5 entries.');
      return;
    }

    // Shuffle and partition split: 80% Training / 20% Testing sets
    const shuffled = [...dataset].sort(() => Math.random() - 0.5);
    const trainSize = Math.floor(shuffled.length * 0.8);
    const trainData = shuffled.slice(0, trainSize);
    const testData = shuffled.slice(trainSize);

    // Train the Gaussian Naive Bayes Model
    const model = AIEngine.trainModel(trainData);
    
    // Evaluate metrics using test partition (fallback to full if test set is too small)
    const evalSet = testData.length >= 2 ? testData : shuffled;
    const evaluation = AIEngine.evaluateModel(model, evalSet);

    // Save model state & user threshold limits to localStorage
    localStorage.setItem('beml_trained_model', JSON.stringify(model));
    const threshold = document.getElementById('reliability-slider').value;
    localStorage.setItem('beml_reliability_threshold', threshold);

    // Update Diagnostics Dashboard Cards
    document.getElementById('model-accuracy-val').textContent = `${(evaluation.accuracy * 100).toFixed(0)}%`;
    document.getElementById('model-precision-val').textContent = `${(evaluation.precision * 100).toFixed(0)}%`;
    document.getElementById('model-recall-val').textContent = `${(evaluation.recall * 100).toFixed(0)}%`;

    // Render Confusion Matrix
    renderConfusionMatrix(evaluation.confusionMatrix);

    // Render learned rules parameters
    renderLearnedRules(model);

    alert(`⚡ AI Training Completed!\n\nParsed: ${shuffled.length} logs\nTrained: ${trainData.length} records\nEvaluated: ${evalSet.length} records\nModel Accuracy: ${(evaluation.accuracy * 100).toFixed(0)}%`);

    // Force updates to live sensor dashboard immediately
    if (simulator && simulator.values) {
      onTelemetryTick({
        dumper_no: simulator.currentDumper,
        status: simulator.status,
        rpm: simulator.rpm,
        smu: simulator.smu,
        activeFault: simulator.activeFault,
        telemetry: { ...simulator.values }
      });
    }

  } catch (err) {
    console.error(err);
    alert(`❌ Training Error: ${err.message}`);
  }
}

// Renders the actual vs predicted confusion matrix HTML grid
function renderConfusionMatrix(matrix) {
  const tbody = document.getElementById('confusion-matrix-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const classes = ['Engine', 'Drive System', 'Hydraulics', 'Suspension', 'Normal'];
  classes.forEach(actual => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="font-weight:700; text-align:left; color:#fff; padding:6px; border: 1px solid rgba(255, 255, 255, 0.05);">${actual}</td>`;
    
    classes.forEach(pred => {
      const count = (matrix[actual] && matrix[actual][pred] !== undefined) ? matrix[actual][pred] : 0;
      let cellCls = 'zero-cell';
      if (count > 0) {
        cellCls = actual === pred ? 'diagonal' : 'off-diagonal';
      }
      tr.innerHTML += `<td class="${cellCls}" style="padding:6px; font-weight:${count > 0 ? '700' : '400'}; border: 1px solid rgba(255, 255, 255, 0.05);">${count}</td>`;
    });
    
    tbody.appendChild(tr);
  });
}

// Renders visual parameter weights extracted from the training data
function renderLearnedRules(model) {
  const container = document.getElementById('learned-rules-container');
  if (!container) return;
  container.innerHTML = '';

  const classes = ['Engine', 'Drive System', 'Hydraulics', 'Suspension', 'Normal'];
  classes.forEach(cls => {
    const div = document.createElement('div');
    div.className = 'rule-item';
    
    let keyInfo = '';
    if (cls === 'Engine') {
      const oil = model.gaussians[cls]['engine_oil_pressure'];
      const coolant = model.gaussians[cls]['engine_coolant_temp'];
      keyInfo = `Lube Oil Press (μ: ${oil.mean.toFixed(2)} bar), Coolant (μ: ${coolant.mean.toFixed(1)}°C)`;
    } else if (cls === 'Drive System') {
      const grid = model.gaussians[cls]['retarder_grid_temp'];
      const alt = model.gaussians[cls]['main_alternator_voltage'];
      keyInfo = `Grid Temp (μ: ${grid.mean.toFixed(0)}°C), Alt (μ: ${alt.mean.toFixed(0)}V)`;
    } else if (cls === 'Hydraulics') {
      const acc = model.gaussians[cls]['steering_accumulator_pressure'];
      const stiff = model.categoricals[cls]['operator_stiff_steering'];
      keyInfo = `N2 Accumulator (μ: ${acc.mean.toFixed(1)} bar), Sluggish (P: ${(stiff * 100).toFixed(0)}%)`;
    } else if (cls === 'Suspension') {
      const sf = model.gaussians[cls]['suspension_pressure_front'];
      keyInfo = `Suspension Front (μ: ${sf.mean.toFixed(1)} bar)`;
    } else {
      keyInfo = `Priors: ${(model.priors[cls] * 100).toFixed(0)}% chance of normal haul cycles`;
    }

    const badgeCls = cls === 'Drive System' ? 'drive' : cls.toLowerCase();
    div.innerHTML = `
      <span class="rule-system-badge ${badgeCls}">${cls}</span>
      <span style="font-weight:600; color:#ddd; font-size:10px;">${keyInfo}</span>
    `;
    container.appendChild(div);
  });
}

