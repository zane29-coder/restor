# End-to-end check of the courier profile + wallet + handover flow.
# ASCII only: PowerShell 5.1 reads .ps1 as ANSI and Uzbek apostrophes break it.
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

function Check($name, $condition, $detail = '') {
  if ($condition) { $script:pass++; Write-Host "  OK   $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL $name $detail" -ForegroundColor Red }
}

Write-Host "`n--- auth ---"
$courier = (Api POST '/auth/login' @{ login='+998906666666'; password='Restor2026dev'; tenantSlug='demo' }).data
$cj = $courier.tokens.accessToken
$owner = (Api POST '/auth/login' @{ login='+998901111111'; password='Restor2026dev'; tenantSlug='demo' }).data
$oj = $owner.tokens.accessToken
Check 'courier logs in' ($null -ne $cj)

Write-Host "`n--- GET /courier/me ---"
$me = (Api GET '/courier/me' $null $cj).data
Check 'returns a name'        ($me.fullName.Length -gt 0)          $me.fullName
Check 'returns a phone'       ($me.phone -like '+*')               $me.phone
Check 'has vehicleType'       ($null -ne $me.vehicleType)          $me.vehicleType
Check 'has branch'            ($null -ne $me.branchName)           $me.branchName
Check 'deliveredToday is int' ($me.deliveredToday -is [int])       "= $($me.deliveredToday)"
Check 'collectedToday present'($null -ne $me.collectedToday)       "= $($me.collectedToday)"
Check 'earnedToday present'   ($null -ne $me.earnedToday)          "= $($me.earnedToday)"
Write-Host "       $($me.fullName) | $($me.phone) | $($me.branchName) | bugun: $($me.deliveredToday) ta"

Write-Host "`n--- PATCH /courier/me (contact phone) ---"
$loginPhone = $me.phone
$newPhone = '+998901234599'
$updated = (Api PATCH '/courier/me' @{ phone = $newPhone } $cj).data
Check 'phone changed' ($updated.phone -eq $newPhone) $updated.phone

# The critical property: the LOGIN phone must be untouched by a contact edit.
try {
  $reLogin = (Api POST '/auth/login' @{ login=$loginPhone; password='Restor2026dev'; tenantSlug='demo' }).data
  Check 'login phone still works' ($null -ne $reLogin.tokens.accessToken)
} catch {
  Check 'login phone still works' $false 'LOCKED OUT'
}
try {
  Api POST '/auth/login' @{ login=$newPhone; password='Restor2026dev'; tenantSlug='demo' } | Out-Null
  Check 'contact phone is NOT a login' $false 'it authenticated'
} catch {
  Check 'contact phone is NOT a login' $true
}
Api PATCH '/courier/me' @{ phone = $loginPhone } $cj | Out-Null

Write-Host "`n--- wallet ---"
$wallet = (Api GET '/courier/wallet' $null $cj).data
Check 'wallet loads' ($null -ne $wallet) "balance=$($wallet.balance)"
$inv = $wallet.cashReceived - $wallet.cashHandedOver - $wallet.expenses
Check 'balance = received - handed - expenses' ($wallet.balance -eq $inv) "$($wallet.balance) vs $inv"

$tx = (Api GET '/courier/wallet/transactions' $null $cj).data
Check 'transactions endpoint' ($null -ne $tx) "$($tx.Count) ta"
if ($tx.Count -gt 0) {
  $t = $tx[0]
  Check 'transaction has type+amount+createdAt' ($t.type -and ($null -ne $t.amount) -and $t.createdAt) "$($t.type) $($t.amount)"
}

Write-Host "`n--- handover flow ---"
$hv = (Api GET '/courier/handovers' $null $cj).data
Check 'handovers endpoint' ($null -ne $hv) "$($hv.Count) ta"

$pending = $hv | Where-Object { $_.status -eq 'PENDING' } | Select-Object -First 1
if (-not $pending -and $wallet.balance -gt 0) {
  $amount = [math]::Floor($wallet.balance / 2)
  if ($amount -lt 1) { $amount = $wallet.balance }
  $declared = (Api POST '/courier/handovers' @{ amount = $amount } $cj).data
  Check 'declare without branchId' ($declared.status -eq 'PENDING') $declared.status
  Check 'branch resolved server-side' ($null -ne $declared.branchId)

  $after = (Api GET '/courier/wallet' $null $cj).data
  Check 'balance UNCHANGED until cashier confirms' ($after.balance -eq $wallet.balance) "$($after.balance) vs $($wallet.balance)"

  try {
    Api POST '/courier/handovers' @{ amount = 1000 } $cj | Out-Null
    Check 'a second pending declaration is refused' $false 'it was accepted'
  } catch {
    Check 'a second pending declaration is refused' $true
  }

  Write-Host "`n--- cashier confirms ---"
  $confirmed = (Api POST "/handovers/$($declared.id)/confirm" @{} $oj).data
  Check 'cashier confirms' ($confirmed.status -eq 'CONFIRMED') $confirmed.status

  $final = (Api GET '/courier/wallet' $null $cj).data
  Check 'balance drops only after confirmation' ($final.balance -eq ($wallet.balance - $amount)) "$($final.balance) vs $($wallet.balance - $amount)"
} else {
  Write-Host "  SKIP handover: balance=$($wallet.balance), pending=$($null -ne $pending)" -ForegroundColor Yellow
}

Write-Host "`n--- isolation ---"
try {
  Api GET '/courier/me' $null $oj | Out-Null
  Check 'a non-courier gets 403 on /courier/me' $false 'it returned data'
} catch {
  Check 'a non-courier gets 403 on /courier/me' $true
}

Write-Host "`n$pass passed, $fail failed`n" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
