@echo off
setlocal

set "VS_NODE_DIR=C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Microsoft\VisualStudio\NodeJs"
set "PATH=%VS_NODE_DIR%;%PATH%"

node "%~dp0terminals.js" %*
