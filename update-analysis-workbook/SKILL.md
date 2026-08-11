---
name: update-analysis-workbook
description: Update the St Ives (Cambs) u3a Treasurer's Analysis workbook (u3aledgerNewCats.xlsm in Budgettingv3) from a freshly downloaded Beacon finance ledger - replacing the Ledger and Detail sheets, extending the LedgerDetails table, carrying forward every New Category already allocated, proposing allocations for the new rows from the workbook's own history, and leaving all the pivots, charts and slicers untouched. Use whenever asked to update / refresh / roll forward the Analysis workbook, the ledger analysis, u3aledgerNewCats, the Budgetting workbook or the Treasurer's spreadsheet, or when handed a file named like "YYYYMMDDHHMM_St Ives (Cambs) u3afinance_ledger.xlsx" and asked to do anything with it - even if the request is only "here's the new ledger download" or "the treasurer's figures need updating". Also use for the related jobs on that workbook: allocating blank New Categories, adding a New Category rule, working out where an unfamiliar Beacon category should go, or checking why a figure in Summary or Trends looks wrong.
---

# Update the Treasurer's Analysis workbook

## What this is

`u3aledgerNewCats.xlsm` in `C:\u3a St Ives\8 Trustees\Treasurer aspects\Budgettingv3` turns the Beacon finance ledger into the **Summary** and **Trends** reports the Treasurer presents. Beacon's own categories are too fine-grained and too inconsistent to report on, so the workbook maps them onto a set of **New Categories** (`1INC Membership Subs`, `3MOM Room Hire`, `9ADM Other Expenses`…) whose 4-character prefix is the activity code the pivots group by.

Six sheets:

| Sheet | What it is |
|---|---|
| **Ledger** | the download's transaction rows, one per `tkey`. Columns R–V hold a `=UNIQUE(Q:Q)` helper listing the distinct Beacon categories, and a snapshot of that list from last time |
| **Detail** | the download's category splits — one `tkey` can appear several times, once per Beacon category |
| **Categories** | column A the New Category, column B a regular expression matched against the Beacon category. This is the mapping |
| **LedgerDetails** | an Excel **Table** joining Detail to Ledger, plus the allocated `NewCat` and the calculated `Year`, `IncExp`, `Activity`, `Year2` columns |
| **Summary**, **Trends** | 8 pivot tables and 6 slicers, **all sharing a single pivot cache pointing at the LedgerDetails table** |

That last fact is the one that shapes everything else. Because every pivot reads the same table, **growing that table in place updates the whole report** — nothing has to be re-pointed. An older written process built a brand-new workbook each time and re-connected every pivot and slicer by hand; that is only needed if the workbook's structure itself must change, and is documented as "Process B" in `Create a new Analysis workbook.docx` in the Budgettingv3 folder.

## Before touching anything

Excel must be **closed** — the scripts drive it through COM and will fail or fight a live instance.

Take a dated backup next to the original, e.g. `u3aledgerNewCats_pre-update-YYYY-MM-DD.xlsm`. Peter usually has his own backup too; take one anyway, because the update rewrites the Ledger and Detail sheets wholesale.

Then run `scripts/inspect.ps1` and **keep the output**. It records the slicer selections as they stand, which is the only record of deliberate choices like "Year2 excludes the current part year". If something looks wrong at the end, this is what you compare against.

## The workflow

Five steps. Steps 1–2 are mechanical; step 3 is where the real work and the judgement live.

### 1. Build the new table body (read-only, safe to repeat)

```
python scripts/build_body.py --workbook <analysis.xlsm> --download <beacon.xlsx> --out _body.xlsx --report _report.json
```

This pairs every row of the download against the rows already in LedgerDetails on `(tkey, category)`, keeps the `NewCat` already allocated, applies the Categories regexps to genuinely new rows, and writes the rebuilt body plus a report. It changes nothing.

**Read `_report.json` before going further, and tell the user what is in it.** Beacon is a live system and the treasurer corrects history in it, so a download is not simply "last time plus new rows". The report separates:

- `updated` — rows that already existed but whose date, amount, payee, detail or notes have changed in Beacon. Mostly `cleared` dates and typo fixes, but a changed **amount** is a real correction and worth naming out loud.
- `dropped` — rows Beacon no longer has, usually because a transaction was recategorised. These disappear; their replacement turns up as an added row needing allocation.
- `added` / `added_blank` — how many new rows, and how many the regexps could not place.

### 2. Apply it

```
powershell -File scripts/apply_update.ps1 -Target <analysis.xlsm> -Source <beacon.xlsx> -Body _body.xlsx
```

Replaces Ledger and Detail, resizes the LedgerDetails table, pastes the body, re-applies the four calculated columns and the NewCat dropdown, refreshes the pivot cache, saves.

**Check the totals it prints.** Ledger, Detail and LedgerDetails must all sum to the same figure, and that figure must match the download. If they don't, stop and find out why rather than pressing on.

### 3. Allocate the blank New Categories

```
python scripts/suggest_newcats.py --workbook <analysis.xlsm>
```

This is the part that needs a person. The script splits the unallocated rows into two kinds, because they need opposite treatment:

**Beacon categories never seen before** need a **rule** on the Categories sheet, not a one-off allocation — otherwise the same rows come back blank at every future update. A brand-new category usually means the u3a has started doing something new (taking PayPal payments, a group collecting its own subs), so it is worth asking what the money actually is before deciding where it goes. Watch for two patterns already in the workbook:

- self-balancing activities where income and expense sit together and the report shows the net — `Outings`, `Theatre Trips`, `Events`, `Particular Groups`. These deliberately have no `1INC` prefix, so `IncExp` calls the lot "Expense" and the receipts net off against the costs.
- ordinary income, which **must** start with `1INC ` — that exact prefix, trailing space included, is what the `IncExp` formula tests.

**Categories seen before but split across several New Categories** are genuine per-transaction judgement calls — the same `Room Hire` goes to `3MOM Room Hire` or `4GST GCL Meetings` depending on which meeting it was. The script prints how that Beacon category has been allocated before, and how the *same payee* has been allocated before, which is usually decisive. Propose an allocation for every one of them with the evidence, rather than handing back a list of blanks; the user can correct the few that are wrong far faster than they can research all of them.

One transaction can be split across several Beacon categories (a single expenses claim covering printing, refreshments and stationery), so an allocation is keyed on the **pair** `tkey|category`, not the `tkey`. Where a split line covers two things, say so — the money can only go one way without a second line in Beacon.

Once the user has agreed, write a rules file and apply it:

```json
{
  "categories":    [ { "newcat": "9ADM Payment charges", "regexp": "PayPal commission|SumUp fee" } ],
  "byCategory":    { "PayPal commission": "9ADM Payment charges" },
  "byTransaction": { "2862003|Room Hire": "3MOM Room Hire" }
}
```

```
powershell -File scripts/apply_newcats.ps1 -Target <analysis.xlsm> -Rules rules.json
```

It only fills blanks, so it is safe to re-run; add `-Force` when *changing* an allocation that has already been made. New Category names must match the Categories sheet **exactly** — several have trailing spaces (`9ADM Membership Admin `, `4GST Group Support  `, `3MOM Speakers   `) which are part of the name.

### 4. Check the two things that go quietly wrong

```
powershell -File scripts/inspect.ps1 -Target <analysis.xlsm>
```

Both failure modes are silent — the workbook looks fine and the numbers are simply wrong:

- **New Beacon accounts arrive UNTICKED on the account slicers.** When PayPal and SumUp first appeared in August 2026 they brought £1,170 that was invisible in Summary and Trends. Compare the slicer selections against the ones recorded before the update; anything newly listed as "NOT selected" is new, not a choice. Fix with `-TickAccounts PayPal,SumUp`.
- **The category snapshot goes stale.** Ledger column T is a live `=UNIQUE(Q:Q)` of Beacon's categories; column V is last update's snapshot. The difference is how new categories get spotted at all. Refresh it with `-RefreshSnapshot`, or the next update's comparison is worthless.

Also confirm the Year and Year2 slicers still show the years intended. `Year2` on Trends normally excludes the current part year, and that is a deliberate choice, not a bug.

### 5. Finish

Confirm 0 blank `NewCat` and 0 `Unknown` in `IncExp`, and that the three totals still agree. Then add a dated entry to the **Log of decisions** at the end of `Create a new Analysis workbook.docx` in the Budgettingv3 folder: the download used, rows before and after, the control total, and any New Category added and why. The reasoning behind a new category is the part that is impossible to reconstruct later.

## Things worth knowing

**Dates are text.** Beacon exports `dd/mm/yyyy` as strings and the workbook keeps them that way. `=YEAR()` coerces them happily, but letting Excel re-parse them turns 06/01 into 6 January or 1 June depending on the wind. That is why the scripts use Copy/PasteSpecial values rather than assigning `.Value2`, and why the date column is forced to Text format.

**The `.bas` modules are not used by this process.** `SetUp`, `Refresh` and `Utilities` live inside the workbook and are what Process B runs on; `RefreshLedgerDetails` is still a quick way to top up a workbook by hand. This skill does the same work from outside Excel, which is why it can also reconcile amended and deleted rows — the macro only ever appends.

**PowerShell 5.1 quirks** that will bite anyone editing these scripts: `$xl.Calculation` can only be set once a workbook is open; `$xl.CutCopyMode = 0` throws, so it goes through `InvokeMember`; assigning a 2-D array to `Range.Value2` throws a cast error, so write cells individually or use Copy/PasteSpecial; and `ConvertFrom-Json` returns PSCustomObjects rather than hashtables.

**When a figure in Summary looks wrong**, the order to check is: slicer selections (is an account or a year excluded?), then blank/Unknown allocations, then the pivot cache (has it been refreshed?), then the underlying rows. It is nearly always the first.
