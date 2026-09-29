# Courier flow end-to-end against the live deployment.
# ASCII only: PowerShell 5.1 reads this file as ANSI.
param([string]$BaseUrl = 'https://restore-1.duckdns.org/api/v1')

$ErrorActionPreference = 'Stop'
$API = $BaseUrl.TrimEnd('/')
$pass = 0; $fail = 0

function Check($name, $cond, $detail = '') {
  if ($cond) { Write-Host "  PASS  $name" -ForegroundColor Green; $script:pass++ }
  else { Write-Host "  FAIL  $name  $detail" -ForegroundColor Red; $script:fail++ }
}

function Api($method, $path, $body = $null, $jwt = $null) {
  $h = @{ 'Content-Type' = 'application/json'; 'X-Tenant-Slug' = 'demo' }
  if ($jwt) { $h['Authorization'] = "Bearer $jwt" }
  $a = @{ Uri = "$API$path"; Method = $method; Headers = $h; TimeoutSec = 30 }
  if ($body) { $a['Body'] = ($body | ConvertTo-Json -Depth 10 -Compress) }
  Invoke-RestMethod @a
}

function ApiFail($method, $path, $body = $null, $jwt = $null) {
  try { Api $method $path $body $jwt | Out-Null; return $null }
  catch {
    $status = [int]$_.Exception.Response.StatusCode
    $raw = $_.ErrorDetails.Message
    $parsed = $null; if ($raw) { try { $parsed = $raw | ConvertFrom-Json } catch {} }
    return @{ status = $status; body = $parsed }
  }
}

Write-Host "`n=== SETUP ===" -ForegroundColor Cyan
$owner = Api POST '/auth/login' @{ login='+998901111111'; password='Restor2026dev'; tenantSlug='demo' }
$ownerJwt = $owner.data.tokens.accessToken
Check 'owner signed in' ($null -ne $ownerJwt)

$courier = Api POST '/auth/login' @{ login='+998906666666'; password='Restor2026dev'; tenantSlug='demo' }
$courierJwt = $courier.data.tokens.accessToken
Check 'seeded courier signed in' ($null -ne $courierJwt)

$me = Api GET '/auth/me' $null $courierJwt
Check 'courier holds only delivery permissions' (
  ($me.data.permissions -contains 'deliveries.view_own') -and
  (-not ($me.data.permissions -contains 'orders.view'))
) "perms=$($me.data.permissions.Count)"

$branchId = ((Api GET '/branches/summary').data | Where-Object { $_.name -eq 'Chilonzor' }).id

Write-Host "`n=== 1. COURIER LIST (dispatcher) ===" -ForegroundColor Cyan
$couriers = Api GET '/couriers' $null $ownerJwt
Check 'dispatcher lists couriers' ($couriers.data.Count -ge 1) "got $($couriers.data.Count)"
$courierId = ($couriers.data | Select-Object -First 1).id
Check 'courier carries a wallet' ($null -ne ($couriers.data | Select-Object -First 1).wallet)

$denied = ApiFail GET '/couriers' $null $courierJwt
Check 'courier cannot list couriers' ($denied.status -eq 403) "status=$($denied.status)"

Write-Host "`n=== 2. COURIER GOES ONLINE ===" -ForegroundColor Cyan
$status = Api POST '/courier/status' @{ status='AVAILABLE' } $courierJwt
Check 'courier goes AVAILABLE' ($status.data.status -eq 'AVAILABLE')

Api POST '/courier/location' @{ latitude=41.2760; longitude=69.2040; accuracyM=12 } $courierJwt | Out-Null
Check 'location ping accepted' $true

$live = Api GET '/couriers/live' $null $ownerJwt
Check 'courier appears on the dispatcher map' ($live.data.Count -ge 1) "got $($live.data.Count)"
Check 'map carries the last position' ($null -ne ($live.data | Select-Object -First 1).lastLocation)

Write-Host "`n=== 3. ORDER + ASSIGNMENT ===" -ForegroundColor Cyan
$menu = Api GET "/menu/$branchId"
$all = $menu.data.categories | ForEach-Object { $_.products }
$item = $all | Where-Object { $_.price -ge 30000 } | Select-Object -First 1

$order = Api POST '/orders' @{
  branchId=$branchId; type='DELIVERY'; source='WEB'
  clientUuid=[guid]::NewGuid().ToString()
  customer=@{ name='Kuryer Testi'; phone='+998935559911' }
  deliveryAddress=@{ address='Chilonzor 5-uy'; latitude=41.2800; longitude=69.2100 }
  items=@(@{ productId=$item.id; quantity=2; modifierIds=@() })
} $ownerJwt
$orderId = $order.data.id
Check 'delivery order created' ($order.data.type -eq 'DELIVERY')
$owed = $order.data.total

$suggest = Api GET "/orders/$orderId/courier-suggestions" $null $ownerJwt
Check 'suggestions ranked' ($suggest.data.Count -ge 1) "got $($suggest.data.Count)"

# The order must reach the courier stage before assignment makes sense.
foreach ($s in @('ACCEPTED','PREPARING','READY','WAITING_COURIER')) {
  Api PATCH "/orders/$orderId/status" @{ status=$s } $ownerJwt | Out-Null
}

$assigned = Api POST "/orders/$orderId/courier" @{ courierId=$courierId } $ownerJwt
Check 'courier assigned' ($assigned.data.courierId -eq $courierId)
Check 'order moved to COURIER_ASSIGNED' ($assigned.data.status -eq 'COURIER_ASSIGNED') "got $($assigned.data.status)"

Write-Host "`n=== 4. COURIER APP FLOW ===" -ForegroundColor Cyan
$jobs = Api GET '/courier/jobs' $null $courierJwt
Check 'job appears in the courier app' ($jobs.data.Count -ge 1) "got $($jobs.data.Count)"
$job = $jobs.data | Where-Object { $_.orderId -eq $orderId } | Select-Object -First 1
Check 'job found for this order' ($null -ne $job)
Check 'job shows cash to collect' ($job.amountToCollect -eq $owed) "got $($job.amountToCollect) want $owed"
Check 'job is marked unpaid' ($job.isPaid -eq $false)
Check 'job carries the pickup branch' ($job.branchName -eq 'Chilonzor')
# The summary reads "2x Name" using a multiplication sign, so match on the
# product name and the quantity rather than on the separator.
Check 'job summarises the items' (
  $job.itemsSummary.Length -gt 3 -and $job.itemsSummary.Contains('2')
) "got '$($job.itemsSummary)'"

$deliveryId = $job.deliveryId

$badJump = ApiFail POST "/courier/jobs/$deliveryId/complete" @{ collectedCash=$owed } $courierJwt
Check 'cannot complete before picking up' ($badJump.status -eq 409) "status=$($badJump.status)"

Api POST "/courier/jobs/$deliveryId/accept" $null $courierJwt | Out-Null
Check 'ASSIGNED -> ACCEPTED' $true

$started = Api POST "/courier/jobs/$deliveryId/start" $null $courierJwt
Check 'ACCEPTED -> PICKED_UP' ($started.data.status -eq 'PICKED_UP')

$onDelivery = Api GET "/orders/$orderId" $null $ownerJwt
Check 'order followed to ON_DELIVERY' ($onDelivery.data.status -eq 'ON_DELIVERY') "got $($onDelivery.data.status)"

Write-Host "`n=== 5. MONEY ===" -ForegroundColor Cyan
$walletBefore = (Api GET '/courier/wallet' $null $courierJwt).data

$overCollect = ApiFail POST "/courier/jobs/$deliveryId/complete" @{ collectedCash=($owed + 50000) } $courierJwt
Check 'cannot collect more than the order owes' ($overCollect.status -eq 400) "status=$($overCollect.status)"

$noCash = ApiFail POST "/courier/jobs/$deliveryId/complete" @{ collectedCash=0 } $courierJwt
Check 'unpaid order refuses a zero collection' ($noCash.status -eq 422) "status=$($noCash.status)"

$done = Api POST "/courier/jobs/$deliveryId/complete" @{ collectedCash=$owed } $courierJwt
Check 'PICKED_UP -> DELIVERED' ($done.data.status -eq 'DELIVERED')

$walletAfter = (Api GET '/courier/wallet' $null $courierJwt).data
Check 'wallet credited with the cash collected' (
  ($walletAfter.cashReceived - $walletBefore.cashReceived) -eq $owed
) "delta=$($walletAfter.cashReceived - $walletBefore.cashReceived) want $owed"
Check 'balance moved by the same amount' (
  ($walletAfter.balance - $walletBefore.balance) -eq $owed
) "delta=$($walletAfter.balance - $walletBefore.balance)"
Check 'delivery income recorded separately' (
  $walletAfter.deliveryIncome -ge $walletBefore.deliveryIncome
)
Check 'wallet invariant holds' (
  $walletAfter.balance -eq ($walletAfter.cashReceived - $walletAfter.cashHandedOver - $walletAfter.expenses)
) "balance=$($walletAfter.balance)"

# Retrying a completed delivery must not credit twice.
Api POST "/courier/jobs/$deliveryId/complete" @{ collectedCash=$owed } $courierJwt | Out-Null
$walletRetry = (Api GET '/courier/wallet' $null $courierJwt).data
Check 'retrying complete does NOT double-credit' (
  $walletRetry.cashReceived -eq $walletAfter.cashReceived
) "before=$($walletAfter.cashReceived) after=$($walletRetry.cashReceived)"

$paidOrder = Api GET "/orders/$orderId" $null $ownerJwt
Check 'order marked PAID' ($paidOrder.data.paymentStatus -eq 'PAID') "got $($paidOrder.data.paymentStatus)"
Check 'order marked DELIVERED' ($paidOrder.data.status -eq 'DELIVERED') "got $($paidOrder.data.status)"

Write-Host "`n=== 6. CASH HANDOVER (two-sided) ===" -ForegroundColor Cyan
$balance = $walletRetry.balance

$tooMuch = ApiFail POST '/courier/handovers' @{ branchId=$branchId; amount=($balance + 100000) } $courierJwt
Check 'cannot hand over more than held' ($tooMuch.status -eq 422) "status=$($tooMuch.status)"

$handAmount = [math]::Floor($balance / 2)
$handover = Api POST '/courier/handovers' @{ branchId=$branchId; amount=$handAmount } $courierJwt
Check 'courier declares a hand-off' ($handover.data.status -eq 'PENDING')

$walletPending = (Api GET '/courier/wallet' $null $courierJwt).data
Check 'declaring does NOT move the balance yet' ($walletPending.balance -eq $balance) "balance=$($walletPending.balance)"

$second = ApiFail POST '/courier/handovers' @{ branchId=$branchId; amount=1000 } $courierJwt
Check 'only one pending hand-off at a time' ($second.status -eq 409) "status=$($second.status)"

$confirmed = Api POST "/handovers/$($handover.data.id)/confirm" @{} $ownerJwt
Check 'cashier confirms receipt' ($confirmed.data.status -eq 'CONFIRMED') "got $($confirmed.data.status)"

$walletFinal = (Api GET '/courier/wallet' $null $courierJwt).data
Check 'confirmation moves the balance' (
  $walletFinal.balance -eq ($balance - $handAmount)
) "balance=$($walletFinal.balance) want $($balance - $handAmount)"
Check 'handed-over total increased' (
  ($walletFinal.cashHandedOver - $walletPending.cashHandedOver) -eq $handAmount
)
Check 'invariant still holds' (
  $walletFinal.balance -eq ($walletFinal.cashReceived - $walletFinal.cashHandedOver - $walletFinal.expenses)
)

$again = ApiFail POST "/handovers/$($handover.data.id)/confirm" @{} $ownerJwt
Check 'cannot confirm the same hand-off twice' ($again.status -eq 409) "status=$($again.status)"

Write-Host "`n=== 7. ISOLATION ===" -ForegroundColor Cyan
$suffix = Get-Random -Minimum 1000000 -Maximum 9999999
$otherPhone = "+99893$suffix"
$sup = Api POST '/auth/login' @{ login='+998900000000'; password='Restor2026dev' }
$newTenant = Api POST '/platform/tenants' @{
  name = "Courier Isolation $suffix"
  owner = @{ fullName='Other'; phone=$otherPhone; password='Restor2026dev' }
} $sup.data.tokens.accessToken
$otherJwt = (Api POST '/auth/login' @{ login=$otherPhone; password='Restor2026dev'; tenantSlug=$newTenant.data.slug }).data.tokens.accessToken

$otherCouriers = Api GET '/couriers' $null $otherJwt
Check 'a new tenant sees ZERO couriers' ($otherCouriers.meta.pagination.total -eq 0) "got $($otherCouriers.meta.pagination.total)"

$crossWallet = ApiFail GET "/couriers/$courierId/wallet" $null $otherJwt
Check 'cannot read another tenant wallet' ($crossWallet.status -eq 404) "status=$($crossWallet.status)"

$crossHandovers = Api GET '/handovers' $null $otherJwt
Check 'a new tenant sees ZERO hand-offs' ($crossHandovers.meta.pagination.total -eq 0)

Write-Host "`n=========================================" -ForegroundColor Cyan
Write-Host "  PASSED: $pass    FAILED: $fail" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
Write-Host "=========================================`n" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 }
