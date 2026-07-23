[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("doctor", "install", "start", "stop", "restart", "status", "logs")]
    [string]$Action = "status",

    [switch]$SkipGpuCheck,
    [switch]$Rebuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $RepoRoot "docker-compose.kimodo.yml"
$EnvironmentFile = Join-Path $RepoRoot ".env.kimodo"
$EnvironmentExample = Join-Path $RepoRoot ".env.kimodo.example"
$DefaultTokenFile = Join-Path $RepoRoot ".secrets\hf-token"
$CudaProbeImage = "nvidia/cuda:12.4.1-base-ubuntu22.04"

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Check {
    param(
        [bool]$Passed,
        [string]$Label,
        [string]$Detail
    )

    $mark = if ($Passed) { "OK" } else { "FAIL" }
    $color = if ($Passed) { "Green" } else { "Red" }
    Write-Host ("[{0}] {1}: {2}" -f $mark, $Label, $Detail) -ForegroundColor $color
}

function Test-ExternalCommand {
    param([string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-DockerEngine {
    if (-not (Test-ExternalCommand "docker")) {
        return $false
    }

    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "SilentlyContinue"
        & docker info --format "{{.ServerVersion}}" *> $null
        $exitCode = $LASTEXITCODE
    }
    catch {
        $exitCode = 1
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    return $exitCode -eq 0
}

function Test-DockerCompose {
    if (-not (Test-ExternalCommand "docker")) {
        return $false
    }

    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "SilentlyContinue"
        & docker compose version *> $null
        $exitCode = $LASTEXITCODE
    }
    catch {
        $exitCode = 1
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    return $exitCode -eq 0
}

function Get-DockerOsType {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "SilentlyContinue"
        $output = & docker info --format "{{.OSType}}" 2>$null
        if ($LASTEXITCODE -eq 0) {
            return ($output | Select-Object -First 1).Trim()
        }
    }
    catch {
        return $null
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    return $null
}

function Get-EnvironmentValue {
    param(
        [string]$Name,
        [string]$DefaultValue
    )

    if (-not (Test-Path -LiteralPath $EnvironmentFile)) {
        return $DefaultValue
    }

    foreach ($line in Get-Content -LiteralPath $EnvironmentFile -Encoding UTF8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }
        $parts = $trimmed.Split(@("="), 2, [System.StringSplitOptions]::None)
        if ($parts.Count -eq 2 -and $parts[0].Trim() -eq $Name) {
            return $parts[1].Trim()
        }
    }

    return $DefaultValue
}

function Get-TokenFile {
    $configuredPath = Get-EnvironmentValue "HF_TOKEN_FILE" $DefaultTokenFile
    if ([System.IO.Path]::IsPathRooted($configuredPath)) {
        return $configuredPath
    }
    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $configuredPath))
}

function Get-ServicePort {
    return Get-EnvironmentValue "KIMODO_PORT" "8787"
}

function Get-ComposeArguments {
    $arguments = @("compose")
    if (Test-Path -LiteralPath $EnvironmentFile) {
        $arguments += @("--env-file", $EnvironmentFile)
    }
    $arguments += @("-f", $ComposeFile)
    return $arguments
}

function Invoke-Compose {
    param([string[]]$CommandArguments)

    $arguments = Get-ComposeArguments
    & docker @arguments @CommandArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose 命令执行失败（退出码 $LASTEXITCODE）。"
    }
}

function Ensure-EnvironmentFile {
    if (Test-Path -LiteralPath $EnvironmentFile) {
        Write-Host "使用现有配置：$EnvironmentFile"
        return
    }

    Copy-Item -LiteralPath $EnvironmentExample -Destination $EnvironmentFile
    Write-Host "已创建配置：$EnvironmentFile"
}

function Test-TokenFile {
    $tokenFile = Get-TokenFile
    if (-not (Test-Path -LiteralPath $tokenFile)) {
        return $false
    }
    $token = (Get-Content -LiteralPath $tokenFile -Raw -Encoding UTF8).Trim()
    return $token -match "^hf_[A-Za-z0-9]{10,}$"
}

function Ensure-HuggingFaceToken {
    if (Test-TokenFile) {
        Write-Host "Hugging Face Token 已配置。"
        return
    }

    $tokenFile = Get-TokenFile
    Write-Host "需要 Hugging Face Read Token，输入内容不会显示。"
    $secureToken = Read-Host "HF Token" -AsSecureString
    $pointer = [IntPtr]::Zero
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
        $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if ($token -notmatch "^hf_[A-Za-z0-9]{10,}$") {
            throw "Token 格式无效，应以 hf_ 开头。"
        }
        $directory = Split-Path -Parent $tokenFile
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
        $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($tokenFile, $token.Trim(), $utf8WithoutBom)
        Write-Host "Token 已保存到本地 secret 文件；该路径已被 Git 忽略。" -ForegroundColor Green
    }
    finally {
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
    }
}

function Test-DockerGpu {
    Write-Host "检查 Docker GPU 访问；首次运行可能需要下载 CUDA 检测镜像。"
    $output = @()
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = & docker run --rm --gpus all $CudaProbeImage nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>&1
        $exitCode = $LASTEXITCODE
    }
    catch {
        $output = @($_.Exception.Message)
        $exitCode = 1
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    $output | ForEach-Object { Write-Host $_ }
    return $exitCode -eq 0
}

function Invoke-Doctor {
    param([switch]$IgnoreMissingToken)

    Write-Step "检查 Kimodo 本地服务运行环境"
    $allRequiredChecksPassed = $true

    $dockerCli = Test-ExternalCommand "docker"
    Write-Check $dockerCli "Docker CLI" $(if ($dockerCli) { "已安装" } else { "未找到，请安装 Docker Desktop" })
    $allRequiredChecksPassed = $allRequiredChecksPassed -and $dockerCli

    $compose = Test-DockerCompose
    Write-Check $compose "Docker Compose" $(if ($compose) { "Compose v2 可用" } else { "不可用，请更新 Docker Desktop" })
    $allRequiredChecksPassed = $allRequiredChecksPassed -and $compose

    $engine = Test-DockerEngine
    Write-Check $engine "Docker 引擎" $(if ($engine) { "正在运行" } else { "未运行，请启动 Docker Desktop 并使用 Linux 容器" })
    $allRequiredChecksPassed = $allRequiredChecksPassed -and $engine

    if ($engine) {
        $dockerOsType = Get-DockerOsType
        $linuxContainers = $dockerOsType -eq "linux"
        Write-Check $linuxContainers "容器模式" $(if ($linuxContainers) { "Linux" } else { "$dockerOsType；请切换到 Linux 容器" })
        $allRequiredChecksPassed = $allRequiredChecksPassed -and $linuxContainers
    }

    try {
        $memoryGb = [Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
        $memoryRecommended = $memoryGb -ge 24
        if ($memoryRecommended) {
            Write-Check $true "系统内存" "$memoryGb GB"
        }
        else {
            Write-Host "[WARN] 系统内存：$memoryGb GB；建议至少 24 GB。" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "[WARN] 系统内存：无法读取，不阻止安装。" -ForegroundColor Yellow
    }

    $tokenReady = Test-TokenFile
    if ($tokenReady) {
        Write-Check $true "Hugging Face Token" "已配置"
    }
    elseif ($IgnoreMissingToken) {
        Write-Host "[INFO] Hugging Face Token：安装器将在环境检查通过后提示输入。" -ForegroundColor Yellow
    }
    else {
        Write-Check $false "Hugging Face Token" "未配置；运行 install 时会安全提示输入"
        $allRequiredChecksPassed = $false
    }

    if ($SkipGpuCheck) {
        Write-Host "[SKIP] Docker GPU：已通过 -SkipGpuCheck 跳过。" -ForegroundColor Yellow
    }
    elseif ($engine) {
        $gpuReady = Test-DockerGpu
        Write-Check $gpuReady "Docker GPU" $(if ($gpuReady) { "NVIDIA GPU 可访问" } else { "不可访问，请检查 NVIDIA 驱动和 Docker Desktop GPU 支持" })
        $allRequiredChecksPassed = $allRequiredChecksPassed -and $gpuReady
    }
    else {
        Write-Check $false "Docker GPU" "Docker 引擎未运行，无法检测"
        $allRequiredChecksPassed = $false
    }

    return $allRequiredChecksPassed
}

function Wait-KimodoReady {
    param([int]$TimeoutSeconds = 180)

    $port = Get-ServicePort
    $healthUrl = "http://127.0.0.1:$port/api/v1/health"
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    Write-Host "等待服务就绪：$healthUrl" -NoNewline

    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 5
            if ($health.status -eq "ok" -and $health.worker.alive -and $health.kimodoCliAvailable) {
                Write-Host " OK" -ForegroundColor Green
                return $health
            }
        }
        catch {
            # The API may be unavailable while the container is starting.
        }
        Write-Host "." -NoNewline
        Start-Sleep -Seconds 3
    }

    Write-Host ""
    throw "服务在 $TimeoutSeconds 秒内未就绪。运行 logs 查看容器日志。"
}

function Show-Status {
    if (-not (Test-DockerEngine)) {
        throw "Docker Desktop 未运行。"
    }

    Invoke-Compose @("ps")
    $port = Get-ServicePort
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/v1/health" -Method Get -TimeoutSec 5
        Write-Host "`nAPI 状态："
        $health | ConvertTo-Json -Depth 5
    }
    catch {
        throw "容器状态已显示，但 API 无法访问：$($_.Exception.Message)"
    }
}

function Install-Service {
    Ensure-EnvironmentFile
    if (-not (Invoke-Doctor -IgnoreMissingToken)) {
        throw "环境检查未通过，请修复 FAIL 项后重新运行安装器。"
    }
    Ensure-HuggingFaceToken

    Write-Step "构建 Kimodo 服务镜像"
    $buildArguments = @("build", "kimodo")
    if ($Rebuild) {
        $buildArguments = @("build", "--no-cache", "kimodo")
    }
    Invoke-Compose $buildArguments

    Write-Step "启动 Kimodo 服务"
    Invoke-Compose @("up", "-d", "kimodo")
    $health = Wait-KimodoReady
    Write-Host ("安装完成：Kimodo {0}，worker PID {1}" -f $health.status, $health.worker.pid) -ForegroundColor Green
}

function Start-KimodoService {
    Ensure-EnvironmentFile
    if (-not (Test-DockerEngine)) {
        throw "Docker Desktop 未运行。"
    }
    Ensure-HuggingFaceToken
    Invoke-Compose @("up", "-d", "--no-build", "kimodo")
    Wait-KimodoReady | Out-Null
    Write-Host "Kimodo 服务已启动。" -ForegroundColor Green
}

function Stop-KimodoService {
    if (-not (Test-DockerEngine)) {
        throw "Docker Desktop 未运行。"
    }
    Invoke-Compose @("down")
    Write-Host "Kimodo 服务已停止，任务和模型缓存卷已保留。" -ForegroundColor Green
}

function Restart-KimodoService {
    if (-not (Test-DockerEngine)) {
        throw "Docker Desktop 未运行。"
    }
    Invoke-Compose @("restart", "kimodo")
    Wait-KimodoReady | Out-Null
    Write-Host "Kimodo 服务已重启。" -ForegroundColor Green
}

try {
    if (-not (Test-Path -LiteralPath $ComposeFile)) {
        throw "找不到 Compose 文件：$ComposeFile"
    }

    switch ($Action) {
        "doctor" {
            if (-not (Invoke-Doctor)) {
                exit 1
            }
        }
        "install" { Install-Service }
        "start" { Start-KimodoService }
        "stop" { Stop-KimodoService }
        "restart" { Restart-KimodoService }
        "status" { Show-Status }
        "logs" {
            if (-not (Test-DockerEngine)) {
                throw "Docker Desktop 未运行。"
            }
            Invoke-Compose @("logs", "-f", "--tail", "200", "kimodo")
        }
    }
}
catch {
    Write-Host "`nKimodo 服务操作失败：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "可运行以下命令重新检查环境："
    Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\kimodo-service.ps1 doctor"
    exit 1
}
