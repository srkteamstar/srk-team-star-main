-- =============================================================================
-- 015_admin_second_factor.sql — a secret for the one role that needed one
-- =============================================================================
--
-- Run after 014. Idempotent — safe to re-run.
--
-- WHAT THIS FIXES
-- ---------------
-- POST /api/auth/login resolves an email or a phone number to a profile and
-- starts a session. Nothing is verified. That was written down as a product
-- decision and it is a defensible one *for a shopper*: the account is an
-- address book with a memory, and the worst case is that whoever types your
-- email reads your own order history back.
--
-- The `admin` role was later put behind the same door, and that part was
-- never re-reasoned. An administrator's session is not one person's address
-- book. It reads every customer's name, email, phone and postal address,
-- every technical enquiry, every quote request with its business details, and
-- every order; and it deletes any product, category or project in the
-- catalogue. The entry price was knowing one email address — and a business
-- publishes its administrator's email address on its own contact page.
--
-- Two other findings turned that from theoretical into practical:
--
--   * `app.set('trust proxy', 1)` was unconditional with no proxy in front,
--     so X-Forwarded-For was client-controlled and every rate limiter keyed
--     on it. authLimiter's own comment calls itself "the only thing between a
--     script and walking the customer list" — one header per request and it
--     counted to 20 forever.
--   * The login route answers 404 for an unknown identifier and 200 for a
--     known one, which is an enumeration oracle. Unmetered, that oracle
--     enumerates the whole customer base, and any hit is a full session.
--
-- Both are fixed in server.js. This file fixes the third and largest part:
-- the admin role now needs something the attacker cannot look up.
--
-- WHY A COLUMN AND NOT A TABLE
-- ----------------------------
-- One secret per administrator, one administrator per row, no history worth
-- keeping. A join table would buy nothing here and would put the secret one
-- accidental `select *, admin_credentials(*)` away from an API response.
--
-- WHY NULLABLE
-- ------------
-- Because it must be. Existing admin rows have no secret, and a NOT NULL
-- column would have to invent one — which means either a default nobody
-- controls or a value written into a migration file. server.js treats a null
-- secret on an admin as *refuse the sign-in*, not as "skip the check": an
-- unenrolled administrator cannot sign in until they run
-- backend/scripts/enroll-admin-totp.js.
--
-- That is deliberately fail-closed and it will lock an administrator out
-- until that one command is run. The alternative — treating "no secret" as
-- "no second factor required" — is a bypass any attacker reaches by finding
-- an admin who never enrolled, which is exactly the row this migration
-- creates. A door that is shut until you enrol beats a door that is open
-- because you did not.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The secret
--
--    Base32, RFC 4226's 160 bits, generated on the server and never sent to a
--    browser. It is written exactly once, by the enrolment script, over a
--    connection that already holds the service-role key.
--
--    Note what is NOT here: no `password_hash`, no `recovery_email`, no
--    `is_2fa_enabled` flag. A flag would be a second source of truth about
--    the same fact — the secret's presence already says it — and the two
--    would eventually disagree, with the flag saying "off" being the answer
--    that wins. Nullability carries the state instead.
-- -----------------------------------------------------------------------------
alter table public.user_profiles
    add column if not exists admin_totp_secret text;

comment on column public.user_profiles.admin_totp_secret is
    'Base32 TOTP secret for an administrator. SECRET — never selected into any API response; server.js projects auth responses field by field and this is not among them. Null on an admin row means that admin cannot sign in until enrolled (fail-closed, by design). Ignored entirely for the customer role.';


-- -----------------------------------------------------------------------------
-- 2. When it was set
--
--    Not decoration. "Which administrators have actually enrolled" is a
--    question worth being able to answer, and it is the query that tells you
--    whether an admin row is currently able to sign in at all.
-- -----------------------------------------------------------------------------
alter table public.user_profiles
    add column if not exists admin_totp_enrolled_at timestamptz;

comment on column public.user_profiles.admin_totp_enrolled_at is
    'When the TOTP secret was written. Null alongside a null secret means never enrolled.';


-- -----------------------------------------------------------------------------
-- 3. Grants
--
--    The trap 001, 011, 012 and 014 all document: the service role's RLS
--    bypass is not a table privilege. user_profiles already carries select /
--    insert / update to service_role from 011, and a new column inherits the
--    table-level grant — so there is nothing to add and this section exists
--    to say that on purpose rather than by omission.
--
--    What matters more is what is NOT granted. anon and authenticated have no
--    privilege on user_profiles at all (011), so this column is unreachable
--    with the browser's key even in principle. VERIFY query 3 checks it.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 4. Refresh PostgREST's schema cache immediately.
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFY
-- =============================================================================
--
-- -- 1. The columns exist and are nullable.
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'user_profiles'
--    and column_name in ('admin_totp_secret', 'admin_totp_enrolled_at');
-- Expected: 2 rows, both is_nullable = YES.
--
-- -- 2. Who is an administrator, and can they actually sign in?
-- --    Every admin row with enrolled = false is locked out until
-- --    backend/scripts/enroll-admin-totp.js is run for it. Run this FIRST,
-- --    before anyone tries to use the dashboard.
-- select p.id, p.email, r.role_name,
--        (p.admin_totp_secret is not null) as enrolled
--   from public.user_profiles p
--   join public.roles r on r.id = p.role_id
--  where lower(r.role_name) = 'admin';
--
-- -- 3. The secret is unreachable with the browser's key.
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'user_profiles' and grantee in ('anon', 'authenticated');
-- Expected: 0 rows.
-- =============================================================================
