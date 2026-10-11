# Storefront (Telegram Mini App) customer flow, end to end through the API.
#
# Signs Telegram initData itself, so it needs the bot token the server
# verifies against: the restaurant's own bot token, or the platform
# TELEGRAM_BOT_TOKEN when the restaurant has none. Never paste a production
# token into a shared terminal.
#
#   powershell -NoProfile -File backend\tests\storefront-smoke.ps1 `
#     -Api http://localhost:3010/api/v1 -BotToken <token> -WithIsolation -WithCampaign
#
# -WithIsolation creates a second restaurant (housekeeping on production).
# -WithCampaign sends a REAL marketing message to opted-in customers and
#   starts the 24 h cooldown: local or staging only.
# ASCII only.
param(
  [string]$Api = 'https://api.restor.uz/api/v1',
  [string]$Slug = 'demo',
  [Parameter(Mandatory = $true)][string]$BotToken,
  [string]$OwnerPhone = '+998901111111',
  [string]$Password = 'Restor2026dev',
  [switch]$WithIsolation,
  [switch]$WithCampaign
)
$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0

function Api($method, $path, $body = $null, $jwt = $null, $slug = $script:Slug) {
  $h = @{ 'Content-Type' = 'application/json' }
  if ($slug) { $h['X-Tenant-Slug'] = $slug }
  if ($jwt) { $h['Authorization'] = "Bearer $jwt" }
  $a = @{ Uri = "$Api$path"; Method = $method; Headers = $h; TimeoutSec = 40 }
  if ($null -ne $body) { $a['Body'] = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 10 -Compress)) }
  Invoke-RestMethod @a
}
# Returns @{ status; code } for a call expected to fail.
function Fails($block) {
  try { & $block | Out-Null; return @{ status = 200; code = $null } }
  catch {
    $status = 0; $code = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    try { $code = ($_.ErrorDetails.Message | ConvertFrom-Json).error.code } catch { }
    return @{ status = $status; code = $code }
  }
}
function Check($name, $cond, $detail = '') {
  if ($cond) { $script:pass++; Write-Host "  OK   $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL $name $detail" -ForegroundColor Red }
}
function Hmac([byte[]]$key, [byte[]]$data) {
  $h = New-Object System.Security.Cryptography.HMACSHA256 (, $key)
  return $h.ComputeHash($data)
}
# Telegram's scheme: secret = HMAC("WebAppData", token); hash = HMAC(secret, data_check_string).
function InitData([long]$userId, [string]$first, [string]$last) {
  $auth = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $user = '{"id":' + $userId + ',"first_name":"' + $first + '","last_name":"' + $last + '","username":"smoke' + $userId + '","language_code":"uz"}'
  $pairs = [ordered]@{ auth_date = "$auth"; query_id = "AAQ$userId"; user = $user }
  $dcs = ($pairs.Keys | Sort-Object | ForEach-Object { "$_=$($pairs[$_])" }) -join "`n"
  $utf8 = [Text.Encoding]::UTF8
  $secret = Hmac $utf8.GetBytes('WebAppData') $utf8.GetBytes($BotToken)
  $hash = (Hmac $secret $utf8.GetBytes($dcs) | ForEach-Object { $_.ToString('x2') }) -join ''
  $qs = ($pairs.Keys | ForEach-Object { "$_=" + [Uri]::EscapeDataString($pairs[$_]) }) -join '&'
  return "$qs&hash=$hash"
}
function SignIn([long]$userId, [string]$slug = $script:Slug) {
  (Api POST '/auth/telegram' @{ initData = (InitData $userId 'Smoke' 'Tester'); tenantSlug = $slug } $null $slug).data
}

$userA = Get-Random -Minimum 7000000000 -Maximum 7999999999
$userB = $userA + 1

Write-Host "`n--- sign-in ---"
$forged = Fails { Api POST '/auth/telegram' @{ initData = ((InitData $userA 'X' 'Y') -replace 'hash=[0-9a-f]+', 'hash=00'); tenantSlug = $Slug } }
Check 'forged initData refused' ($forged.status -eq 401) "$($forged.status)"
$a = SignIn $userA
$jwtA = $a.tokens.accessToken
Check 'customer A signed in' ($null -ne $jwtA)
Check 'Telegram name is not the official name' ($a.user.fullName -eq 'Smoke Tester' -or $a.user.fullName -eq 'Mehmon')
$a2 = SignIn $userA
Check 'second sign-in is the same customer' ($a2.user.id -eq $a.user.id)

Write-Host "`n--- session boundaries ---"
$r = Fails { Api GET '/orders' $null $jwtA }
Check 'customer cannot list staff orders' ($r.status -eq 403) "$($r.status)"
$r = Fails { Api GET '/auth/me' $null $jwtA }
Check 'customer cannot reach a staff route without permissions' ($r.status -eq 403) "$($r.status)"
$r = Fails { Api GET '/me/profile' }
Check 'anonymous cannot read a profile' ($r.status -eq 401) "$($r.status)"
$owner = (Api POST '/auth/login' @{ login = $OwnerPhone; password = $Password; tenantSlug = $Slug }).data
$jwtO = $owner.tokens.accessToken
$r = Fails { Api GET '/me/profile' $null $jwtO }
Check 'staff token refused on a customer route' ($r.status -eq 403) "$($r.status)"

Write-Host "`n--- storefront info and menu ---"
$info = (Api GET '/storefront').data
Check 'storefront info' ($info.restaurant.slug -eq $Slug)
Check 'cash offered by default' (@($info.checkout.paymentOptions) -contains 'CASH')
$branch = (Api GET '/branches/summary').data[0]
Check 'branch summary carries delivery flags' ($null -ne $branch.acceptsDelivery -and $null -ne $branch.averagePrepMinutes)
$menu = (Api GET "/menu/$($branch.id)").data
Check 'menu carries recommendations' ($null -ne $menu.recommendations)
$all = @($menu.categories | ForEach-Object { $_.products })
$simple = $all | Where-Object { @($_.modifierGroups | Where-Object { $_.minSelect -ge 1 }).Count -eq 0 } | Select-Object -First 1
Check 'a product without required options' ($null -ne $simple)
$variantId = $null
if (@($simple.variants).Count -gt 0) { $variantId = (@($simple.variants | Where-Object { $_.isDefault }) + @($simple.variants))[0].id }
$qty = [Math]::Max(1, [Math]::Ceiling(($branch.minOrderAmount + 1) / [Math]::Max(1, $simple.price)))
$item = @{ productId = $simple.id; quantity = [int]$qty; modifierIds = @() }
if ($variantId) { $item['variantId'] = $variantId }

Write-Host "`n--- profile ---"
$p = (Api GET '/me/profile' $null $jwtA).data
Check 'new profile is missing name, surname, phone' (@($p.missingFields).Count -eq 3) "$($p.missingFields)"
Check 'phone not verified' ($p.phoneVerified -eq $false)
$uuid1 = [guid]::NewGuid().ToString()
$r = Fails { Api POST '/me/checkout' @{ branchId = $branch.id; type = 'PICKUP'; items = @($item); paymentOption = 'CASH'; clientUuid = $uuid1 } $jwtA }
Check 'checkout asks for the missing profile' ($r.code -eq 'PROFILE_INCOMPLETE') "$($r.code)"
$r = Fails { Api PATCH '/me/profile' @{ phone = '+7 912 345 67 89' } $jwtA }
Check 'non-Uzbek phone refused' ($r.status -eq 422 -or $r.status -eq 400) "$($r.status)"
$p = (Api PATCH '/me/profile' @{ firstName = 'Elbek'; lastName = 'Qurbonov'; phone = '93 206 30 15' } $jwtA).data
Check 'phone normalised to E.164' ($p.phone -eq '+998932063015') $p.phone
Check 'profile complete' (@($p.missingFields).Count -eq 0)
Check 'still not verified after typing it' ($p.phoneVerified -eq $false)

Write-Host "`n--- addresses ---"
$lat = if ($branch.latitude) { $branch.latitude + 0.002 } else { $null }
$lng = if ($branch.longitude) { $branch.longitude + 0.002 } else { $null }
$addr = (Api POST '/me/addresses' @{ label = 'Uy'; address = 'Uzum Bogi 2-tor kochasi'; house = '280A'; latitude = $lat; longitude = $lng } $jwtA).data
Check 'first address becomes the default' ($addr.isDefault -eq $true)
$addr2 = (Api POST '/me/addresses' @{ label = 'Ish'; address = 'Amir Temur kochasi'; house = '15'; isDefault = $true; latitude = $lat; longitude = $lng } $jwtA).data
$list = (Api GET '/me/addresses' $null $jwtA).data
Check 'exactly one default address' (@($list | Where-Object { $_.isDefault }).Count -eq 1)
Check 'the new default is the one asked for' ((@($list | Where-Object { $_.isDefault }))[0].id -eq $addr2.id)

Write-Host "`n--- checkout ---"
$preview = (Api POST '/me/checkout/preview' @{ branchId = $branch.id; type = 'DELIVERY'; items = @($item); address = @{ addressId = $addr.id } } $jwtA).data
Check 'preview priced by the server' ($preview.total -ge $preview.subtotal -and $preview.subtotal -gt 0) "$($preview.total)"
$body = @{
  branchId = $branch.id; type = 'DELIVERY'; items = @($item); paymentOption = 'CASH'; clientUuid = $uuid1
  comment = 'Piyoz qoshmang'; courierComment = 'Darvoza oldida qongiroq qiling'; cutleryCount = 2
  address = @{ addressId = $addr.id; apartment = '12'; floor = '3'; entrance = '2'; intercom = '12K' }
  total = 1; price = 1
}
$order = (Api POST '/me/checkout' $body $jwtA).data
Check 'order placed' ($null -ne $order.order.id)
Check 'client total ignored' ($order.order.total -eq $preview.total) "$($order.order.total) vs $($preview.total)"
Check 'cash order is UNPAID, not paid' ($order.order.paymentStatus -eq 'UNPAID')
Check 'payment intent recorded' ($order.order.paymentMethod -eq 'CASH')
Check 'partner comment stored' ($order.order.comment -eq 'Piyoz qoshmang')
Check 'courier comment stored' ($order.order.courierComment -eq 'Darvoza oldida qongiroq qiling')
Check 'cutlery stored' ($order.order.cutleryCount -eq 2)
Check 'address snapshot carries the details' ($order.order.deliveryAddress.apartment -eq '12' -and $order.order.deliveryAddress.intercom -eq '12K')
Check 'name comes from the profile' ($order.order.customerName -eq 'Elbek Qurbonov')
$again = (Api POST '/me/checkout' $body $jwtA).data
Check 'same clientUuid returns the same order' ($again.order.id -eq $order.order.id)
$saved = (Api GET '/me/addresses' $null $jwtA).data | Where-Object { $_.id -eq $addr.id }
Check 'details written back to the saved address' ($saved.apartment -eq '12' -and $saved.floor -eq '3')
Api PATCH "/me/addresses/$($addr.id)" @{ apartment = '99' } $jwtA | Out-Null
$detail = (Api GET "/me/orders/$($order.order.id)" $null $jwtA).data
Check 'editing the address later does not rewrite the order' ($detail.order.deliveryAddress.apartment -eq '12')
Check 'cash order offers no payment retry' ($detail.canRetryPayment -eq $false)

Write-Host "`n--- another customer ---"
$b = SignIn $userB
$jwtB = $b.tokens.accessToken
$r = Fails { Api GET "/me/orders/$($order.order.id)" $null $jwtB }
Check 'B cannot read A order' ($r.status -eq 404) "$($r.status)"
$r = Fails { Api PATCH "/me/addresses/$($addr.id)" @{ apartment = '1' } $jwtB }
Check 'B cannot edit A address' ($r.status -eq 404) "$($r.status)"
Api PATCH '/me/profile' @{ firstName = 'Bobur'; lastName = 'Aliyev'; phone = '+998901234567' } $jwtB | Out-Null
$r = Fails { Api POST '/me/checkout' @{ branchId = $branch.id; type = 'PICKUP'; items = @($item); paymentOption = 'CASH'; clientUuid = $uuid1 } $jwtB }
Check 'B replaying A clientUuid does not get A order' ($r.status -eq 409) "$($r.status) $($r.code)"
$listB = (Api GET '/me/orders' $null $jwtB).data
Check 'B history is empty' (@($listB).Count -eq 0)

Write-Host "`n--- staff side and notifications ---"
$staffOrder = (Api GET "/orders/$($order.order.id)" $null $jwtO).data
Check 'restaurant sees the order with its fields' ($staffOrder.cutleryCount -eq 2 -and $staffOrder.courierComment -ne $null)
Check 'order has no staff creator' ($null -eq $staffOrder.createdByUserId)
Api PATCH "/orders/$($order.order.id)/status" @{ status = 'ACCEPTED' } $jwtO | Out-Null
Start-Sleep -Seconds 2
$inbox = (Api GET '/me/notifications' $null $jwtA).data
Check 'inbox has the order received message' (@($inbox | Where-Object { $_.type -eq 'ORDER_RECEIVED' }).Count -ge 1)
Check 'inbox has the accepted message' (@($inbox | Where-Object { $_.type -eq 'ORDER_ACCEPTED' }).Count -ge 1)
$unread = (Api GET '/me/notifications/unread-count' $null $jwtA).data.count
Check 'unread count' ($unread -ge 2) "$unread"
Api POST '/me/notifications/read' @{} $jwtA | Out-Null
Check 'mark all read' ((Api GET '/me/notifications/unread-count' $null $jwtA).data.count -eq 0)
$history = (Api GET '/me/orders' $null $jwtA).data
Check 'history lists the order with its restaurant' ($history[0].id -eq $order.order.id -and $history[0].restaurantName)

Write-Host "`n--- favourites ---"
Api PUT "/me/favorites/$($simple.id)" $null $jwtA | Out-Null
$fav = (Api GET '/me/favorites' $null $jwtA).data
Check 'favourite saved for this restaurant' (@($fav | Where-Object { $_.productId -eq $simple.id -and $_.isCurrentRestaurant }).Count -eq 1)
Api DELETE "/me/favorites/$($simple.id)" $null $jwtA | Out-Null
Check 'favourite removed' (@((Api GET '/me/favorites' $null $jwtA).data).Count -eq 0)

Write-Host "`n--- settings, recommendations, promo codes ---"
$before = (Api GET '/storefront/settings' $null $jwtO).data
try {
  Api PATCH '/storefront/settings' @{ onlineProviders = @('CLICK'); cutleryEnabled = $true } $jwtO | Out-Null
  $info2 = (Api GET '/storefront').data
  if ($before.onlineAvailable) {
    Check 'enabled provider offered while Subo is active' (@($info2.checkout.paymentOptions) -contains 'CLICK')
  } else {
    Check 'provider NOT offered while Subo is inactive' (-not (@($info2.checkout.paymentOptions) -contains 'CLICK'))
    $r = Fails { Api POST '/me/checkout' @{ branchId = $branch.id; type = 'PICKUP'; items = @($item); paymentOption = 'CLICK'; clientUuid = [guid]::NewGuid().ToString() } $jwtA }
    Check 'checkout refuses an unavailable payment option' ($r.code -eq 'PAYMENT_METHOD_UNAVAILABLE') "$($r.code)"
  }
  $r = Fails { Api PATCH '/storefront/settings' @{ cashEnabled = $false; onlineProviders = @() } $jwtO }
  Check 'a storefront with no way to pay is refused' ($r.status -eq 422) "$($r.status)"
} finally {
  Api PATCH '/storefront/settings' @{ cashEnabled = $before.cashEnabled; onlineProviders = @($before.onlineProviders); cutleryEnabled = $before.cutleryEnabled; leaveAtDoorEnabled = $before.leaveAtDoorEnabled } $jwtO | Out-Null
}

$cat = $menu.categories[0]
$recBefore = (Api GET '/recommendations?placement=CART' $null $jwtO).data
try {
  Api PUT '/recommendations' @{ placement = 'CART'; targets = @(@{ categoryId = $cat.id }) } $jwtO | Out-Null
  $menu2 = (Api GET "/menu/$($branch.id)").data
  $ids = @($menu2.categories | ForEach-Object { $_.products } | ForEach-Object { $_.id })
  Check 'cart recommendations resolved from the category' (@($menu2.recommendations.cart).Count -ge 1)
  Check 'every recommendation is on the menu' (@($menu2.recommendations.cart | Where-Object { $ids -notcontains $_ }).Count -eq 0)
  $r = Fails { Api PUT '/recommendations' @{ placement = 'PRODUCT_DETAIL'; sourceProductId = $simple.id; targets = @(@{ productId = $simple.id }) } $jwtO }
  Check 'a product cannot recommend itself' ($r.status -eq 422) "$($r.status)"
} finally {
  $targets = @()
  $old = @($recBefore | Where-Object { $_.placement -eq 'CART' })
  if ($old.Count -gt 0) { $targets = @($old[0].targets | ForEach-Object { if ($_.kind -eq 'PRODUCT') { @{ productId = $_.id } } else { @{ categoryId = $_.id } } }) }
  Api PUT '/recommendations' @{ placement = 'CART'; targets = $targets } $jwtO | Out-Null
}

$suffix = Get-Random -Minimum 1000 -Maximum 9999
$code = (Api POST '/promo-codes' @{ code = "SMOKE$suffix"; type = 'FIXED'; discount = 1000; isPublic = $true; userLimit = 1; description = 'Smoke test' } $jwtO).data
try {
  $codes = (Api GET '/me/promo-codes' $null $jwtA).data
  Check 'public promo code listed for the customer' (@($codes | Where-Object { $_.code -eq $code.code }).Count -eq 1)
  $pv = (Api POST '/me/checkout/preview' @{ branchId = $branch.id; type = 'PICKUP'; items = @($item); promoCode = $code.code.ToLower() } $jwtA).data
  Check 'promo code applied by the server' ($pv.discountTotal -ge 1000) "$($pv.discountTotal)"
  $r = Fails { Api POST '/me/checkout/preview' @{ branchId = $branch.id; type = 'PICKUP'; items = @($item); promoCode = 'NOPE0000' } $jwtA }
  Check 'unknown promo code refused' ($r.code -eq 'PROMO_CODE_NOT_FOUND') "$($r.code)"
} finally {
  Api DELETE "/promo-codes/$($code.id)" $null $jwtO | Out-Null
}

if ($WithCampaign) {
  Write-Host "`n--- marketing campaign ---"
  Api PATCH '/me/profile' @{ marketingOptIn = $true } $jwtA | Out-Null
  $aud = (Api GET '/marketing/campaigns/audience' $null $jwtO).data
  Check 'opted-in customer counted' ($aud.optedIn -ge 1) "$($aud.optedIn)"
  $sent = (Api POST '/marketing/campaigns' @{ kind = 'PROMOTION'; title = 'Smoke aksiya'; body = 'Bugun lavash arzon' } $jwtO).data
  Check 'campaign reached opted-in customers' ($sent.recipientCount -ge 1) "$($sent.recipientCount)"
  $inboxA = (Api GET '/me/notifications' $null $jwtA).data
  Check 'campaign is in the inbox as marketing' (@($inboxA | Where-Object { $_.category -eq 'MARKETING' }).Count -ge 1)
  $inboxB = (Api GET '/me/notifications' $null $jwtB).data
  Check 'customer without consent got nothing' (@($inboxB | Where-Object { $_.category -eq 'MARKETING' }).Count -eq 0)
  $r = Fails { Api POST '/marketing/campaigns' @{ kind = 'PROMOTION'; title = 'Yana bir'; body = 'Ikkinchi xabar' } $jwtO }
  Check 'second campaign inside the cooldown refused' ($r.code -eq 'CAMPAIGN_RATE_LIMITED') "$($r.code)"
}

if ($WithIsolation) {
  Write-Host "`n--- a second restaurant ---"
  $sa = (Api POST '/auth/login' @{ login = '+998900000000'; password = $Password } $null $null).data
  $slug2 = "storefront-iso-$suffix"
  $phone2 = "+99893$((Get-Random -Minimum 1000000 -Maximum 9999999))"
  $t2 = (Api POST '/platform/tenants' @{ name = "Iso $suffix"; slug = $slug2; owner = @{ fullName = 'Iso Egasi'; phone = $phone2; password = $Password } } $sa.tokens.accessToken $null).data
  Check 'second restaurant created' ($t2.slug -eq $slug2) "$($t2.slug)"
  $c2 = SignIn $userA $slug2
  $jwtA2 = $c2.tokens.accessToken
  $p2 = (Api GET '/me/profile' $null $jwtA2 $slug2).data
  Check 'profile follows the person to another restaurant' ($p2.firstName -eq 'Elbek' -and $p2.phone -eq '+998932063015')
  Check 'addresses follow too' (@((Api GET '/me/addresses' $null $jwtA2 $slug2).data).Count -eq 2)
  $h2 = (Api GET '/me/orders' $null $jwtA2 $slug2).data
  Check 'history shows the other restaurant order, marked as such' ($h2[0].id -eq $order.order.id -and $h2[0].isCurrentRestaurant -eq $false)
  $r = Fails { Api PUT "/me/favorites/$($simple.id)" $null $jwtA2 $slug2 }
  Check 'cannot favourite another restaurant dish from here' ($r.status -eq 404) "$($r.status)"
  $r = Fails { Api POST "/me/orders/$($order.order.id)/pay" @{} $jwtA2 $slug2 }
  Check 'cannot pay another restaurant order from here' ($r.status -eq 404) "$($r.status)"
  $r = Fails { Api GET "/orders/$($order.order.id)" $null $jwtA2 $slug2 }
  Check 'customer token never reaches staff orders' ($r.status -eq 403) "$($r.status)"
}

Write-Host "`n$pass passed, $fail failed"
if ($fail -gt 0) { exit 1 }
