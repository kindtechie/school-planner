#define AppName "HamDars"
#define AppVersion "1.0.0"

[Setup]
AppId={{D99DB9E4-5134-47E5-B4A4-A2A168319126}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=HamDars
DefaultDirName={localappdata}\Programs\HamDars
DefaultGroupName=HamDars
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=HamDars-Setup-1.0.0-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\HamDars.exe
CloseApplications=yes

[Files]
Source: "..\dist\HamDars\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: checkedonce

[Icons]
Name: "{group}\HamDars"; Filename: "{app}\HamDars.exe"
Name: "{autodesktop}\HamDars"; Filename: "{app}\HamDars.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\HamDars.exe"; Description: "Open HamDars"; Flags: nowait postinstall skipifsilent

; User data is deliberately outside {app}; uninstall does not delete schools.
