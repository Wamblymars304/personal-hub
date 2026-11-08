' Starts the Personal Hub server with no window. Windows runs this at login (a shortcut to it sits in
' the Startup folder), so the server, and its "go outside" / "write" nudges, is always running.
' Output goes to data\server.log. If the hub is already running, the new copy just exits.
' To stop starting at login: delete "Personal Hub.lnk" from shell:startup.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c ""mkdir data 2>nul & node server.js >> data\server.log 2>&1""", 0, False
