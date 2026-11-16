$ProgressPreference='SilentlyContinue'
$queries = @(
  'dsh game',
  'dsh-game',
  'dsh minecraft',
  'dsh 我的世界',
  'deepseek harness 游戏',
  'dsh 插件 游戏',
  'dsh vision',
  'dsh 游戏感知',
  'dsh 视觉',
  'dsh desktop control',
  'dsh computer use',
  'dsh 直播',
  'dsh livestream',
  'dsh mc',
  'dsh screen',
  'dsh screenshot',
  'dsh godot',
  'dsh unity',
  'dsh ocr',
  'dsh game engine'
)
$seen = @{}
foreach ($q in $queries) {
  $enc = [uri]::EscapeDataString($q)
  $uri = "https://api.github.com/search/repositories?q=$enc&sort=stars&order=desc&per_page=100"
  try {
    $r = Invoke-RestMethod -Uri $uri -Headers @{ 'User-Agent'='ps'; 'Accept'='application/vnd.github+json' }
    Write-Output "=== QUERY: $q | total=$($r.total_count) | returned=$($r.items.Count) ==="
    foreach ($i in $r.items) {
      if ($i.full_name -match 'dsh|deepseek|harness') {
        $desc = $i.description
        if ($desc) { $desc = $desc -replace '\s+',' ' }
        Write-Output ("{0}|{1}|{2}|{3}|{4}|{5}|{6}" -f $i.full_name, $i.stargazers_count, $i.created_at, $i.pushed_at, $i.language, $i.license.spdx_id, $desc)
        if (-not $seen.ContainsKey($i.full_name)) { $seen[$i.full_name] = $i.stargazers_count }
      }
    }
  } catch {
    Write-Output "=== QUERY: $q | ERR: $($_.Exception.Message) ==="
  }
  Start-Sleep -Milliseconds 2500
}
Write-Output "=== UNIQUE REPOS FOUND: $($seen.Count) ==="
