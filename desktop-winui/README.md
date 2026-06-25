# BXB Homework WinUI Prototype

This directory is a native Windows UI prototype for BXB Homework.

It does not replace the current Electron client in `desktop/`. The goal is to prove the WinUI path first:

- WinUI 3 native window.
- Windows App SDK `NavigationView` shell.
- C# starts a Node backend process.
- C# calls the existing local Banxuebang tool layer through JSONL stdio.

## Required Local Tooling

Recommended tooling:

```powershell
winget install Microsoft.DotNet.SDK.8
winget install Microsoft.VisualStudio.2022.BuildTools
```

When installing Visual Studio Build Tools, include:

- .NET desktop build tools
- Windows App SDK / WinUI workload or individual components
- Windows 10/11 SDK

## Run

After installing the tooling, build with Visual Studio MSBuild, not plain `dotnet build`.
WinUI / Windows App SDK projects need VS AppxPackaging tasks that the standalone .NET SDK MSBuild does not provide.

```powershell
cd <repo>\desktop-winui
.\build.ps1
```

The debug executable is generated at:

```text
<repo>\desktop-winui\BxbHomework.WinUI\bin\x64\Debug\net8.0-windows10.0.19041.0\BxbHomework.WinUI.exe
```

## Package For Users

The user-facing WinUI build is packaged as a per-user NSIS installer. It includes:

- The WinUI self-contained output.
- `resources\payload` with `src`, `scripts`, root `package.json`, desktop version metadata, root `node_modules`, and the Playwright browser archive.
- `resources\node\node.exe`, so end users do not need to install Node.js.

Build the installer from the repository root:

```powershell
.\desktop-winui\package-winui.ps1 -Configuration Release
```

Outputs:

```text
<repo>\dist-winui-app\winui-unpacked\BxbHomework.WinUI.exe
<repo>\dist-winui-app\BXB Homework Setup <version>.exe
<repo>\dist-winui-app\BXB Homework Setup <version>.exe.sha256
```

The installer writes the app to:

```text
%LOCALAPPDATA%\Programs\BXB Homework
```

It creates desktop and Start Menu shortcuts named `BXB Homework`. The app currently shares the existing application data directory under `%APPDATA%\bxb-homework-electron`.

## Backend Protocol

In development mode, the app starts:

```powershell
node <repo>\scripts\winui-backend.js
```

In packaged mode, the app starts:

```text
resources\node\node.exe resources\payload\scripts\winui-backend.js
```

Each request is one JSON line:

```json
{"id":"1","method":"session.status","params":{}}
```

Each response is one JSON line:

```json
{"id":"1","ok":true,"result":{}}
```

Current prototype method groups:

- `app.info`
- `app.openPath`
- `session.status`
- `tool.call`
- `modelConfig.load`
- `modelConfig.save`
- `modelConfig.clear`
- `modelConfig.list`
- `modelConfig.test`
- `conversation.list`
- `conversation.create`
- `conversation.select`
- `conversation.rename`
- `conversation.delete`
- `agent.chat`
- `agent.compact`
- `agent.reset`
- `workspace.importPaths`
- `workspace.savePastes`
- `workspace.open`
- `workspace.imageDataUrl`
- `update.check`
- `update.status`
- `update.download`
- `update.install`
- `update.cancel`
- `update.openUrl`

The WinUI shell currently exposes native pages for Home, Agent, Homework, Drafts, Private Messages, Workspace, Updates, and Settings. Complex confirmation flows such as draft submission, private-message sending, and installer launch are available in the backend but should still be surfaced through dedicated confirmation UI before normal use.
