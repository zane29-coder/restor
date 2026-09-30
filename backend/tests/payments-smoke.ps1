# Cash shift + payment + refund, end to end against the live server. ASCII only.
$ErrorActionPreference = 'Stop'
$API = 'https://restore-1.duckdns.org/api/v1'
$pass = 0; $fail = 0

function Api($method, $path, $body = $null, $jwt = $null) {
  $h = @{ 'Content-Type' = 'application/json'; 'X-Tenant-Slug' = 'demo' }
  if ($jwt) { $h['Authorization'] = "Bearer $jwt" }
  $a = @{ Uri = "$API$path"; Method = $method; Headers = $h; TimeoutSec = 30 }
  if ($body) { $a['Body'] = ($body | ConvertTo-Json -Depth 10 -Compress) }
  Invoke-RestMethod @a
}
function Check($name, $cond, $detail = '') {
  if ($cond) { $script:pass++; Write-Host "  OK   $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL $name $detail" -ForegroundColor Red }
}

$oj = (Api POST '/auth/login' @{ login='+998901111111'; password='Restor2026dev'; tenantSlug='demo' }).data.tokens.accessToken
$branch = (Api GET '/branches/summary').data | Where-Object { $_.name -eq 'Chilonzor' }
$bid = $branch.id

Write-Host "`n--- registers ---"
$regs = (Api GET "/cash/registers?branchId=$bid" $null $oj).data
Check 'registers endpoint answers' ($null -ne $regs) "$($regs.Count) ta"

Write-Host "`n--- open a shift ---"
$open = (Api GET "/cash/shifts/current?branchId=$bid" $null $oj).data
if ($open) {
  Write-Host "  (closing a leftover shift first)" -ForegroundColor Yellow
  Api POST "/cash/shifts/$($open.id)/close" @{ actualCash = $open.expectedCash } $oj | Out-Null
}
$shift = (Api POST '/cash/shifts/open' @{ branchId=$bid; openingCash=200000 } $oj).data
Check 'shift opens'              ($shift.status -eq 'OPEN')            $shift.status
Check 'float counted in'         ($shift.expectedCash -eq 200000)      "= $($shift.expectedCash)"
Check 'register auto-resolved'   ($null -ne $shift.cashRegisterId)

try {
  Api POST '/cash/shifts/open' @{ branchId=$bid; openingCash=0 } $oj | Out-Null
  Check 'a second shift is refused' $false 'it opened'
} catch { Check 'a second shift is refused' $true }

Write-Host "`n--- an order to pay for ---"
$menu = Api GET "/menu/$bid"
$p = ($menu.data.categories | ForEach-Object { $_.products } | Select-Object -First 1)
$order = (Api POST '/orders' @{
  branchId=$bid; type='PICKUP'; source='POS'
  clientUuid=[guid]::NewGuid().ToString()
  customer=@{ name='Kassa testi'; phone='+998901234777' }
  items=@(@{ productId=$p.id; quantity=2; modifierIds=@() })
} $oj).data
Write-Host "  $($order.displayNumber)  jami: $($order.total)"
Check 'starts UNPAID' ($order.paymentStatus -eq 'UNPAID') $order.paymentStatus

Write-Host "`n--- partial cash payment ---"
$half = [math]::Floor($order.total / 2)
Api POST '/payments' @{ orderId=$order.id; method='CASH'; amount=$half } $oj | Out-Null
$after = (Api GET "/orders/$($order.id)" $null $oj).data
Check 'becomes PARTIALLY_PAID' ($after.paymentStatus -eq 'PARTIALLY_PAID') $after.paymentStatus
Check 'paidTotal follows'      ($after.paidTotal -eq $half)              "= $($after.paidTotal)"

$s1 = (Api GET "/cash/shifts/$($shift.id)" $null $oj).data
Check 'drawer rose by the cash' ($s1.expectedCash -eq (200000 + $half)) "= $($s1.expectedCash)"
Check 'cashTotal rose'          ($s1.cashTotal -eq $half)                "= $($s1.cashTotal)"

Write-Host "`n--- the rest on a card ---"
$rest = $order.total - $half
Api POST '/payments' @{ orderId=$order.id; method='CARD'; amount=$rest } $oj | Out-Null
$after2 = (Api GET "/orders/$($order.id)" $null $oj).data
Check 'becomes PAID' ($after2.paymentStatus -eq 'PAID') $after2.paymentStatus

$s2 = (Api GET "/cash/shifts/$($shift.id)" $null $oj).data
Check 'card did NOT touch the drawer' ($s2.expectedCash -eq $s1.expectedCash) "= $($s2.expectedCash)"
Check 'cardTotal rose'                ($s2.cardTotal -eq $rest)               "= $($s2.cardTotal)"

try {
  Api POST '/payments' @{ orderId=$order.id; method='CASH'; amount=1000 } $oj | Out-Null
  Check 'overpaying a paid order is refused' $false 'it was accepted'
} catch { Check 'overpaying a paid order is refused' $true }

Write-Host "`n--- payments ledger ---"
$list = (Api GET "/payments/order/$($order.id)" $null $oj).data
Check 'two payment rows' ($list.Count -eq 2) "= $($list.Count)"
$sum = ($list | Measure-Object -Property amount -Sum).Sum
Check 'rows sum to the order total' ($sum -eq $order.total) "$sum vs $($order.total)"

Write-Host "`n--- refund ---"
Api POST '/payments/refund' @{ orderId=$order.id; amount=$rest; reason='Test qaytarish' } $oj | Out-Null
$after3 = (Api GET "/orders/$($order.id)" $null $oj).data
Check 'becomes PARTIALLY_REFUNDED' ($after3.paymentStatus -eq 'PARTIALLY_REFUNDED') $after3.paymentStatus

Write-Host "`n--- manual drawer movements ---"
Api POST "/cash/shifts/$($shift.id)/transactions" @{ type='CASH_IN'; amount=50000; comment='Test' } $oj | Out-Null
Api POST "/cash/shifts/$($shift.id)/transactions" @{ type='CASH_OUT'; amount=20000; comment='Test' } $oj | Out-Null
try {
  Api POST "/cash/shifts/$($shift.id)/transactions" @{ type='SALE'; amount=99999 } $oj | Out-Null
  Check 'inventing a SALE by hand is refused' $false 'it was accepted'
} catch { Check 'inventing a SALE by hand is refused' $true }

Write-Host "`n--- X-report ---"
$x = (Api GET "/cash/shifts/$($shift.id)/summary" $null $oj).data
Write-Host "  naqd: $($x.cashSales)  karta: $($x.cardSales)  qaytarish: $($x.refunds)  kutilgan: $($x.expectedCash)"
Check 'X-report cash matches'  ($x.cashSales -eq $half)
Check 'X-report card matches'  ($x.cardSales -eq $rest)
Check 'X-report cashIn/Out'    ($x.cashIn -eq 50000 -and $x.cashOut -eq 20000)

# opening 200 000 + cash sale - card refund? The refund went back on CARD
# (the most recent payment), so the drawer keeps the cash sale.
$expected = 200000 + $half + 50000 - 20000
Check 'expectedCash adds up' ($x.expectedCash -eq $expected) "$($x.expectedCash) vs $expected"

Write-Host "`n--- Subo config ---"
$cfg = (Api GET '/payments/subo/config' $null $oj).data
Check 'subo config endpoint' ($cfg.provider -eq 'SUBO') $cfg.provider
Check 'no key configured yet' ($cfg.hasKey -eq $false)
# The whole path, not a wildcard: a URL missing /api/v1 matches
# "https://*/webhooks/subo" too, and that is exactly the bug this once hid.
Check 'callback url carries the api prefix' ($cfg.callbackUrl -like 'https://*/api/v1/webhooks/subo') $cfg.callbackUrl
try {
  $probe = Invoke-WebRequest -Uri $cfg.callbackUrl -Method POST -TimeoutSec 20 -UseBasicParsing `
           -Headers @{'Content-Type'='application/json'} -Body '{"orderId":"probe"}'
  Check 'the advertised callback url actually answers' ($probe.StatusCode -eq 200) "HTTP $($probe.StatusCode)"
} catch {
  Check 'the advertised callback url actually answers' $false "HTTP $($_.Exception.Response.StatusCode.value__)"
}
try {
  Api POST '/payments/subo/checkout' @{ orderId=$order.id } $oj | Out-Null
  Check 'checkout without a key is refused' $false 'it was accepted'
} catch { Check 'checkout without a key is refused' $true }
try {
  Api POST '/payments/subo/config' @{ apiKey='wrong_prefix_key_123456' } $oj | Out-Null
  Check 'a malformed key is rejected' $false 'it was accepted'
} catch { Check 'a malformed key is rejected' $true }

Write-Host "`n--- webhook is public but not gullible ---"
try {
  $r = Invoke-RestMethod -Uri "$API/webhooks/subo" -Method POST -TimeoutSec 20 `
       -Headers @{ 'Content-Type'='application/json' } `
       -Body (@{ event='order.paid'; orderId='forged-id'; status='PAID'; amountTiyin='99999999' } | ConvertTo-Json -Compress)
  Check 'accepts a callback without a token' $true
} catch { Check 'accepts a callback without a token' $false $_.Exception.Message }

$after4 = (Api GET "/orders/$($order.id)" $null $oj).data
Check 'a forged callback changed nothing' ($after4.paidTotal -eq $after3.paidTotal) "$($after4.paidTotal) vs $($after3.paidTotal)"

Write-Host "`n--- close the shift ---"
$counted = $x.expectedCash - 5000   # deliberately 5 000 short
$closed = (Api POST "/cash/shifts/$($shift.id)/close" @{ actualCash=$counted; comment='Test' } $oj).data
Check 'shift closes'            ($closed.status -eq 'CLOSED')      $closed.status
Check 'shortage recorded as-is' ($closed.difference -eq -5000)     "= $($closed.difference)"
try {
  Api POST "/cash/shifts/$($shift.id)/close" @{ actualCash=0 } $oj | Out-Null
  Check 'closing twice is refused' $false 'it closed again'
} catch { Check 'closing twice is refused' $true }

Write-Host "`n$pass passed, $fail failed`n" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
