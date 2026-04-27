#define MyAppName "BXB Client"
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#define MyAppPublisher "IGpig"
#define MyAppExeName "Launch BXB Client.vbs"

[Setup]
AppId={{A7C0E386-C7B0-4699-9007-08D1A4D133C5}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\BXB Client
DefaultGroupName=BXB Client
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\..\dist\windows-installer
OutputBaseFilename=BXB_Client_Setup_Windows
Compression=lzma
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\assets\app_icon.ico
SetupIconFile=..\..\assets\app_icon.ico

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "..\..\banxuebang.py"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\banxuebang_gui.py"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\bootstrap_runtime.py"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\bootstrap_config.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\app_metadata.py"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\pyproject.toml"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\requirements.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\start_gui.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\start_gui.command"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\start_cli.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\start_cli.command"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\generate_ui_assets.py"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\assets\*"; DestDir: "{app}\assets"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "Launch BXB Client.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "Launch BXB Client.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\build\windows-runtime\python\*"; DestDir: "{app}\runtime\python"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\build\windows-runtime\ms-playwright\*"; DestDir: "{app}\runtime\ms-playwright"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\BXB Client"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall BXB Client"; Filename: "{uninstallexe}"
Name: "{autodesktop}\BXB Client"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch BXB Client"; Flags: nowait postinstall skipifsilent
