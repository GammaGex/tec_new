@echo off
title GexBrowser Builder System
cls

echo ======================================================
echo           INICIANDO BUILD DO GEXBROWSER
echo ======================================================
echo.

:: Verifica se o Python está no PATH
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Python nao encontrado no PATH.
    pause
    exit /b
)

:: Executa o script de build
echo [+] Executando logica de build (Python)...
python setup.py

:: Verifica se o build falhou
if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Ocorreu uma falha durante o processo de build.
    pause
    exit /b
)

echo.
echo ======================================================
echo           PROCESSO CONCLUIDO COM SUCESSO!
echo ======================================================
echo.
pause