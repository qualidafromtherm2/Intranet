@echo off
setlocal

set "URL=http://localhost:5001/menu_produto.html#inicio"
set "ROOT=%~dp0"

netstat -ano | findstr ":5001" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo Servidor local nao encontrado na porta 5001.
  echo Iniciando Intranet local...
  start "Intranet Localhost 5001" cmd /k "cd /d "%ROOT%" && npm start"
  echo Aguardando servidor iniciar...
  for /l %%i in (1,1,60) do (
    netstat -ano | findstr ":5001" | findstr "LISTENING" >nul
    if not errorlevel 1 goto abriu_servidor
    timeout /t 1 /nobreak >nul
  )
  echo.
  echo ERRO: O servidor nao iniciou na porta 5001.
  echo Veja a janela "Intranet Localhost 5001" para entender o erro.
  pause
  exit /b 1
)

:abriu_servidor
echo Abrindo Intranet local:
echo %URL%
start "" "%URL%"

endlocal
