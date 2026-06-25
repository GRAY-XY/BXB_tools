Unicode true
RequestExecutionLevel user

!ifndef APP_VERSION
  !define APP_VERSION "0.0.0"
!endif
!ifndef APP_VERSION_NUMERIC
  !define APP_VERSION_NUMERIC "0.0.0.0"
!endif
!ifndef SOURCE_DIR
  !error "SOURCE_DIR is required"
!endif
!ifndef OUT_FILE
  !error "OUT_FILE is required"
!endif

!define PRODUCT_NAME "BXB Homework"
!define PRODUCT_PUBLISHER "GRAY-XY"
!define PRODUCT_KEY "Software\GRAY-XY\BXB Homework"

Name "${PRODUCT_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\BXB Homework"
InstallDirRegKey HKCU "${PRODUCT_KEY}" "InstallDir"
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${APP_VERSION_NUMERIC}"
VIAddVersionKey /LANG=1033 "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey /LANG=1033 "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey /LANG=1033 "FileDescription" "${PRODUCT_NAME} Installer"
VIAddVersionKey /LANG=1033 "ProductVersion" "${APP_VERSION}"

Section "Install"
  SetOutPath "$TEMP"
  RMDir /r "$INSTDIR"
  CreateDirectory "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${SOURCE_DIR}\*.*"

  WriteRegStr HKCU "${PRODUCT_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${PRODUCT_KEY}" "Version" "${APP_VERSION}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  Delete "$DESKTOP\BXB Homework WinUI.lnk"
  Delete "$SMPROGRAMS\BXB Homework WinUI\BXB Homework WinUI.lnk"
  RMDir "$SMPROGRAMS\BXB Homework WinUI"
  CreateDirectory "$SMPROGRAMS\BXB Homework"
  CreateShortcut "$SMPROGRAMS\BXB Homework\BXB Homework.lnk" "$INSTDIR\BXBHomework.exe"
  CreateShortcut "$DESKTOP\BXB Homework.lnk" "$INSTDIR\BXBHomework.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\BXB Homework.lnk"
  Delete "$DESKTOP\BXB Homework WinUI.lnk"
  Delete "$SMPROGRAMS\BXB Homework\BXB Homework.lnk"
  Delete "$SMPROGRAMS\BXB Homework WinUI\BXB Homework WinUI.lnk"
  RMDir "$SMPROGRAMS\BXB Homework"
  RMDir "$SMPROGRAMS\BXB Homework WinUI"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${PRODUCT_KEY}"
SectionEnd
