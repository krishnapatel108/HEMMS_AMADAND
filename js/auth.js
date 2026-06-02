// ═══════════════════════════════════════════════════════════════
//  HEMM Report — auth.js
//  Authentication wrapper using Supabase Auth
//  Supports dual-mode: Supabase Auth OR Local Mock Auth
//  Depends: supabase-client.js (SB, initSupabase, USE_LOCAL_MOCK, loadLocalData)
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Auth State ───────────────────────────────────────────────
let currentUser = null;
let currentRole = null;   // 'operator' | 'engineer' | 'admin'
let isLoggedIn  = false;

// ═══════════════════════════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════════════════════════

// Check if a user is already signed in and restore state
async function initAuth() {
  try {
    if (typeof USE_LOCAL_MOCK !== 'undefined' && USE_LOCAL_MOCK) {
      const sessStr = sessionStorage.getItem('hemm_mock_session');
      if (sessStr) {
        const sess = JSON.parse(sessStr);
        currentUser = { email: sess.email };
        currentRole = sess.role;
        isLoggedIn  = true;
        return { success: true, role: currentRole };
      }
      _resetAuthState();
      return { success: false, error: 'No active session' };
    }

    if (!SB) initSupabase();
    if (!SB) return { success: false, error: 'Supabase not initialized' };

    const { data: { session }, error } = await SB.auth.getSession();
    if (error || !session) {
      _resetAuthState();
      return { success: false, error: error ? error.message : 'No active session' };
    }

    currentUser = session.user;
    isLoggedIn  = true;
    currentRole = await _resolveRole(session.user);
    return { success: true, role: currentRole };
  } catch (err) {
    console.error('initAuth:', err);
    _resetAuthState();
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  SIGN IN — Anonymous (Operators)
// ═══════════════════════════════════════════════════════════════

// Operators don't need to login — create an anonymous session
async function signInAnonymous() {
  try {
    if (typeof USE_LOCAL_MOCK !== 'undefined' && USE_LOCAL_MOCK) {
      currentUser = { email: 'anonymous@hemm.local', is_anonymous: true };
      currentRole = 'operator';
      isLoggedIn  = true;
      return { success: true, role: 'operator', error: null };
    }

    if (!SB) initSupabase();
    if (!SB) return { success: false, role: null, error: 'Supabase not initialized' };

    const { data, error } = await SB.auth.signInAnonymously();
    if (error) {
      return { success: false, role: null, error: error.message };
    }

    currentUser = data.user;
    currentRole = 'operator';
    isLoggedIn  = true;
    return { success: true, role: 'operator', error: null };
  } catch (err) {
    console.error('signInAnonymous:', err);
    return { success: false, role: null, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
//  SIGN IN — Credentials (Engineer / Admin)
// ═══════════════════════════════════════════════════════════════

async function signInWithCredentials(email, password) {
  try {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = String(password).trim();

    if (!cleanEmail || !cleanPassword) {
      return { success: false, role: null, error: { message: 'ID and password required' } };
    }

    if (typeof USE_LOCAL_MOCK !== 'undefined' && USE_LOCAL_MOCK) {
      const mock = await loadLocalData();
      if (!mock) {
        return { success: false, role: null, error: { message: 'Local credentials file not loaded' } };
      }

      // Extract Staff ID from email (e.g. "95004182" from "95004182@hemm.local")
      const staffId = cleanEmail.split('@')[0];

      // 1. Verify Admin (default config check)
      if (mock.config && mock.config.adminCredentials) {
        const adminCred = mock.config.adminCredentials.find(c => 
          String(c.id).trim().toLowerCase() === staffId.toLowerCase()
        );
        if (adminCred && String(adminCred.pass).trim() === cleanPassword) {
          currentUser = { email: cleanEmail };
          currentRole = 'admin';
          isLoggedIn  = true;
          sessionStorage.setItem('hemm_mock_session', JSON.stringify({
            email: cleanEmail, role: 'admin', staffId
          }));
          return { success: true, role: 'admin', error: null };
        }
      }

      // 2. Verify Engineer PIN fallback (e.g. ID "8085" or any custom staff ID with pin "8085")
      if (mock.config && mock.config.engineerPin) {
        const pin = String(mock.config.engineerPin).trim();
        if (cleanPassword === pin || (staffId === pin && cleanPassword === pin)) {
          currentUser = { email: cleanEmail };
          currentRole = 'engineer';
          isLoggedIn  = true;
          sessionStorage.setItem('hemm_mock_session', JSON.stringify({
            email: cleanEmail, role: 'engineer', staffId
          }));
          return { success: true, role: 'engineer', error: null };
        }
      }

      // 3. Verify Custom Mock Accounts from localStorage
      const customStored = localStorage.getItem('hemm_mock_staff_accounts');
      if (customStored) {
        const accounts = JSON.parse(customStored);
        const userAccount = accounts.find(a => String(a.staff_id).trim().toLowerCase() === staffId.toLowerCase());
        if (userAccount) {
          const mockPasswords = JSON.parse(localStorage.getItem('hemm_mock_passwords') || '{}');
          const savedPass = mockPasswords[staffId.toLowerCase()];
          if (savedPass && savedPass === cleanPassword) {
            currentUser = { email: cleanEmail };
            currentRole = userAccount.role;
            isLoggedIn  = true;
            sessionStorage.setItem('hemm_mock_session', JSON.stringify({
              email: cleanEmail, role: userAccount.role, staffId
            }));
            return { success: true, role: userAccount.role, error: null };
          }
        }
      }

      return { success: false, role: null, error: { message: 'Invalid Staff ID or Password' } };
    }

    if (!SB) initSupabase();
    if (!SB) return { success: false, role: null, error: { message: 'Supabase not initialized' } };

    const { data, error } = await SB.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanPassword,
    });

    if (error) {
      return { success: false, role: null, error };
    }

    currentUser = data.user;
    isLoggedIn  = true;
    currentRole = await _resolveRole(data.user);

    return { success: true, role: currentRole, error: null };
  } catch (err) {
    console.error('signInWithCredentials:', err);
    return { success: false, role: null, error: { message: err.message } };
  }
}

// ═══════════════════════════════════════════════════════════════
//  SIGN OUT
// ═══════════════════════════════════════════════════════════════

async function signOut() {
  try {
    if (typeof USE_LOCAL_MOCK !== 'undefined' && USE_LOCAL_MOCK) {
      sessionStorage.removeItem('hemm_mock_session');
      _resetAuthState();
      return;
    }
    if (SB) await SB.auth.signOut();
  } catch (err) {
    console.error('signOut:', err);
  } finally {
    _resetAuthState();
  }
}

// ═══════════════════════════════════════════════════════════════
//  SESSION & ROLE HELPERS
// ═══════════════════════════════════════════════════════════════

async function getSession() {
  try {
    if (typeof USE_LOCAL_MOCK !== 'undefined' && USE_LOCAL_MOCK) {
      const sessStr = sessionStorage.getItem('hemm_mock_session');
      return sessStr ? JSON.parse(sessStr) : null;
    }
    if (!SB) return null;
    const { data: { session } } = await SB.auth.getSession();
    return session;
  } catch (err) {
    console.error('getSession:', err);
    return null;
  }
}

function isEngineer() {
  return currentRole === 'engineer' || currentRole === 'admin';
}

function isAdmin() {
  return currentRole === 'admin';
}

function requireAuth(minRole) {
  const roleHierarchy = { operator: 0, engineer: 1, admin: 2 };
  const userLevel = roleHierarchy[currentRole] ?? -1;
  const needLevel = roleHierarchy[minRole] ?? 0;

  if (!isLoggedIn || userLevel < needLevel) {
    window.location.href = 'index.html';
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
//  INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════

function _resetAuthState() {
  currentUser = null;
  currentRole = null;
  isLoggedIn  = false;
}

async function _resolveRole(user) {
  if (!user) return 'operator';

  const metaRole = user.user_metadata && user.user_metadata.role;
  if (metaRole && ['operator', 'engineer', 'admin'].includes(metaRole)) {
    return metaRole;
  }

  const appRole = user.app_metadata && user.app_metadata.role;
  if (appRole && ['operator', 'engineer', 'admin'].includes(appRole)) {
    return appRole;
  }

  try {
    if (!SB) return 'operator';
    const { data, error } = await SB
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!error && data && data.role) {
      return data.role;
    }
  } catch (err) {
    console.error('_resolveRole fallback:', err);
  }

  if (user.is_anonymous) return 'operator';
  return 'operator';
}
