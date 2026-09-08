; Runtime payload is pinned and verified during packaging, then embedded here.
; No network download is performed on the user's machine.
!include "LogicLib.nsh"
!include "WordFunc.nsh"
!include "${BUILD_RESOURCES_DIR}\vendor\windows-runtime.nsh"

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customHeader
  ShowInstDetails show
  !ifdef BUILD_UNINSTALLER
    ShowUninstDetails show
  !else
    LangString MV_RuntimeConsent ${LANG_ENGLISH} "Mechvibes requires Microsoft Visual C++ Runtime ${MV_VC_VERSION} or newer. Setup includes a verified copy and will request permission to install it. Continue?"
    LangString MV_RuntimeConsent ${LANG_RUSSIAN} "Для Mechvibes необходим Microsoft Visual C++ Runtime ${MV_VC_VERSION} или новее. Проверенная копия включена в установщик. Для её установки потребуется разрешение администратора. Продолжить?"
    LangString MV_RuntimeFailure ${LANG_ENGLISH} "Visual C++ Runtime installation failed or was canceled. The existing Mechvibes installation has not been changed. Restart Windows if another installation is pending, then try again. Details:"
    LangString MV_RuntimeFailure ${LANG_RUSSIAN} "Установка Visual C++ Runtime завершилась ошибкой или отменена. Существующая установка Mechvibes не изменена. Если другая установка ожидает завершения, перезагрузите Windows и повторите попытку. Подробности:"

    Function MechvibesRuntimeIsCurrent
      Push $0
      Push $1
      Push $2
      SetRegView 64
      ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
      ReadRegStr $1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Version"
      SetRegView lastused
      StrCpy $2 "0"
      ${If} $0 == 1
      ${AndIf} $1 != ""
        StrCpy $0 $1 1
        ${If} $0 == "v"
          StrCpy $1 $1 "" 1
        ${EndIf}
        ${VersionCompare} "$1" "${MV_VC_VERSION}" $0
        ${If} $0 != 2
          StrCpy $2 "1"
        ${EndIf}
      ${EndIf}
      StrCpy $R9 $2
      Pop $2
      Pop $1
      Pop $0
    FunctionEnd

    ; A hidden section BEFORE electron-builder's installation section means
    ; prerequisite failure cannot uninstall/overwrite the previous application.
    Section "-Visual C++ Runtime" MV_PREREQUISITES
      Call MechvibesRuntimeIsCurrent
      ${If} $R9 == "1"
        DetailPrint "A compatible Microsoft Visual C++ Runtime is already installed."
        Goto mv_runtime_done
      ${EndIf}
      ${If} ${Silent}
        ${IfNot} ${UAC_IsAdmin}
          DetailPrint "Runtime installation requires elevation. Provision the runtime before silent per-user installation."
          SetErrorLevel 740
          Abort
        ${EndIf}
      ${Else}
        MessageBox MB_OKCANCEL|MB_ICONINFORMATION "$(MV_RuntimeConsent)" /SD IDCANCEL IDOK mv_runtime_install
        SetErrorLevel 1223
        Abort
      ${EndIf}
      mv_runtime_install:
      InitPluginsDir
      File /oname=$PLUGINSDIR\vc_redist.x64.exe "${BUILD_RESOURCES_DIR}\vendor\vc_redist.x64.exe"
      ${StdUtils.HashFile} $R0 "SHA2-256" "$PLUGINSDIR\vc_redist.x64.exe"
      ${If} $R0 != "${MV_VC_SHA256}"
        StrCpy $R2 "Runtime integrity check failed"
        Goto mv_runtime_failed
      ${EndIf}
      DetailPrint "Installing Microsoft Visual C++ Runtime ${MV_VC_VERSION}..."
      ${StdUtils.ExecShellWaitEx} $R0 $R1 "$PLUGINSDIR\vc_redist.x64.exe" "runas" "/install /quiet /norestart"
      ${If} $R0 != "ok"
        StrCpy $R2 "Runtime could not start ($R0 / $R1)"
        Goto mv_runtime_failed
      ${EndIf}
      ${StdUtils.WaitForProcEx} $R2 $R1
      Delete "$PLUGINSDIR\vc_redist.x64.exe"
      ${If} $R2 == 3010
      ${OrIf} $R2 == 1641
        SetRebootFlag true
        DetailPrint "Windows restart is required to finish installing the runtime."
      ${ElseIf} $R2 != 0
        ; 1638 is acceptable only if the installed runtime actually meets the minimum.
        ${If} $R2 != 1638
          Goto mv_runtime_failed
        ${EndIf}
      ${EndIf}
      Call MechvibesRuntimeIsCurrent
      ${If} $R9 != "1"
        StrCpy $R2 "Runtime version could not be verified after installation"
        Goto mv_runtime_failed
      ${EndIf}
      Goto mv_runtime_done
      mv_runtime_failed:
        Delete "$PLUGINSDIR\vc_redist.x64.exe"
        DetailPrint "$(MV_RuntimeFailure) $R2"
        MessageBox MB_OK|MB_ICONSTOP "$(MV_RuntimeFailure) $R2" /SD IDOK
        SetErrorLevel 1603
        Abort
      mv_runtime_done:
    SectionEnd
  !endif
!macroend

!macro customUnInstall
  ; Keep settings/custom soundpacks; never remove a system-wide shared runtime.
  DetailPrint "Removing Mechvibes. User settings, custom soundpacks and shared runtimes are preserved."
!macroend
