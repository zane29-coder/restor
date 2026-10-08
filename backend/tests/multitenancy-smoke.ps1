# Proves two restaurants on one installation cannot see each other.
# Creates a second tenant, fills it, and checks every surface built so far.
# ASCII only.
$ErrorActionPreference = 'Stop'
$API = 'https://api.restor.uz/api/v1'
$pass = 0; $fail = 0

function Api($method, $path, $body = $null, $jwt = $null, $slug = $null) {
  $h = @{ 'Content-Type' = 'application/json' }
  if ($slug) { $h['X-Tenant-Slug'] = $slug }
  if ($jwt) { $h['Authorization'] = "Bearer $jwt" }
  $a = @{ Uri = "$API$path"; Method = $method; Headers = $h; TimeoutSec = 40 }
  if ($body) { $a['Body'] = ($body | ConvertTo-Json -Depth 10 -Compress) }
  Invoke-RestMethod @a
}
function Check($name, $cond, $detail = '') {
  if ($cond) { $script:pass++; Write-Host "  OK   $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL $name $detail" -ForegroundColor Red }
}
# A call that MUST be refused or come back empty.
function MustNotSee($name, $block) {
  try {
    $r = & $block
    $items = if ($r.data -is [array]) { $r.data } else { @($r.data) }
    if ($null -eq $r.data -or $items.Count -eq 0) { Check $name $true }
    else { Check $name $false "$($items.Count) ta yozuv kordi" }
  } catch {
    # 403/404 is also a refusal.
    Check $name $true
  }
}

Write-Host "`n--- super admin ---"
$sa = (Api POST '/auth/login' @{ login='+998900000000'; password='Restor2026dev' }).data
Check 'super admin kirdi' ($null -ne $sa.tokens.accessToken)
$saJwt = $sa.tokens.accessToken

$suffix = Get-Random -Minimum 100000 -Maximum 999999
$slug2 = "osh-markazi-$suffix"
$ownerPhone2 = "+99893$((Get-Random -Minimum 1000000 -Maximum 9999999))"

Write-Host "`n--- ikkinchi restoran yaratish ---"
$t2 = (Api POST '/platform/tenants' @{
  name = "Osh Markazi $suffix"
  slug = $slug2
  owner = @{ fullName='Ikkinchi Egasi'; phone=$ownerPhone2; password='Restor2026dev' }
} $saJwt).data
Check 'tenant yaratildi' ($t2.slug -eq $slug2) $t2.slug

Write-Host "`n--- har ikki egasi o'z hisobiga kiradi ---"
$o1 = (Api POST '/auth/login' @{ login='+998901111111'; password='Restor2026dev'; tenantSlug='demo' }).data
$o2 = (Api POST '/auth/login' @{ login=$ownerPhone2; password='Restor2026dev'; tenantSlug=$slug2 }).data
$j1 = $o1.tokens.accessToken
$j2 = $o2.tokens.accessToken
Check 'demo egasi kirdi'        ($null -ne $j1)
Check 'yangi restoran egasi kirdi' ($null -ne $j2)
Check 'ikki xil tenant id'      ($o1.user.tenantId -ne $o2.user.tenantId)

Write-Host "`n--- tenant 2 uchun filial va mahsulot ---"
$b2 = (Api POST '/branches' @{
  name='Yunusobod'; address='Yunusobod 4-kvartal, 12-uy'
  latitude=41.3400; longitude=69.2890; deliveryPrice=12000
} $j2 $slug2).data
Check 'filial yaratildi' ($null -ne $b2.id) $b2.name

$cat2 = (Api POST '/categories' @{ name='Osh'; sortOrder=1 } $j2 $slug2).data
$prod2 = (Api POST '/products' @{ categoryId=$cat2.id; name='Toy oshi'; price=45000 } $j2 $slug2).data
Check 'mahsulot yaratildi' ($prod2.price -eq 45000) $prod2.name

$promo2 = (Api POST '/promotions' @{
  name='Osh haftasi'; type='PERCENTAGE_DISCOUNT'; value=15; isActive=$true
} $j2 $slug2).data
$code2 = (Api POST '/promo-codes' @{ code="OSH$suffix"; type='FIXED'; discount=5000 } $j2 $slug2).data
Check 'aksiya va promokod yaratildi' ($null -ne $promo2.id -and $null -ne $code2.id)

Write-Host "`n--- tenant 1 tenant 2 ni KO'RMASLIGI kerak ---"
$b1 = (Api GET '/branches?limit=100' $null $j1 'demo')
Check 'demo yangi filialni kormaydi' ($null -eq ($b1.data | Where-Object { $_.id -eq $b2.id }))

$p1 = (Api GET '/products?limit=100' $null $j1 'demo')
Check 'demo yangi mahsulotni kormaydi' ($null -eq ($p1.data | Where-Object { $_.id -eq $prod2.id }))

$pr1 = (Api GET '/promotions?limit=100' $null $j1 'demo')
Check 'demo yangi aksiyani kormaydi' ($null -eq ($pr1.data | Where-Object { $_.id -eq $promo2.id }))

$pc1 = (Api GET '/promo-codes?limit=100' $null $j1 'demo')
Check 'demo yangi promokodni kormaydi' ($null -eq ($pc1.data | Where-Object { $_.code -eq $code2.code }))

Write-Host "`n--- to'g'ridan-to'g'ri ID bo'yicha ham ---"
MustNotSee 'demo boshqa filialni ID bilan ololmaydi'   { Api GET "/branches/$($b2.id)"    $null $j1 'demo' }
MustNotSee 'demo boshqa mahsulotni ID bilan ololmaydi' { Api GET "/products/$($prod2.id)" $null $j1 'demo' }
MustNotSee 'demo boshqa aksiyani ID bilan ololmaydi'   { Api GET "/promotions/$($promo2.id)" $null $j1 'demo' }

Write-Host "`n--- sarlavhani almashtirish yordam bermaydi ---"
# The tenant comes from the verified JWT, never from a header a client sends.
MustNotSee 'demo tokeni + boshqa slug sarlavhasi' { Api GET '/promotions?limit=100' $null $j1 $slug2 }

Write-Host "`n--- teskari yo'nalish ---"
$demoProducts = (Api GET '/products?limit=100' $null $j1 'demo').data
if ($demoProducts.Count -gt 0) {
  MustNotSee 'yangi restoran demo mahsulotini kormaydi' {
    Api GET "/products/$($demoProducts[0].id)" $null $j2 $slug2
  }
}
$p2 = (Api GET '/products?limit=100' $null $j2 $slug2)
Check 'yangi restoranda faqat ozining mahsuloti' ($p2.data.Count -eq 1) "$($p2.data.Count) ta"

Write-Host "`n--- promokod boshqa restoranda ishlamaydi ---"
# /menu/:branchId is public, so it carries no token -- the tenant has to come
# from the slug header. Without either, the scoping extension refuses to run
# the query at all, which is the fail-closed behaviour working as designed.
$demoBranchId = (Api GET '/branches/summary' $null $j1 'demo').data[0].id
$menu1 = Api GET "/menu/$demoBranchId" $null $null 'demo'
$item1 = ($menu1.data.categories | ForEach-Object { $_.products } | Select-Object -First 1)
if ($item1) {
  try {
    Api POST '/orders/preview' @{
      branchId = $demoBranchId
      type='PICKUP'; items=@(@{ productId=$item1.id; quantity=1; modifierIds=@() })
      promoCode=$code2.code
    } $j1 'demo' | Out-Null
    Check 'boshqa restoran promokodi rad etiladi' $false 'qabul qilindi'
  } catch { Check 'boshqa restoran promokodi rad etiladi' $true }
}

Write-Host "`n--- super admin hammasini ko'radi ---"
$all = (Api GET '/platform/tenants?limit=100' $null $saJwt)
Check 'super admin tenantlar royxatini koradi' ($all.data.Count -ge 2) "$($all.data.Count) ta"

Write-Host "`n--- oddiy egasi platformaga kira olmaydi ---"
MustNotSee 'demo egasi /platform/tenants ni ololmaydi' { Api GET '/platform/tenants' $null $j1 'demo' }

Write-Host "`nYaratilgan test tenant: $slug2" -ForegroundColor Yellow
Write-Host "`n$pass passed, $fail failed`n" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
