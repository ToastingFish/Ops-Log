Option Explicit

'====================================================
'TYPES
'====================================================
Private Type ShiftInfo
    CurrentRota As String
    IncomingRota As String
    ShiftLabel As String
    ShiftStartDate As Date
    ShiftEndDate As Date
End Type

Private Type ReportRow
    T As String
    Left1 As String
    Left2 As String
    Left3 As String
    Job As String
    RightT As String
    Remarks As String
    IsP3 As Boolean
    IsApplianceName As Boolean
End Type

Private Type ApplianceInfo
    Code As String
    Rank As String
    PersonName As String
End Type

Private Type PersonInfo
    PersonId As Long
    Rank As String
    PersonName As String
End Type

Private Type TurnoutEntry
    TurnoutType As String
    PersonId As Long
    Times(1 To 5) As String
    TimesBlocked(1 To 5) As Boolean
End Type

Private Type ParsedInput
    IsValid As Boolean
    ErrorMsg As String
    ShiftIsAuto As Boolean
    OverrideDate As Date
    OverrideShiftChar As String
    CurrentPersonId As Long
    IncomingPersonId As Long
    TurnoutCount As Long
    RedconCount As Long
    ' Note: TurnoutList, RedconList and People are stored as module-level variables
    ' to avoid VBA's shallow-copy bug when returning UDTs with dynamic arrays.
End Type

' Module-level Turnout storage — populated by ParseClipboardString, consumed by Build*Report.
Private m_TurnoutList() As TurnoutEntry
Private m_TurnoutCount As Long

' Module-level REDCON storage — populated by ParseClipboardString, consumed by BuildNightReport.
Private m_RedconList() As ApplianceInfo
Private m_RedconCount As Long

' Module-level People database — alpha manning OICs + turnout activators.
' Populated from the inline PEOPLE section in the clipboard string.
Private m_People() As PersonInfo
Private m_PersonCount As Long

' Module-level Rota People database — shift ICs (current + incoming).
' Loaded from inline ROTA_PEOPLE section in clipboard.
Private m_RotaPeople() As PersonInfo
Private m_RotaPersonCount As Long

' Module-level Appliances list — loaded from appliances.csv; used as fallback when no REDCON data.
Private m_AppliancesCodes() As String
Private m_ApplianceCount As Long

'====================================================
'CLIPBOARD STRING FORMAT (version 3)
'
'  Fields (0-based index, pipe-delimited):
'  0  OPSLOG
'  1  3                         (version)
'  2  AUTO | OVERRIDE
'  3  YYYY-MM-DD-D/N or blank   (override spec)
'  4  current IC person ID
'  5  incoming IC person ID
'  6  TURNOUTS                  (section header)
'  7  N                         (turnout count)
'  For each turnout i = 0..N-1, 7 fields starting at 8+(i*7):
'    type, personId, t1, t2, t3, t4, t5
'  8+N*7  REDCON count
'  ...    A4xx code, personId   (2 fields per appliance)
'  PEOPLE  n  id rank name ...
'  ROTA_PEOPLE  n  id rota rank name ...
'
'  All validation is done in the front-end.
'  VBA only checks format integrity and looks up names from the inline PEOPLE section.
'====================================================

'====================================================
'MAIN MACRO
'====================================================
Public Sub GenerateFromClipboard()

    On Error GoTo ErrorHandler

    Dim ws As Worksheet
    Set ws = ActiveSheet

    Dim rawText As String
    rawText = ReadClipboard()

    If Left(rawText, 7) <> "OPSLOG|" Then
        MsgBox "The clipboard does not contain a valid Ops Log code." & vbCrLf & vbCrLf & _
               "Please generate and copy the code from the Ops Log control panel first.", _
               vbCritical, "Invalid Clipboard"
        Exit Sub
    End If

    LoadAppliancesDatabase

    Dim parsed As ParsedInput
    ParseClipboardString rawText, parsed

    If Not parsed.IsValid Then
        MsgBox "Could not read the Ops Log code:" & vbCrLf & vbCrLf & parsed.ErrorMsg, _
               vbCritical, "Parse Error"
        Exit Sub
    End If

    Dim info As ShiftInfo
    If parsed.ShiftIsAuto Then
        info = GetCurrentShiftInfo(0, "")
    Else
        Dim mappedChar As String
        mappedChar = IIf(parsed.OverrideShiftChar = "D", "A", "P")
        info = GetCurrentShiftInfo(parsed.OverrideDate, mappedChar)
    End If

    ' Current and incoming ICs come from the rota people DB (separate from alpha manning).
    Dim currentIC As String
    Dim nextIC As String
    currentIC = FormatPersonName(LookupRotaPersonById(parsed.CurrentPersonId))
    nextIC    = FormatPersonName(LookupRotaPersonById(parsed.IncomingPersonId))

    Dim baseCol As Long
    baseCol = 2

    Dim baseRow As Long
    Dim previousHeaderRow As Long
    Dim previousFooterRow As Long
    Dim previousShiftLabel As String
    Dim previousEndSerial As Long
    Dim wasGeneratedSeparately As Boolean
    wasGeneratedSeparately = False

    If Not GetAppendStart(ws, baseCol, info, Not parsed.ShiftIsAuto, baseRow, _
                          previousHeaderRow, previousFooterRow, previousShiftLabel, _
                          previousEndSerial, wasGeneratedSeparately) Then
        Exit Sub
    End If

    If previousFooterRow > 0 Then
        UpdatePreviousIncomingIC ws, previousHeaderRow, previousFooterRow, baseCol, currentIC
    End If

    Dim firstSerial As Long
    If wasGeneratedSeparately Then
        ' Gap detected — do not continue numbering from the old block; use the shift default.
        firstSerial = IIf(info.ShiftLabel = "Night", 34, 15)
    ElseIf previousEndSerial > 0 Then
        firstSerial = previousEndSerial + 1
    Else
        firstSerial = IIf(info.ShiftLabel = "Night", 34, 15)
    End If

    Application.ScreenUpdating = False
    Application.DisplayAlerts = False

    If previousFooterRow = 0 Then
        ClearOutputArea ws, baseRow, baseCol
    End If

    SetCommonColumnWidths ws, baseCol, (info.ShiftLabel = "Day")

    If info.ShiftLabel = "Day" Then
        BuildDayReport ws, baseRow, baseCol, info, currentIC, nextIC, firstSerial, parsed
    Else
        BuildNightReport ws, baseRow, baseCol, info, currentIC, nextIC, firstSerial, parsed
    End If

    WriteReportMetadata ws, baseRow, baseCol, info, firstSerial

    ' ---- Re-enable display before post-generation steps ----
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True

    ' Locate the footer row of the newly written report
    Dim newFooterRow As Long
    newFooterRow = FindLatestTakenOverRow(ws, baseCol)

    ' Scroll to the header of the newly generated report so the full table is visible
    Application.Goto ws.Cells(baseRow, baseCol), True
    ws.Cells(baseRow, baseCol).Select

    ' Copy the generated table to the clipboard so the user can paste it if needed
    If newFooterRow > 0 And newFooterRow >= baseRow Then
        ws.Range(ws.Cells(baseRow, baseCol), ws.Cells(newFooterRow, baseCol + 10)).Copy
    End If

    ' Confirm to the user, noting whether the log was separated from the previous report
    If wasGeneratedSeparately Then
        MsgBox "The ops log you requested does not follow on directly from the previous " & _
               "report on this sheet." & vbCrLf & vbCrLf & _
               "It has been generated at the bottom with a gap separating it from the " & _
               "earlier report." & vbCrLf & vbCrLf & _
               "The generated table has been copied to your clipboard.", _
               vbInformation, "Ops Log Generated (Out of Sequence)"
    Else
        MsgBox "Ops log generated successfully." & vbCrLf & vbCrLf & _
               "The generated table has been copied to your clipboard.", _
               vbInformation, "Ops Log Generated"
    End If

    Exit Sub

ErrorHandler:
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
    MsgBox "An unexpected error occurred." & vbCrLf & vbCrLf & _
           "Error " & Err.Number & ": " & Err.Description, _
           vbCritical, "Macro Error"

End Sub

'====================================================
'CLIPBOARD READING
'====================================================
Private Function ReadClipboard() As String
    Dim obj As Object
    On Error GoTo Fallback
    Set obj = CreateObject("htmlfile")
    ReadClipboard = obj.ParentWindow.ClipboardData.GetData("text")
    Set obj = Nothing
    Exit Function
Fallback:
    ReadClipboard = ""
End Function

'====================================================
'PARSE CLIPBOARD STRING
'====================================================
Private Sub ParseClipboardString(ByVal raw As String, ByRef result As ParsedInput)

    result.IsValid = False
    m_TurnoutCount = 0
    m_RedconCount = 0
    m_PersonCount = 0
    m_RotaPersonCount = 0

    Dim parts() As String
    parts = Split(Trim(raw), "|")

    If UBound(parts) < 8 Then
        result.ErrorMsg = "Code is too short. Please regenerate from the control panel."
        Exit Sub
    End If

    If Trim(parts(1)) <> "3" Then
        result.ErrorMsg = "This code was generated by an incompatible version of the control panel." & vbCrLf & _
                          "Please refresh the control panel and regenerate the code."
        Exit Sub
    End If

    ' ================================================================
    ' PRE-PASS: scan from index 6 onward for PEOPLE and ROTA_PEOPLE.
    ' This ensures LookupPersonById() works when parsing REDCON entries.
    ' ================================================================
    Dim ps As Long
    For ps = 6 To UBound(parts)

        Select Case UCase(Trim(parts(ps)))

            Case "PEOPLE"
                If UBound(parts) >= ps + 1 Then
                    If IsNumeric(Trim(parts(ps + 1))) Then
                        Dim pplCnt As Long
                        pplCnt = CLng(Trim(parts(ps + 1)))
                        Dim ppi As Long
                        For ppi = 1 To pplCnt
                            Dim pOff As Long
                            pOff = ps + 2 + (ppi - 1) * 3
                            If UBound(parts) >= pOff + 2 Then
                                If IsNumeric(Trim(parts(pOff))) Then
                                    Dim ppId As Long
                                    ppId = CLng(Trim(parts(pOff)))
                                    Dim ppExists As Boolean
                                    ppExists = False
                                    Dim psc As Long
                                    For psc = 1 To m_PersonCount
                                        If m_People(psc).PersonId = ppId Then
                                            ppExists = True
                                            Exit For
                                        End If
                                    Next psc
                                    If Not ppExists Then
                                        m_PersonCount = m_PersonCount + 1
                                        ReDim Preserve m_People(1 To m_PersonCount)
                                        m_People(m_PersonCount).PersonId   = ppId
                                        m_People(m_PersonCount).Rank       = Trim(parts(pOff + 1))
                                        m_People(m_PersonCount).PersonName = Trim(parts(pOff + 2))
                                    End If
                                End If
                            End If
                        Next ppi
                    End If
                End If

            Case "ROTA_PEOPLE"
                If UBound(parts) >= ps + 1 Then
                    If IsNumeric(Trim(parts(ps + 1))) Then
                        Dim rpCnt As Long
                        rpCnt = CLng(Trim(parts(ps + 1)))
                        Dim rpi As Long
                        For rpi = 1 To rpCnt
                            Dim rpOff As Long
                            rpOff = ps + 2 + (rpi - 1) * 4
                            If UBound(parts) >= rpOff + 3 Then
                                If IsNumeric(Trim(parts(rpOff))) Then
                                    m_RotaPersonCount = m_RotaPersonCount + 1
                                    ReDim Preserve m_RotaPeople(1 To m_RotaPersonCount)
                                    m_RotaPeople(m_RotaPersonCount).PersonId   = CLng(Trim(parts(rpOff)))
                                    ' parts(rpOff+1) = rota name (informational)
                                    m_RotaPeople(m_RotaPersonCount).Rank       = Trim(parts(rpOff + 2))
                                    m_RotaPeople(m_RotaPersonCount).PersonName = Trim(parts(rpOff + 3))
                                End If
                            End If
                        Next rpi
                    End If
                End If

        End Select
    Next ps

    ' ================================================================
    ' MAIN SEQUENTIAL PARSE
    ' ================================================================

    Select Case UCase(Trim(parts(2)))
        Case "AUTO"
            result.ShiftIsAuto = True
        Case "OVERRIDE"
            result.ShiftIsAuto = False
            Dim spec As String
            spec = Trim(parts(3))
            If Len(spec) < 12 Then
                result.ErrorMsg = "Invalid override date in code."
                Exit Sub
            End If
            On Error GoTo BadDate
            result.OverrideDate = DateSerial(CLng(Left(spec, 4)), CLng(Mid(spec, 6, 2)), CLng(Mid(spec, 9, 2)))
            result.OverrideShiftChar = UCase(Right(spec, 1))
            On Error GoTo 0
        Case Else
            result.ErrorMsg = "Unknown shift type in code: " & parts(2)
            Exit Sub
    End Select

    If Not IsNumeric(Trim(parts(4))) Then
        result.ErrorMsg = "Invalid current IC person ID in code."
        Exit Sub
    End If
    result.CurrentPersonId = CLng(Trim(parts(4)))

    If Not IsNumeric(Trim(parts(5))) Then
        result.ErrorMsg = "Invalid incoming IC person ID in code."
        Exit Sub
    End If
    result.IncomingPersonId = CLng(Trim(parts(5)))

    ' Expect TURNOUTS header at index 6
    If UCase(Trim(parts(6))) <> "TURNOUTS" Then
        result.ErrorMsg = "Expected TURNOUTS section at position 6. Please regenerate the code."
        Exit Sub
    End If

    If Not IsNumeric(Trim(parts(7))) Then
        result.ErrorMsg = "Invalid turnout count in code."
        Exit Sub
    End If

    Dim tCount As Long
    tCount = CLng(Trim(parts(7)))
    result.TurnoutCount = tCount
    m_TurnoutCount = tCount

    ' Each turnout is 7 fields: type, personId, t1..t5
    Dim redconIdx As Long
    redconIdx = 8 + tCount * 7

    If tCount > 0 Then
        If UBound(parts) < redconIdx - 1 Then
            result.ErrorMsg = "Turnout data is incomplete in code."
            Exit Sub
        End If
        ReDim m_TurnoutList(1 To tCount)
        Dim ti As Long
        For ti = 1 To tCount
            Dim tBase As Long
            tBase = 8 + (ti - 1) * 7
            m_TurnoutList(ti).TurnoutType = Trim(parts(tBase))
            If IsNumeric(Trim(parts(tBase + 1))) Then
                m_TurnoutList(ti).PersonId = CLng(Trim(parts(tBase + 1)))
            End If
            Dim si As Integer
            For si = 1 To 5
                Dim tVal As String
                tVal = Trim(parts(tBase + 1 + si))
                If UCase(tVal) = "BLOCKED" Then
                    m_TurnoutList(ti).TimesBlocked(si) = True
                    m_TurnoutList(ti).Times(si) = ""
                Else
                    m_TurnoutList(ti).TimesBlocked(si) = False
                    m_TurnoutList(ti).Times(si) = tVal
                End If
            Next si
        Next ti
    End If

    ' REDCON count immediately follows turnout data
    If UBound(parts) < redconIdx Then
        result.ErrorMsg = "Invalid REDCON count in code."
        Exit Sub
    End If

    If Not IsNumeric(Trim(parts(redconIdx))) Then
        result.ErrorMsg = "Invalid REDCON count in code."
        Exit Sub
    End If

    result.RedconCount = CLng(Trim(parts(redconIdx)))
    m_RedconCount = result.RedconCount

    If m_RedconCount > 0 Then
        If UBound(parts) < redconIdx + m_RedconCount * 2 Then
            result.ErrorMsg = "REDCON data is incomplete in code."
            Exit Sub
        End If
        ReDim m_RedconList(1 To m_RedconCount)
        Dim k As Long
        Dim ri As Long
        ri = redconIdx + 1
        For k = 1 To m_RedconCount
            m_RedconList(k).Code = UCase(Trim(parts(ri)))
            If IsNumeric(Trim(parts(ri + 1))) Then
                Dim pid As Long
                pid = CLng(Trim(parts(ri + 1)))
                If pid > 0 Then
                    Dim p As PersonInfo
                    p = LookupPersonById(pid)
                    m_RedconList(k).Rank       = p.Rank
                    m_RedconList(k).PersonName = p.PersonName
                End If
            End If
            ri = ri + 2
        Next k
    End If

    result.IsValid = True
    Exit Sub

BadDate:
    result.ErrorMsg = "Invalid override date in code."

End Sub

'====================================================
'DAY REPORT
'====================================================
Private Sub BuildDayReport( _
    ByVal ws As Worksheet, _
    ByVal baseRow As Long, _
    ByVal baseCol As Long, _
    ByRef info As ShiftInfo, _
    ByVal currentIC As String, _
    ByVal nextIC As String, _
    ByVal firstSerial As Long, _
    ByRef parsed As ParsedInput)

    SetCommonColumnWidths ws, baseCol, True

    Dim rows() As ReportRow
    Dim n As Long
    n = 0

    AddRow rows, n, "0800", "-", "-", "-", "@Terminal", "0800", "All in order.", False, False
    AddRow rows, n, "0830", "-", "-", "-", "@Terminal", "0830", "All in order.", False, False
    AddRow rows, n, "0930", "-", "-", "-", "FCV CHECK", "0930", "All in order.", False, False
    AddRow rows, n, "1000", "-", "-", "CCTV", "@Terminal", "1000", "All in order.", False, False
    AddRow rows, n, "1030", "-", "-", "-", "FP AUDIT", "1030", "All in order.", False, False
    AddRow rows, n, "1100", "-", "-", "-", "@Terminal", "1100", "All in order.", False, False
    AddRow rows, n, "1200", "-", "-", "-", "@Terminal", "1200", "All in order.", False, False
    AddRow rows, n, "1300", "-", "-", "-", "Checking of Key Press", "1300", "All in order.", False, False
    AddRow rows, n, "1330", "-", "-", "-", "Updating of Reports", "1330", "All in order.", False, False
    AddRow rows, n, "1430", "-", "-", "-", "FP AUDIT", "1430", "All in order.", False, False
    AddRow rows, n, "1500", "-", "-", "CCTV", "@Terminal", "1500", "All in order.", False, False
    AddRow rows, n, "1600", "-", "-", "-", "Checking of Directives", "1600", "All in order.", False, False

    AddTurnoutRowsFromData rows, n, parsed

    AddRow rows, n, "1755", info.IncomingRota, info.CurrentRota, "PERS", _
        UCase(nextIC) & " TAKING OVER " & UCase(currentIC), "1755", "All in order.", False, False

    SortReportRows rows, n, "Day"

    Dim hotoStartRow As Long
    Dim hotoEndRow As Long
    Dim bottomRow As Long

    hotoStartRow = baseRow + n + 1
    hotoEndRow = hotoStartRow + 5
    bottomRow = hotoEndRow + 1

    FormatReportBlock ws, baseRow, baseCol, bottomRow, 10

    DrawHeader ws, baseRow, baseCol, "Taken over by " & info.CurrentRota

    Dim i As Long, r As Long
    For i = 1 To n
        r = baseRow + i
        DrawStandardRow ws, r, baseCol, firstSerial + i - 1, rows(i)
    Next i

    MergeRightICBlock ws, baseRow + 1, hotoStartRow - 1, baseCol + 10, currentIC

    DrawHOTO ws, hotoStartRow, hotoEndRow, baseCol, firstSerial + n, "1800", _
        info.CurrentRota, info.IncomingRota, _
        UCase(info.IncomingRota) & " TAKING OVER " & UCase(info.CurrentRota), _
        nextIC, True

    DrawFooter ws, bottomRow, baseCol, "Taken over by " & info.IncomingRota

End Sub

'====================================================
'NIGHT REPORT
'====================================================
Private Sub BuildNightReport( _
    ByVal ws As Worksheet, _
    ByVal baseRow As Long, _
    ByVal baseCol As Long, _
    ByRef info As ShiftInfo, _
    ByVal currentIC As String, _
    ByVal nextIC As String, _
    ByVal firstSerial As Long, _
    ByRef parsed As ParsedInput)

    SetCommonColumnWidths ws, baseCol, False

    ' The control panel always sends the full configured appliance list in the REDCON
    ' section (personId=0 for those with no IC assigned), so m_RedconList is the
    ' authoritative source.  appliances.csv is kept only as a last-resort fallback
    ' for old clipboard codes that pre-date this behaviour.
    Dim applianceList() As ApplianceInfo
    Dim applianceCount As Long
    Dim k As Long

    If m_RedconCount > 0 Then
        applianceCount = m_RedconCount
        ReDim applianceList(1 To applianceCount)
        For k = 1 To applianceCount
            applianceList(k) = m_RedconList(k)
        Next k
    ElseIf m_ApplianceCount > 0 Then
        ' Fallback: old clipboard with no appliance list — use appliances.csv with blank ICs.
        applianceCount = m_ApplianceCount
        ReDim applianceList(1 To applianceCount)
        Dim ak As Long
        For ak = 1 To applianceCount
            applianceList(ak).Code       = m_AppliancesCodes(ak)
            applianceList(ak).Rank       = ""
            applianceList(ak).PersonName = ""
        Next ak
    End If

    Dim rows() As ReportRow
    Dim n As Long
    n = 0

    AddRow rows, n, "1800", "-", "-", "-", "Maintaining cleanliness of RDR", "1800", "All in order.", False, False
    AddRow rows, n, "1900", "-", "-", "-", "Checking of key press", "1900", "All in order.", False, False
    AddRow rows, n, "2000", "-", "-", "-", "FP AUDIT", "2000", "All in order.", False, False
    AddRow rows, n, "2100", "-", "-", "-", "Checking of station Alphas", "2100", "All in order.", False, False

    AddRow rows, n, "2100", "-", "-", "-", "Check and Updated Appliances OIC -", "2100", "All in order.", False, False

    If applianceCount > 0 Then
        For k = 1 To applianceCount
            AddRow rows, n, "", "-", "-", "-", applianceList(k).Code & " " & ChrW(8211), "", "All in order.", False, True
        Next k
    End If

    AddRow rows, n, "2100", "-", "-", "-", "Check and Updated Appliances OIC", "2100", "All in order.", False, False
    AddRow rows, n, "2200", "-", "-", "-", "Checking of iDen & Batteries", "2200", "All in order.", False, False
    AddRow rows, n, "2300", "-", "-", "-", "Checking of iDen & Batteries", "2300", "All in order.", False, False
    AddRow rows, n, "2359", "-", "-", "-", "Maintaining cleanliness of RDR", "2359", "All in order.", False, False

    AddRow rows, n, "0000", "-", "-", "-", "@Terminal", "0000", "All in order.", False, False
    AddRow rows, n, "0110", "-", "-", "-", "@Terminal", "0110", "All in order.", False, False
    AddRow rows, n, "0150", "-", "-", "CCTV", "FP AUDIT", "0150", "All in order.", False, False
    AddRow rows, n, "0155", "-", "-", "-", "@Terminal", "0155", "All in order.", False, False
    AddRow rows, n, "0200", "-", "-", "-", "@Terminal", "0200", "All in order.", False, False
    AddRow rows, n, "0300", "-", "-", "-", "@Terminal", "0300", "All in order.", False, False
    AddRow rows, n, "0316", "-", "-", "-", "@Terminal", "0316", "All in order.", False, False
    AddRow rows, n, "0500", "-", "-", "-", "@Terminal", "0500", "All in order.", False, False
    AddRow rows, n, "0512", "-", "-", "-", "@Terminal", "0512", "All in order.", False, False
    AddRow rows, n, "0600", "-", "-", "-", "Checking of RDR Equipments", "0600", "All in order.", False, False
    AddRow rows, n, "0625", "-", "-", "-", "@Terminal", "0625", "All in order.", False, False
    AddRow rows, n, "0700", "-", "-", "-", "Fire and Rescue Statistics & FP Audit", "0700", "All in order.", False, False

    AddTurnoutRowsFromData rows, n, parsed

    AddRow rows, n, "0758", info.IncomingRota, info.CurrentRota, "-", _
        UCase(nextIC) & " TAKING OVER " & UCase(currentIC), "0758", "All in order.", False, False

    SortReportRows rows, n, "Night"

    Dim noticeStartRow As Long
    Dim noticeEndRow As Long
    Dim hotoStartRow As Long
    Dim hotoEndRow As Long
    Dim bottomRow As Long

    Dim after2359Index As Long
    after2359Index = FindLastRowIndexAtOrBefore(rows, n, "2359", "Night")

    noticeStartRow = baseRow + after2359Index + 1
    noticeEndRow = noticeStartRow + 2
    hotoStartRow = baseRow + n + 4
    hotoEndRow = hotoStartRow + 5
    bottomRow = hotoEndRow + 1

    FormatReportBlock ws, baseRow, baseCol, bottomRow, 10

    DrawHeader ws, baseRow, baseCol, "Taken over by " & info.CurrentRota

    Dim i As Long, outputRow As Long, serialNum As Long
    outputRow = baseRow

    For i = 1 To n
        If i = after2359Index + 1 Then
            DrawMidnightNotice ws, noticeStartRow, baseCol, info.ShiftStartDate, info.ShiftEndDate
            outputRow = outputRow + 3
        End If

        outputRow = outputRow + 1

        If i > after2359Index Then
            serialNum = i - after2359Index
        Else
            serialNum = firstSerial + i - 1
        End If

        DrawStandardRow ws, outputRow, baseCol, serialNum, rows(i)

        If rows(i).IsApplianceName Then
            DrawApplianceNameRow ws, outputRow, baseCol, rows(i).Job, applianceList, applianceCount
        End If
    Next i

    If after2359Index = n Then
        DrawMidnightNotice ws, noticeStartRow, baseCol, info.ShiftStartDate, info.ShiftEndDate
    End If

    MergeNight2100TimeBlocks ws, baseRow, bottomRow, baseCol

    Dim firstICEnd As Long
    firstICEnd = noticeStartRow - 1
    If firstICEnd >= baseRow + 1 Then
        MergeRightICBlock ws, baseRow + 1, firstICEnd, baseCol + 10, currentIC
    End If

    Dim secondICStart As Long
    secondICStart = noticeEndRow + 1
    Dim secondICEnd As Long
    secondICEnd = hotoStartRow - 1

    If secondICEnd >= secondICStart Then
        MergeRightICBlock ws, secondICStart, secondICEnd, baseCol + 10, currentIC
    End If

    Dim hotoSerial As Long
    hotoSerial = n - after2359Index + 1

    DrawHOTO ws, hotoStartRow, hotoEndRow, baseCol, hotoSerial, "0800", _
        info.CurrentRota, info.IncomingRota, _
        UCase(info.IncomingRota) & " TAKING OVER " & UCase(info.CurrentRota), _
        nextIC, False

    DrawFooter ws, bottomRow, baseCol, "Taken over by " & info.IncomingRota

    RemoveNightApplianceInnerBorders ws, baseRow, bottomRow, baseCol

End Sub

'====================================================
'TURNOUTS FROM PARSED DATA
'====================================================
Private Sub AddTurnoutRowsFromData(ByRef rows() As ReportRow, ByRef n As Long, ByRef parsed As ParsedInput)

    If parsed.TurnoutCount = 0 Then Exit Sub

    Dim ti As Long
    For ti = 1 To m_TurnoutCount
        Dim tType As String
        tType = m_TurnoutList(ti).TurnoutType
        If tType = "" Then tType = "P3"

        Dim activator As String
        activator = UCase(FormatPersonName(LookupPersonById(m_TurnoutList(ti).PersonId)))

        Dim labels(1 To 5) As String
        labels(1) = tType & " Activated by " & activator
        labels(2) = tType & " Left Division"
        labels(3) = tType & " Arrive At Location"
        labels(4) = tType & " Left Location"
        labels(5) = tType & " Reach Division"

        Dim si As Integer
        For si = 1 To 5
            If Not m_TurnoutList(ti).TimesBlocked(si) And m_TurnoutList(ti).Times(si) <> "" Then
                AddRow rows, n, m_TurnoutList(ti).Times(si), "-", "-", "-", _
                    labels(si), m_TurnoutList(ti).Times(si), "All in order.", True, False
            End If
        Next si
    Next ti

End Sub

'====================================================
'APPEND / CONTINUITY HELPERS
'====================================================
Private Function GetAppendStart( _
    ByVal ws As Worksheet, _
    ByVal baseCol As Long, _
    ByRef info As ShiftInfo, _
    ByVal usingOverride As Boolean, _
    ByRef baseRow As Long, _
    ByRef previousHeaderRow As Long, _
    ByRef previousFooterRow As Long, _
    ByRef previousShiftLabel As String, _
    ByRef previousEndSerial As Long, _
    ByRef wasGeneratedSeparately As Boolean) As Boolean

    Dim latestRow As Long
    latestRow = FindLatestTakenOverRow(ws, baseCol)

    If latestRow = 0 Then
        baseRow = 2
        previousHeaderRow = 0
        previousFooterRow = 0
        previousShiftLabel = ""
        previousEndSerial = 0
        GetAppendStart = True
        Exit Function
    End If

    previousFooterRow = latestRow
    previousHeaderRow = FindPreviousTakenOverRow(ws, baseCol, previousFooterRow - 1)

    If previousHeaderRow = 0 Then
        MsgBox "I found a 'Taken over by...' row, but could not find the start of the previous ops log above it." & vbCrLf & vbCrLf & _
               "Please check the existing sheet before generating the next report.", _
               vbCritical, "Previous Ops Log Not Clear"
        GetAppendStart = False
        Exit Function
    End If

    previousShiftLabel = DetectExistingReportShift(ws, previousHeaderRow, previousFooterRow, baseCol)

    If previousShiftLabel = "" Then
        MsgBox "I could not identify whether the previous ops log is a day or night report." & vbCrLf & vbCrLf & _
               "Please check the previous report format before continuing.", _
               vbCritical, "Previous Ops Log Not Clear"
        GetAppendStart = False
        Exit Function
    End If

    Dim expectedPreviousShift As String
    expectedPreviousShift = IIf(info.ShiftLabel = "Day", "Night", "Day")

    If previousShiftLabel <> expectedPreviousShift Then
        If usingOverride Then
            StartSeparatedOverrideLog ws, baseCol, previousHeaderRow, previousFooterRow, baseRow, previousShiftLabel, previousEndSerial
            wasGeneratedSeparately = True
            GetAppendStart = True
            Exit Function
        End If

        MsgBox "The latest ops log on this sheet does not look like the correct previous shift." & vbCrLf & vbCrLf & _
               "This macro is about to generate a " & LCase(info.ShiftLabel) & " report, so the latest completed ops log should be a " & _
               LCase(expectedPreviousShift) & " report." & vbCrLf & vbCrLf & _
               "Please check the sheet before continuing.", _
               vbCritical, "Previous Ops Log Sequence Error"
        GetAppendStart = False
        Exit Function
    End If

    Dim footerRota As String
    footerRota = ExtractTakenOverRota(CStr(ws.Cells(previousFooterRow, baseCol).Value))

    If footerRota <> "" Then
        If UCase(footerRota) <> UCase(info.CurrentRota) Then
            If usingOverride Then
                StartSeparatedOverrideLog ws, baseCol, previousHeaderRow, previousFooterRow, baseRow, previousShiftLabel, previousEndSerial
                wasGeneratedSeparately = True
                GetAppendStart = True
                Exit Function
            End If

            MsgBox "The rota continuity does not match." & vbCrLf & vbCrLf & _
                   "The previous ops log ended with '" & footerRota & "', but this report is starting with '" & info.CurrentRota & "'." & vbCrLf & vbCrLf & _
                   "Please check the previous report or use override shift before continuing.", _
                   vbCritical, "Previous Ops Log Sequence Error"
            GetAppendStart = False
            Exit Function
        End If
    End If

    If Not IsPreviousDateContinuous(ws, previousHeaderRow, previousFooterRow, baseCol, previousShiftLabel, info) Then
        If usingOverride Then
            StartSeparatedOverrideLog ws, baseCol, previousHeaderRow, previousFooterRow, baseRow, previousShiftLabel, previousEndSerial
            wasGeneratedSeparately = True
            GetAppendStart = True
            Exit Function
        End If

        MsgBox "The date continuity does not match the report you are trying to generate." & vbCrLf & vbCrLf & _
               "Please check that the latest ops log on this sheet is the immediate previous shift.", _
               vbCritical, "Previous Ops Log Date Error"
        GetAppendStart = False
        Exit Function
    End If

    previousEndSerial = GetMaxSerialInBlock(ws, previousHeaderRow, previousFooterRow - 1, baseCol)
    baseRow = previousFooterRow

    GetAppendStart = True

End Function

Private Sub StartSeparatedOverrideLog( _
    ByVal ws As Worksheet, _
    ByVal baseCol As Long, _
    ByRef previousHeaderRow As Long, _
    ByRef previousFooterRow As Long, _
    ByRef baseRow As Long, _
    ByRef previousShiftLabel As String, _
    ByRef previousEndSerial As Long)

    Dim oldFooterRow As Long
    oldFooterRow = previousFooterRow

    previousEndSerial = GetMaxSerialInBlock(ws, previousHeaderRow, oldFooterRow - 1, baseCol)
    baseRow = oldFooterRow + 2

    With ws.Range(ws.Cells(oldFooterRow + 1, baseCol), ws.Cells(oldFooterRow + 1, baseCol + 10))
        .UnMerge
        .Clear
        .Borders.LineStyle = xlNone
    End With

    previousHeaderRow = 0
    previousFooterRow = 0
    previousShiftLabel = ""

End Sub

Private Function FindLatestTakenOverRow(ByVal ws As Worksheet, ByVal baseCol As Long) As Long

    Dim r As Long
    For r = ws.Rows.Count To 1 Step -1
        If InStr(1, UCase(Trim(CStr(ws.Cells(r, baseCol).Value))), "TAKEN OVER BY", vbTextCompare) > 0 Then
            FindLatestTakenOverRow = r
            Exit Function
        End If
    Next r

End Function

Private Function FindPreviousTakenOverRow(ByVal ws As Worksheet, ByVal baseCol As Long, ByVal startRow As Long) As Long

    Dim r As Long
    For r = startRow To 1 Step -1
        If InStr(1, UCase(Trim(CStr(ws.Cells(r, baseCol).Value))), "TAKEN OVER BY", vbTextCompare) > 0 Then
            FindPreviousTakenOverRow = r
            Exit Function
        End If
    Next r

End Function

Private Function DetectExistingReportShift(ByVal ws As Worksheet, ByVal headerRow As Long, ByVal footerRow As Long, ByVal baseCol As Long) As String

    Dim r As Long
    For r = headerRow To footerRow
        If InStr(1, UCase(CStr(ws.Cells(r, baseCol).Value)), "CLOSED PAGE ON", vbTextCompare) > 0 Then
            DetectExistingReportShift = "Night"
            Exit Function
        End If
    Next r

    DetectExistingReportShift = "Day"

End Function

Private Function ExtractTakenOverRota(ByVal txt As String) As String

    txt = Trim(txt)
    If UCase(Left(txt, 13)) <> "TAKEN OVER BY" Then Exit Function
    ExtractTakenOverRota = Trim(Mid(txt, 14))

End Function

Private Function GetMaxSerialInBlock(ByVal ws As Worksheet, ByVal startRow As Long, ByVal endRow As Long, ByVal baseCol As Long) As Long

    Dim r As Long, v As Variant, maxSN As Long, scanStartRow As Long
    maxSN = 0
    scanStartRow = startRow

    If endRow < startRow Then
        GetMaxSerialInBlock = 0
        Exit Function
    End If

    For r = startRow To endRow
        If InStr(1, UCase(CStr(ws.Cells(r, baseCol).Value)), "OPENED PAGE ON", vbTextCompare) > 0 Then
            scanStartRow = r + 1
        End If
    Next r

    For r = scanStartRow To endRow
        v = ws.Cells(r, baseCol).Value
        If IsNumeric(v) Then
            If CLng(v) > maxSN Then maxSN = CLng(v)
        End If
    Next r

    GetMaxSerialInBlock = maxSN

End Function

Private Function IsPreviousDateContinuous( _
    ByVal ws As Worksheet, _
    ByVal headerRow As Long, _
    ByVal footerRow As Long, _
    ByVal baseCol As Long, _
    ByVal previousShiftLabel As String, _
    ByRef currentInfo As ShiftInfo) As Boolean

    Dim previousDate As Date
    Dim hasPreviousDate As Boolean

    hasPreviousDate = TryGetReportDateFromMetadataForShift(ws, headerRow, footerRow, baseCol, previousShiftLabel, previousDate)

    If hasPreviousDate Then
        If currentInfo.ShiftLabel = "Day" Then
            IsPreviousDateContinuous = (previousDate = currentInfo.ShiftStartDate - 1)
        Else
            IsPreviousDateContinuous = (previousDate = currentInfo.ShiftStartDate)
        End If
        Exit Function
    End If

    If previousShiftLabel = "Night" And currentInfo.ShiftLabel = "Day" Then
        If TryGetOpenedPageDate(ws, headerRow, footerRow, baseCol, previousDate) Then
            IsPreviousDateContinuous = (previousDate = currentInfo.ShiftStartDate)
            Exit Function
        End If
    End If

    IsPreviousDateContinuous = True

End Function

Private Function TryGetReportDateFromMetadataForShift( _
    ByVal ws As Worksheet, _
    ByVal headerRow As Long, _
    ByVal footerRow As Long, _
    ByVal baseCol As Long, _
    ByVal expectedShiftLabel As String, _
    ByRef reportDate As Date) As Boolean

    If TryParseOpsLogMetadataDate(CStr(ws.Cells(footerRow, baseCol + 11).Value), expectedShiftLabel, reportDate) Then
        TryGetReportDateFromMetadataForShift = True
        Exit Function
    End If

    If TryParseOpsLogMetadataDate(CStr(ws.Cells(headerRow, baseCol + 11).Value), expectedShiftLabel, reportDate) Then
        TryGetReportDateFromMetadataForShift = True
        Exit Function
    End If

End Function

Private Function TryParseOpsLogMetadataDate( _
    ByVal metaText As String, _
    ByVal expectedShiftLabel As String, _
    ByRef reportDate As Date) As Boolean

    Dim parts As Variant
    If Left(metaText, 7) <> "OPSLOG|" Then Exit Function

    parts = Split(metaText, "|")
    If UBound(parts) < 2 Then Exit Function
    If UCase(CStr(parts(1))) <> UCase(expectedShiftLabel) Then Exit Function

    On Error GoTo BadDate
    reportDate = DateSerial(CLng(Left(parts(2), 4)), CLng(Mid(parts(2), 6, 2)), CLng(Mid(parts(2), 9, 2)))
    TryParseOpsLogMetadataDate = True
    Exit Function
BadDate:
End Function

Private Function TryGetOpenedPageDate( _
    ByVal ws As Worksheet, _
    ByVal headerRow As Long, _
    ByVal footerRow As Long, _
    ByVal baseCol As Long, _
    ByRef openedDate As Date) As Boolean

    Dim r As Long, txt As String
    For r = headerRow To footerRow
        txt = UCase(Trim(CStr(ws.Cells(r, baseCol).Value)))
        If Left(txt, 14) = "OPENED PAGE ON" Then
            On Error GoTo BadDate
            openedDate = CDate(Trim(Mid(txt, 15)))
            TryGetOpenedPageDate = True
            Exit Function
        End If
    Next r

    TryGetOpenedPageDate = False
    Exit Function
BadDate:
End Function

Private Sub UpdatePreviousIncomingIC( _
    ByVal ws As Worksheet, _
    ByVal headerRow As Long, _
    ByVal footerRow As Long, _
    ByVal baseCol As Long, _
    ByVal newIncomingIC As String)

    Dim r As Long, txt As String, p As Long, targetRow As Long
    targetRow = 0

    For r = headerRow To footerRow - 1
        txt = CStr(ws.Cells(r, baseCol + 5).Value)
        If InStr(1, UCase(txt), " TAKING OVER ", vbTextCompare) > 0 Then
            If Left(UCase(Trim(txt)), 4) <> "ROTA" Then
                targetRow = r
            End If
        End If
    Next r

    If targetRow > 0 Then
        txt = CStr(ws.Cells(targetRow, baseCol + 5).Value)
        p = InStr(1, UCase(txt), " TAKING OVER ", vbTextCompare)
        If p > 0 Then
            ws.Cells(targetRow, baseCol + 5).Value = UCase(newIncomingIC) & Mid(txt, p)
        End If
    End If

    Dim lastICRow As Long
    lastICRow = 0

    For r = headerRow To footerRow - 1
        If Trim(CStr(ws.Cells(r, baseCol + 10).Value)) <> "" Then
            lastICRow = r
        End If
    Next r

    If lastICRow > 0 Then
        ws.Cells(lastICRow, baseCol + 10).Value = newIncomingIC
    End If

End Sub

Private Sub ClearOutputArea(ByVal ws As Worksheet, ByVal baseRow As Long, ByVal baseCol As Long)

    Dim lastClearRow As Long
    lastClearRow = baseRow + 180
    If lastClearRow > ws.Rows.Count Then lastClearRow = ws.Rows.Count

    With ws.Range(ws.Cells(baseRow, baseCol), ws.Cells(lastClearRow, baseCol + 11))
        .UnMerge
        .Clear
    End With

End Sub

Private Sub WriteReportMetadata( _
    ByVal ws As Worksheet, _
    ByVal baseRow As Long, _
    ByVal baseCol As Long, _
    ByRef info As ShiftInfo, _
    ByVal firstSerial As Long)

    Dim footerRow As Long
    footerRow = FindLatestTakenOverRow(ws, baseCol)

    Dim metaText As String
    metaText = "OPSLOG|" & info.ShiftLabel & "|" & Format(info.ShiftStartDate, "yyyy-mm-dd") & "|" & CStr(firstSerial)

    ws.Cells(baseRow, baseCol + 11).Value = metaText
    If footerRow >= baseRow Then
        ws.Cells(footerRow, baseCol + 11).Value = metaText
    End If

    ws.Columns(baseCol + 11).Hidden = True

End Sub

'====================================================
'ROW HELPERS
'====================================================
Private Sub AddRow( _
    ByRef rows() As ReportRow, _
    ByRef n As Long, _
    ByVal t As String, _
    ByVal left1 As String, _
    ByVal left2 As String, _
    ByVal left3 As String, _
    ByVal job As String, _
    ByVal rightT As String, _
    ByVal remarks As String, _
    ByVal isP3 As Boolean, _
    ByVal isApplianceName As Boolean)

    n = n + 1
    ReDim Preserve rows(1 To n)

    rows(n).T = t
    rows(n).Left1 = left1
    rows(n).Left2 = left2
    rows(n).Left3 = left3
    rows(n).Job = job
    rows(n).RightT = rightT
    rows(n).Remarks = remarks
    rows(n).IsP3 = isP3
    rows(n).IsApplianceName = isApplianceName

End Sub

Private Sub SortReportRows(ByRef rows() As ReportRow, ByRef n As Long, ByRef shiftLabel As String)

    Dim i As Long, j As Long, tmp As ReportRow

    For i = 1 To n - 1
        For j = i + 1 To n
            If ShouldSwapRows(rows(i), rows(j), shiftLabel) Then
                tmp = rows(i)
                rows(i) = rows(j)
                rows(j) = tmp
            End If
        Next j
    Next i

End Sub

Private Function ShouldSwapRows(ByRef rowA As ReportRow, ByRef rowB As ReportRow, ByRef shiftLabel As String) As Boolean

    Dim orderA As Long, orderB As Long
    orderA = TimeOrder(rowA.T, shiftLabel)
    orderB = TimeOrder(rowB.T, shiftLabel)

    If orderB < orderA Then
        ShouldSwapRows = True
        Exit Function
    End If

    If orderB > orderA Then
        ShouldSwapRows = False
        Exit Function
    End If

    If shiftLabel = "Night" And orderA = 2100 Then
        If Night2100SortRank(rowB) < Night2100SortRank(rowA) Then
            ShouldSwapRows = True
            Exit Function
        End If
    End If

End Function

Private Function Night2100SortRank(ByRef oneRow As ReportRow) As Long

    Dim jobText As String
    jobText = UCase(Trim(CStr(oneRow.Job)))

    If jobText = "CHECKING OF STATION ALPHAS" Then
        Night2100SortRank = 10
    ElseIf jobText = "CHECK AND UPDATED APPLIANCES OIC -" Then
        Night2100SortRank = 20
    ElseIf oneRow.IsApplianceName Or Left(jobText, 2) = "A4" Then
        Night2100SortRank = 30
    ElseIf jobText = "CHECK AND UPDATED APPLIANCES OIC" Then
        Night2100SortRank = 40
    Else
        Night2100SortRank = 50
    End If

End Function

Private Function FindLastRowIndexAtOrBefore( _
    ByRef rows() As ReportRow, _
    ByVal n As Long, _
    ByVal targetTime As String, _
    ByVal shiftLabel As String) As Long

    Dim targetOrder As Long, i As Long, lastIndex As Long
    targetOrder = TimeOrder(targetTime, shiftLabel)
    lastIndex = 0

    For i = 1 To n
        If rows(i).T <> "" Then
            If TimeOrder(rows(i).T, shiftLabel) <= targetOrder Then
                lastIndex = i
            End If
        End If
    Next i

    FindLastRowIndexAtOrBefore = lastIndex

End Function

'====================================================
'TIME ORDERING
'====================================================
Private Function ShiftStartOrder(ByVal shiftLabel As String) As Long
    ShiftStartOrder = 0
End Function

Private Function TimeOrder(ByVal t As String, ByVal shiftLabel As String) As Long

    If t = "" Then
        TimeOrder = IIf(shiftLabel = "Night", 2100, 0)
        Exit Function
    End If

    Dim actualTime As Long
    actualTime = CLng(t)

    If shiftLabel = "Night" Then
        TimeOrder = IIf(actualTime <= 810, actualTime + 2400, actualTime)
    Else
        TimeOrder = actualTime
    End If

End Function

'====================================================
'DRAWING HELPERS
'====================================================
Private Sub SetCommonColumnWidths(ByVal ws As Worksheet, ByVal baseCol As Long, ByVal isDay As Boolean)

    ws.Columns(baseCol + 0).ColumnWidth = 12
    ws.Columns(baseCol + 1).ColumnWidth = 12
    ws.Columns(baseCol + 2).ColumnWidth = 12
    ws.Columns(baseCol + 3).ColumnWidth = 12
    ws.Columns(baseCol + 4).ColumnWidth = 12
    ws.Columns(baseCol + 5).ColumnWidth = 78
    ws.Columns(baseCol + 6).ColumnWidth = 12
    ws.Columns(baseCol + 7).ColumnWidth = 78
    ws.Columns(baseCol + 8).ColumnWidth =12
    ws.Columns(baseCol + 9).ColumnWidth = 18
    ws.Columns(baseCol + 10).ColumnWidth = 30

End Sub

Private Sub FormatReportBlock( _
    ByVal ws As Worksheet, _
    ByVal baseRow As Long, _
    ByVal baseCol As Long, _
    ByVal bottomRow As Long, _
    ByVal lastOffset As Long)

    With ws.Range(ws.Cells(baseRow, baseCol), ws.Cells(bottomRow, baseCol + lastOffset))
        .Font.Name = "Segoe UI"
        .Font.Size = 16
        .HorizontalAlignment = xlCenter
        .VerticalAlignment = xlCenter
        .WrapText = True
        .Borders.LineStyle = xlContinuous
        .Borders.Weight = xlThin
    End With

End Sub

Private Sub DrawHeader(ByVal ws As Worksheet, ByVal rowNum As Long, ByVal baseCol As Long, ByVal txt As String)

    With ws.Range(ws.Cells(rowNum, baseCol), ws.Cells(rowNum, baseCol + 10))
        .ClearContents
        .Merge
        .Value = txt
        .Font.Bold = True
        .Font.Size = 20
        .Interior.Color = RGB(217, 217, 217)
    End With

End Sub

Private Sub DrawFooter(ByVal ws As Worksheet, ByVal rowNum As Long, ByVal baseCol As Long, ByVal txt As String)

    With ws.Range(ws.Cells(rowNum, baseCol), ws.Cells(rowNum, baseCol + 10))
        .ClearContents
        .Merge
        .Value = txt
        .Font.Bold = True
        .Font.Size = 20
        .Interior.Color = RGB(217, 217, 217)
    End With

End Sub

Private Sub DrawStandardRow(ByVal ws As Worksheet, ByVal rowNum As Long, ByVal baseCol As Long, ByVal serialNum As Long, ByRef rr As ReportRow)

    ws.Cells(rowNum, baseCol + 0).Value = serialNum

    ws.Cells(rowNum, baseCol + 1).NumberFormat = "@"
    ws.Cells(rowNum, baseCol + 1).Value = rr.T

    ws.Cells(rowNum, baseCol + 2).Value = rr.Left1
    ws.Cells(rowNum, baseCol + 3).Value = rr.Left2
    ws.Cells(rowNum, baseCol + 4).Value = rr.Left3

    With ws.Range(ws.Cells(rowNum, baseCol + 5), ws.Cells(rowNum, baseCol + 7))
        .ClearContents
        .Merge
        .Value = rr.Job
        .HorizontalAlignment = xlCenter
        .VerticalAlignment = xlCenter
        .WrapText = True

        If rr.IsP3 Then
            .Font.Color = RGB(255, 0, 0)
            .Font.Bold = True
        End If

        If InStr(UCase(rr.Job), "TAKING OVER") > 0 Then
            .Font.Bold = True
        End If
    End With

    ws.Cells(rowNum, baseCol + 8).NumberFormat = "@"
    ws.Cells(rowNum, baseCol + 8).Value = rr.RightT
    ws.Cells(rowNum, baseCol + 9).Value = rr.Remarks

End Sub

Private Sub DrawApplianceNameRow( _
    ByVal ws As Worksheet, _
    ByVal rowNum As Long, _
    ByVal baseCol As Long, _
    ByVal applianceText As String, _
    ByRef applianceList() As ApplianceInfo, _
    ByRef applianceCount As Long)

    Dim applianceCode As String
    Dim applianceRank As String
    Dim applianceName As String

    applianceCode = ExtractApplianceCode(applianceText)
    applianceRank = FindApplianceRank(applianceCode, applianceList, applianceCount)
    applianceName = FindApplianceName(applianceCode, applianceList, applianceCount)

    ws.Range(ws.Cells(rowNum, baseCol + 5), ws.Cells(rowNum, baseCol + 7)).UnMerge

    ws.Cells(rowNum, baseCol + 5).Value = applianceCode & " " & ChrW(8211)
    ws.Cells(rowNum, baseCol + 6).Value = applianceRank
    ws.Cells(rowNum, baseCol + 7).Value = applianceName

    ws.Cells(rowNum, baseCol + 5).HorizontalAlignment = xlRight
    ws.Cells(rowNum, baseCol + 6).HorizontalAlignment = xlCenter
    ws.Cells(rowNum, baseCol + 7).HorizontalAlignment = xlLeft

End Sub

Private Function ExtractApplianceCode(ByRef applianceText As String) As String

    Dim txt As String, p As Long
    txt = UCase(Trim(applianceText))
    txt = Replace(txt, ChrW(8211), "-")
    txt = Replace(txt, ChrW(8212), "-")

    p = InStr(1, txt, "-", vbTextCompare)
    If p > 0 Then txt = Trim(Left(txt, p - 1))

    p = InStr(1, txt, " ", vbTextCompare)
    If p > 0 Then txt = Trim(Left(txt, p - 1))

    ExtractApplianceCode = txt

End Function

Private Function FindApplianceRank( _
    ByRef applianceCode As String, _
    ByRef applianceList() As ApplianceInfo, _
    ByRef applianceCount As Long) As String

    Dim i As Long
    For i = 1 To applianceCount
        If UCase(applianceList(i).Code) = UCase(applianceCode) Then
            FindApplianceRank = applianceList(i).Rank
            Exit Function
        End If
    Next i

End Function

Private Function FindApplianceName( _
    ByRef applianceCode As String, _
    ByRef applianceList() As ApplianceInfo, _
    ByRef applianceCount As Long) As String

    Dim i As Long
    For i = 1 To applianceCount
        If UCase(applianceList(i).Code) = UCase(applianceCode) Then
            FindApplianceName = applianceList(i).PersonName
            Exit Function
        End If
    Next i

End Function

Private Sub MergeRightICBlock(ByVal ws As Worksheet, ByVal startRow As Long, ByVal endRow As Long, ByVal colNum As Long, ByVal icName As String)

    If endRow < startRow Then Exit Sub

    With ws.Range(ws.Cells(startRow, colNum), ws.Cells(endRow, colNum))
        .ClearContents
        .Merge
        .Value = icName
        .Font.Bold = True
        .HorizontalAlignment = xlCenter
        .VerticalAlignment = xlCenter
    End With

End Sub

Private Sub DrawMidnightNotice( _
    ByVal ws As Worksheet, _
    ByVal startRow As Long, _
    ByVal baseCol As Long, _
    ByVal closeDate As Date, _
    ByVal openDate As Date)

    Dim r As Long
    For r = startRow To startRow + 2
        With ws.Range(ws.Cells(r, baseCol), ws.Cells(r, baseCol + 10))
            .ClearContents
            .Merge
            .Font.Color = RGB(255, 0, 0)
            .Font.Bold = True
            .HorizontalAlignment = xlCenter
            .VerticalAlignment = xlCenter
        End With
    Next r

    ws.Cells(startRow, baseCol).Value = "CLOSED PAGE ON " & UCase(Format(closeDate, "dd mmm yyyy"))
    ws.Cells(startRow + 1, baseCol).Value = "Certified by CPT HADIZUL   All in order"
    ws.Cells(startRow + 2, baseCol).Value = "OPENED PAGE ON " & UCase(Format(openDate, "dd mmm yyyy"))

End Sub

Private Sub DrawHOTO( _
    ByVal ws As Worksheet, _
    ByVal startRow As Long, _
    ByVal endRow As Long, _
    ByVal baseCol As Long, _
    ByVal serialNum As Long, _
    ByVal timingText As String, _
    ByVal currentRota As String, _
    ByVal incomingRota As String, _
    ByVal takingOverText As String, _
    ByVal nextIC As String, _
    ByVal isDay As Boolean)

    With ws.Range(ws.Cells(startRow, baseCol + 0), ws.Cells(endRow, baseCol + 0))
        .ClearContents
        .Merge
        .Value = serialNum
    End With

    With ws.Range(ws.Cells(startRow, baseCol + 1), ws.Cells(endRow, baseCol + 1))
        .ClearContents
        .Merge
        .NumberFormat = "@"
        .Value = timingText
    End With

    With ws.Range(ws.Cells(startRow, baseCol + 2), ws.Cells(endRow, baseCol + 2))
        .ClearContents
        .Merge
        .Value = currentRota
    End With

    With ws.Range(ws.Cells(startRow, baseCol + 3), ws.Cells(endRow, baseCol + 3))
        .ClearContents
        .Merge
        .Value = incomingRota
    End With

    With ws.Range(ws.Cells(startRow, baseCol + 4), ws.Cells(endRow, baseCol + 4))
        .ClearContents
        .Merge
        .Value = "PERS"
    End With

    MergeMiddleText ws, startRow, baseCol, takingOverText, True
    MergeMiddleText ws, startRow + 1, baseCol, "HOTO comprises of", False
    MergeMiddleText ws, startRow + 2, baseCol, "1. FCV Equipment", False
    MergeMiddleText ws, startRow + 3, baseCol, "2. Physical Recall Kit - 9 Nominal Roll, DO, ADO, RDR, ARMS II Guide, 15 pens, 5 Markers.", False
    MergeMiddleText ws, startRow + 4, baseCol, "3. Files and Directives - List of the files are at the Cabinet 1 and 2. *(HRI 70 Files and Ops Directive)", False
    MergeMiddleText ws, startRow + 5, baseCol, "4. Transport Keypress Book", False

    With ws.Range(ws.Cells(startRow, baseCol + 8), ws.Cells(endRow, baseCol + 8))
        .ClearContents
        .Merge
        .NumberFormat = "@"
        .Value = timingText
    End With

    With ws.Range(ws.Cells(startRow, baseCol + 9), ws.Cells(endRow, baseCol + 9))
        .ClearContents
        .Merge
        .Value = "All in order."
    End With

    With ws.Range(ws.Cells(startRow, baseCol + 10), ws.Cells(endRow, baseCol + 10))
        .ClearContents
        .Merge
        .Value = nextIC
        .Font.Bold = True
        .HorizontalAlignment = xlCenter
        .VerticalAlignment = xlCenter
    End With

End Sub

Private Sub MergeMiddleText(ByVal ws As Worksheet, ByVal rowNum As Long, ByVal baseCol As Long, ByVal txt As String, ByVal makeBold As Boolean)

    With ws.Range(ws.Cells(rowNum, baseCol + 5), ws.Cells(rowNum, baseCol + 7))
        .ClearContents
        .Merge
        .Value = txt
        .Font.Bold = makeBold
        .HorizontalAlignment = xlCenter
        .VerticalAlignment = xlCenter
        .WrapText = True
    End With

End Sub

Private Function IsNight2100BlockRow(ByVal ws As Worksheet, ByVal rowNum As Long, ByVal baseCol As Long) As Boolean

    Dim leftText As String
    leftText = UCase(Trim(CStr(ws.Cells(rowNum, baseCol + 5).Value)))

    If Left(leftText, 2) = "A4" And Left(leftText, 4) Like "A4##" Then
        IsNight2100BlockRow = True
    End If

End Function

Private Sub FindNight2100BlockRows(ByVal ws As Worksheet, ByVal baseRow As Long, ByVal bottomRow As Long, ByVal baseCol As Long, ByRef firstRow As Long, ByRef lastRow As Long)

    Dim r As Long
    firstRow = 0
    lastRow = 0

    For r = baseRow + 1 To bottomRow
        If IsNight2100BlockRow(ws, r, baseCol) Then
            If firstRow = 0 Then firstRow = r
            lastRow = r
        End If
    Next r

End Sub

Private Sub MergeNight2100TimeBlocks(ByVal ws As Worksheet, ByVal baseRow As Long, ByVal bottomRow As Long, ByVal baseCol As Long)

    Dim firstRow As Long, lastRow As Long
    FindNight2100BlockRows ws, baseRow, bottomRow, baseCol, firstRow, lastRow

    If firstRow = 0 Or lastRow = 0 Or lastRow < firstRow Then Exit Sub

    ws.Range(ws.Cells(firstRow, baseCol + 1), ws.Cells(lastRow, baseCol + 1)).UnMerge
    ws.Range(ws.Cells(firstRow, baseCol + 8), ws.Cells(lastRow, baseCol + 8)).UnMerge
    ws.Range(ws.Cells(firstRow, baseCol + 1), ws.Cells(lastRow, baseCol + 1)).ClearContents
    ws.Range(ws.Cells(firstRow, baseCol + 8), ws.Cells(lastRow, baseCol + 8)).ClearContents

    With ws.Range(ws.Cells(firstRow, baseCol + 1), ws.Cells(lastRow, baseCol + 1))
        .Merge
        .NumberFormat = "@"
        .Value = "2100"
        .HorizontalAlignment = xlCenter
        .VerticalAlignment = xlCenter
    End With

    With ws.Range(ws.Cells(firstRow, baseCol + 8), ws.Cells(lastRow, baseCol + 8))
        .Merge
        .NumberFormat = "@"
        .Value = "2100"
        .HorizontalAlignment = xlCenter
        .VerticalAlignment = xlCenter
    End With

End Sub

Private Sub RemoveNightApplianceInnerBorders(ByVal ws As Worksheet, ByVal baseRow As Long, ByVal bottomRow As Long, ByVal baseCol As Long)

    Dim firstRow As Long, lastRow As Long
    FindNight2100BlockRows ws, baseRow, bottomRow, baseCol, firstRow, lastRow

    If firstRow = 0 Or lastRow = 0 Or lastRow < firstRow Then Exit Sub

    With ws.Range(ws.Cells(firstRow, baseCol + 5), ws.Cells(lastRow, baseCol + 7))
        .Borders.LineStyle = xlNone
    End With

    With ws.Range(ws.Cells(firstRow, baseCol + 5), ws.Cells(lastRow, baseCol + 5)).Borders(xlEdgeLeft)
        .LineStyle = xlContinuous
        .Weight = xlThin
    End With

    With ws.Range(ws.Cells(firstRow, baseCol + 7), ws.Cells(lastRow, baseCol + 7)).Borders(xlEdgeRight)
        .LineStyle = xlContinuous
        .Weight = xlThin
    End With

End Sub

Private Function LookupRotaPersonById(ByVal personId As Long) As PersonInfo

    Dim i As Long
    For i = 1 To m_RotaPersonCount
        If m_RotaPeople(i).PersonId = personId Then
            LookupRotaPersonById = m_RotaPeople(i)
            Exit Function
        End If
    Next i

    ' Not found — return a placeholder so the IC cell has something meaningful
    Dim notFound As PersonInfo
    notFound.PersonId   = personId
    notFound.Rank       = ""
    notFound.PersonName = "ROTA ID " & personId & " NOT FOUND"
    LookupRotaPersonById = notFound

End Function

Private Sub LoadAppliancesDatabase()

    m_ApplianceCount = 0

    Dim csvPath As String
    csvPath = ThisWorkbook.Path & "\ops-log-panel\appliances.csv"

    Dim fNum As Integer
    fNum = FreeFile

    On Error GoTo FileNotFound
    Open csvPath For Input As #fNum
    On Error GoTo 0

    Dim lineText As String
    Dim isHeader As Boolean
    isHeader = True

    Do While Not EOF(fNum)
        Line Input #fNum, lineText
        lineText = Trim(lineText)
        If isHeader Then
            isHeader = False
        ElseIf lineText <> "" Then
            Dim cols() As String
            cols = Split(lineText, ",")
            If UBound(cols) >= 0 And Len(Trim(cols(0))) > 0 Then
                m_ApplianceCount = m_ApplianceCount + 1
                ReDim Preserve m_AppliancesCodes(1 To m_ApplianceCount)
                m_AppliancesCodes(m_ApplianceCount) = UCase(Trim(cols(0)))
            End If
        End If
    Loop

    Close #fNum
    Exit Sub

FileNotFound:
    ' appliances.csv not found — no fallback list (non-fatal)
    On Error GoTo 0

End Sub

Private Function LookupPersonById(ByVal personId As Long) As PersonInfo

    Dim i As Long
    For i = 1 To m_PersonCount
        If m_People(i).PersonId = personId Then
            LookupPersonById = m_People(i)
            Exit Function
        End If
    Next i

    ' Not found — return empty record so caller can handle gracefully
    Dim notFound As PersonInfo
    notFound.PersonId   = personId
    notFound.Rank       = ""
    notFound.PersonName = "ID " & personId & " NOT FOUND"
    LookupPersonById = notFound

End Function

Private Function FormatPersonName(ByRef p As PersonInfo) As String

    Dim r As String, n As String
    r = Trim(p.Rank)
    n = Trim(p.PersonName)

    If r = "" Then
        FormatPersonName = n
    ElseIf n = "" Then
        FormatPersonName = r
    Else
        FormatPersonName = r & " " & n
    End If

End Function

'====================================================
'SHIFT INFO LOGIC
'====================================================
Private Function GetCurrentShiftInfo(ByVal overrideDate As Date, ByVal overrideShift As String) As ShiftInfo

    Dim info As ShiftInfo
    Dim cycleStart As Date
    cycleStart = DateSerial(2026, 2, 17)

    Dim nowDT As Date

    If overrideDate <> 0 Then
        If UCase(overrideShift) = "A" Then
            nowDT = overrideDate + TimeSerial(9, 0, 0)
        Else
            nowDT = overrideDate + TimeSerial(21, 0, 0)
        End If
    Else
        nowDT = Now
    End If

    Dim isNight As Boolean
    isNight = (TimeValue(nowDT) >= TimeValue("18:10:00") Or TimeValue(nowDT) < TimeValue("08:10:00"))

    Dim shiftDate As Date
    If isNight And TimeValue(nowDT) < TimeValue("08:10:00") Then
        shiftDate = DateValue(nowDT) - 1
    Else
        shiftDate = DateValue(nowDT)
    End If

    Dim daysPassed As Long, cycleDay As Long
    daysPassed = DateDiff("d", cycleStart, shiftDate)
    cycleDay = ((daysPassed Mod 6) + 6) Mod 6 + 1

    Select Case cycleDay
        Case 1
            info.CurrentRota = IIf(isNight, "Rota 2", "Rota 1")
            info.IncomingRota = IIf(isNight, "Rota 1", "Rota 2")
        Case 2
            info.CurrentRota = IIf(isNight, "Rota 2", "Rota 1")
            info.IncomingRota = IIf(isNight, "Rota 3", "Rota 2")
        Case 3
            info.CurrentRota = IIf(isNight, "Rota 1", "Rota 3")
            info.IncomingRota = IIf(isNight, "Rota 3", "Rota 1")
        Case 4
            info.CurrentRota = IIf(isNight, "Rota 1", "Rota 3")
            info.IncomingRota = IIf(isNight, "Rota 2", "Rota 1")
        Case 5
            info.CurrentRota = IIf(isNight, "Rota 3", "Rota 2")
            info.IncomingRota = IIf(isNight, "Rota 2", "Rota 3")
        Case 6
            info.CurrentRota = IIf(isNight, "Rota 3", "Rota 2")
            info.IncomingRota = IIf(isNight, "Rota 1", "Rota 3")
    End Select

    If isNight Then
        info.ShiftLabel = "Night"
        info.ShiftStartDate = shiftDate
        info.ShiftEndDate = shiftDate + 1
    Else
        info.ShiftLabel = "Day"
        info.ShiftStartDate = shiftDate
        info.ShiftEndDate = shiftDate
    End If

    GetCurrentShiftInfo = info

End Function
