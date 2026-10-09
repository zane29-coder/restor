# The Telegram bot's INBOUND half, against the live server. ASCII only.
#
# Why this script exists: the bot was write-only. It posted order notifications
# into staff groups and ignored everything anyone sent it, because setWebhook
# had no call site, no route existed for Telegram to POST to, and no command
# handler existed at all. Pressing /start did nothing, which looks exactly like
# a bad token - two were revoked chasing it.
#
# So the assertions below are mostly "does this route exist, and is it
# guarded", which is what nobody could answer before.
#
# What it does NOT cover: an actual /start. Only Telegram can deliver a genuine
# update, since the secret is derived server-side and no client can forge it.
# That last step is a human opening the bot and pressing the button.
param(
  [string]$BaseUrl = 'https://api.restor.uz/api/v1',
  [string]$Login = '+998901111111',
  [string]$Password = 'Restor2026dev',
  [string]$Slug = 'demo'
)

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0

function Api($method, $path, $body = $null, $jwt = $null) {
  $h = @{ 'Content-Type' = 'application/json'; 'X-Tenant-Slug' = $Slug }
  if ($jwt) { $h['Authorization'] = "Bearer $jwt" }
  $a = @{ Uri = "$BaseUrl$path"; Method = $method; Headers = $h; TimeoutSec = 30 }
  if ($body) { $a['Body'] = ($body | ConvertTo-Json -Depth 10 -Compress) }
  Invoke-RestMethod @a
}

# The status code of a call that is EXPECTED to fail. 0 means it succeeded,
# which for every use below is itself the failure.
function StatusOf($method, $path, $body = $null, $headers = $null) {
  $h = @{ 'Content-Type' = 'application/json' }
  if ($headers) { foreach ($k in $headers.Keys) { $h[$k] = $headers[$k] } }
  $a = @{ Uri = "$BaseUrl$path"; Method = $method; Headers = $h; TimeoutSec = 30 }
  if ($body) { $a['Body'] = ($body | ConvertTo-Json -Depth 10 -Compress) }
  try {
    Invoke-RestMethod @a | Out-Null
    return 0
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return -1
  }
}

function Check($name, $cond, $detail = '') {
  if ($cond) { $script:pass++; Write-Host "  OK   $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL $name $detail" -ForegroundColor Red }
}

$jwt = (Api POST '/auth/login' @{ login=$Login; password=$Password; tenantSlug=$Slug }).data.tokens.accessToken

Write-Host "`n--- 1. Bot status reports where updates must arrive ---"
$status = (Api GET '/telegram/bot/status' $null $jwt).data

Check 'status endpoint answers'           ($null -ne $status)
Check 'it names the expected webhook URL' (-not [string]::IsNullOrWhiteSpace($status.expectedWebhookUrl)) "= $($status.expectedWebhookUrl)"

# Asserted as a whole string, no wildcard where a defect could hide. The Subo
# callback once shipped without /api/v1 and every call hit the static site; a
# pattern like 'https://*/webhooks/telegram/*' would pass on both URLs equally.
$expectedPrefix = "$BaseUrl/webhooks/telegram/"
Check 'the URL carries the full /api/v1/webhooks prefix' `
  ($status.expectedWebhookUrl.StartsWith($expectedPrefix)) `
  "expected to start with $expectedPrefix, got $($status.expectedWebhookUrl)"

Check 'the Mini App link carries the restaurant slug' `
  ($status.miniAppUrl -like "*tenant=$Slug*") "= $($status.miniAppUrl)"

Check 'it says in Uzbek what the state is' (-not [string]::IsNullOrWhiteSpace($status.message)) "= $($status.message)"

Write-Host "`n--- 2. Is this restaurant's bot actually connected? ---"
if (-not $status.hasToken) {
  # Not a failure: a restaurant without a bot is a valid state. But say so
  # loudly, because the assertions it would support are vacuous without one.
  Write-Host "  SKIP no bot token configured for '$Slug' - nothing to connect" -ForegroundColor Yellow
} else {
  Check 'the bot has a username'   (-not [string]::IsNullOrWhiteSpace($status.botUsername)) "= $($status.botUsername)"
  Check 'the customer link exists' ($status.botLink -like 'https://t.me/*') "= $($status.botLink)"
  Check 'Telegram delivers HERE'   ($status.isConnected -eq $true) `
    "registered at '$($status.webhookUrl)', we need '$($status.expectedWebhookUrl)' - press Qayta ulash"

  if ($status.pendingUpdateCount -gt 0) {
    Write-Host "  WARN $($status.pendingUpdateCount) updates pending; Telegram said: $($status.lastErrorMessage)" -ForegroundColor Yellow
  }
}

Write-Host "`n--- 3. The webhook route exists and refuses a forgery ---"
# The assertion this whole script is for. Before the bot's inbound half was
# written every one of these was a 404 - there was no route at all.
#
# A deliberately non-existent config id is used throughout: the secret is an
# HMAC of a server-side key, so no client can forge a valid delivery for a real
# id either, and this way the section means something even on a restaurant with
# no bot.
$fakeConfig = '00000000-0000-4000-8000-000000000000'
$update = @{ update_id = 1; message = @{ message_id = 1; chat = @{ id = 1; type = 'private' }; text = '/start' } }

$noSecret = StatusOf POST "/webhooks/telegram/$fakeConfig" $update
Check 'the route exists (not 404)' ($noSecret -ne 404) "got $noSecret"
Check 'no secret is refused'       ($noSecret -eq 403) "got $noSecret"

# 403 and not 401 also proves the route is public: Telegram holds no token of
# ours, so a JWT guard here would reject every real delivery.
Check 'the route is not behind the JWT guard' ($noSecret -ne 401) "got $noSecret"

$wrongSecret = StatusOf POST "/webhooks/telegram/$fakeConfig" $update @{ 'X-Telegram-Bot-Api-Secret-Token' = 'not-the-secret' }
Check 'a wrong secret is refused' ($wrongSecret -eq 403) "got $wrongSecret"

Write-Host "`n--- 4. The management routes are still guarded ---"
Check 'status needs a token'  ((StatusOf GET  '/telegram/bot/status')  -eq 401)
Check 'connect needs a token' ((StatusOf POST '/telegram/bot/connect') -eq 401)

Write-Host "`n--- 5. Nothing above disturbed the config ---"
$config = (Api GET '/telegram/config' $null $jwt).data
Check 'the token is never returned' ($null -eq $config.botToken -and $null -eq $config.botTokenEncrypted)
Check 'hasToken still agrees with the status call' ($config.hasToken -eq $status.hasToken) `
  "config=$($config.hasToken) status=$($status.hasToken)"

Write-Host "`n$pass passed, $fail failed`n" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
