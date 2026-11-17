param(
  [Parameter(Mandatory=$true)][string]$Jdk,
  [Parameter(Mandatory=$true)][string]$KotlinLib,
  [Parameter(Mandatory=$true)][string]$JsonJar
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$out = 'android/app/build/production-tools-jvm-test'
New-Item -ItemType Directory -Force $out | Out-Null
$stdlib = (Get-ChildItem $KotlinLib -Filter 'kotlin-stdlib-*.jar' | Where-Object { $_.Name -match '^kotlin-stdlib-[0-9]' } | Select-Object -First 1).FullName
if (!$stdlib) { throw 'Kotlin standard library not found.' }
& "$Jdk/bin/javac.exe" -encoding UTF-8 -d $out tests/plan-native/com/google/ai/edge/litertlm/OpenApiTool.java tests/production-native/react/com/facebook/react/bridge/Promise.java tests/production-native/react/com/facebook/react/bridge/ReactApplicationContext.java tests/production-native/react/com/facebook/react/bridge/ReactContextBaseJavaModule.java tests/production-native/react/com/facebook/react/bridge/ReactMethod.java
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$classpath = "$out;$JsonJar;$stdlib"
& "$Jdk/bin/java.exe" -cp "$KotlinLib/*" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -classpath $classpath -d $out android/app/src/main/java/com/albion/market/litert/ProductionEngine.kt android/app/src/main/java/com/albion/market/litert/ProductionWeightEngine.kt android/app/src/main/java/com/albion/market/litert/ProductionTools.kt android/app/src/main/java/com/albion/market/litert/ProductionScenarioRegistry.kt android/app/src/main/java/com/albion/market/litert/ProductionModule.kt tests/production-native/ProductionToolsHarness.kt tests/production-native/ProductionModuleHarness.kt
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$Jdk/bin/java.exe" -cp $classpath ProductionToolsHarnessKt
exit $LASTEXITCODE
