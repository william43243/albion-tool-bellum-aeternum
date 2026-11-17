param(
  [Parameter(Mandatory=$true)][string]$Jdk,
  [Parameter(Mandatory=$true)][string]$KotlinLib,
  [Parameter(Mandatory=$true)][string]$JsonJar
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$out = 'android/app/build/plan-jvm-test'
New-Item -ItemType Directory -Force $out | Out-Null
$src = 'tests/plan-native'
& "$Jdk/bin/javac.exe" -encoding UTF-8 -cp $JsonJar -d $out "$src/android/content/Context.java" "$src/android/content/res/AssetManager.java" "$src/android/util/Log.java" "$src/com/albion/market/BuildConfig.java" "$src/com/google/ai/edge/litertlm/OpenApiTool.java" android/app/src/main/java/com/albion/market/litert/WorldRouteGraph.java
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$stdlib = (Get-ChildItem $KotlinLib -Filter 'kotlin-stdlib-*.jar' | Where-Object { $_.Name -match '^kotlin-stdlib-[0-9]' } | Select-Object -First 1).FullName
if (!$stdlib) { throw 'Kotlin standard library not found.' }
$classpath = "$out;$JsonJar;$stdlib"
& "$Jdk/bin/java.exe" -cp "$KotlinLib/*" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -classpath $classpath -d $out android/app/src/main/java/com/albion/market/litert/PlanEngine.kt
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$Jdk/bin/javac.exe" -encoding UTF-8 -cp $classpath -d $out "$src/PlanHarness.java" "$src/PlanToolHarness.java"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$Jdk/bin/java.exe" -cp $classpath PlanHarness
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$Jdk/bin/java.exe" -cp $classpath PlanToolHarness
exit $LASTEXITCODE
