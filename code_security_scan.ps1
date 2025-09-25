# SecurityScan.ps1 - ASP Classic Security Scanner
param(
    [string]$ScanPath = ".",
    [switch]$Detailed,
    [switch]$ExportResults
)

Write-Host "=== ASP Classic Security Scanner ===" -ForegroundColor Green
Write-Host "Scanning path: $ScanPath" -ForegroundColor Yellow

# Get all ASP files
$aspFiles = Get-ChildItem -Path $ScanPath -Recurse -Include *.asp
Write-Host "Found $($aspFiles.Count) ASP files to scan" -ForegroundColor Cyan

# Security Patterns to Scan For
$securityPatterns = @(
    @{Name="SQL Injection - Request.Querystring"; Pattern="Request\.QueryString\[[^]]+\][^&]*&"},
    @{Name="SQL Injection - Request.Form"; Pattern="Request\.Form\[[^]]+\][^&]*&"},
    @{Name="SQL Injection - EXEC"; Pattern="exec\s*\("},
    @{Name="SQL Injection - xp_cmdshell"; Pattern="xp_cmdshell"},
    @{Name="XSS - Response.Write Request"; Pattern="Response\.Write.*Request"},
    @{Name="XSS - Shortcut Tags"; Pattern="<%="},
    @{Name="File Inclusion Risk"; Pattern="#include.*Request"},
    @{Name="File System Object Usage"; Pattern="Scripting\.FileSystemObject"},
    @{Name="Hardcoded Passwords"; Pattern="password\s*=\s*[^""][^;]+"},
    @{Name="Admin Bypass Patterns"; Pattern="admin\s*=\s*true"},
    @{Name="Debug Mode Risks"; Pattern="debug\s*=\s*1"}
)

$results = @()

foreach ($file in $aspFiles) {
    try {
        $content = Get-Content $file.FullName -Raw -ErrorAction Stop
        $fileResults = @()
        
        foreach ($pattern in $securityPatterns) {
            $matches = [regex]::Matches($content, $pattern.Pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
            if ($matches.Count -gt 0) {
                foreach ($match in $matches) {
                    $fileResults += [PSCustomObject]@{
                        File = $file.Name
                        Path = $file.FullName
                        Line = "Line: $(($content.Substring(0, $match.Index).Split("`n").Length))"
                        Pattern = $pattern.Name
                        Match = $match.Value.Trim()
                        Severity = "High"
                    }
                }
            }
        }
        
        if ($fileResults.Count -gt 0) {
            $results += $fileResults
            Write-Host "⚠️  Found $($fileResults.Count) issues in: $($file.Name)" -ForegroundColor Red
        } else {
            if ($Detailed) {
                Write-Host "✓ Clean: $($file.Name)" -ForegroundColor Green
            }
        }
    }
    catch {
        Write-Warning "Could not read file: $($file.Name)"
    }
}

# Display Results
Write-Host "`n=== SCAN RESULTS ===" -ForegroundColor Green
Write-Host "Total issues found: $($results.Count)" -ForegroundColor Yellow

if ($results.Count -gt 0) {
    $results | Group-Object Pattern | Sort-Object Count -Descending | ForEach-Object {
        Write-Host "$($_.Name): $($_.Count) occurrences" -ForegroundColor Magenta
    }
    
    # Show detailed results
    $results | Format-Table File, Pattern, Line, Match -AutoSize
    
    # Export to CSV if requested
    if ($ExportResults) {
        $csvPath = "SecurityScan_Results_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"
        $results | Export-Csv -Path $csvPath -NoTypeInformation
        Write-Host "Results exported to: $csvPath" -ForegroundColor Green
    }
} else {
    Write-Host "No security issues found! ✓" -ForegroundColor Green
}

Write-Host "`nScan completed!" -ForegroundColor Green