@echo off
chcp 65001 >nul
title Arena Tactics Manager - 로컬 서버 (http://localhost:8080)
cd /d "%~dp0"

echo ==================================================
echo   아레나 택틱스 매니저 (Arena Tactics Manager)
echo   로컬 웹 서버 시작 중: http://localhost:8080/
echo   종료하려면 이 창을 닫거나 Ctrl+C 를 누르세요.
echo ==================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = (Get-Location).Path;" ^
  "$listener = New-Object System.Net.HttpListener;" ^
  "$listener.Prefixes.Add('http://localhost:8080/');" ^
  "$listener.Start();" ^
  "Start-Process 'http://localhost:8080/';" ^
  "Write-Host '서버 실행 중: http://localhost:8080/' -ForegroundColor Cyan;" ^
  "$mimeMap = @{ '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='application/javascript; charset=utf-8'; '.svg'='image/svg+xml'; '.json'='application/json; charset=utf-8' };" ^
  "try {" ^
  "  while ($listener.IsListening) {" ^
  "    $ctx = $listener.GetContext();" ^
  "    $reqPath = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'));" ^
  "    if ([string]::IsNullOrWhiteSpace($reqPath)) { $reqPath = 'index.html'; }" ^
  "    $safeRel = $reqPath.Replace('/', [System.IO.Path]::DirectorySeparatorChar);" ^
  "    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $safeRel));" ^
  "    if (-not $fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {" ^
  "      $ctx.Response.StatusCode = 404;" ^
  "      $bytes = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found');" ^
  "      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length);" ^
  "      $ctx.Response.Close();" ^
  "      continue;" ^
  "    }" ^
  "    $ext = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant();" ^
  "    $ctx.Response.ContentType = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { 'application/octet-stream' };" ^
  "    $ctx.Response.Headers.Add('Cache-Control', 'no-cache');" ^
  "    $data = [System.IO.File]::ReadAllBytes($fullPath);" ^
  "    $ctx.Response.ContentLength64 = $data.Length;" ^
  "    $ctx.Response.OutputStream.Write($data, 0, $data.Length);" ^
  "    $ctx.Response.Close();" ^
  "  }" ^
  "} finally { $listener.Stop(); $listener.Close(); }"
