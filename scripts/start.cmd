@echo off
set DSH_HOME=D:\dsh\home
set PATH=D:\dsh\npm;%LOCALAPPDATA%\Programs\nodejs;%PATH%
if not exist D:\dsh\home\xai.key (
  echo Missing D:\dsh\home\xai.key
  exit /b 1
)
set /p XAI_API_KEY=<D:\dsh\home\xai.key
cd /d D:\dsh\src\dsh-superagent-prototype-main
D:\dsh\npm\dsh.cmd --profile superagent --no-open --public-url https://agent.hoantienmuasam.net/ --trusted-host agent.hoantienmuasam.net > D:\dsh\dsh.out 2> D:\dsh\dsh.err
