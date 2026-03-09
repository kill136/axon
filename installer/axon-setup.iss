; Axon Desktop - Inno Setup Script
; Builds a standard Windows installer from the portable build output.
;
; Prerequisites:
;   1. Run build-portable.ps1 first to generate release\axon-portable\
;   2. Ensure electron\icon.ico exists (run: build-installer.ps1 which handles this)
;   3. Install Inno Setup 6 from https://jrsoftware.org/isdl.php
;
; Usage:
;   iscc installer\axon-setup.iss
;
; Or use the all-in-one script:
;   .\build-installer.ps1

#define MyAppName "Axon"
#define MyAppVersion "2.1.42"
#define MyAppPublisher "Axon"
#define MyAppURL "https://github.com/anthropics/claude-code"
#define MyAppExeName "Axon.exe"

[Setup]
AppId={{B8F3A2D1-7E4C-4F9A-8B5D-1C6E3A9F0D2B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
; Allow user to choose if they want a desktop icon
AllowNoIcons=yes
; Output installer file
OutputDir=..\release
OutputBaseFilename=Axon-Setup
; Installer icon
SetupIconFile=..\electron\icon.ico
; Uninstaller icon
UninstallDisplayIcon={app}\{#MyAppExeName}
; Compression
Compression=lzma2/fast
SolidCompression=yes
LZMANumBlockThreads=4
DiskSpanning=no
; Modern wizard style
WizardStyle=modern
; 64-bit only
ArchitecturesAllowed=x64
; Require admin for Program Files, but also support per-user install
PrivilegesRequiredOverridesAllowed=dialog
PrivilegesRequired=lowest
; Don't create an uninstall registry entry under HKLM if per-user
UninstallDisplayName={#MyAppName}
; Minimum Windows 10
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "addtopath"; Description: "Add Axon to PATH"; GroupDescription: "System Integration:"; Flags: unchecked

[Files]
; Copy the entire portable build directory
Source: "..\release\axon-portable\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Start menu shortcut
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
; Desktop shortcut (optional)
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; Option to launch after install
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[Registry]
; Add to PATH if user selected the task
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; Tasks: addtopath; Check: NeedsAddPath(ExpandConstant('{app}'))

[Code]
// Check if the path is already in PATH to avoid duplicates
function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', OrigPath) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Param + ';', ';' + OrigPath + ';') = 0;
end;

// Remove from PATH on uninstall
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  OrigPath, AppPath: string;
  P: Integer;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    if RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', OrigPath) then
    begin
      AppPath := ExpandConstant('{app}');
      P := Pos(';' + AppPath, OrigPath);
      if P > 0 then
      begin
        Delete(OrigPath, P, Length(';' + AppPath));
        RegWriteStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', OrigPath);
      end;
    end;
  end;
end;
