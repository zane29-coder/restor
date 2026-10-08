# Inventory: items, movements, recipes and automatic deduction. ASCII only.
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
$items = @(); $sup = $null

try {
  Write-Host "`n--- yetkazib beruvchi ---"
  $sup = (Api POST '/suppliers' @{ name="Sinov taminot $(Get-Random -Max 9999)"; phone='+998901234000' } $oj).data
  Check 'yetkazib beruvchi yaratildi' ($null -ne $sup.id) $sup.name

  Write-Host "`n--- ombor mahsuloti ---"
  $cheese = (Api POST '/stock/items' @{ branchId=$bid; name="Pishloq $(Get-Random -Max 9999)"; unit='KG'; quantity=10; minQuantity=2; costPerUnit=50000 } $oj).data
  $items += $cheese.id
  Check 'mahsulot yaratildi'  ($cheese.quantity -eq '10.000') $cheese.quantity
  Check 'past emas'           ($cheese.isLow -eq $false)
  Check 'qiymat hisoblandi'   ($cheese.stockValue -eq 500000) "= $($cheese.stockValue)"

  Write-Host "`n--- boshlangich qoldiq ham harakat sifatida yozildi ---"
  $mv = (Api GET "/stock/movements?stockItemId=$($cheese.id)" $null $oj).data
  Check 'boshlangich qoldiq harakati' (@($mv).Count -eq 1) "$(@($mv).Count) ta"

  Write-Host "`n--- kirim ---"
  Api POST '/stock/movements' @{ stockItemId=$cheese.id; type='RECEIPT'; quantity=5; costPerUnit=52000; supplierId=$sup.id } $oj | Out-Null
  $after = (Api GET "/stock/items/$($cheese.id)" $null $oj).data
  Check 'miqdor oshdi'          ($after.quantity -eq '15.000') $after.quantity
  Check 'narx yangilandi'       ($after.costPerUnit -eq 52000) "= $($after.costPerUnit)"

  Write-Host "`n--- chiqim (yaroqsiz) ---"
  Api POST '/stock/movements' @{ stockItemId=$cheese.id; type='WASTE'; quantity=1.5; comment='Buzilgan' } $oj | Out-Null
  $after2 = (Api GET "/stock/items/$($cheese.id)" $null $oj).data
  Check 'miqdor kamaydi' ($after2.quantity -eq '13.500') $after2.quantity

  Write-Host "`n--- kasrli arifmetika ---"
  # 0.1 kg ten times must come to exactly 1.0, not 0.9999999
  for ($i = 0; $i -lt 10; $i++) {
    Api POST '/stock/movements' @{ stockItemId=$cheese.id; type='WASTE'; quantity=0.1 } $oj | Out-Null
  }
  $after3 = (Api GET "/stock/items/$($cheese.id)" $null $oj).data
  Check 'kasrlar aniq qoshildi' ($after3.quantity -eq '12.500') $after3.quantity

  Write-Host "`n--- cheklovlar ---"
  try {
    Api POST '/stock/movements' @{ stockItemId=$cheese.id; type='CONSUMPTION'; quantity=1 } $oj | Out-Null
    Check 'qolda sarflash rad etiladi' $false 'qabul qilindi'
  } catch { Check 'qolda sarflash rad etiladi' $true }
  try {
    Api POST '/stock/movements' @{ stockItemId=$cheese.id; type='ADJUSTMENT'; quantity=5 } $oj | Out-Null
    Check 'sababsiz tuzatish rad etiladi' $false 'qabul qilindi'
  } catch { Check 'sababsiz tuzatish rad etiladi' $true }
  try {
    Api PATCH "/stock/items/$($cheese.id)" @{ quantity=999 } $oj | Out-Null
    $probe = (Api GET "/stock/items/$($cheese.id)" $null $oj).data
    Check 'miqdorni togridan-togri ozgartirib bolmaydi' ($probe.quantity -ne '999.000') $probe.quantity
  } catch { Check 'miqdorni togridan-togri ozgartirib bolmaydi' $true }

  Write-Host "`n--- past qoldiq ogohlantirishi ---"
  Api POST '/stock/movements' @{ stockItemId=$cheese.id; type='ADJUSTMENT'; quantity=-11; comment='Inventarizatsiya' } $oj | Out-Null
  $low = (Api GET "/stock/items/$($cheese.id)" $null $oj).data
  Check 'past deb belgilandi' ($low.isLow -eq $true) "miqdor $($low.quantity), chegara $($low.minQuantity)"

  Write-Host "`n--- retsept ---"
  $prod = (Api GET '/products?limit=1' $null $oj).data[0]
  $r = (Api PATCH "/products/$($prod.id)/recipe" @{ ingredients=@(@{ stockItemId=$cheese.id; quantity=0.2 }) } $oj).data
  Check 'retsept saqlandi'     (@($r.ingredients).Count -eq 1)
  Check 'tannarx hisoblandi'   ($r.totalCost -gt 0) "= $($r.totalCost)"
  Check 'margin hisoblandi'    ($r.margin -eq ($r.price - $r.totalCost)) "$($r.margin)"

  try {
    Api PATCH "/products/$($prod.id)/recipe" @{ ingredients=@(
      @{ stockItemId=$cheese.id; quantity=0.1 }, @{ stockItemId=$cheese.id; quantity=0.2 }
    ) } $oj | Out-Null
    Check 'takroriy ingredient rad etiladi' $false 'qabul qilindi'
  } catch { Check 'takroriy ingredient rad etiladi' $true }

  Write-Host "`n--- AVTOMATIK HISOBDAN CHIQARISH ---"
  $before = [decimal]((Api GET "/stock/items/$($cheese.id)" $null $oj).data.quantity)
  $order = (Api POST '/orders' @{
    branchId=$bid; type='PICKUP'; source='POS'
    clientUuid=[guid]::NewGuid().ToString()
    customer=@{ name='Ombor sinovi'; phone='+998901239999' }
    items=@(@{ productId=$prod.id; quantity=3; modifierIds=@() })
  } $oj).data
  foreach ($s in @('ACCEPTED','PREPARING','READY','DELIVERED')) {
    Api PATCH "/orders/$($order.id)/status" @{ status=$s } $oj | Out-Null
  }
  Start-Sleep -Seconds 3
  $afterOrder = [decimal]((Api GET "/stock/items/$($cheese.id)" $null $oj).data.quantity)
  $expected = $before - 0.6   # 0.2 kg x 3
  Check 'buyurtma ingredientni hisobdan chiqardi' ($afterOrder -eq $expected) "$afterOrder vs $expected"

  $consumed = (Api GET "/stock/movements?stockItemId=$($cheese.id)&type=CONSUMPTION" $null $oj).data
  Check 'sarflash harakati yozildi' (@($consumed).Count -ge 1) "$(@($consumed).Count) ta"
  if (@($consumed).Count -gt 0) {
    Check 'buyurtmaga bogiangan' ($consumed[0].orderId -eq $order.id)
  }

  Write-Host "`n--- hisobot ---"
  $sum = (Api GET "/stock/summary?branchId=$bid" $null $oj).data
  Check 'ombor hisoboti'     ($null -ne $sum)
  Check 'past mahsulotlar'   ($sum.lowCount -ge 1) "= $($sum.lowCount)"
  Check 'yaroqsiz qiymati'   ($sum.wasteValue -gt 0) "= $($sum.wasteValue)"
  Write-Host "       $($sum.itemsCount) mahsulot, $($sum.lowCount) past, qiymat $($sum.totalValue), yaroqsiz $($sum.wasteValue)"
} finally {
  Write-Host "`n--- tozalash ---"
  $prod = (Api GET '/products?limit=1' $null $oj).data[0]
  try { Api PATCH "/products/$($prod.id)/recipe" @{ ingredients=@() } $oj | Out-Null } catch {}
  foreach ($id in $items) { try { Api DELETE "/stock/items/$id" $null $oj | Out-Null } catch {} }
  if ($sup) { try { Api PATCH "/suppliers/$($sup.id)" @{ isActive=$false } $oj | Out-Null } catch {} }
  Check 'tozalandi' $true
}

Write-Host "`n$pass passed, $fail failed`n" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
