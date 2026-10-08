# Customers, loyalty and the menu editor, against the live server. ASCII only.
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
$bid = (Api GET '/branches/summary' $null $oj).data[0].id

Write-Host "`n--- mijozlar ---"
$list = (Api GET '/customers?limit=50' $null $oj)
Check 'GET /customers' ($null -ne $list.data) "$($list.data.Count) ta"
if ($list.data.Count -eq 0) { Write-Host "  (mijoz yoq, test toxtatildi)" -ForegroundColor Yellow; exit }

$c = $list.data[0]
Write-Host "  $($c.fullName) $($c.phone) - $($c.ordersCount) buyurtma, $($c.totalSpent) som"

$detail = (Api GET "/customers/$($c.id)" $null $oj).data
Check 'batafsil korinish'      ($detail.id -eq $c.id)
Check 'manzillar massiv'       ($null -ne $detail.addresses)

$orders = (Api GET "/customers/$($c.id)/orders?limit=5" $null $oj)
Check 'buyurtmalar tarixi' ($null -ne $orders.data) "$($orders.data.Count) ta"

Write-Host "`n--- qidiruv ---"
$found = (Api GET "/customers?search=$($c.phone)" $null $oj)
Check 'telefon boyicha topiladi' (@($found.data | Where-Object { $_.id -eq $c.id }).Count -eq 1)
$none = (Api GET '/customers?search=YOQSHUNAQAODAM999' $null $oj)
Check 'mavjud bomagan boyicha bosh' (@($none.data).Count -eq 0)

Write-Host "`n--- bloklash ---"
Api POST "/customers/$($c.id)/block" @{ reason='Test' } $oj | Out-Null
$blocked = (Api GET "/customers/$($c.id)" $null $oj).data
Check 'bloklandi' ($blocked.isBlocked -eq $true)
Api POST "/customers/$($c.id)/unblock" $null $oj | Out-Null
$unblocked = (Api GET "/customers/$($c.id)" $null $oj).data
Check 'blok ochildi' ($unblocked.isBlocked -eq $false)
Check 'tarix saqlanib qoldi' ($unblocked.ordersCount -eq $c.ordersCount)

Write-Host "`n--- sodiqlik dasturi ---"
$prog = (Api GET '/loyalty/program' $null $oj).data
Check 'dastur endpointi' ($null -ne $prog) "faol: $($prog.isActive)"
$saved = (Api PATCH '/loyalty/program' @{ isActive=$true; cashbackPercent=5; pointValue=100; maxRedeemPercent=30 } $oj).data
Check 'sozlamalar saqlandi' ($saved.cashbackPercent -eq 5 -and $saved.pointValue -eq 100) "$($saved.cashbackPercent)% / $($saved.pointValue)"
try {
  Api PATCH '/loyalty/program' @{ cashbackPercent=80 } $oj | Out-Null
  Check 'haddan tashqari keshbek rad etiladi' $false 'qabul qilindi'
} catch { Check 'haddan tashqari keshbek rad etiladi' $true }

Write-Host "`n--- ball hisobi ---"
$acc = (Api GET "/customers/$($c.id)/loyalty" $null $oj).data
Check 'hisob yaratildi'     ($null -ne $acc.id)
Check 'referal kodi bor'    ($acc.referralCode.Length -eq 8) $acc.referralCode
Check 'kodda chalgituvchi belgi yoq' ($acc.referralCode -notmatch '[01OIL]') $acc.referralCode

$quote = (Api GET "/customers/$($c.id)/loyalty/quote?total=100000" $null $oj).data
Check 'ball kotirovkasi' ($null -ne $quote) "$($quote.points) ball = $($quote.amount) som"
Check 'kotirovka 30% dan oshmaydi' ($quote.amount -le 30000) "= $($quote.amount)"

$tx = (Api GET "/customers/$($c.id)/loyalty/transactions" $null $oj)
Check 'ball harakatlari' ($null -ne $tx.data) "$($tx.data.Count) ta"

Write-Host "`n--- menyu tahrirlash ---"
$prod = (Api GET '/products?limit=1' $null $oj).data[0]
$oldPrice = $prod.price
$newPrice = $oldPrice + 1000
Api PATCH "/products/$($prod.id)" @{ price=$newPrice } $oj | Out-Null
$after = (Api GET "/products/$($prod.id)" $null $oj).data
Check 'narx ozgardi' ($after.price -eq $newPrice) "$($after.price) vs $newPrice"
Api PATCH "/products/$($prod.id)" @{ price=$oldPrice } $oj | Out-Null
Check 'narx qaytarildi' ((Api GET "/products/$($prod.id)" $null $oj).data.price -eq $oldPrice)

$cat = (Api POST '/categories' @{ name='Test kategoriya'; sortOrder=99 } $oj).data
Check 'kategoriya yaratildi' ($cat.name -eq 'Test kategoriya')
Api PATCH "/categories/$($cat.id)" @{ name='Test ozgargan' } $oj | Out-Null
$renamed = (Api GET '/categories' $null $oj).data | Where-Object { $_.id -eq $cat.id }
Check 'kategoriya nomi ozgardi' ($renamed.name -eq 'Test ozgargan') $renamed.name
Api DELETE "/categories/$($cat.id)" $null $oj | Out-Null
Check 'kategoriya ochirildi' ($null -eq ((Api GET '/categories' $null $oj).data | Where-Object { $_.id -eq $cat.id }))

Write-Host "`n--- POS kassa oqimi hali ishlaydimi ---"
$cur = (Api GET "/cash/shifts/current?branchId=$bid" $null $oj).data
if (-not $cur) {
  $cur = (Api POST '/cash/shifts/open' @{ branchId=$bid; openingCash=100000 } $oj).data
}
Check 'smena mavjud' ($cur.status -eq 'OPEN')
$sum = (Api GET "/cash/shifts/$($cur.id)/summary" $null $oj).data
Check 'X-hisobot' ($null -ne $sum.expectedCash) "kutilgan: $($sum.expectedCash)"

Write-Host "`n$pass passed, $fail failed`n" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
