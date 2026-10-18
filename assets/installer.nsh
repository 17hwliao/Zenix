; Included by electron-builder's standard installer AND signed uninstaller.
!define ZENIX_NSIS_RESOURCES "${__FILEDIR__}"

!macro customHeader
  ; Prefer the generated installUtil.nsh without replacing the standard NSIS
  ; script (a custom script would disable electron-builder's uninstaller signing).
  !addincludedir "${ZENIX_NSIS_RESOURCES}\..\node_modules\app-builder-lib\templates\nsis"
  !cd "${ZENIX_NSIS_RESOURCES}\..\release\windows-installer"
  ShowInstDetails show
  !ifdef BUILD_UNINSTALLER
    ShowUninstDetails show
    !define ZENIX_RUNNING_FUNCTION "un.ZenixFindRunningApp"
  !else
    !define ZENIX_RUNNING_FUNCTION "ZenixFindRunningApp"
  !endif
  !insertmacro ZenixRunningFunction
  !ifndef BUILD_UNINSTALLER
    !insertmacro ZenixLegacyLauncherFunction
  !endif
!macroend

; Historical uninstallers run PowerShell availability checks BEFORE checking
; their executable name. Run their unchanged bytes in a one-process job so
; those optional shell probes fail immediately, without starting a profile.
; _?= keeps NSIS in this process; the audited standard uninstall uses no child
; process for file/registry/shortcut work. No user process is added to this job.
!macro ZenixLegacyLauncherFunction
Function ZenixExecLegacyUninstaller
  System::Store S
  Pop $1 ; executable
  Pop $0 ; complete command line, including KEEP_APP_DATA / --updated / _?=
  StrCpy $9 -1
  StrCpy $7 0
  StrCpy $8 0
  System::Call 'kernel32::CreateJobObjectW(p 0, p 0) p.r2'
  System::Alloc 48
  Pop $3
  System::Alloc 68
  Pop $4
  System::Alloc 16
  Pop $5
  IntOp $R0 ${NSIS_MAX_STRLEN} * 2
  System::Alloc $R0
  Pop $6
  ${If} $2 == 0
  ${OrIf} $3 == 0
  ${OrIf} $4 == 0
  ${OrIf} $5 == 0
  ${OrIf} $6 == 0
    Goto zenix_legacy_cleanup
  ${EndIf}
  ; x86 JOBOBJECT_BASIC_LIMIT_INFORMATION: active-process limit is one.
  System::Call '*$3(l 0, l 0, i 8, p 0, p 0, i 1, p 0, i 0, i 0, i 0)'
  System::Call 'kernel32::SetInformationJobObject(p r2, i 2, p r3, i 48) i.R0'
  ${If} $R0 == 0
    Goto zenix_legacy_cleanup
  ${EndIf}
  System::Call '*$4(i 68, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0)'
  System::Call '*$6(&w${NSIS_MAX_STRLEN} r0)'
  ; Suspend before assigning the job: no shell or uninstall code can race it.
  System::Call 'kernel32::CreateProcessW(w r1, p r6, p 0, p 0, i 0, i 4, p 0, p 0, p r4, p r5) i.R0'
  ${If} $R0 == 0
    Goto zenix_legacy_cleanup
  ${EndIf}
  System::Call '*$5(p.r7, p.r8, i, i)'
  System::Call 'kernel32::AssignProcessToJobObject(p r2, p r7) i.R0'
  ${If} $R0 == 0
    Goto zenix_legacy_not_started
  ${EndIf}
  System::Call 'kernel32::ResumeThread(p r8) i.R0'
  ${If} $R0 == -1
    Goto zenix_legacy_not_started
  ${EndIf}
  ; Wait for a real exit, never time out file migration halfway through.
  System::Call 'kernel32::WaitForSingleObject(p r7, i -1) i.R0'
  ${If} $R0 == 0
    System::Call 'kernel32::GetExitCodeProcess(p r7, *i .r9) i.R0'
    ${If} $R0 == 0
      StrCpy $9 -1
    ${EndIf}
  ${EndIf}
  Goto zenix_legacy_cleanup
  zenix_legacy_not_started:
  ; Only this newly-created, still-suspended helper can be terminated here.
  System::Call 'kernel32::TerminateProcess(p r7, i 2)'
  zenix_legacy_cleanup:
  ${If} $8 != 0
    System::Call 'kernel32::CloseHandle(p r8)'
  ${EndIf}
  ${If} $7 != 0
    System::Call 'kernel32::CloseHandle(p r7)'
  ${EndIf}
  ${If} $2 != 0
    System::Call 'kernel32::CloseHandle(p r2)'
  ${EndIf}
  System::Free $3
  System::Free $4
  System::Free $5
  System::Free $6
  Push $9
  System::Store L
FunctionEnd
!macroend

; PROCESSENTRY32W is 556 bytes in the x86 NSIS host, even for an x64 app.
; Enumerate locally with Toolhelp; never depend on WMI, CIM or a shell profile.
; Return 0 = clear, 1 = running in this install directory, -1 = query failed.
!macro ZenixRunningFunction
Function ${ZENIX_RUNNING_FUNCTION}
  System::Store S
  StrCpy $9 -1
  GetFullPathName $8 "$INSTDIR\"
  StrLen $7 $8
  System::Call 'kernel32::GetCurrentProcessId() i.r6'
  System::Call 'kernel32::CreateToolhelp32Snapshot(i 2, i 0) p.r0'
  ${If} $0 != -1
    System::Alloc 556
    Pop $1
    ${If} $1 != 0
      System::Call '*$1(i 556)'
      System::Call 'kernel32::Process32FirstW(p r0, p r1) i.r2 ?e'
      Pop $R0
      ${While} $2 != 0
        System::Call '*$1(i, i, i.r3, i, i, i, i, i, i, &w260.r4)'
        ${If} $3 != $6
        ${AndIf} $4 == "${APP_EXECUTABLE_FILENAME}"
          System::Call 'kernel32::OpenProcess(i 0x1000, i 0, i r3) p.r5 ?e'
          Pop $R0
          ${If} $5 == 0
            ; A process may disappear between snapshot and OpenProcess.
            ${If} $R0 != 87
              Goto zenix_running_done
            ${EndIf}
          ${Else}
            System::Call 'kernel32::QueryFullProcessImageNameW(p r5, i 0, w .r4, *i ${NSIS_MAX_STRLEN}) i.r2'
            System::Call 'kernel32::CloseHandle(p r5)'
            ${If} $2 == 0
              Goto zenix_running_done
            ${EndIf}
            StrCpy $4 $4 $7
            ${If} $4 == $8
              StrCpy $9 1
              Goto zenix_running_done
            ${EndIf}
          ${EndIf}
        ${EndIf}
        System::Call 'kernel32::Process32NextW(p r0, p r1) i.r2 ?e'
        Pop $R0
      ${EndWhile}
      ${If} $R0 == 18
        StrCpy $9 0
      ${EndIf}
      zenix_running_done:
      System::Free $1
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r0)'
  ${EndIf}
  Push $9
  System::Store L
FunctionEnd
!macroend

!macro customCheckAppRunning
  SetDetailsPrint textonly
  DetailPrint "检查 Zenix 是否已经退出…"
  zenix_check_running:
  Call ${ZENIX_RUNNING_FUNCTION}
  Pop $R0
  ${If} $R0 == 1
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "请先从托盘菜单退出 Zenix，再点击重试。安装不会清空你的资料。" /SD IDCANCEL IDRETRY zenix_check_running
    SetErrorLevel 2
    Quit
  ${ElseIf} $R0 != 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法确认 Zenix 是否已经退出。请关闭 Zenix 后重试；本次尚未替换程序文件。" /SD IDCANCEL IDRETRY zenix_check_running
    SetErrorLevel 2
    Quit
  ${EndIf}
  DetailPrint "检查完成，正在保留资料并更新程序文件…"
!macroend
