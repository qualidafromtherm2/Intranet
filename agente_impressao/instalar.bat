@echo off
chcp 65001 >nul
echo.
echo  ====================================================
echo   Agente de Impressao de Etiquetas — Intranet SGF
echo  ====================================================
echo.

:: ── Verifica Node.js ─────────────────────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo  ERRO: Node.js nao encontrado.
  echo.
  echo  Instale o Node.js em: https://nodejs.org/en/download
  echo  Escolha a versao LTS ^(Windows Installer, 64-bit^).
  echo  Apos instalar, execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  Node.js encontrado: %NODE_VER%

:: ── Define diretório de instalação ───────────────────────────────────────────
set INSTALL_DIR=%APPDATA%\AgenteImpressaoSGF
echo  Instalando em : %INSTALL_DIR%

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /y "%~dp0index.js"      "%INSTALL_DIR%\" >nul
copy /y "%~dp0imprimir.ps1"  "%INSTALL_DIR%\" >nul
copy /y "%~dp0package.json"  "%INSTALL_DIR%\" >nul

:: ── Cria script de inicialização ─────────────────────────────────────────────
set INICIAR=%INSTALL_DIR%\iniciar.bat
echo @echo off                                      > "%INICIAR%"
echo cd /d "%INSTALL_DIR%"                         >> "%INICIAR%"
echo node index.js                                 >> "%INICIAR%"

:: ── Adiciona à pasta Startup do Windows (inicia com o login) ─────────────────
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
echo @echo off                                       > "%STARTUP%\AgenteImpressaoSGF.bat"
echo cd /d "%INSTALL_DIR%"                          >> "%STARTUP%\AgenteImpressaoSGF.bat"
echo start "Agente Impressao SGF" /min node index.js >> "%STARTUP%\AgenteImpressaoSGF.bat"

echo.
echo  ====================================================
echo   Instalacao concluida com sucesso!
echo  ====================================================
echo.
echo  O agente sera iniciado AUTOMATICAMENTE ao fazer login.
echo.
echo  Para iniciar AGORA sem reiniciar, execute:
echo    %INICIAR%
echo.
echo  Para verificar se esta rodando, abra no navegador:
echo    http://localhost:9200/status
echo.
pause
