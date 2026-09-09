# ---------------------------------------------------------------------------
# LeadBee Android development environment (Windows / PowerShell)
#
# All of these values are ALSO persisted as User-scope environment variables,
# so a freshly opened PowerShell session or a reboot already has them. This
# script exists so that (a) the configuration is documented and reproducible in
# source control, and (b) an already-open shell can pick the values up without
# being restarted.
#
#   Usage:  . .\scripts\android-env.ps1          (dot-source it)
#
# Storage policy: every Android / Java / Gradle artifact that can be relocated
# lives on D:. See docs/ANDROID_DEV_ENVIRONMENT.md for the items that cannot.
# ---------------------------------------------------------------------------

# --- Java -------------------------------------------------------------------
# JDK 17 is required, not optional: react-native 0.86.3 pins AGP 8.12.0 and
# Kotlin 2.1.20 (node_modules/react-native/gradle/libs.versions.toml), and every
# native module compiles with sourceCompatibility/jvmTarget 17. Android Studio's
# bundled JBR is JDK 25, which AGP 8.12 / Kotlin 2.1.20 / KSP do not support.
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot'

# --- Android SDK ------------------------------------------------------------
$env:ANDROID_HOME      = 'D:\Android\Sdk'
$env:ANDROID_SDK_ROOT  = 'D:\Android\Sdk'
$env:ANDROID_AVD_HOME  = 'D:\Android\avd'
# Moves ~/.android (adb keys, emulator + Studio CLI caches) off C:.
$env:ANDROID_USER_HOME = 'D:\Android\.android'

# --- Gradle -----------------------------------------------------------------
# Holds caches, wrapper distributions and any auto-provisioned JDKs.
$env:GRADLE_USER_HOME  = 'D:\Android\Gradle'

# --- PATH -------------------------------------------------------------------
$prepend = @(
    (Join-Path $env:JAVA_HOME 'bin'),
    (Join-Path $env:ANDROID_HOME 'platform-tools'),
    (Join-Path $env:ANDROID_HOME 'emulator'),
    (Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin')
)
$existing = $env:Path -split ';' | Where-Object { $_ -and ($prepend -notcontains $_) }
$env:Path = (($prepend + $existing) -join ';')

# --- Report -----------------------------------------------------------------
Write-Host 'LeadBee Android environment' -ForegroundColor Cyan
foreach ($n in 'JAVA_HOME','ANDROID_HOME','ANDROID_SDK_ROOT','ANDROID_AVD_HOME','ANDROID_USER_HOME','GRADLE_USER_HOME') {
    '{0,-18} = {1}' -f $n, (Get-Item "Env:$n").Value | Write-Host
}
'{0,-18} = {1}' -f 'java', (Get-Command java).Source | Write-Host
'{0,-18} = {1}' -f 'adb',  (Get-Command adb).Source  | Write-Host
