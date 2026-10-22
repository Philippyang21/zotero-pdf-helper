param([string]$EdgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    [ValidateSet('text','preview','account','speed','files','python','legacy','maintenance','updates')][string]$Page='text',
    [int]$Width=1250,[switch]$Dark,[switch]$Light)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$qaRoot = Join-Path $projectPath 'work'
$previewPath = Join-Path $qaRoot 'text-preview.html'
& node (Join-Path $PSScriptRoot 'render_text_preview.cjs') $previewPath
if ($LASTEXITCODE -ne 0) { throw 'Preview generation failed' }
if (!(Test-Path -LiteralPath $EdgePath)) { throw 'Pass -EdgePath with the installed Edge executable path' }
$previewUrl = ([System.Uri]$previewPath).AbsoluteUri + '?page=' + $Page
if($Light){$previewUrl += '&light=1'}
$shotName = 'settings-' + $Page + '-' + $Width + $(if($Dark){'-dark'}elseif($Light){'-light'}else{''}) + '.png'
$edgeArgs = @('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    '--disable-background-networking','--disable-extensions',
    ('--user-data-dir="' + (Join-Path $qaRoot ('qa-browser-profile-' + $PID)) + '"'),
    '--allow-file-access-from-files','--virtual-time-budget=9000','--dump-dom',
    ('--screenshot="' + (Join-Path $qaRoot $shotName) + '"'),
    ('--window-size=' + $Width + ',1600'),('"' + $previewUrl + '"'))
if($Dark){$edgeArgs=@('--force-dark-mode')+$edgeArgs}
$qaProcess = Start-Process -FilePath $EdgePath -ArgumentList $edgeArgs -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $qaRoot 'text-dom.html') -RedirectStandardError (Join-Path $qaRoot 'edge.log')
if (!$qaProcess.WaitForExit(25000)) { throw 'Isolated browser did not finish in 25 seconds; inspect work/edge.log' }
& node (Join-Path $PSScriptRoot 'verify_text_browser.cjs') (Join-Path $qaRoot 'text-dom.html')
if ($LASTEXITCODE -ne 0) { throw 'Browser UI checks failed' }
