'use strict';

// focusSession(session) — open/focus the app that owns an agent session, for
// the pet's left-click / "💬 去回复".
//
// Our hook reports source_pid as the terminal process plus a pid_chain. On
// Windows 下我们探测 pid 链中拥有顶层窗口的进程
// (WindowsTerminal / conhost apps / VS Code) and bring it to the foreground via
// user32 (SetForegroundWindow + SwitchToThisWindow). focusSession only supports
// the Windows desktop shipped by AgentPaw.

const { execFile } = require('child_process');

const DESKTOP_APPS = { zcode: 'zcode', opencode: 'openchamber' };

function selectDesktopPid(agentId, pids, processes) {
  const target = DESKTOP_APPS[agentId];
  if (!target || !Array.isArray(processes)) return null;
  const byPid = new Map(processes.map(p => [p.pid, p]));
  const windows = processes.filter(p => String(p.name).toLowerCase().replace(/\.exe$/, '') === target
    && p.window === true && Number.isInteger(p.pid) && p.pid > 0);
  const matches = new Set();
  for (const start of pids) {
    const seen = new Set();
    let current = byPid.get(start);
    while (current && !seen.has(current.pid) && seen.size < 32) {
      seen.add(current.pid);
      if (windows.some(p => p.pid === current.pid)) { matches.add(current.pid); break; }
      current = byPid.get(current.parentPid);
    }
  }
  if (matches.size === 1) return [...matches][0];
  if (matches.size > 1) return null;
  return windows.length === 1 ? windows[0].pid : null;
}

async function activateDesktopWindow(agentId, pids) {
  if (process.platform !== 'win32' || !DESKTOP_APPS[agentId]) return false;
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$session = (Get-Process -Id $PID).SessionId',
    '$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name',
    '$rows = @(Get-CimInstance Win32_Process -Filter "SessionId=$session" | ForEach-Object {',
    '    $window = $false',
    '    if ($_.Name -in @("ZCode.exe", "OpenChamber.exe")) {',
    '      $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue',
    '      if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) {',
    '        $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction SilentlyContinue',
    '        $window = $owner.ReturnValue -eq 0 -and ($owner.Domain + "\\" + $owner.User) -eq $user',
    '      }',
    '    }',
    '    [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;name=$_.Name;window=$window}',
    '})',
    'ConvertTo-Json -InputObject $rows -Compress',
  ].join('\n');
  const processes = await new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) { resolve([]); return; }
        try { resolve(JSON.parse(stdout)); } catch { resolve([]); }
      });
  });
  const pid = selectDesktopPid(agentId, pids, processes);
  return pid ? activateWinPids([pid], DESKTOP_APPS[agentId]) : false;
}

// Windows: one PowerShell run tries every candidate pid in order and focuses
// the first one that owns a top-level window. SetForegroundWindow from a
// background process is throttled by Windows, so we also call
// SwitchToThisWindow as a fallback (it emulates the Alt-Tab path).
function activateWinPids(pids, expectedName = null) {
  const list = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (!list.length) return Promise.resolve(false);
  const script = [
    "Add-Type -Namespace W -Name U -MemberDefinition '",
    '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
    '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int cmd);',
    '[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
    '[DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool alt);',
    '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);',
    '[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
    '[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);',
    '[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);',
    "'",
    `foreach ($id in @(${list.join(',')})) {`,
    '  $p = Get-Process -Id $id -ErrorAction SilentlyContinue',
    ...(expectedName === 'terminal'
      ? ['  if ($p -and $p.ProcessName -notin @("WindowsTerminal", "wt", "cmd", "powershell", "pwsh", "mintty", "conemu64", "conemu", "code", "cursor", "code-insiders")) { continue }']
      : expectedName ? [`  if ($p -and $p.ProcessName -ne '${expectedName}') { continue }`] : []),
    '  if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) {',
    '    $h = $p.MainWindowHandle',
    '    if ([W.U]::IsIconic($h)) { [W.U]::ShowWindowAsync($h, 9) | Out-Null; Start-Sleep -Milliseconds 200 }',
    '    for ($attempt = 0; $attempt -lt 3; $attempt++) {',
    '    $foregroundId = [uint32]0',
    '    $foregroundThread = [W.U]::GetWindowThreadProcessId([W.U]::GetForegroundWindow(), [ref]$foregroundId)',
    '    $thread = [W.U]::GetCurrentThreadId()',
    '    $targetId = [uint32]0',
    '    $targetThread = [W.U]::GetWindowThreadProcessId($h, [ref]$targetId)',
    '    $targetAttached = $targetThread -ne 0 -and $targetThread -ne $thread -and [W.U]::AttachThreadInput($thread, $targetThread, $true)',
    '    $attached = $foregroundThread -ne 0 -and $foregroundThread -ne $thread -and $foregroundThread -ne $targetThread -and [W.U]::AttachThreadInput($thread, $foregroundThread, $true)',
    '    try {',
    '      [W.U]::BringWindowToTop($h) | Out-Null',
    '      [W.U]::SetForegroundWindow($h) | Out-Null',
    '      [W.U]::SwitchToThisWindow($h, $true)',
    '    } finally {',
    '      if ($attached) { [W.U]::AttachThreadInput($thread, $foregroundThread, $false) | Out-Null }',
    '      if ($targetAttached) { [W.U]::AttachThreadInput($thread, $targetThread, $false) | Out-Null }',
    '    }',
    '    Start-Sleep -Milliseconds 100',
    '    $foregroundId = [uint32]0',
    '    [W.U]::GetWindowThreadProcessId([W.U]::GetForegroundWindow(), [ref]$foregroundId) | Out-Null',
    '    if ($foregroundId -eq $id) { Write-Output ("ok|" + $id); exit 0 }',
    '    }',
    '  }',
    '}',
    "Write-Output 'none'",
  ].join('\n');
  return new Promise((resolve) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        const m = /^ok\|(\d+)$/m.exec(String(stdout || ''));
        resolve(!err && m ? parseInt(m[1], 10) : false);
      });
  });
}

// Codex Desktop owns the `codex:` protocol. Its watcher sessions deliberately
// have no sourcePid, so a thread deep link is the only precise way to navigate
// to the selected task (focusing ChatGPT.exe alone would open an arbitrary one).
function codexThreadUrl(session) {
  if (!session || session.agentId !== 'codex') return null;
  const id = String(session.id || '');
  // Session ids currently are UUIDs. Keep the protocol payload deliberately
  // narrow so future/untrusted adapter data cannot alter the URI structure.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  return `codex://threads/${encodeURIComponent(id)}`;
}

// Returns true if the OS accepted a precise deep link or a window was focused.
// Dependencies are injectable so the behavior can be tested without changing
// the foreground window or launching an application.
async function focusSession(session, options = {}) {
  if (!session) return false;

  const threadUrl = codexThreadUrl(session);
  if (threadUrl && typeof options.openExternal === 'function') {
    try {
      await options.openExternal(threadUrl);
      return true;
    } catch {
      // If a Codex protocol handler is unavailable, retain the PID fallback.
    }
  }

  const candidates = [];
  if (session.sourcePid) candidates.push(session.sourcePid);
  if (Array.isArray(session.pidChain)) for (const p of session.pidChain) candidates.push(p);

  const ordered = [...new Set(candidates)].filter(p => Number.isInteger(p) && p > 0);
  if (DESKTOP_APPS[session.agentId]) {
    const activateDesktop = options.activateDesktop || activateDesktopWindow;
    try {
      if (await activateDesktop(session.agentId, ordered)) return true;
    } catch {}
    if (session.agentId === 'opencode' && ordered.length) {
      const activateTerminal = options.activatePids || (pids => {
        const chain = require('./pidwalk').resolve(pids[0], 32).pidChain || [];
        return activateWinPids([...new Set([...pids, ...chain])], 'terminal');
      });
      try { return Boolean(await activateTerminal(ordered)); } catch { return false; }
    }
    // ZCode must not raise an unrelated ancestor window.
    return false;
  }
  const activatePids = options.activatePids || activateWinPids;
  try { return Boolean(await activatePids(ordered)); } catch { return false; }
}

module.exports = { codexThreadUrl, focusSession, selectDesktopPid };
