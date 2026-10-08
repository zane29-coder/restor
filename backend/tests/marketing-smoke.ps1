# Promotions, promo codes and dispatch, against the live server. ASCII only.
$ErrorActionPreference = 'Stop'
$API = 'https://api.restor.uz/api/v1'
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
$menu = Api GET "/menu/$bid"
$p = ($menu.data.categories | ForEach-Object { $_.products } | Select-Object -First 1)
$cart = @{ branchId=$bid; type='PICKUP'; items=@(@{ productId=$p.id; quantity=2; modifierIds=@() }) }

$base = (Api POST '/orders/preview' $cart $oj).data
Write-Host "`nBazaviy narx: subtotal $($base.subtotal), jami $($base.total)"

$createdPromotions = @(); $createdCodes = @()
try {
  Write-Host "`n--- endpointlar ochildi ---"
  $promos = (Api GET '/promotions' $null $oj)
  Check 'GET /promotions' ($null -ne $promos.data)
  $codes = (Api GET '/promo-codes' $null $oj)
  Check 'GET /promo-codes' ($null -ne $codes.data)

  Write-Host "`n--- xato turdagi qiymat rad etiladi ---"
  try {
    Api POST '/promotions' @{ name='Xato'; type='PERCENTAGE_DISCOUNT'; value=50000 } $oj | Out-Null
    Check 'foiz sifatida 50000 rad etiladi' $false 'qabul qilindi'
  } catch { Check 'foiz sifatida 50000 rad etiladi' $true }
  try {
    Api POST '/promotions' @{ name='Xato2'; type='FIXED_DISCOUNT'; value=0 } $oj | Out-Null
    Check 'nol belgilangan chegirma rad etiladi' $false 'qabul qilindi'
  } catch { Check 'nol belgilangan chegirma rad etiladi' $true }
  try {
    Api POST '/promotions' @{ name='Yarim oyna'; type='HAPPY_HOUR'; value=10; timeFrom='10:00' } $oj | Out-Null
    Check 'yarim vaqt oraligi rad etiladi' $false 'qabul qilindi'
  } catch { Check 'yarim vaqt oraligi rad etiladi' $true }

  Write-Host "`n--- aksiya yaratish va narxga tasiri ---"
  $promo = (Api POST '/promotions' @{
    name='Test 20 foiz'; type='PERCENTAGE_DISCOUNT'; value=20
    isExclusive=$true; isActive=$true; priority=100
  } $oj).data
  $createdPromotions += $promo.id
  Check 'aksiya yaratildi' ($promo.value -eq 20) "= $($promo.value)"

  Start-Sleep -Seconds 1
  $withPromo = (Api POST '/orders/preview' $cart $oj).data
  $expected = [math]::Floor($base.subtotal * 0.2)
  Check 'chegirma narxlashda qollandi' ($withPromo.discountTotal -eq $expected) "$($withPromo.discountTotal) vs $expected"
  Check 'jami kamaydi' ($withPromo.total -lt $base.total) "$($withPromo.total) vs $($base.total)"
  Check 'aksiya nomi korsatiladi' ($withPromo.appliedPromotions.Count -ge 1 -and $withPromo.appliedPromotions[0].name -eq 'Test 20 foiz')

  Write-Host "`n--- ochirilgan aksiya qollanmaydi ---"
  Api PATCH "/promotions/$($promo.id)" @{ isActive=$false } $oj | Out-Null
  Start-Sleep -Seconds 1
  $off = (Api POST '/orders/preview' $cart $oj).data
  Check 'ochirilgach chegirma yoq' ($off.discountTotal -eq 0) "= $($off.discountTotal)"

  Write-Host "`n--- promokod ---"
  $code = "TEST$((Get-Random -Minimum 1000 -Maximum 9999))"
  $pc = (Api POST '/promo-codes' @{ code=$code.ToLower(); type='PERCENTAGE'; discount=15; userLimit=5 } $oj).data
  $createdCodes += $pc.id
  Check 'kod katta harfga otkazildi' ($pc.code -eq $code) "$($pc.code) vs $code"

  $withCode = (Api POST '/orders/preview' (@{} + $cart + @{ promoCode=$code }) $oj).data
  $expectedCode = [math]::Floor($base.subtotal * 0.15)
  Check 'promokod chegirmasi qollandi' ($withCode.discountTotal -eq $expectedCode) "$($withCode.discountTotal) vs $expectedCode"

  try {
    Api POST '/promo-codes' @{ code=$code; type='FIXED'; discount=5000 } $oj | Out-Null
    Check 'takroriy kod rad etiladi' $false 'qabul qilindi'
  } catch { Check 'takroriy kod rad etiladi' $true }
  try {
    Api POST '/promo-codes' @{ code='AB'; type='FIXED'; discount=5000 } $oj | Out-Null
    Check 'juda qisqa kod rad etiladi' $false 'qabul qilindi'
  } catch { Check 'juda qisqa kod rad etiladi' $true }

  Write-Host "`n--- notogri promokod ---"
  try {
    Api POST '/orders/preview' (@{} + $cart + @{ promoCode='YOQSHUNAQAKOD' }) $oj | Out-Null
    Check 'mavjud bomagan kod rad etiladi' $false 'qabul qilindi'
  } catch { Check 'mavjud bomagan kod rad etiladi' $true }

  Write-Host "`n--- foydalanishlar royxati ---"
  $usages = (Api GET "/promo-codes/$($pc.id)/usages" $null $oj)
  Check 'usages endpoint' ($null -ne $usages.data) "$($usages.data.Count) ta"

  Write-Host "`n--- dispetcher ---"
  $couriers = (Api GET '/couriers?limit=50' $null $oj)
  Check 'kuryerlar royxati' ($couriers.data.Count -ge 1) "$($couriers.data.Count) ta"
  $c = $couriers.data[0]
  Check 'kuryerda hamyon bor' ($null -ne $c.wallet) "balans: $($c.wallet.balance)"
  Check 'faol yetkazish soni bor' ($null -ne $c.activeDeliveryCount)
  $hv = (Api GET '/handovers?limit=20' $null $oj)
  Check 'topshiruvlar royxati' ($null -ne $hv.data) "$($hv.data.Count) ta"

  Write-Host "`n--- tenant izolyatsiyasi ---"
  # A promotion must not be visible from another restaurant.
  $other = $null
  try { $other = (Api POST '/auth/login' @{ login='+998901111111'; password='Restor2026dev'; tenantSlug='demo2' }).data } catch {}
  if ($other) {
    $h2 = @{ 'Content-Type'='application/json'; 'X-Tenant-Slug'='demo2'; 'Authorization'="Bearer $($other.tokens.accessToken)" }
    $seen = Invoke-RestMethod -Uri "$API/promotions" -Headers $h2 -TimeoutSec 30
    $leak = $seen.data | Where-Object { $_.id -eq $promo.id }
    Check 'boshqa tenant aksiyani kormaydi' ($null -eq $leak)
  } else {
    Write-Host "  SKIP: ikkinchi tenant yoq" -ForegroundColor Yellow
  }
} finally {
  Write-Host "`n--- tozalash ---"
  foreach ($id in $createdPromotions) { try { Api DELETE "/promotions/$id" $null $oj | Out-Null } catch {} }
  foreach ($id in $createdCodes) { try { Api DELETE "/promo-codes/$id" $null $oj | Out-Null } catch {} }
  Start-Sleep -Seconds 1
  $final = (Api POST '/orders/preview' $cart $oj).data
  Check 'narx bazaviy holatga qaytdi' ($final.total -eq $base.total) "$($final.total) vs $($base.total)"
}

Write-Host "`n$pass passed, $fail failed`n" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
