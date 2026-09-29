# End-to-end smoke test against a running RESTOR API.
#
#   pwsh backend/tests/smoke.ps1
#   pwsh backend/tests/smoke.ps1 -BaseUrl https://restore-1.duckdns.org/api/v1
#
# Against a remote deployment the suite creates a tenant and an order, so point
# it at staging or a test host — not at a live production database.
param(
  [string]$BaseUrl = $env:RESTOR_API_URL
)

$ErrorActionPreference = 'Stop'
if (-not $BaseUrl) { $BaseUrl = 'http://localhost:3000/api/v1' }
$API = $BaseUrl.TrimEnd('/')
Write-Host "Target: $API`n" -ForegroundColor Cyan
$pass = 0; $fail = 0

function Check($name, $condition, $detail = '') {
  if ($condition) { Write-Host "  PASS  $name" -ForegroundColor Green; $script:pass++ }
  else { Write-Host "  FAIL  $name  $detail" -ForegroundColor Red; $script:fail++ }
}

function Api($method, $path, $body = $null, $token = $null) {
  # Public storefront calls carry no token, so the tenant comes from the slug.
  $headers = @{ 'Content-Type' = 'application/json'; 'X-Tenant-Slug' = 'demo' }
  if ($token) { $headers['Authorization'] = "Bearer $token" }
  $args = @{ Uri = "$API$path"; Method = $method; Headers = $headers; TimeoutSec = 30 }
  if ($body) { $args['Body'] = ($body | ConvertTo-Json -Depth 10 -Compress) }
  return Invoke-RestMethod @args
}

function ApiFail($method, $path, $body = $null, $token = $null) {
  try { Api $method $path $body $token | Out-Null; return $null }
  catch {
    $status = [int]$_.Exception.Response.StatusCode
    # ErrorDetails holds the body PowerShell already read off the stream;
    # re-reading the stream after that yields an empty string.
    $raw = $_.ErrorDetails.Message
    if (-not $raw) {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $raw = $reader.ReadToEnd()
    }
    $parsed = $null
    if ($raw) { try { $parsed = $raw | ConvertFrom-Json } catch { } }
    return @{ status = $status; body = $parsed; raw = $raw }
  }
}

Write-Host "`n=== 1. AUTH ===" -ForegroundColor Cyan

$owner = Api POST '/auth/login' @{ login = '+998901111111'; password = 'Restor2026dev'; tenantSlug = 'demo' }
Check 'owner login returns a token pair' ($owner.data.tokens.accessToken -and $owner.data.tokens.refreshToken)
Check 'owner session carries permissions' ($owner.data.user.permissions.Count -gt 30) "got $($owner.data.user.permissions.Count)"
Check 'owner is scoped to the demo tenant' ($owner.data.user.tenantSlug -eq 'demo')
$ownerToken = $owner.data.tokens.accessToken

$super = Api POST '/auth/login' @{ login = '+998900000000'; password = 'Restor2026dev' }
Check 'super admin login works without a tenant' ($super.data.user.isSuperAdmin -eq $true)
Check 'super admin has no tenant' ($null -eq $super.data.user.tenantId)
$superToken = $super.data.tokens.accessToken

$cashier = Api POST '/auth/login' @{ login = '+998904444444'; password = 'Restor2026dev'; tenantSlug = 'demo' }
$cashierToken = $cashier.data.tokens.accessToken
Check 'cashier is branch-scoped' ($cashier.data.user.branchIds.Count -eq 1) "got $($cashier.data.user.branchIds.Count)"
Check 'cashier cannot manage roles' (-not ($cashier.data.user.permissions -contains 'roles.create'))

$bad = ApiFail POST '/auth/login' @{ login = '+998901111111'; password = 'wrong-password'; tenantSlug = 'demo' }
Check 'wrong password is rejected' ($bad.status -eq 401 -and $bad.body.error.code -eq 'INVALID_CREDENTIALS') "status=$($bad.status) code=$($bad.body.error.code)"

$noAuth = ApiFail GET '/branches'
Check 'protected route refuses an anonymous call' ($noAuth.status -eq 401)

$me = Api GET '/auth/me' $null $ownerToken
Check '/auth/me returns the owner' ($me.data.phone -eq '+998901111111')

Write-Host "`n=== 2. RBAC ===" -ForegroundColor Cyan

$roles = Api GET '/roles' $null $ownerToken
Check 'tenant sees its 10 seeded roles' ($roles.data.Count -eq 10) "got $($roles.data.Count)"
Check 'roles do not leak SUPER_ADMIN into the tenant' (-not ($roles.data.code -contains 'SUPER_ADMIN')) "codes=$($roles.data.code -join ',')"

$perms = Api GET '/permissions' $null $ownerToken
Check 'permission catalog is served' ($perms.data.Count -ge 80) "got $($perms.data.Count)"

$denied = ApiFail GET '/roles' $null $cashierToken
Check 'cashier is denied roles.view' ($denied.status -eq 403 -and $denied.body.error.code -eq 'PERMISSION_DENIED') "status=$($denied.status) code=$($denied.body.error.code)"

$platformDenied = ApiFail GET '/platform/tenants' $null $ownerToken
Check 'tenant owner cannot reach platform routes' ($platformDenied.status -eq 403)

$tenants = Api GET '/platform/tenants' $null $superToken
Check 'super admin lists tenants' ($tenants.data.Count -ge 1)

$stats = Api GET '/platform/stats' $null $superToken
Check 'platform stats are computed' ($null -ne $stats.data.totalCompanies)

Write-Host "`n=== 3. BRANCHES & MENU ===" -ForegroundColor Cyan

$branches = Api GET '/branches' $null $ownerToken
Check 'owner sees both branches' ($branches.data.Count -eq 2) "got $($branches.data.Count)"
Check 'branch list is paginated' ($null -ne $branches.meta.pagination.total)
$branchId = ($branches.data | Where-Object { $_.name -eq 'Chilonzor' }).id
Check 'working hours are seeded' (($branches.data[0].workingHours).Count -eq 7)

$cashierBranches = Api GET '/branches' $null $cashierToken
Check 'branch-scoped cashier sees only their branch' ($cashierBranches.data.Count -eq 1) "got $($cashierBranches.data.Count)"

$menu = Api GET "/menu/$branchId"
Check 'public menu needs no token' ($menu.data.categories.Count -eq 5) "got $($menu.data.categories.Count)"
$lavash = ($menu.data.categories | ForEach-Object { $_.products } | Where-Object { $_.name -eq 'Tovuqli lavash' })
Check 'menu product carries variants' ($lavash.variants.Count -eq 2)
Check 'menu product carries modifier groups' ($lavash.modifierGroups.Count -eq 2)
# Matched by price rather than by name: the seeded names contain a U+2018
# apostrophe that PowerShell 5.1 mangles when reading this file.
$discounted = @($menu.data.categories | ForEach-Object { $_.products } | Where-Object { $null -ne $_.oldPrice })
Check 'discounted product shows the old price' (
  $discounted.Count -eq 1 -and $discounted[0].price -eq 38000 -and $discounted[0].oldPrice -eq 42000
) "count=$($discounted.Count) price=$($discounted[0].price) old=$($discounted[0].oldPrice)"

$products = Api GET '/products' $null $ownerToken
Check 'admin product list works' ($products.meta.pagination.total -eq 11) "got $($products.meta.pagination.total)"

Write-Host "`n=== 4. ORDER PRICING (server-side) ===" -ForegroundColor Cyan

$cola = ($menu.data.categories | ForEach-Object { $_.products } | Where-Object { $_.name -eq 'Cola 0.5' })
$fries = ($menu.data.categories | ForEach-Object { $_.products } | Where-Object { $_.name -eq 'Fri kartoshka' })
$bigVariant = ($lavash.variants | Where-Object { $_.name -eq 'Katta' })
$hotSauce = ($lavash.modifierGroups | Where-Object { $_.name -eq 'Sous' }).modifiers | Where-Object { $_.name -eq 'Achchiq sous' }

$cart = @{
  branchId = $branchId
  type     = 'DELIVERY'
  items    = @(
    @{ productId = $lavash.id; variantId = $bigVariant.id; quantity = 2; modifierIds = @($hotSauce.id) },
    @{ productId = $fries.id;  quantity = 1; modifierIds = @() },
    @{ productId = $cola.id;   quantity = 2; modifierIds = @() }
  )
}

$preview = Api POST '/orders/preview' $cart
# 2 x (32000 + 9000 + 3000) = 88000 ; fries 18000 ; 2 x cola 24000 => 130000
Check 'preview prices the cart from server data' ($preview.data.subtotal -eq 130000) "got $($preview.data.subtotal)"
Check 'preview applies the branch delivery fee' ($preview.data.deliveryFee -eq 15000) "got $($preview.data.deliveryFee)"
Check 'preview total = subtotal + delivery' ($preview.data.total -eq 145000) "got $($preview.data.total)"

$badModifier = ApiFail POST '/orders/preview' @{
  branchId = $branchId; type = 'PICKUP'
  items = @(@{ productId = $cola.id; quantity = 1; modifierIds = @($hotSauce.id) })
}
Check 'modifiers from another product are rejected' ($badModifier.status -eq 422 -and $badModifier.body.error.code -eq 'MODIFIER_SELECTION_INVALID')

$tooSmall = ApiFail POST '/orders' @{
  branchId = $branchId; type = 'DELIVERY'
  customer = @{ name = 'Test'; phone = '+998935550101' }
  deliveryAddress = @{ address = 'Chilonzor 12-uy, 4-xonadon' }
  items = @(@{ productId = $cola.id; quantity = 1; modifierIds = @() })
}
Check 'minimum delivery order is enforced' ($tooSmall.status -eq 422 -and $tooSmall.body.error.code -eq 'MIN_ORDER_NOT_REACHED') "code=$($tooSmall.body.error.code)"

Write-Host "`n=== 5. ORDER LIFECYCLE ===" -ForegroundColor Cyan

$clientUuid = [guid]::NewGuid().ToString()
$orderBody = $cart.Clone()
$orderBody['customer'] = @{ name = 'Elbek'; phone = '+998935551234' }
$orderBody['deliveryAddress'] = @{ address = 'Chilonzor 12-uy, 4-xonadon'; latitude = 41.2760; longitude = 69.2040 }
$orderBody['clientUuid'] = $clientUuid
$orderBody['source'] = 'POS'

$order = Api POST '/orders' $orderBody $ownerToken
Check 'order is created' ($order.data.id -ne $null)
Check 'order number uses the branch prefix' ($order.data.displayNumber -like 'CH-*') "got $($order.data.displayNumber)"
Check 'order total matches the preview' ($order.data.total -eq 145000) "got $($order.data.total)"
Check 'order starts as NEW' ($order.data.status -eq 'NEW')
Check 'order items were persisted' ($order.data.items.Count -eq 3)
$orderId = $order.data.id

$replay = Api POST '/orders' $orderBody $ownerToken
Check 'replayed clientUuid returns the SAME order (idempotent)' ($replay.data.id -eq $orderId) "got $($replay.data.id)"

$jump = ApiFail PATCH "/orders/$orderId/status" @{ status = 'DELIVERED' } $ownerToken
Check 'illegal status jump is refused' ($jump.status -eq 409 -and $jump.body.error.code -eq 'INVALID_STATUS_TRANSITION')

$accepted = Api PATCH "/orders/$orderId/status" @{ status = 'ACCEPTED' } $ownerToken
Check 'NEW -> ACCEPTED succeeds' ($accepted.data.status -eq 'ACCEPTED')
Check 'acceptedAt is stamped' ($null -ne $accepted.data.acceptedAt)

$timeline = Api GET "/orders/$orderId/timeline" $null $ownerToken
Check 'timeline records both steps' ($timeline.data.Count -eq 2) "got $($timeline.data.Count)"

$noReason = ApiFail PATCH "/orders/$orderId/status" @{ status = 'CANCELLED' } $ownerToken
Check 'cancelling without a reason is rejected' ($noReason.status -eq 422)

Write-Host "`n=== 6. KITCHEN (KDS) ===" -ForegroundColor Cyan

Start-Sleep -Milliseconds 800   # the ticket listener runs off the domain event
$tickets = Api GET "/kitchen/tickets?branchId=$branchId" $null $ownerToken
# Scoped to THIS order: the branch accumulates open tickets across runs.
$mine = @($tickets.data | Where-Object { $_.orderId -eq $orderId })
Check 'kitchen tickets were created from the order event' ($mine.Count -ge 1) "got $($mine.Count)"
# The cart spans Grill (lavash) and Bar (fries + cola), so two stations.
Check 'items are split across stations' ($mine.Count -eq 2) "got $($mine.Count) (expected grill + bar)"
Check 'ticket carries the elapsed timer' ($null -ne $mine[0].elapsedSeconds)
Check 'ticket items reference the order lines' ((@($mine | ForEach-Object { $_.items }).Count) -eq 3) "got $(@($mine | ForEach-Object { $_.items }).Count)"

Write-Host "`n=== 7. TENANT ISOLATION ===" -ForegroundColor Cyan

# Unique per run so the suite can be re-run without colliding on phone/slug.
$suffix = (Get-Random -Minimum 1000000 -Maximum 9999999)
# +998 + 9 national digits, which is what the phone validator requires.
$otherPhone = "+99893$suffix"
$newTenant = Api POST '/platform/tenants' @{
  name  = "Isolation Test $suffix"
  owner = @{ fullName = 'Other Owner'; phone = $otherPhone; password = 'Restor2026dev' }
} $superToken
Check 'super admin creates a second tenant' ($newTenant.data.slug -like 'isolation-test-*') "got $($newTenant.data.slug)"

$otherOwner = Api POST '/auth/login' @{ login = $otherPhone; password = 'Restor2026dev'; tenantSlug = $newTenant.data.slug }
$otherToken = $otherOwner.data.tokens.accessToken

$otherBranches = Api GET '/branches' $null $otherToken
Check 'the new tenant sees ZERO branches (no leak)' ($otherBranches.data.Count -eq 0) "got $($otherBranches.data.Count)"

$otherProducts = Api GET '/products' $null $otherToken
Check 'the new tenant sees ZERO products (no leak)' ($otherProducts.meta.pagination.total -eq 0) "got $($otherProducts.meta.pagination.total)"

$otherOrders = Api GET '/orders' $null $otherToken
Check 'the new tenant sees ZERO orders (no leak)' ($otherOrders.meta.pagination.total -eq 0) "got $($otherOrders.meta.pagination.total)"

$crossRead = ApiFail GET "/orders/$orderId" $null $otherToken
Check 'fetching another tenant''s order by id returns 404' ($crossRead.status -eq 404) "got $($crossRead.status)"

$crossBranch = ApiFail GET "/branches/$branchId" $null $otherToken
Check 'fetching another tenant''s branch by id returns 404' ($crossBranch.status -eq 404) "got $($crossBranch.status)"

$otherRoles = Api GET '/roles' $null $otherToken
Check 'new tenant got its own seeded roles' ($otherRoles.data.Count -eq 10) "got $($otherRoles.data.Count)"

Write-Host "`n=== 8. AUDIT ===" -ForegroundColor Cyan

$audit = Api GET '/audit?limit=50' $null $ownerToken
Check 'audit trail recorded the activity' ($audit.data.Count -ge 3) "got $($audit.data.Count)"
Check 'audit records the order creation' ($audit.data.action -contains 'ORDER_CREATED')
Check 'audit is tenant-scoped' (($audit.data | Where-Object { $_.tenantId -ne $owner.data.user.tenantId }).Count -eq 0)

Write-Host "`n=== 9. RESPONSE CONTRACT ===" -ForegroundColor Cyan
Check 'success envelope shape' ($menu.success -eq $true -and $null -eq $menu.error)
Check 'error envelope shape' ($bad.body.success -eq $false -and $null -ne $bad.body.error.code)
Check 'responses carry a request id' ($null -ne $menu.meta.requestId)

Write-Host "`n════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  PASSED: $pass    FAILED: $fail" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
Write-Host "════════════════════════════════════════`n" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 }
