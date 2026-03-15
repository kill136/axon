[Setup]
AppName=Axon
AppVersion={#AppVersion}
AppPublisher=Axon
AppPublisherURL=https://github.com/kill136/axon
DefaultDirName={autopf}\Axon
DefaultGroupName=Axon
UninstallDisplayIcon={app}\Axon.exe
OutputDir=.
OutputBaseFilename=Axon-Setup
Compression=lzma2/ultra64
SolidCompression=yes
SetupIconFile=electron\icon.ico
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
WizardStyle=modern
DisableProgramGroupPage=yes

[Files]
Source: "release\axon-portable\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Axon"; Filename: "{app}\Axon.exe"
Name: "{autodesktop}\Axon"; Filename: "{app}\Axon.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Run]
Filename: "{app}\Axon.exe"; Description: "Launch Axon"; Flags: nowait postinstall skipifsilent
