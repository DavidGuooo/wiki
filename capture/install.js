// (Re)install the LaunchAgent com.guodawei.wiki-capture: the Telegram capture worker, always running.
// (The nightly topic compile is a Claude Code desktop routine, not a LaunchAgent.)
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {config} from './lib/config.js';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const domain = `gui/${process.getuid()}`;

function install(label, script) {
  const plist = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
  const logFile = path.join(os.homedir(), 'Library/Logs', `${label.replace('com.guodawei.', '')}.log`);
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${esc(process.execPath)}</string><string>${esc(path.join(config.capture, script))}</string></array>
  <key>WorkingDirectory</key><string>${esc(config.repo)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${esc(path.join(os.homedir(), '.local/bin'))}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${esc(logFile)}</string>
  <key>StandardErrorPath</key><string>${esc(logFile)}</string>
</dict></plist>
`);
  try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], {stdio: 'ignore'}); } catch { /* not loaded */ }
  // launchd can briefly refuse a bootstrap right after a bootout; retry a few times.
  for (let i = 0; ; i++) {
    try { execFileSync('launchctl', ['bootstrap', domain, plist], {stdio: 'pipe'}); break; }
    catch (e) { if (i === 4) throw e; execFileSync('sleep', ['1']); }
  }
  console.log(`Installed ${label}. Log: ${logFile}`);
}

install('com.guodawei.wiki-capture', 'worker.js');
