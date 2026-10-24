HOMESTEAD FREE FOR WINDOWS - STANDALONE PREVIEW

Windows 10/11, x64. No Docker Desktop, Node.js or FFmpeg installation required.
Allow at least 2 GB free disk space and 4 GB RAM (8 GB recommended).

Run the Windows Setup EXE. If using the ZIP alternative, extract the complete
folder first and run Install-Homestead.cmd. Leave its progress window open.
Setup installs the private application runtimes, creates Start menu/desktop
shortcuts and opens Homestead in your browser at http://localhost:7312.
Complete the local owner setup, choose media folders and scan your library.
The Homestead icon is included by default; Choose Icon can replace the app icon.
For network media, enter the actual UNC share (\\server\share\Movies) or mapped
drive (M:\Movies), not a folder under Windows Network Shortcuts. Open the share
in File Explorer with the Windows account running Homestead and sign in first.
Setup checks folder access before continuing. Missing network shares are not
created automatically; missing local folders can be created during setup.
Free includes one owner, one stream and core local Movies, TV, Music, Books
and Photos in Media. Archived YouTube and Adult are optional. Family, Live TV,
Cloud, Inventory, AI and connected services stay locked. No trial/license is needed.

Settings, media, and logs remain in %LOCALAPPDATA%\Homestead Free.
Updates switch application versions without replacing data or media. Previous
application versions are retained for recovery. Uninstall retains data/media.
Use the Start menu's Homestead Free and Stop Homestead shortcuts after reboot.

If setup fails, an error is shown and logged to:
%TEMP%\Homestead-Free-Install.log
Server startup logs: %LOCALAPPDATA%\Homestead Free\logs
A different app already using port 7312 is reported rather than stopped.

This preview installer is unsigned. Check the published SHA-256. Windows may
show an unknown-publisher warning. It is for a trusted PC/home network; do not
expose the application port directly to the internet.
