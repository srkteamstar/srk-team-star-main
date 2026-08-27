<#
.SYNOPSIS
    Registers the daily payment reconciliation as a Windows scheduled task.

.DESCRIPTION
    reconcile.js is the only check in this repository that can find a payment
    the gateway took and this database never recorded. It has always been
    runnable and has never been scheduled, which means the failure it exists to
    catch — a captured payment whose callback and webhook both went missing —
    was still only ever found by a customer emailing to ask where their order
    was.

    This registers `reconcile-scheduled.js` to run once a day. That wrapper
    holds a lock, appends its report to backend/logs/reconcile-YYYY-MM.log and
    passes reconcile.js's exit code through (0 clean, 2 discrepancies, 1 the
    check itself failed).

    NOTHING HERE WRITES TO THE DATABASE. Reconciliation is read-only by design;
    settling a missed payment means resending the event from the Razorpay
    dashboard so it goes through markOrderPaid() and is verified from scratch.

    PREVIEW BY DEFAULT. Run it once to see exactly what would be registered,
    then again with -Apply. That is the same shape expire-unpaid-orders.js
    uses, and for the same reason: the first time you learn what an operator
    script does should not be by reading what it already did.

.PARAMETER Apply
    Actually register (or remove) the task. Without it nothing is changed.

.PARAMETER Time
    Local start time, 24-hour HH:mm. Default 02:30.

.PARAMETER Days
    Size of the window handed to reconcile.js, in days. Default 2, so a payment
    captured just before midnight is not split across two windows.

.PARAMETER Remove
    Unregister the task instead of creating it.

.EXAMPLE
    .\schedule-reconcile.ps1
    Preview: shows the task that would be created.

.EXAMPLE
    .\schedule-reconcile.ps1 -Apply
    Registers it to run daily at 02:30 over a two-day window.

.EXAMPLE
    .\schedule-reconcile.ps1 -Remove -Apply
    Unregisters it.

.NOTES
    On Linux use cron instead — see the header of reconcile-scheduled.js:
      30 2 * * *  cd /srv/srk/backend && /usr/bin/node scripts/reconcile-scheduled.js --days=2 || true
#>

[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$Time = '02:30',
    [int]$Days = 2,
    [switch]$Remove,
    [string]$TaskName = 'SRK Team Star - Reconcile Payments'
)

$ErrorActionPreference = 'Stop'

$backend = Split-Path -Parent $PSScriptRoot
$script  = Join-Path $PSScriptRoot 'reconcile-scheduled.js'

function Fail($message) {
    Write-Host "  ERROR  $message" -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host ('-' * 72)
Write-Host '  SRK Team Star - schedule payment reconciliation'
Write-Host ('-' * 72)

if ($Remove) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "  Not registered: '$TaskName'. Nothing to remove."
        Write-Host ''
        exit 0
    }

    if (-not $Apply) {
        Write-Host "  WOULD REMOVE the scheduled task '$TaskName'."
        Write-Host '  Re-run with -Apply to remove it.'
        Write-Host ''
        exit 0
    }

    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "  Removed '$TaskName'." -ForegroundColor Green
    Write-Host ''
    exit 0
}

# ---- Checks that are cheaper to fail here than at 02:30 in three weeks.
if (-not (Test-Path $script)) { Fail "Cannot find $script" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Fail 'node is not on PATH. Task Scheduler needs the full path to node.exe.' }

if ($Time -notmatch '^([01]\d|2[0-3]):[0-5]\d$') { Fail "Time must be HH:mm in 24-hour form. Got '$Time'." }
if ($Days -lt 1) { Fail "Days must be at least 1. Got $Days." }

$envFile = Join-Path $backend '.env'
if (-not (Test-Path $envFile)) {
    Write-Host '  WARNING  backend/.env not found. reconcile.js reads its Supabase and' -ForegroundColor Yellow
    Write-Host '           Razorpay credentials from it and will exit 1 without them.' -ForegroundColor Yellow
}

$arguments = "`"$script`" --days=$Days"

Write-Host "  Task name   $TaskName"
Write-Host "  Runs        daily at $Time (local)"
Write-Host "  Command     $node $arguments"
Write-Host "  Working dir $backend"
Write-Host "  Log         $(Join-Path $backend 'logs\reconcile-YYYY-MM.log')"
Write-Host "  Window      $Days day(s)"
Write-Host ''

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) { Write-Host '  A task with this name already exists and will be replaced.' -ForegroundColor Yellow }

if (-not $Apply) {
    Write-Host '  PREVIEW ONLY. Nothing has been registered.'
    Write-Host '  Re-run with -Apply to create it.'
    Write-Host ''
    exit 0
}

$action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $backend
$trigger = New-ScheduledTaskTrigger -Daily -At $Time

# StartWhenAvailable matters on a machine that is not on at 02:30 every night:
# without it a missed run is simply skipped and the gap is invisible.
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host "  Registered '$TaskName'." -ForegroundColor Green
Write-Host ''
Write-Host '  Verify it now with:'
Write-Host "    Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "    Get-Content '$(Join-Path $backend "logs\reconcile-$(Get-Date -Format yyyy-MM).log")' -Tail 40"
Write-Host ''
Write-Host '  A run that exits 2 has found discrepancies. Start with the MONEY MOVED block.'
Write-Host ''
