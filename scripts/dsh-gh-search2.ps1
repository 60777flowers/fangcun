$ProgressPreference='SilentlyContinue'
$queries = @(
  'dsh game',
  'dsh-game',
  'dsh minecraft',
  'dsh 我的世界',
  'deepseek harness 游戏',
  'dsh 插件 游戏',
  'dsh 直播',
  'dsh livestream',
  'dsh mc',
  'dsh 游戏感知',
  'dsh 视觉',
  'dsh desktop control',
  'dsh computer use',
  'dsh vision'
)
$out = 'D:\研一上\AR_MC\reports\_data-dsh-search.txt'
$lines = New-Object System.Collections.Generic.List[string]
foreach ($q in $queries) {
  $enc = [uri]::EscapeDataString($q)
  $uri = "https://api.github.com/search/repositories?q=$enc&sort=stars&order=desc&per_page=100"
  try {
    $r = Invoke-RestMethod -Uri $uri -Headers @{ 'User-Agent'='ps'; 'Accept'='application/vnd.github+json' }
    $lines.Add("=== QUERY: $q | total=$($r.total_count) | returned=$($r.items.Count) ===")
    foreach ($i in $r.items) {
      if ($i.full_name -match 'dsh|deepseek|harness') {
        $desc = $i.description
        if ($desc) { $desc = $desc -replace '\s+',' ' }
        $lines.Add(("{0}|{1}|{2}|{3}|{4}|{5}|{6}" -f $i.full_name, $i.stargazers_count, $i.created_at, $i.pushed_at, $i.language, $i.license.spdx_id, $desc))
      }
    }
  } catch {
    $lines.Add("=== QUERY: $q | ERR: $($_.Exception.Message) ===")
  }
  Start-Sleep -Milliseconds 2500
}
Set-Content -Path $out -Value $lines -Encoding UTF8
Write-Output "WROTE $($lines.Count) lines to $out"
