<#
.SYNOPSIS
Reports the state of the Analysis workbook, and optionally fixes the two things
that go quietly wrong after an update.

.DESCRIPTION
Reads out the totals, the table size, every slicer's current selection, and the
Beacon categories that have appeared since the last snapshot. Run it before an
update to record the slicer selections, and after one to check nothing has
drifted.

Two switches do a repair rather than a report:

  -TickAccounts   ticks the named items on every account slicer. New Beacon
                  accounts arrive UNSELECTED, so their money silently vanishes
                  from Summary and Trends until someone notices.

  -RefreshSnapshot  copies the live =UNIQUE() category list on Ledger into the
                  snapshot column beside it. That comparison is how new Beacon
                  categories get spotted, and it is worthless if the snapshot is
                  never brought up to date.

.EXAMPLE
powershell -File inspect.ps1 -Target "...\u3aledgerNewCats.xlsm"
powershell -File inspect.ps1 -Target "..." -TickAccounts PayPal,SumUp -RefreshSnapshot
#>
param(
    [Parameter(Mandatory = $true)][string]$Target,
    [string[]]$TickAccounts,
    [switch]$RefreshSnapshot,
    [int]$UniqueCol   = 20,   # Ledger column T - the =UNIQUE() spill of Beacon categories
    [int]$SnapshotCol = 22    # Ledger column V - last update's snapshot of that list
)

$ErrorActionPreference = 'Stop'
$xlUp = -4162
if (-not (Test-Path $Target)) { throw "not found: $Target" }
$writing = ($TickAccounts -and $TickAccounts.Count -gt 0) -or $RefreshSnapshot

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.ScreenUpdating = $false
try {
    $wb = $xl.Workbooks.Open((Resolve-Path $Target).Path, 0, (-not $writing))
    $ws = $wb.Worksheets.Item("LedgerDetails")
    $lo = $ws.ListObjects.Item("LedgerDetails")

    "=== LedgerDetails"
    "  table range    : " + $lo.Range.Address()
    "  rows           : " + $lo.ListRows.Count
    "  blank NewCat   : " + $xl.WorksheetFunction.CountBlank($lo.ListColumns.Item("NewCat").DataBodyRange)
    "  Unknown IncExp : " + $xl.WorksheetFunction.CountIf($lo.ListColumns.Item("IncExp").DataBodyRange, "Unknown")
    "  sum of amount  : " + $xl.WorksheetFunction.Sum($lo.ListColumns.Item("amount").DataBodyRange)
    "  years          : " + $xl.WorksheetFunction.Min($lo.ListColumns.Item("Year").DataBodyRange) + " to " + $xl.WorksheetFunction.Max($lo.ListColumns.Item("Year").DataBodyRange)

    "=== raw sheets (these three totals must agree)"
    foreach ($pair in @(@{Sheet = 'Ledger'; Col = 5 }, @{Sheet = 'Detail'; Col = 3 })) {
        $s = $wb.Worksheets.Item($pair.Sheet)
        $last = $s.Cells($s.Rows.Count, 1).End($xlUp).Row
        "  {0,-8} rows {1,6}   sum {2}" -f $pair.Sheet, ($last - 1), `
            $xl.WorksheetFunction.Sum($s.Range($s.Cells(2, $pair.Col), $s.Cells($last, $pair.Col)))
    }
    "  {0,-8} rows {1,6}   sum {2}" -f 'LedgerDet', $lo.ListRows.Count, `
        $xl.WorksheetFunction.Sum($lo.ListColumns.Item("amount").DataBodyRange)

    "=== pivots"
    foreach ($sh in $wb.Worksheets) {
        foreach ($pt in $sh.PivotTables()) {
            "  {0,-10} {1,-24} source={2}" -f $sh.Name, $pt.Name, $pt.PivotCache().SourceData
        }
    }

    "=== slicers"
    foreach ($sc in $wb.SlicerCaches) {
        $sel = @(); $un = @()
        foreach ($it in $sc.SlicerItems) { if ($it.Selected) { $sel += $it.Name } else { $un += $it.Name } }
        "  {0} ({1})" -f $sc.Name, $sc.SourceName
        "      selected     : " + ($sel -join ', ')
        if ($un.Count -gt 0) { "      NOT selected : " + ($un -join ', ') }
        $conn = @(); foreach ($pt in $sc.PivotTables()) { $conn += $pt.Name }
        "      drives       : " + ($conn -join ', ')
    }

    # ---- new Beacon categories since the last snapshot ---------------------
    $wsL = $wb.Worksheets.Item("Ledger")
    $lastU = $wsL.Cells($wsL.Rows.Count, $UniqueCol).End($xlUp).Row
    $lastS = $wsL.Cells($wsL.Rows.Count, $SnapshotCol).End($xlUp).Row
    if ($lastU -gt 2) {
        $live = @(); for ($i = 3; $i -le $lastU; $i++) { $live += [string]$wsL.Cells($i, $UniqueCol).Value2 }
        $snap = @(); for ($i = 3; $i -le $lastS; $i++) { $snap += [string]$wsL.Cells($i, $SnapshotCol).Value2 }
        $new = $live | Where-Object { $snap -notcontains $_ -and $_ -ne '' }
        "=== Beacon categories new since the last snapshot ({0} live, {1} in snapshot)" -f $live.Count, $snap.Count
        if ($new) { $new | ForEach-Object { "  $_" } } else { "  (none)" }

        if ($RefreshSnapshot) {
            $wsL.Range($wsL.Cells(3, $SnapshotCol), $wsL.Cells([Math]::Max($lastS, $lastU), $SnapshotCol)).ClearContents()
            for ($i = 0; $i -lt $live.Count; $i++) { $wsL.Cells(3 + $i, $SnapshotCol).Value2 = $live[$i] }
            "  snapshot refreshed to {0} entries" -f $live.Count
        }
    }

    if ($TickAccounts -and $TickAccounts.Count -gt 0) {
        "=== ticking accounts"
        foreach ($sc in $wb.SlicerCaches) {
            if ($sc.SourceName -ne 'account') { continue }
            foreach ($it in $sc.SlicerItems) {
                if ($TickAccounts -contains $it.Name -and -not $it.Selected) {
                    $it.Selected = $true
                    "  ticked {0} on {1}" -f $it.Name, $sc.Name
                }
            }
        }
    }

    if ($writing) {
        $wb.Application.CalculateFullRebuild()
        foreach ($pc in $wb.PivotCaches()) { $pc.Refresh() }
        $wb.Save()
        "saved"
    }
    $wb.Close($false)
}
finally {
    $xl.ScreenUpdating = $true
    $xl.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
}
