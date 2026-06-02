-- ═══════════════════════════════════════════════════════════════
--  HEMM Report — Supabase SQL Database Setup Script
--  Copy and run this script in the Supabase SQL Editor (Dashboard)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Create Tables ──────────────────────────────────────────

-- Reports table
CREATE TABLE IF NOT EXISTS public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine TEXT NOT NULL,
    tipper_no TEXT NOT NULL,
    problems TEXT[] DEFAULT '{}',
    note TEXT DEFAULT '',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved')),
    operator_auth TEXT DEFAULT 'unknown' CHECK (operator_auth IN ('authorized', 'unauthorized', 'unknown')),
    operator_name TEXT DEFAULT '—',
    operator_designation TEXT DEFAULT '—',
    operator_form_a TEXT DEFAULT '—',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    archived_at TIMESTAMPTZ DEFAULT NULL,
    archive_month TEXT DEFAULT NULL
);

-- Operators lookup table (read-only verification for operators)
CREATE TABLE IF NOT EXISTS public.operators (
    form_a TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    designation TEXT DEFAULT 'Dumper Operator',
    dob DATE NOT NULL
);

-- Config table (for key-value settings, e.g. Apps Script URL, WhatsApp number)
CREATE TABLE IF NOT EXISTS public.config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Staff accounts mapping (records created when adding new engineer/admin)
CREATE TABLE IF NOT EXISTS public.staff_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('engineer', 'admin')),
    label TEXT DEFAULT '',
    auth_uid UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User roles fallback table (for auth fallback checks)
CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('operator', 'engineer', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ── 2. Enable Row Level Security (RLS) ───────────────────────

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;


-- ── 3. Define RLS Policies ───────────────────────────────────

-- ── REPORTS POLICIES ──
-- Anyone can submit (INSERT) reports (Operators don't need credentials)
CREATE POLICY "Allow anyone to submit reports" ON public.reports
    FOR INSERT WITH CHECK (true);

-- Authenticated staff (Engineers & Admins) can read reports
CREATE POLICY "Allow authenticated staff to read reports" ON public.reports
    FOR SELECT TO authenticated USING (true);

-- Authenticated staff can update reports (Engineers & Admins can change status/archive)
CREATE POLICY "Allow authenticated staff to update reports" ON public.reports
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Only Admins can delete reports (We restrict delete to staff who are admins)
CREATE POLICY "Only admins can delete reports" ON public.reports
    FOR DELETE TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.staff_accounts 
            WHERE staff_accounts.auth_uid = auth.uid() AND staff_accounts.role = 'admin'
        )
    );

-- ── OPERATORS POLICIES ──
-- Anyone can search/verify operators (checked against Form A and DOB during verification)
CREATE POLICY "Allow anyone to verify operators" ON public.operators
    FOR SELECT USING (true);

-- Only Admins can manage operator records
CREATE POLICY "Only admins can do CRUD on operators" ON public.operators
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.staff_accounts 
            WHERE staff_accounts.auth_uid = auth.uid() AND staff_accounts.role = 'admin'
        )
    );

-- ── CONFIG POLICIES ──
-- Anyone can read configuration values (Apps Script URL, WhatsApp numbers, etc.)
CREATE POLICY "Allow public read-only access to config" ON public.config
    FOR SELECT USING (true);

-- Only Admins can update system configurations
CREATE POLICY "Only admins can edit config" ON public.config
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.staff_accounts 
            WHERE staff_accounts.auth_uid = auth.uid() AND staff_accounts.role = 'admin'
        )
    );

-- ── STAFF ACCOUNTS POLICIES ──
-- Authenticated users can view staff list (non-recursive SELECT)
CREATE POLICY "Allow authenticated staff to read staff accounts" ON public.staff_accounts
    FOR SELECT TO authenticated USING (true);

-- Only Admins can insert/update/delete staff accounts (avoids SELECT recursion)
CREATE POLICY "Only admins can insert staff accounts" ON public.staff_accounts
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.staff_accounts 
            WHERE staff_accounts.auth_uid = auth.uid() AND staff_accounts.role = 'admin'
        )
    );

CREATE POLICY "Only admins can update staff accounts" ON public.staff_accounts
    FOR UPDATE TO authenticated USING (
        EXISTS (
            SELECT 1 FROM public.staff_accounts 
            WHERE staff_accounts.auth_uid = auth.uid() AND staff_accounts.role = 'admin'
        )
    );

CREATE POLICY "Only admins can delete staff accounts" ON public.staff_accounts
    FOR DELETE TO authenticated USING (
        EXISTS (
            SELECT 1 FROM public.staff_accounts 
            WHERE staff_accounts.auth_uid = auth.uid() AND staff_accounts.role = 'admin'
        )
    );

-- ── USER ROLES POLICIES ──
-- Anyone can read user roles
CREATE POLICY "Allow public read access to user roles" ON public.user_roles
    FOR SELECT USING (true);

-- Only Admins can manage user roles (INSERT/UPDATE/DELETE)
CREATE POLICY "Only admins can insert user roles" ON public.user_roles
    FOR INSERT TO authenticated WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.staff_accounts 
            WHERE staff_accounts.auth_uid = auth.uid() AND staff_accounts.role = 'admin'
        )
    );

CREATE POLICY "Only admins can update user roles" ON public.user_roles
    FOR UPDATE TO authenticated USING (
        EXISTS (
            SELECT 1 FROM public.staff_accounts 
            WHERE staff_accounts.auth_uid = auth.uid() AND staff_accounts.role = 'admin'
        )
    );

CREATE POLICY "Only admins can delete user roles" ON public.user_roles
    FOR DELETE TO authenticated USING (
        EXISTS (
            SELECT 1 FROM public.staff_accounts 
            WHERE staff_accounts.auth_uid = auth.uid() AND staff_accounts.role = 'admin'
        )
    );


-- ── 4. Insert Initial Config & Seed Data ──────────────────────

-- Add default config values
INSERT INTO public.config (key, value) VALUES
('whatsapp_number', '919425182900'), -- Replace with your default mining supervisor/engineer WhatsApp number
('apps_script_url', 'https://script.google.com/macros/s/AKfycbzvQQcUftmeXPn6u04AzDSyUA9ZYpQIRN1R1Es04pp0DJUu3fNn_te2NEkAgJsBNUblZQ/exec') -- Your existing Apps Script URL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Seed some mock Operator verification data (Form A # and DOB)
-- DOB format in DB is DATE (YYYY-MM-DD)
INSERT INTO public.operators (form_a, name, designation, dob) VALUES
('101', 'रमेश कुमार (Ramesh Kumar)', 'Dumper Operator', '1985-05-15'),
('102', 'सुरेश यादव (Suresh Yadav)', 'Shovel Operator', '1989-10-20'),
('103', 'राजेश सिंह (Rajesh Singh)', 'Dumper Operator', '1992-03-08'),
('511/A', 'विजय विश्वकर्मा (Vijay Vishwakarma)', 'Dumper Operator', '1983-08-05'),
('125', 'दिनेश पटेल (Dinesh Patel)', 'Tipper Operator', '1990-12-25')
ON CONFLICT (form_a) DO NOTHING;


-- ── 5. Helper Function for Database Triggers ──────────────────
-- Updates the `updated_at` column automatically when a report is updated
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_reports_timestamp
    BEFORE UPDATE ON public.reports
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();


-- ── 6. Setup Initial Admin Account ───────────────────────────
-- Note: Create the auth user first through the Supabase Dashboard -> Authentication tab.
-- For example, sign up an admin account with:
-- Email: admin@hemm.local  (e.g. staff id: admin)
-- Password: adminpassword123
-- Once signed up, find their User ID (UUID) in the Supabase Auth list, and run the following insert (replace UUID):
--
-- INSERT INTO public.staff_accounts (staff_id, role, label, auth_uid)
-- VALUES ('admin', 'admin', 'System Administrator', 'PASTE_SUPABASE_USER_UUID_HERE');
--
-- INSERT INTO public.user_roles (user_id, role)
-- VALUES ('PASTE_SUPABASE_USER_UUID_HERE', 'admin');
