<#
.SYNOPSIS
  Envia arquivo ZPL para impressora Windows via API Win32 (modo RAW).
  Usado pelo Agente de Impressão da Intranet SGF.

.PARAMETER ZplFile
  Caminho completo para o arquivo .zpl temporário.

.PARAMETER PrinterName
  Nome exato da impressora conforme exibido no Windows
  (Painel de Controle > Dispositivos e Impressoras).

.EXAMPLE
  .\imprimir.ps1 -ZplFile "C:\Temp\etq.zpl" -PrinterName "ZTC ZD220-203dpi ZPL"
#>
param(
  [Parameter(Mandatory)][string]$ZplFile,
  [Parameter(Mandatory)][string]$PrinterName
)

$ErrorActionPreference = 'Stop'

# Lê bytes do arquivo ZPL
$bytes = [IO.File]::ReadAllBytes($ZplFile)

# Compila classe C# com P/Invoke para winspool.Drv
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class ZebraRaw {

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DocInfo {
    public int    cbSize     = 16;
    public string pDocName;
    public string pOutputFile;
    public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA",
    CharSet = CharSet.Ansi, SetLastError = true)]
  public static extern bool OpenPrinter(
    string name, out IntPtr handle, IntPtr defaults);

  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter",
    SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr handle);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA",
    CharSet = CharSet.Ansi, SetLastError = true)]
  public static extern int StartDocPrinter(
    IntPtr handle, int level, DocInfo docInfo);

  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter",
    SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr handle);

  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter",
    SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr handle);

  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter",
    SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr handle);

  [DllImport("winspool.Drv", EntryPoint = "WritePrinter",
    SetLastError = true)]
  public static extern bool WritePrinter(
    IntPtr handle, byte[] data, int count, out int written);
}
'@

$handle = [IntPtr]::Zero

if (-not [ZebraRaw]::OpenPrinter($PrinterName, [ref]$handle, [IntPtr]::Zero)) {
  $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  throw "Impressora nao encontrada: '$PrinterName' (Win32 error $err). " +
        "Verifique o nome exato em: Painel de Controle > Dispositivos e Impressoras"
}

try {
  $doc            = New-Object ZebraRaw+DocInfo
  $doc.pDocName   = "ZPL"
  $doc.pDataType  = "RAW"

  if ([ZebraRaw]::StartDocPrinter($handle, 1, $doc) -le 0) {
    throw "Falha ao iniciar trabalho de impressao (StartDocPrinter)"
  }

  [ZebraRaw]::StartPagePrinter($handle) | Out-Null

  $written = 0
  $ok = [ZebraRaw]::WritePrinter($handle, $bytes, $bytes.Length, [ref]$written)

  [ZebraRaw]::EndPagePrinter($handle) | Out-Null
  [ZebraRaw]::EndDocPrinter($handle)  | Out-Null

  if (-not $ok) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "WritePrinter falhou (Win32 error $err)"
  }

  Write-Output "ENVIADO: $written bytes para '$PrinterName'"

} finally {
  [ZebraRaw]::ClosePrinter($handle) | Out-Null
}
