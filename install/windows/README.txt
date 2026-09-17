HOMESTEAD FREE FOR WINDOWS

Requirements:
- Windows 10 or Windows 11, 64-bit
- At least 2 GB of free disk space
- At least 4 GB of memory; 8 GB is recommended

Run "Install-Homestead.cmd". The installer includes Homestead's private Node,
FFmpeg, and FFprobe runtimes. It starts Homestead Free as a background Windows
process and opens http://localhost:7312 when the health check passes.

Homestead data is stored in:
%LOCALAPPDATA%\Homestead Free\data

The package is currently unsigned, so Windows may display an unknown-publisher
warning. Verify the published SHA-256 checksum before running it.
