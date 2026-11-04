# Herdr-UI installer: copies the mods into Herdr and wires them into a layout.
#   .\install.ps1                      install into the "my-layout" layout (cloned from "main" if missing)
#   .\install.ps1 -Layout work         another layout of yours
#   .\install.ps1 -ModsOnly            copy the mods only, leave layouts alone
# Works in Windows PowerShell 5.1 and PowerShell 7.
param(
  [string]$Layout = "my-layout",
  [switch]$ModsOnly
)
$ErrorActionPreference = "Stop"

$src = $PSScriptRoot
$app = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $env:USERPROFILE ".config\herdr-app" }
if (-not (Test-Path $app)) {
  Write-Host "Herdr 앱 폴더가 없어요: $app`nHerdr를 한 번 실행한 뒤 다시 설치하세요." -ForegroundColor Red
  exit 1
}

# 1. Mods
$mods = @("my-files", "my-files-drag", "my-files-open", "my-github", "my-plugins", "my-tabs")
New-Item -ItemType Directory -Force (Join-Path $app "mods") | Out-Null
foreach ($m in $mods) {
  $to = Join-Path $app "mods\$m"
  New-Item -ItemType Directory -Force $to | Out-Null
  Copy-Item (Join-Path $src "mods\$m\*") $to -Recurse -Force
}
Write-Host "mod 복사 완료: $($mods -join ', ')" -ForegroundColor Green
if ($ModsOnly) { exit 0 }

# 2. Layout (shipped layouts can't be edited: clone first)
if ($Layout -in @("main", "terminals", "win98")) {
  Write-Host "'$Layout' 은 Herdr 기본 레이아웃이라 직접 고칠 수 없어요. 다른 이름을 주세요 (예: -Layout my-layout)." -ForegroundColor Yellow
  exit 1
}
$file = Join-Path $app "layouts\$Layout.json"
if (-not (Test-Path $file)) {
  if (-not (Get-Command herdr-app -ErrorAction SilentlyContinue)) {
    Write-Host "레이아웃 '$Layout' 이 없고 herdr-app 명령도 찾을 수 없어요. Herdr에서 레이아웃을 복제한 뒤 다시 실행하세요." -ForegroundColor Red
    exit 1
  }
  $json = '{"name":"main","as":"' + $Layout + '"}'
  & herdr-app do layout.clone $json | Out-Null
  for ($i = 0; $i -lt 20 -and -not (Test-Path $file); $i++) { Start-Sleep -Milliseconds 250 }
  if (-not (Test-Path $file)) { Write-Host "레이아웃 복제에 실패했어요: $file" -ForegroundColor Red; exit 1 }
  Write-Host "기본 레이아웃 main 을 '$Layout' 으로 복제했어요." -ForegroundColor Green
}

$raw = [IO.File]::ReadAllText($file)
$doc = $raw | ConvertFrom-Json

function Find-Node($node, [scriptblock]$pred) {
  if ($null -eq $node) { return $null }
  if (& $pred $node) { return $node }
  foreach ($child in @($node.children)) {
    $found = Find-Node $child $pred
    if ($found) { return $found }
  }
  return $null
}
function Mod-Of($node) { if ($node.content -and $node.content.PSObject.Properties["mod"]) { $node.content.mod } else { $null } }

$filesBlock = Find-Node $doc { param($n) (Mod-Of $n) -in @("files", "my-files") }
$tabsBlock  = Find-Node $doc { param($n) (Mod-Of $n) -in @("tabs", "my-tabs") }
$panelBody  = Find-Node $doc { param($n) $n.id -eq "panel-body" }
if (-not $filesBlock -or -not $tabsBlock -or -not $panelBody) {
  Write-Host "이 레이아웃에서 Files 칸, 탭 바, 오른쪽 패널(panel-body)을 찾지 못했어요. README의 수동 설치를 보세요." -ForegroundColor Yellow
  exit 1
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $file "$file.bak-$stamp" -Force

$filesBlock.content.mod = "my-files"
$tabsBlock.content.mod = "my-tabs"
if (-not (@($panelBody.children) | Where-Object { $_.id -eq "github" })) {
  $github = [pscustomobject]@{ id = "github"; type = "block"; content = [pscustomobject]@{ mod = "my-github" } }
  $panelBody.children = @($panelBody.children) + $github
}
if (-not (@($panelBody.children) | Where-Object { $_.id -eq "plugins" })) {
  $plugins = [pscustomobject]@{ id = "plugins"; type = "block"; content = [pscustomobject]@{ mod = "my-plugins" } }
  $panelBody.children = @($panelBody.children) + $plugins
}

$out = $doc | ConvertTo-Json -Depth 100
[IO.File]::WriteAllText($file, $out, (New-Object Text.UTF8Encoding $false))
Write-Host "레이아웃 '$Layout' 에 연결했어요 (백업: $Layout.json.bak-$stamp)." -ForegroundColor Green

if (Get-Command herdr-app -ErrorAction SilentlyContinue) {
  $shared = Join-Path $app "shared.json"
  $current = $null
  if (Test-Path $shared) {
    $text = [IO.File]::ReadAllText($shared)
    try { $current = ($text | ConvertFrom-Json).layout }
    catch { if ($text -match '"layout"\s*:\s*"([^"]*)"') { $current = $Matches[1] } }
  }
  if ($current -ne $Layout) {
    $json = '{"name":"' + $Layout + '"}'
    & herdr-app do layout.switch $json | Out-Null
    Write-Host "레이아웃을 '$Layout' 으로 바꿨어요." -ForegroundColor Green
  }
}
Write-Host "완료. 탭 바에 Files · Changes · GitHub · Plugin 버튼이 보이면 성공이에요."
