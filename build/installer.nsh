!addincludedir build

!macro customInstall
    SetShellVarContext all
    DetailPrint "Checking Visual C++ Redistributable requirements..."
    
    ; Check for VC++ Runtime 2022 (v143) - modern version
    SetRegView 64
    ReadRegStr $0 HKLM "SOFTWARE\Microsoft\VisualStudio\17.0\VC\Runtimes\X64" "Version"
    
    ; Fallback: check for older VC++ Runtime 2015-2022 (v140+)
    ${If} $0 == ''
        ReadRegStr $0 HKLM "SOFTWARE\Microsoft\VisualStudio\16.0\VC\Runtimes\X64" "Version"
    ${EndIf}
    
    ${If} $0 == ''
        ReadRegStr $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Version"
    ${EndIf}
    
    SetRegView 32
    
    ${If} $0 != ''
        DetailPrint "VC++ Redistributable found (Version: $0)"
        Goto InstallComplete
    ${EndIf}
    
    DetailPrint "VC++ Redistributable 2022 (v143) not found. Downloading..."
    
    ; Download VC++ Redistributable 2022 x64
    inetc::get /TIMEOUT=30000 "https://aka.ms/vs/17/release/vc_redist.x64.exe" "$PLUGINSDIR\vcredist.exe" /END
    Pop $1
    
    ${If} $1 != "OK"
        DetailPrint "Warning: Failed to download VC++ Redistributable ($1). Continuing..."
        ; Try to continue anyway, user might have it installed
        Goto InstallComplete
    ${EndIf}
    
    DetailPrint "Installing Visual C++ Redistributable 2022 (x64)..."
    ExecWait '"$PLUGINSDIR\vcredist.exe" /install /quiet /norestart' $2
    
    ${If} $2 == 0
        DetailPrint "VC++ Redistributable installed successfully"
    ${Else}
        DetailPrint "Warning: VC++ Redistributable installation returned code $2 (may already be installed)"
    ${EndIf}
    
    ; Cleanup
    ${If} ${FileExists} "$PLUGINSDIR\vcredist.exe"
        Delete "$PLUGINSDIR\vcredist.exe"
    ${EndIf}
    
    InstallComplete:
    DetailPrint "Setup prerequisites check completed"
!macroend

!macro customUnInstall
    DetailPrint "Uninstalling Mechvibes..."
!macroend