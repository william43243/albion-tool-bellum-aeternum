param([string]$Jdk = $env:JAVA_HOME)
$ErrorActionPreference = 'Stop'
if (!$Jdk) { throw 'Set JAVA_HOME or pass -Jdk (JDK 17 or later).' }
$root = Split-Path $PSScriptRoot -Parent
$native = Join-Path $root 'android/app/src/main/java/com/albion/market/siwc'
$jar = Get-ChildItem "$env:USERPROFILE/.gradle/caches/modules-2/files-2.1/com.nimbusds/nimbus-jose-jwt/10.10" -Recurse -Filter '*.jar' | Select-Object -First 1 -ExpandProperty FullName
if (!$jar) { throw 'Resolve Gradle dependencies first: com.nimbusds:nimbus-jose-jwt:10.10.' }
$out = Join-Path $root 'android/app/build/siwc-unit'
New-Item -ItemType Directory -Force $out | Out-Null
$sources = @('AuthCore','IdentityVerifier','LoopbackWindow','SseReader','AuthAttemptGate','OperationFence','InferenceGuard','RefreshPolicy','NetworkCleanup','OutputItemCollector','ResponseAssemblyPolicy') | ForEach-Object { Join-Path $native "$_.java" }
$sources += Join-Path $root 'android/app/src/main/java/com/albion/market/litert/MarketNumeric.java'
$sources += Join-Path $root 'android/app/src/main/java/com/albion/market/litert/HistoryWindow.java'
$sources += Join-Path $root 'android/app/src/main/java/com/albion/market/litert/HistoryAggregate.java'
$sources += Join-Path $root 'android/app/src/main/java/com/albion/market/litert/WorldRouteGraph.java'
$sources += Join-Path $root 'android/app/src/main/java/com/albion/market/litert/FlipComparison.java'
$sources += Join-Path $root 'android/app/src/main/java/com/albion/market/alerts/PriceAlertMath.java'
$sources += Join-Path $root 'android/app/src/main/java/com/albion/market/network/BoundedRead.java'
$sources += (Get-ChildItem (Join-Path $root 'tests/siwc-java') -Filter '*.java').FullName
& "$Jdk/bin/javac.exe" -encoding UTF-8 -cp $jar -d $out $sources
if ($LASTEXITCODE -ne 0) { throw 'SIWC test compilation failed.' }
foreach ($test in @('AuthCoreTest','IdentityVerifierTest','LoopbackWindowTest','SseReaderTest','AuthAttemptGateTest','ProductionGuardsTest','NetworkCleanupTest','OutputItemCollectorTest','ResponseAssemblyPolicyTest','HistoryWindowTest','WorldRouteGraphTest','FlipComparisonTest','PriceAlertMathCheck','BoundedReadTest')) {
 & "$Jdk/bin/java.exe" -cp "$jar;$out" $test
 if ($LASTEXITCODE -ne 0) { throw "$test failed." }
}
