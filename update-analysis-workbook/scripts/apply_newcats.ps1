<#
.SYNOPSIS
Applies an agreed batch of NewCat allocations, and any new Categories rules.

.DESCRIPTION
Fills blank NewCat cells from a rules file, so a batch the user has approved
goes in in one pass instead of being typed cell by cell. Rules that will recur
are also written to the Categories sheet, which is what stops the same rows
coming back blank at the next update.

The rules file is JSON:

{
  "categories": [
    { "newcat": "9ADM Payment charges", "regexp": "PayPal commission|SumUp fee" }
  ],
  "byCategory": {
    "PayPal commission": "9ADM Payment charges",
    "Particular groups": "Particular Groups"
  },
  "byTransaction": {
    "2862003|Room Hire": "3MOM Room Hire",
    "2957694|Misc Expense": "9ADM Other Expenses"
  }
}

"categories" adds rows to the Categories sheet (skipped if the NewCategory is
already there). "byCategory" allocates every blank row with that Beacon
category. "byTransaction" is keyed tkey|category and wins over byCategory - one
transaction can be split across several Beacon categories, so the pair is what
identifies a row.

Only BLANK cells are touched, so re-running is safe and an existing allocation
is never silently overwritten. Use -Force to overwrite as well - needed when
changing an allocation that has already been made.

.EXAMPLE
powershell -File apply_newcats.ps1 -Target "...\u3aledgerNewCats.xlsm" -Rules "...\rules.json"
#>
param(
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][string]$Rules,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$xlUp = -4162

if (-not (Test-Path $Target)) { throw "not found: $Target" }
if (-not (Test-Path $Rules))  { throw "not found: $Rules" }

$r = Get-Content $Rules -Raw | ConvertFrom-Json

# ConvertFrom-Json gives PSCustomObjects in Windows PowerShell 5.1, not hashtables
function To-Hash($obj) {
    $h = @{}
    if ($null -ne $obj) { foreach ($p in $obj.PSObject.Properties) { $h[$p.Name] = $p.Value } }
    return $h
}
$byCategory    = To-Hash $r.byCategory
$byTransaction = To-Hash $r.byTransaction

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.ScreenUpdating = $false
try {
    $wb  = $xl.Workbooks.Open((Resolve-Path $Target).Path)
    $ws  = $wb.Worksheets.Item("LedgerDetails")
    $lo  = $ws.ListObjects.Item("LedgerDetails")
    $wsC = $wb.Worksheets.Item("Categories")

    # ---- 1. new rules on the Categories sheet ------------------------------
    $lastCat = $wsC.Cells($wsC.Rows.Count, 1).End($xlUp).Row
    $existing = @()
    for ($i = 2; $i -le $lastCat; $i++) { $existing += [string]$wsC.Cells($i, 1).Value2 }
    foreach ($c in $r.categories) {
        if ($existing -contains $c.newcat) {
            "category already present: {0}" -f $c.newcat
        }
        else {
            $lastCat++
            $wsC.Cells($lastCat, 1).Value2 = $c.newcat
            $wsC.Cells($lastCat, 2).Value2 = $c.regexp
            "added category: {0}  [{1}]  row {2}" -f $c.newcat, $c.regexp, $lastCat
        }
    }

    # ---- 2. allocate ---------------------------------------------------------
    $n     = $lo.ListRows.Count
    $tkeys = $ws.Range("A2:A" + ($n + 1)).Value2
    $cats  = $ws.Range("B2:B" + ($n + 1)).Value2
    $ncs   = $ws.Range("I2:I" + ($n + 1)).Value2

    $filled = 0; $skipped = 0; $stillBlank = 0
    $unmatched = @()
    for ($i = 1; $i -le $n; $i++) {
        $cur = $ncs[$i, 1]
        $isBlank = ($null -eq $cur -or "$cur" -eq "")
        $tk  = [long]$tkeys[$i, 1]
        $cat = "$($cats[$i,1])"
        $val = $null
        if ($byTransaction.ContainsKey("$tk|$cat")) { $val = $byTransaction["$tk|$cat"] }
        elseif ($byCategory.ContainsKey($cat))      { $val = $byCategory[$cat] }

        if (-not $isBlank) {
            if ($Force -and $val -and "$cur" -ne $val) {
                "row {0}: {1} -> {2}  (tkey {3}, {4})" -f ($i + 1), $cur, $val, $tk, $cat
                $ws.Cells($i + 1, 9).Value2 = $val; $filled++
            }
            elseif ($val) { $skipped++ }
            continue
        }
        if ($val) { $ws.Cells($i + 1, 9).Value2 = $val; $filled++ }
        else { $stillBlank++; $unmatched += "$tk|$cat" }
    }
    "allocated {0} cell(s); {1} left blank; {2} already allocated and left alone" -f $filled, $stillBlank, $skipped
    if ($stillBlank -gt 0) {
        "  no rule for: " + (($unmatched | Select-Object -Unique | Select-Object -First 20) -join '; ')
    }

    # ---- 3. widen the dropdown to include any new categories ---------------
    $vr = $lo.ListColumns.Item("NewCat").DataBodyRange
    $vr.Validation.Delete()
    $vr.Validation.Add(3, 1, 1, "=Categories!`$A`$2:`$A`$$lastCat")
    $vr.Validation.ShowInput = $false
    $vr.Validation.ShowError = $false

    $wb.Application.CalculateFullRebuild()
    foreach ($pc in $wb.PivotCaches()) { $pc.Refresh() }
    $wb.Save()

    "--- after ---"
    "blank NewCat   : " + $xl.WorksheetFunction.CountBlank($vr)
    "Unknown IncExp : " + $xl.WorksheetFunction.CountIf($lo.ListColumns.Item("IncExp").DataBodyRange, "Unknown")
    "sum of amount  : " + $xl.WorksheetFunction.Sum($lo.ListColumns.Item("amount").DataBodyRange)
    $wb.Close($false)
}
finally {
    $xl.ScreenUpdating = $true
    $xl.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl) | Out-Null
}
