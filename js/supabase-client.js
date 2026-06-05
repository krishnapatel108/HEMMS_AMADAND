// ═══════════════════════════════════════════════════════════════
//  HEMM Report — supabase-client.js
//  Supabase client init + database wrapper functions
//  Supports dual-mode: Supabase DB Mode OR Local Mock Mode
//  Uses: window.supabase (from CDN @supabase/supabase-js@2)
//  Depends: config.js (SUPABASE_URL, SUPABASE_ANON, FALLBACK_APPS_SCRIPT_URL)
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Client State & Mock Flags ─────────────────────────────────
let SB = null;
let USE_LOCAL_MOCK = false;
let LOCAL_MOCK_DATA = null;

// Auto-detect local mock mode
if (typeof SUPABASE_URL === 'undefined' || SUPABASE_URL.includes('YOUR_PROJECT_ID')) {
  USE_LOCAL_MOCK = true;
  console.warn('⚡ HEMM: Supabase keys not set. Running in LOCAL MOCK MODE.');
}

// Helper to fetch and parse local operator JSON data
async function loadLocalData() {
  if (LOCAL_MOCK_DATA) return LOCAL_MOCK_DATA;
  try {
    const res = await fetch('jsonAdminOperator.txt');
    if (!res.ok) throw new Error('Status: ' + res.status);
    let text = await res.text();
    text = text.trim();
    
    // Ensure valid enclosing braces
    if (!text.startsWith('{')) text = '{' + text;
    if (!text.endsWith('}')) text = text + '}';
    
    LOCAL_MOCK_DATA = JSON.parse(text);
    return LOCAL_MOCK_DATA;
  } catch (err) {
    console.warn('Local data file not available. Running in limited mock mode.');
    LOCAL_MOCK_DATA = {
      config: {
        adminCredentials: [],
        engineerPin: '',
        ownerWhatsApp: ''
      },
      operators: {}
    };
    return LOCAL_MOCK_DATA;
  }
}

function initSupabase() {
  if (USE_LOCAL_MOCK) {
    // Trigger loading local file in background early
    loadLocalData();
    return null;
  }
  if (SB) return SB;
  if (typeof supabase === 'undefined' || !supabase.createClient) {
    console.error('Supabase CDN not loaded');
    return null;
  }
  try {
    SB = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    return SB;
  } catch (err) {
    console.error('Failed to init Supabase client:', err);
    USE_LOCAL_MOCK = true;
    loadLocalData();
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  REPORT OPERATIONS
// ═══════════════════════════════════════════════════════════════

// ── Submit Report ────────────────────────────────────────────
async function submitReport(reportData) {
  try {
    if (USE_LOCAL_MOCK) {
      const reports = JSON.parse(localStorage.getItem('hemm_mock_reports') || '[]');
      reports.unshift(reportData);
      localStorage.setItem('hemm_mock_reports', JSON.stringify(reports));
      
      // Dispatch storage event to trigger dashboard update on same page
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'hemm_mock_reports',
        newValue: JSON.stringify(reports)
      }));
      
      return { data: reportData, error: null };
    }

    if (!SB) return { data: null, error: { message: 'Supabase not initialized' } };
    const { data, error } = await SB
      .from('reports')
      .insert([reportData])
      .select()
      .single();
    return { data, error };
  } catch (err) {
    console.error('submitReport:', err);
    return { data: null, error: { message: err.message } };
  }
}

// ── Get All Active Reports ────────────────────────────────────
async function getReports() {
  try {
    if (USE_LOCAL_MOCK) {
      const reports = JSON.parse(localStorage.getItem('hemm_mock_reports') || '[]');
      const active = reports.filter(r => !r.archived_at);
      return { data: active, error: null };
    }

    if (!SB) return { data: null, error: { message: 'Supabase not initialized' } };
    const { data, error } = await SB
      .from('reports')
      .select('*')
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    return { data, error };
  } catch (err) {
    console.error('getReports:', err);
    return { data: null, error: { message: err.message } };
  }
}

// ── Update Report Status ─────────────────────────────────────
async function updateReportStatus(id, status) {
  try {
    if (!isValidStatus(status)) {
      return { data: null, error: { message: 'Invalid status: ' + status } };
    }

    if (USE_LOCAL_MOCK) {
      const reports = JSON.parse(localStorage.getItem('hemm_mock_reports') || '[]');
      const idx = reports.findIndex(r => r.id === id);
      if (idx !== -1) {
        reports[idx].status = status;
        reports[idx].updated_at = new Date().toISOString();
        localStorage.setItem('hemm_mock_reports', JSON.stringify(reports));
        
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'hemm_mock_reports',
          newValue: JSON.stringify(reports)
        }));
        
        return { data: reports[idx], error: null };
      }
      return { data: null, error: { message: 'Report not found' } };
    }

    if (!SB) return { data: null, error: { message: 'Supabase not initialized' } };
    const { data, error } = await SB
      .from('reports')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    return { data, error };
  } catch (err) {
    console.error('updateReportStatus:', err);
    return { data: null, error: { message: err.message } };
  }
}

// ── Delete Report ────────────────────────────────────────────
async function deleteReport(id) {
  try {
    if (USE_LOCAL_MOCK) {
      const reports = JSON.parse(localStorage.getItem('hemm_mock_reports') || '[]');
      const filtered = reports.filter(r => r.id !== id);
      localStorage.setItem('hemm_mock_reports', JSON.stringify(filtered));
      
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'hemm_mock_reports',
        newValue: JSON.stringify(filtered)
      }));
      
      return { data: null, error: null };
    }

    if (!SB) return { data: null, error: { message: 'Supabase not initialized' } };
    const { data, error } = await SB
      .from('reports')
      .delete()
      .eq('id', id);
    return { data, error };
  } catch (err) {
    console.error('deleteReport:', err);
    return { data: null, error: { message: err.message } };
  }
}

// ── Real-Time Subscription ───────────────────────────────────
function subscribeReports(callback) {
  if (USE_LOCAL_MOCK) {
    const handler = (e) => {
      if (e.key === 'hemm_mock_reports') {
        const reports = JSON.parse(e.newValue || '[]');
        // Simulate change update
        callback('UPDATE', null, null);
      }
    };
    window.addEventListener('storage', handler);
    // Custom window listener trigger for single-tab updates
    window.addEventListener('mock-db-update', () => callback('UPDATE', null, null));
    
    return {
      unsubscribe: () => {
        window.removeEventListener('storage', handler);
        window.removeEventListener('mock-db-update', () => {});
      },
    };
  }

  if (!SB) {
    console.error('subscribeReports: Supabase not initialized');
    return { unsubscribe: () => {} };
  }

  const channel = SB
    .channel('reports-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reports' },
      (payload) => {
        try {
          callback(payload.eventType, payload.new, payload.old);
        } catch (err) {
          console.error('subscribeReports callback:', err);
        }
      }
    )
    .subscribe();

  return {
    unsubscribe: () => {
      SB.removeChannel(channel);
    },
  };
}

// ═══════════════════════════════════════════════════════════════
//  OPERATOR VERIFICATION
// ═══════════════════════════════════════════════════════════════

async function verifyOperator(formA, dob) {
  try {
    const sanitizedFormA = sanitizeText(formA, 20).trim();
    // Fix parsing issue: if dob is already YYYY-MM-DD (has dashes), use it directly
    const parsedDob = (typeof dob === 'string' && dob.includes('-')) ? dob : parseDOB(dob);
    
    if (!sanitizedFormA || !parsedDob) {
      return null;
    }

    if (USE_LOCAL_MOCK) {
      const mock = await loadLocalData();
      if (!mock || !mock.operators) {
        return null;
      }
      
      // Look up operator by key or by FormA lookup
      const normalizedKey = sanitizedFormA.toLowerCase().replace('/', '-');
      let op = mock.operators[sanitizedFormA] || mock.operators[normalizedKey];
      if (!op) {
        // Fallback linear scan
        op = Object.values(mock.operators).find(o => 
          String(o.formA).trim().toLowerCase() === sanitizedFormA.toLowerCase()
        );
      }
      
      if (op && op.dob === parsedDob) {
        return { 
          id: op.formA, // Add id mapping for operator.js
          form_a: op.formA, 
          name: op.name, 
          designation: op.designation,
          dob: op.dob 
        };
      }
      return null;
    }

    if (!SB) return null;
    // Use secure RPC function — cannot dump entire table
    const { data, error } = await SB.rpc('verify_operator', {
      p_form_a: sanitizedFormA,
      p_dob: parsedDob
    });
      
    if (error || !data) return null;
    return {
      ...data,
      id: data.form_a // Add id mapping for operator.js
    };
  } catch (err) {
    console.error('verifyOperator:', err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  ARCHIVE OPERATIONS
// ═══════════════════════════════════════════════════════════════

async function archiveReport(reportId, monthKey) {
  try {
    if (USE_LOCAL_MOCK) {
      const reports = JSON.parse(localStorage.getItem('hemm_mock_reports') || '[]');
      const idx = reports.findIndex(r => r.id === reportId);
      if (idx !== -1) {
        reports[idx].archived_at = new Date().toISOString();
        reports[idx].archive_month = monthKey;
        localStorage.setItem('hemm_mock_reports', JSON.stringify(reports));
        
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'hemm_mock_reports',
          newValue: JSON.stringify(reports)
        }));
        
        return { data: reports[idx], error: null };
      }
      return { data: null, error: { message: 'Report not found' } };
    }

    if (!SB) return { data: null, error: { message: 'Supabase not initialized' } };
    const { data, error } = await SB
      .from('reports')
      .update({
        archived_at: new Date().toISOString(),
        archive_month: monthKey,
      })
      .eq('id', reportId)
      .select()
      .single();
    return { data, error };
  } catch (err) {
    console.error('archiveReport:', err);
    return { data: null, error: { message: err.message } };
  }
}

async function getArchivedReports(monthKey) {
  try {
    if (USE_LOCAL_MOCK) {
      const reports = JSON.parse(localStorage.getItem('hemm_mock_reports') || '[]');
      const archived = reports.filter(r => r.archived_at && r.archive_month === monthKey);
      return { data: archived, error: null };
    }

    if (!SB) return { data: null, error: { message: 'Supabase not initialized' } };
    const { data, error } = await SB
      .from('reports')
      .select('*')
      .eq('archive_month', monthKey)
      .not('archived_at', 'is', null)
      .order('created_at', { ascending: false });
    return { data, error };
  } catch (err) {
    console.error('getArchivedReports:', err);
    return { data: null, error: { message: err.message } };
  }
}

async function getArchiveMonths() {
  try {
    if (USE_LOCAL_MOCK) {
      const reports = JSON.parse(localStorage.getItem('hemm_mock_reports') || '[]');
      const months = [...new Set(
        reports.filter(r => r.archived_at && r.archive_month).map(r => r.archive_month)
      )].sort().reverse();
      return { data: months, error: null };
    }

    if (!SB) return { data: null, error: { message: 'Supabase not initialized' } };
    const { data, error } = await SB
      .from('reports')
      .select('archive_month')
      .not('archived_at', 'is', null)
      .not('archive_month', 'is', null);
    if (error) return { data: null, error };
    const months = [...new Set(data.map(r => r.archive_month))].sort().reverse();
    return { data: months, error: null };
  } catch (err) {
    console.error('getArchiveMonths:', err);
    return { data: null, error: { message: err.message } };
  }
}

// ═══════════════════════════════════════════════════════════════
//  CONFIG OPERATIONS
// ═══════════════════════════════════════════════════════════════

async function getConfig(key) {
  try {
    if (USE_LOCAL_MOCK) {
      if (key === 'apps_script_url') {
        return { data: { key, value: '' }, error: null };
      }
      const mock = await loadLocalData();
      if (mock && mock.config) {
        if (key === 'whatsapp_number') {
          return { data: { key, value: mock.config.ownerWhatsApp }, error: null };
        }
      }
      return { data: null, error: null };
    }

    if (!SB) return { data: null, error: { message: 'Supabase not initialized' } };
    const { data, error } = await SB
      .from('config')
      .select('key, value')
      .eq('key', key)
      .maybeSingle();
    return { data, error };
  } catch (err) {
    console.error('getConfig:', err);
    return { data: null, error: { message: err.message } };
  }
}
