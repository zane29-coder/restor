# Reports, against the live server. ASCII only.
$ErrorActionPreference = 'Stop'
$API = 'https://api.restor.uz/api/v1'
$pass = 0; $fail = 0

function Api($method, $path, $body = $null, $jwt = $null) {
  $h = @{ 'Content-Type' = 'application/json'; 'X-Tenant-Slug' = 'demo' }
  if ($jwt) { $h['Authorization'] = "Bearer $jwt" }
  $a = @{ Uri = "$API$path"; Method = $method; Headers = $h; TimeoutSec = 40 }
  if ($body) { $a['Body'] = ($body | ConvertTo-Json -Depth 10 -Compress) }
  Invoke-RestMethod @a
}
function Check($name, $cond, $detail = '') {
  if ($cond) { $script:pass++; Write-Host "  OK   $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL $name $detail" -ForegroundColor Red }
}

$oj = (Api POST '/auth/login' @{ login='+998901111111'; password='Restor2026dev'; tenantSlug='demo' }).data.tokens.accessToken
$fin = (Api POST '/auth/login' @{ login='+998907777777'; password='Restor2026dev'; tenantSlug='demo' }).data.tokens.accessToken
$cashier = (Api POST '/auth/login' @{ login='+998904444444'; password='Restor2026dev'; tenantSlug='demo' }).data.tokens.accessToken
$bid = (Api GET '/branches/summary' $null $oj).data[0].id

Write-Host "`n--- dashboard ---"
$d = (Api GET '/reports/dashboard' $null $oj).data
Check 'dashboard javob beradi' ($null -ne $d)
Check 'tushum raqam'          ($d.revenue -is [int] -or $d.revenue -is [long]) "= $($d.revenue)"
Check 'ortacha chek hisoblandi' ($d.ordersCount -eq 0 -or $d.averageCheck -gt 0) "= $($d.averageCheck)"
Check 'sana oraligi qaytdi'   ($null -ne $d.dateFrom -and $null -ne $d.dateTo)
Write-Host "       tushum $($d.revenue), $($d.ordersCount) buyurtma, ortacha $($d.averageCheck)"

Write-Host "`n--- sotuv hisoboti ---"
$s = (Api GET '/reports/sales?granularity=day' $null $oj).data
Check 'sotuv hisoboti'        ($null -ne $s)
Check 'tur boyicha taqsimot'  ($null -ne $s.byType)
Check 'kanal boyicha'         ($null -ne $s.bySource)
Check 'tolov turi boyicha'    ($null -ne $s.byPayment)
Check 'timeline massiv'       ($null -ne $s.timeline)
$sumByType = ($s.byType | Measure-Object -Property revenue -Sum).Sum
Check 'tur boyicha yigindi jamiga yaqin' ([math]::Abs($sumByType - ($s.revenue + $s.refunds)) -le 1) "$sumByType vs $($s.revenue + $s.refunds)"
if ($s.byPayment.Count -gt 0) {
  $shareSum = ($s.byPayment | Measure-Object -Property sharePercent -Sum).Sum
  Check 'tolov ulushlari ~100%' ([math]::Abs($shareSum - 100) -le 1) "= $shareSum"
}

Write-Host "`n--- granularity ---"
foreach ($g in @('hour','day','week','month')) {
  $r = (Api GET "/reports/sales?granularity=$g" $null $oj).data
  Check "granularity=$g" ($null -ne $r.timeline) "$($r.timeline.Count) nuqta"
}

Write-Host "`n--- mahsulotlar / ABC ---"
$p = (Api GET '/reports/products?limit=50' $null $oj).data
Check 'mahsulotlar hisoboti' ($null -ne $p) "$($p.Count) ta"
if ($p.Count -gt 0) {
  Check 'tushum boyicha tartiblangan' ($p[0].revenue -ge $p[$p.Count-1].revenue)
  Check 'ABC sinfi berilgan'          ($p[0].abcClass -in @('A','B','C')) $p[0].abcClass
  Check 'ulush foizi berilgan'        ($null -ne $p[0].revenueSharePercent) "= $($p[0].revenueSharePercent)%"
  $a = @($p | Where-Object { $_.abcClass -eq 'A' })
  Check 'A sinfi eng yuqori tushumda' ($a.Count -eq 0 -or $a[0].productId -eq $p[0].productId)
}

Write-Host "`n--- moliya (FINANCE roli) ---"
$f = (Api GET '/reports/finance' $null $fin).data
Check 'moliya hisoboti'   ($null -ne $f)
Check 'smenalar sanaldi'  ($null -ne $f.shiftsCount) "= $($f.shiftsCount)"
Check 'farqlar royxati'   ($null -ne $f.discrepancies)
$calc = $f.countedCash - $f.expectedCash
Write-Host "       $($f.shiftsCount) smena, kutilgan $($f.expectedCash), sanalgan $($f.countedCash), farq $($f.difference)"

Write-Host "`n--- ruxsatlar ---"
try {
  Api GET '/reports/finance' $null $cashier | Out-Null
  Check 'kassir moliya hisobotini olmaydi' $false 'oldi'
} catch { Check 'kassir moliya hisobotini olmaydi' $true }

Write-Host "`n--- sana cheklovi ---"
try {
  Api GET '/reports/sales?dateFrom=2026-12-31&dateTo=2026-01-01' $null $oj | Out-Null
  Check 'teskari sana oraligi rad etiladi' $false 'qabul qilindi'
} catch { Check 'teskari sana oraligi rad etiladi' $true }
try {
  Api GET '/reports/sales?dateFrom=notadate' $null $oj | Out-Null
  Check 'notogri sana formati rad etiladi' $false 'qabul qilindi'
} catch { Check 'notogri sana formati rad etiladi' $true }

Write-Host "`n--- filial boyicha ajratish ---"
$all = (Api GET '/reports/dashboard' $null $oj).data
$one = (Api GET "/reports/dashboard?branchId=$bid" $null $oj).data
Check 'filial boyicha filtr ishlaydi' ($one.branchId -eq $bid) $one.branchId
Check 'filial tushumi umumiydan oshmaydi' ($one.revenue -le $all.revenue) "$($one.revenue) <= $($all.revenue)"

Write-Host "`n$pass passed, $fail failed`n" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
