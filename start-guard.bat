@echo off
title ATLAS Dev Guard (:5173)
cd /d "%~dp0"
echo Starting ATLAS self-healing guard...
echo   Dev server : http://localhost:5173
echo   Control API: http://localhost:5099/guard/health
echo.
npm run guard
pause
