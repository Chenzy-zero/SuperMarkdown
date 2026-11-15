!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\SuperMarkdown.Markdown\shell\open\command" "" '$\"$INSTDIR\SuperMarkdown.exe$\" $\"%1$\"'
  WriteRegStr SHELL_CONTEXT "Software\SuperMarkdown\Capabilities" "ApplicationName" "SuperMarkdown"
  WriteRegStr SHELL_CONTEXT "Software\SuperMarkdown\Capabilities" "ApplicationDescription" "Markdown editor"
  WriteRegStr SHELL_CONTEXT "Software\SuperMarkdown\Capabilities" "ApplicationIcon" "$INSTDIR\SuperMarkdown.exe,0"
  !insertmacro RegisterMarkdownCapability ".md"
  !insertmacro RegisterMarkdownCapability ".markdown"
  !insertmacro RegisterMarkdownCapability ".mdown"
  !insertmacro RegisterMarkdownCapability ".mkd"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "SuperMarkdown" "Software\SuperMarkdown\Capabilities"
!macroend

!macro RegisterMarkdownCapability EXT
  WriteRegStr SHELL_CONTEXT "Software\SuperMarkdown\Capabilities\FileAssociations" "${EXT}" "SuperMarkdown.Markdown"
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "SuperMarkdown"
  DeleteRegKey SHELL_CONTEXT "Software\SuperMarkdown\Capabilities"
  DeleteRegKey /ifempty SHELL_CONTEXT "Software\SuperMarkdown"
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "打开默认应用设置，选择 SuperMarkdown"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION OpenMarkdownDefaults
  !insertmacro MUI_PAGE_FINISH
!macroend

!ifndef BUILD_UNINSTALLER
Function OpenMarkdownDefaults
  ExecShell "open" "ms-settings:defaultapps"
FunctionEnd
!endif
