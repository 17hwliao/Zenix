$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Speech
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $engines = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  $engine = $engines | Where-Object { $_.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
  if (-not $engine) { throw '未安装 Windows 中文语音识别组件，请在系统语言设置安装中文语音，或使用文字。' }
  if ($request.operation -eq 'capabilities') {
    @{ available=$true; language=$engine.Culture.Name; offline=$true } | ConvertTo-Json -Compress
    exit 0
  }
  $bytes = [Convert]::FromBase64String($request.wav)
  $stream = New-Object IO.MemoryStream(,$bytes)
  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($engine)
  try {
    $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    $recognizer.SetInputToWaveStream($stream)
    $words = New-Object 'System.Collections.Generic.List[string]'
    $confidence = 1.0
    while ($true) {
      $result = $recognizer.Recognize()
      if ($null -eq $result) { break }
      $words.Add($result.Text)
      $confidence = [Math]::Min($confidence, $result.Confidence)
    }
    @{ transcript=($words -join ''); confidence=$confidence; offline=$true } | ConvertTo-Json -Compress
  } finally { $recognizer.Dispose(); $stream.Dispose() }
} catch { @{ error=$_.Exception.Message } | ConvertTo-Json -Compress; exit 1 }
