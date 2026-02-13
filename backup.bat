@echo off
setlocal

:: ============================================================
:: 1. Obtém a data e hora atual (Formato: YYYY-MM-DD_HH-mm-ss)
:: ============================================================
for /f "usebackq delims=" %%a in (`powershell -Command "Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'"`) do set "TIMESTAMP=%%a"

:: ============================================================
:: 2. Define a pasta de destino (Google Drive)
:: ============================================================
:: O caminho base onde as pastas serão criadas
set "TARGET_ROOT=G:\Meu Drive\BKPS\GEX"

:: O caminho completo da nova pasta
set "BACKUP_DIR=%TARGET_ROOT%\backup_%TIMESTAMP%"

:: ============================================================
:: 3. Cria a pasta de backup
:: ============================================================
echo Criando pasta no G:: %BACKUP_DIR%...
mkdir "%BACKUP_DIR%"

:: ============================================================
:: 4. Copia arquivos (Ignorando EXECUTÁVEIS)
:: ============================================================
:: Mudamos de COPY para ROBOCOPY para usar o filtro de exclusão.
:: Sintaxe: robocopy "origem" "destino" "quais arquivos"
:: /xf *.exe    -> Exclude Files: ignora qualquer arquivo .exe
:: /lev:1       -> Level 1: Copia apenas arquivos da raiz (não entra em subpastas), igual ao script original.
:: /R:0 /W:0    -> Retry/Wait: Se der erro, não fica tentando de novo (agiliza o processo).
:: >nul         -> Oculta o relatório detalhado do robocopy para não poluir a tela.

echo Copiando arquivos (exceto .exe)...
robocopy . "%BACKUP_DIR%" *.* /xf *.exe /lev:1 /R:0 /W:0 >nul

echo.
echo ==============================================
echo  SUCESSO! Backup realizado.
echo  Pasta criada: %BACKUP_DIR%
echo ==============================================
echo.
pause