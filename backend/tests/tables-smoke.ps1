# Tables and QR guest service, against the live server. ASCII only.
$ErrorActionPreference = 'Stop'
$API = 'https://api.restor.uz/api/v1'
$pass = 0; $fail = 0

function Api($method, $path, $body = $null, $jwt = $null, $noTenant = $false) {
  $h = @{ 'Content-Type' = 'application/json' }
  if (-not $noTenant) { $h['X-Tenant-Slug'] = 'demo' }
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
$created = @()

try {
  Write-Host "`n--- stol yaratish ---"
  $num = "T$((Get-Random -Minimum 100 -Maximum 999))"
  $t = (Api POST '/tables' @{ branchId=$bid; number=$num; name='Test stol'; seats=4; zone='Terrassa' } $oj).data
  $created += $t.id
  Check 'stol yaratildi'    ($t.number -eq $num) $t.number
  Check 'QR token berildi'  ($t.qrToken.Length -ge 30) "uzunlik $($t.qrToken.Length)"
  Check 'QR url qurildi'    ($t.qrUrl -like 'http*/t/*') $t.qrUrl

  try {
    Api POST '/tables' @{ branchId=$bid; number=$num } $oj | Out-Null
    Check 'takroriy raqam rad etiladi' $false 'qabul qilindi'
  } catch { Check 'takroriy raqam rad etiladi' $true }

  Write-Host "`n--- mehmon QR ni skanerlaydi (token bilan, tokensiz) ---"
  # The guest has no account and sends no tenant header: the token is all.
  $s = (Api GET "/t/$($t.qrToken)" $null $null $true).data
  Check 'QR hal qilindi'       ($s.tableId -eq $t.id)
  Check 'filial nomi qaytdi'   ($s.branchName.Length -gt 0) $s.branchName
  Check 'restoran slugi qaytdi'($s.tenantSlug -eq 'demo') $s.tenantSlug

  try {
    Api GET '/t/yoq-shunaqa-token-123' $null $null $true | Out-Null
    Check 'notogri token rad etiladi' $false 'qabul qilindi'
  } catch { Check 'notogri token rad etiladi' $true }

  Write-Host "`n--- ofitsiantni chaqirish ---"
  $c1 = (Api POST "/t/$($t.qrToken)/call" @{ type='CALL_WAITER' } $null $true).data
  Check 'chaqiruv yaratildi' ($c1.status -eq 'PENDING') $c1.status
  Check 'stol raqami bor'    ($c1.tableNumber -eq $num)

  # Repeat taps must collapse, not queue three rows at a waiter.
  $c2 = (Api POST "/t/$($t.qrToken)/call" @{ type='CALL_WAITER' } $null $true).data
  Check 'takroriy bosish bitta chaqiruvga yigiladi' ($c2.id -eq $c1.id)

  $bill = (Api POST "/t/$($t.qrToken)/call" @{ type='REQUEST_BILL' } $null $true).data
  Check 'hisob sorovi alohida chaqiruv' ($bill.id -ne $c1.id) $bill.type

  Write-Host "`n--- ofitsiant navbatida korinadi ---"
  $queue = (Api GET "/waiter-calls?branchId=$bid" $null $oj).data
  Check 'navbatda korinadi' (@($queue | Where-Object { $_.id -eq $c1.id }).Count -eq 1)

  Write-Host "`n--- ikki bosqichli bajarish ---"
  $ack = (Api POST "/waiter-calls/$($c1.id)/acknowledge" $null $oj).data
  Check 'ketdim bosildi'     ($ack.status -eq 'ACKNOWLEDGED') $ack.status
  Check 'kim olgani yozildi' ($null -ne $ack.acknowledgedByUserId)
  $done = (Api POST "/waiter-calls/$($c1.id)/resolve" $null $oj).data
  Check 'bajarildi'          ($done.status -eq 'RESOLVED') $done.status
  Check 'bajarilgan vaqt'    ($null -ne $done.resolvedAt)

  $after = (Api GET "/waiter-calls?branchId=$bid" $null $oj).data
  Check 'bajarilgan navbatdan chiqdi' (@($after | Where-Object { $_.id -eq $c1.id }).Count -eq 0)

  Write-Host "`n--- QR ni yangilash ---"
  $oldToken = $t.qrToken
  $rotated = (Api POST "/tables/$($t.id)/rotate-qr" $null $oj).data
  Check 'yangi token berildi' ($rotated.qrToken -ne $oldToken)
  try {
    Api GET "/t/$oldToken" $null $null $true | Out-Null
    Check 'eski token ishlamaydi' $false 'hali ishlayapti'
  } catch { Check 'eski token ishlamaydi' $true }
  $s2 = (Api GET "/t/$($rotated.qrToken)" $null $null $true).data
  Check 'yangi token ishlaydi' ($s2.tableId -eq $t.id)

  Write-Host "`n--- ochirilgan stol ---"
  Api PATCH "/tables/$($t.id)" @{ isActive=$false } $oj | Out-Null
  try {
    Api GET "/t/$($rotated.qrToken)" $null $null $true | Out-Null
    Check 'ochirilgan stol QR si ishlamaydi' $false 'ishlayapti'
  } catch { Check 'ochirilgan stol QR si ishlamaydi' $true }
  Api PATCH "/tables/$($t.id)" @{ isActive=$true } $oj | Out-Null

  Write-Host "`n--- royxat ---"
  $list = (Api GET "/tables?branchId=$bid" $null $oj).data
  Check 'stollar royxati' (@($list | Where-Object { $_.id -eq $t.id }).Count -eq 1) "$($list.Count) ta"
} finally {
  Write-Host "`n--- tozalash ---"
  foreach ($id in $created) {
    try { Api DELETE "/tables/$id" $null $oj | Out-Null; Check 'stol ochirildi' $true } catch { Check 'stol ochirildi' $false $_.Exception.Message }
  }
}

Write-Host "`n$pass passed, $fail failed`n" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
