# The three delivery arrangements, against the live server. ASCII only.
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
$branch = (Api GET '/branches?limit=50' $null $oj) | ForEach-Object { $_.data } | Where-Object { $_.name -eq 'Chilonzor' }
$bid = $branch.id
Write-Host "`nBranch: $($branch.name)  ($($branch.latitude), $($branch.longitude))"
$original = @{
  deliveryRadiusM     = $branch.deliveryRadiusM
  freeDeliveryRadiusM = $branch.freeDeliveryRadiusM
  deliveryPrice       = $branch.deliveryPrice
  deliveryPricePerKm  = $branch.deliveryPricePerKm
  freeDeliveryFrom    = $branch.freeDeliveryFrom
}

# Pick two products so a cart can be priced.
$menu = Api GET "/menu/$bid"
$product = ($menu.data.categories | ForEach-Object { $_.products } | Select-Object -First 1)
$items = @(@{ productId = $product.id; quantity = 2; modifierIds = @() })

# A point N metres due north of the branch. 1 degree of latitude is ~111 320 m.
function PointAt($metres) {
  @{ address = 'Test manzil, 1-uy'
     latitude = $branch.latitude + ($metres / 111320.0)
     longitude = $branch.longitude }
}
function FeeAt($metres) {
  (Api POST '/orders/preview' @{
    branchId = $bid; type = 'DELIVERY'; items = $items
    deliveryAddress = (PointAt $metres)
  } $oj).data.deliveryFee
}
function Configure($patch) { Api PATCH "/branches/$bid" $patch $oj | Out-Null }

try {
  Write-Host "`n--- 1. Free delivery everywhere ---"
  Configure @{ deliveryPrice=0; freeDeliveryRadiusM=$null; deliveryPricePerKm=$null; freeDeliveryFrom=$null; deliveryRadiusM=10000 }
  Check 'free at 500 m'  ((FeeAt 500) -eq 0)
  Check 'free at 8 km'   ((FeeAt 8000) -eq 0)

  Write-Host "`n--- 2. Flat 15 000, free within 1 km ---"
  Configure @{ deliveryPrice=15000; freeDeliveryRadiusM=1000; deliveryPricePerKm=$null; freeDeliveryFrom=$null }
  $f900 = FeeAt 900; $f1500 = FeeAt 1500
  Check 'free at 900 m'          ($f900 -eq 0)       "= $f900"
  Check 'charged at 1.5 km'      ($f1500 -eq 15000)  "= $f1500"

  Write-Host "`n--- 3. Only within 5 km ---"
  Configure @{ deliveryRadiusM=5000 }
  $ok = FeeAt 4000
  Check 'accepted at 4 km' ($null -ne $ok) "= $ok"
  try {
    FeeAt 6000 | Out-Null
    Check 'refused at 6 km' $false 'it was accepted'
  } catch {
    $body = $_.ErrorDetails.Message
    Check 'refused at 6 km' ($body -match 'OUTSIDE_DELIVERY_RADIUS')
  }

  Write-Host "`n--- 4. 10 000 base + 3 000/km beyond a 1 km free zone ---"
  Configure @{ deliveryPrice=10000; freeDeliveryRadiusM=1000; deliveryPricePerKm=3000; deliveryRadiusM=10000 }
  $a = FeeAt 800; $b = FeeAt 1500; $c = FeeAt 3000
  Check 'free at 800 m'                  ($a -eq 0)      "= $a"
  Check '1.5 km = base + 1 km'           ($b -eq 13000)  "= $b"
  Check '3 km = base + 2 km'             ($c -eq 16000)  "= $c"

  Write-Host "`n--- 5. Free above an order amount ---"
  $subtotal = (Api POST '/orders/preview' @{ branchId=$bid; type='DELIVERY'; items=$items; deliveryAddress=(PointAt 3000) } $oj).data.subtotal
  Configure @{ freeDeliveryFrom = $subtotal }
  $d = FeeAt 3000
  Check "free once the order reaches $subtotal" ($d -eq 0) "= $d"
  Configure @{ freeDeliveryFrom = $subtotal + 1 }
  $e = FeeAt 3000
  Check 'charged one so`m below it' ($e -eq 16000) "= $e"

  Write-Host "`n--- 6. Guard rails ---"
  try {
    Configure @{ freeDeliveryRadiusM = 20000 }
    Check 'free zone cannot exceed the radius' $false 'it was accepted'
  } catch {
    Check 'free zone cannot exceed the radius' $true
  }
} finally {
  Write-Host "`nRestoring the branch..."
  Configure $original
  $after = (Api GET "/branches/$bid" $null $oj).data
  Check 'branch restored' ($after.deliveryPrice -eq $original.deliveryPrice -and $after.deliveryRadiusM -eq $original.deliveryRadiusM)
}

Write-Host "`n$pass passed, $fail failed`n" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
