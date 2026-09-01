# rehearse-migrations.ps1 — Option B: clone the live project's schema+data
# into a disposable project and run every pending migration against the
# clone, in order, before any of it touches production.
#
# WHAT THIS DOES NOT DO: log you in, or create the clone project. Those two
# steps need your browser and your Supabase account — nothing running
# non-interactively can complete an OAuth flow or create billed cloud
# resources on your behalf. Do these first, by hand:
#
#   1. Dashboard -> New Project -> create a disposable project (any name,
#      e.g. "srk-migration-rehearsal"). Note its project ref and the
#      database password you set.
#   2. In a terminal YOU control:
#        supabase login
#        supabase link --project-ref <your CURRENT/live project ref>
#      (Current project ref: Settings -> General on that project's dashboard.)
#
# Then fill in the two values below and run this script from backend/.
#
# SAFETY: this reads from your LIVE project (via the CLI's --linked default,
# which is what `supabase link` above pointed at) and writes only to the
# CLONE project's connection string you provide below. It never runs
# anything against production. Still: this copies real customer data
# (PII, order history) into a second project — delete the clone when you're
# done rehearsing, and treat it with the same care as production while it
# exists.

$ErrorActionPreference = "Stop"

# ---- fill these in ---------------------------------------------------------
$CloneProjectRef = ""       # e.g. "abcdefghijklmnopqrst"
$CloneDbPassword = ""       # the password you set when creating the clone project
# -----------------------------------------------------------------------------

if (-not $CloneProjectRef -or -not $CloneDbPassword) {
    Write-Error "Set `$CloneProjectRef and `$CloneDbPassword at the top of this script first."
    exit 1
}

$CloneConnString = "postgresql://postgres:$CloneDbPassword@db.$CloneProjectRef.supabase.co:5432/postgres"

function Require-Psql {
    if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
        Write-Error "psql not found. Install PostgreSQL client tools (e.g. https://www.postgresql.org/download/windows/ — the client-only 'command line tools' component is enough) and re-run."
        exit 1
    }
}
Require-Psql

Write-Host "==> Dumping schema from the linked (live) project..." -ForegroundColor Cyan
npx supabase db dump -f schema.sql
if ($LASTEXITCODE -ne 0) { Write-Error "Schema dump failed."; exit 1 }

Write-Host "==> Dumping data from the linked (live) project..." -ForegroundColor Cyan
npx supabase db dump --data-only -f data.sql
if ($LASTEXITCODE -ne 0) { Write-Error "Data dump failed."; exit 1 }

Write-Host "==> Restoring schema into the clone project..." -ForegroundColor Cyan
psql $CloneConnString -f schema.sql
if ($LASTEXITCODE -ne 0) { Write-Error "Schema restore failed."; exit 1 }

Write-Host "==> Restoring data into the clone project..." -ForegroundColor Cyan
psql $CloneConnString -f data.sql
if ($LASTEXITCODE -ne 0) { Write-Error "Data restore failed."; exit 1 }

# Exact numeric order — every migration after 020 depends on the schema the
# ones before it created. See AGENTS.md's "Still open before live keys" for
# why each of these is still pending, and 034's own header for the
# re-run-even-if-a-ledger-says-otherwise caveat.
$Pending = @(020, 027, 028, 029, 030, 031, 034, 035, 036, 037, 038, 039, 040, 041)

foreach ($n in $Pending) {
    $padded = "{0:D3}" -f $n
    $file = Get-ChildItem "migrations/${padded}_*.sql" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $file) {
        Write-Error "Could not find migrations/${padded}_*.sql — aborting so later migrations don't run out of order."
        exit 1
    }
    Write-Host "==> Running $($file.Name) against the clone..." -ForegroundColor Cyan
    psql $CloneConnString -v ON_ERROR_STOP=1 -f $file.FullName
    if ($LASTEXITCODE -ne 0) {
        Write-Error "$($file.Name) failed. Stop here, read the error, and fix before continuing — do not skip ahead."
        exit 1
    }
}

Write-Host "==> All pending migrations applied to the clone. Running the smoke check..." -ForegroundColor Cyan
$SmokeCheck = @"
select to_regprocedure('public.update_customer_profile_and_address(bigint,jsonb,jsonb)') is not null as profile_rpc_ready;
select to_regprocedure('public.fail_store_payment_setup(bigint,bigint)') is not null as fail_setup_rpc_ready;
select to_regprocedure('public.replace_customer_cart(bigint,bigint,jsonb)') is not null as cart_rpc_ready;
select to_regprocedure('public.settle_captured_store_payment(bigint,bigint,text,text,timestamptz)') is not null as settlement_rpc_ready;
select count(*) as legacy_accounts_needing_credential_reset from public.user_profiles where password_hash is null;
"@
psql $CloneConnString -c $SmokeCheck

Write-Host ""
Write-Host "==> Done. Next steps:" -ForegroundColor Green
Write-Host "    1. Point a scratch copy of backend/.env at the clone's SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY (Settings -> API on the clone project) and run 'npm start' against it."
Write-Host "    2. Walk through registration, checkout, cart, order history, and a refund if you can simulate one."
Write-Host "    3. Only once that's clean: back up the LIVE project for real, then re-run this same migration sequence there."
Write-Host "    4. Delete the clone project when you're done rehearsing — it was disposable by design."
