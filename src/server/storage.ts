import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

export async function prepareDataDirectory(
  base: string,
): Promise<{ directory: string; warning: string | null }> {
  const directory = join(resolve(base), 'dashboard-data');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(directory)).isSymbolicLink())
    throw new Error('Use a dedicated app-owned directory, not a link.');
  const marker = join(directory, 'dashboard.owner');
  const entries = await fs.readdir(directory);
  if (entries.length && !entries.includes('dashboard.owner'))
    throw new Error('Choose an empty dedicated app-data directory.');
  if (entries.includes('dashboard.owner')) {
    if (
      (await fs.lstat(marker)).isSymbolicLink() ||
      (await fs.readFile(marker, 'utf8')) !== 'CopilotSessionDashboard\n'
    ) {
      throw new Error('Directory is not app-owned.');
    }
  }
  let warning: string | null = null;
  try {
    if (process.platform === 'win32') {
      const identity = execFileSync(
        'whoami.exe',
        ['/user', '/fo', 'csv', '/nh'],
        { encoding: 'utf8', windowsHide: true },
      );
      const sid = identity.match(/S-\d(?:-\d+)+/)?.[0];
      if (!sid) throw new Error('No current-user SID');
      execFileSync(
        'icacls.exe',
        [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`],
        { stdio: 'pipe', windowsHide: true },
      );
      const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
      const ownedFiles = [
        'dashboard.owner',
        'sessions.db',
        'sessions.db-shm',
        'sessions.db-wal',
      ]
        .map((file) => literal(join(directory, file)))
        .join(',');
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$ErrorActionPreference='Stop';
         $acls=@([System.IO.Directory]::GetAccessControl(${literal(directory)}));
         foreach ($file in @(${ownedFiles})) { if ([System.IO.File]::Exists($file)) { $acls += [System.IO.File]::GetAccessControl($file) } }
         foreach ($acl in $acls) {
           $rules=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]);
           $other=@($rules | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin @(${literal(sid)},'S-1-5-18','S-1-5-32-544') });
           if ($other.Count) { exit 1 }
         }`,
        ],
        { stdio: 'pipe', windowsHide: true },
      );
    } else await fs.chmod(directory, 0o700);
  } catch {
    warning =
      'Owner-only data-directory permissions could not be verified. Do not collect sensitive history until permissions are checked.';
  }
  if (!entries.includes('dashboard.owner'))
    await fs.writeFile(marker, 'CopilotSessionDashboard\n', {
      flag: 'wx',
      mode: 0o600,
    });
  return { directory, warning };
}
