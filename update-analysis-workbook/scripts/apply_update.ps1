<#
.SYNOPSIS
Applies a Beacon ledger download to the Analysis workbook in place.

.DESCRIPTION
Replaces the Ledger and Detail sheets with the download, resizes the
LedgerDetails table, pastes in the body built by build_body.py, re-applies the
calculated columns and the NewCat dropdown, and refreshes the pivot cache that
every pivot shares.

Working in place is the whole point: the pivots, charts and slicers already
point at the LedgerDetails table, so growing that table leaves them intact and
none of them has to be re-pointed by hand.

The workbook must be CLOSED in Excel before running this.

.EXAMPLE
powershell -File apply_update.ps1 -Target "...\u3aledgerNewCats.xlsm" `
    -Source "...\202608111506_..._ledger.xlsx" -Body "...\_body.xlsx"
#>
param(
    [Parameter(Mandatory = $true)][string]$Target,   # the Analysis .xlsm
    [Parameter(Mandatory = $true)][string]$Source,   # the Beacon download .xlsx
    [Parameter(Mandatory = $true)][string]$Body      # body .xlsx from build_body.py
)

$ErrorActionPreference = 'Stop'
$xlPasteValues = -4163
$xlUp          = -4162
$xlManual      = -4135
$xlAutomatic   = -4105

foreach ($f in @($Target, $Source, $Body)) {
    if (-not (Test-Path $f)) { throw "not found: $f" }
}

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.ScreenUpdating = $false
try {
    $wbT = $xl.Workbooks.Open((Resolve-Path $Target).Path)
    $wbS = $xl.Workbooks.Open((Resolve-Path $Source).Path, 0, $true)
    $wbB = $xl.Workbooks.Open((Resolve-Path $Body).Path, 0, $true)
    $xl.Calculation = $xlManual

    # ---- Ledger and Detail: straight replacement ---------------------------
    # Copy/PasteSpecial rather than assigning .Value2, because Beacon stores its
    # dates as dd/mm/yyyy TEXT and a value assignment lets Excel re-parse them.
    foreach ($pair in @(@{Sheet = 'Ledger'; LastCol = 'Q' }, @{Sheet = 'Detail'; LastCol = 'C' })) {
        $s = $wbS.Worksheets.Item($pair.Sheet)
        $t = $wbT.Worksheets.Item($pair.Sheet)
        $sLast = $s.Cells($s.Rows.Count, 1).End($xlUp).Row
        $tLast = $t.Cells($t.Rows.Count, 1).End($xlUp).Row
        "{0}: {1} rows -> {2} rows" -f $pair.Sheet, ($tLast - 1), ($sLast - 1)
        # only the data columns are cleared - anything to the right is a helper
        # (e.g. the =UNIQUE() category list on Ledger) and must survive
        $t.Range("A1:$($pair.LastCol)$tLast").ClearContents()
        $s.Range("A1:$($pair.LastCol)$sLast").Copy() | Out-Null
        $t.Range("A1").PasteSpecial($xlPasteValues) | Out-Null
        $xl.GetType().InvokeMember("CutCopyMode", "SetProperty", $null, $xl, @(0)) | Out-Null
    }

    # ---- LedgerDetails -----------------------------------------------------
    $sB    = $wbB.Worksheets.Item(1)
    $nBody = $sB.Cells($sB.Rows.Count, 1).End($xlUp).Row       # body has no header row
    $tLD   = $wbT.Worksheets.Item("LedgerDetails")
    $lo    = $tLD.ListObjects.Item("LedgerDetails")
    "LedgerDetails: {0} -> {1} rows" -f $lo.ListRows.Count, $nBody

    $lo.DataBodyRange.ClearContents()
    $lo.Resize($tLD.Range("A1:M" + ($nBody + 1)))

    $tLD.Range("D2:D" + ($nBody + 1)).NumberFormat = "@"       # keep the dates text
    $sB.Range("A1:I$nBody").Copy() | Out-Null
    $tLD.Range("A2").PasteSpecial($xlPasteValues) | Out-Null
    $xl.GetType().InvokeMember("CutCopyMode", "SetProperty", $null, $xl, @(0)) | Out-Null

    $lo.ListColumns.Item("Year").DataBodyRange.Formula     = "=YEAR([@date])"
    $lo.ListColumns.Item("IncExp").DataBodyRange.Formula   = "=SWITCH(LEFT([@NewCat],5),""1INC "",""Income"","""",""Unknown"",""Expense"")"
    $lo.ListColumns.Item("Activity").DataBodyRange.Formula = "=LEFT([@NewCat],4)"
    $lo.ListColumns.Item("Year2").DataBodyRange.Formula    = "=[@Year]"

    $wsC     = $wbT.Worksheets.Item("Categories")
    $lastCat = $wsC.Cells($wsC.Rows.Count, 1).End($xlUp).Row
    $vr      = $lo.ListColumns.Item("NewCat").DataBodyRange
    $vr.Validation.Delete()
    $vr.Validation.Add(3, 1, 1, "=Categories!`$A`$2:`$A`$$lastCat")   # xlValidateList
    $vr.Validation.ShowInput = $false
    $vr.Validation.ShowError = $false

    $xl.Calculation = $xlAutomatic
    $wbT.Application.CalculateFullRebuild()
    foreach ($pc in $wbT.PivotCaches()) { $pc.Refresh() }

    $wbS.Close($false); $wbB.Close($false)
    $wbT.Save()

    "--- after ---"
    "table range    : " + $lo.Range.Address()
    "blank NewCat   : " + $xl.WorksheetFunction.CountBlank($lo.ListColumns.Item("NewCat").DataBodyRange)
    "Unknown IncExp : " + $xl.WorksheetFunction.CountIf($lo.ListColumns.Item("IncExp").DataBodyRange, "Unknown")
    "sum of amount  : " + $xl.WorksheetFunction.Sum($lo.ListColumns.Item("amount").DataBodyRange)
    "years          : " + $xl.WorksheetFunction.Min($lo.ListColumns.Item("Year").DataBodyRange) + " to " + $xl.WorksheetFunction.Max($lo.ListColumns.Item("Year").DataBodyRange)
    "first/last date: " + $tLD.Range("D2").Value2 + " / " + $tLD.Range("D" + ($nBody + 1)).Value2
    $wbT.Close($false)
}
finally {
    try { $xl.Calculation = $xlAutomatic } catch {}
    $xl.ScreenUpdating = $true
    $xl.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
}
