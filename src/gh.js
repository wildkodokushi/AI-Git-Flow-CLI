import { hasCommand, run } from './git.js';

export function ghStatus() {
  if (!hasCommand('gh')) return { installed: false, authed: false };
  return { installed: true, authed: run('gh', ['auth', 'status']).code === 0 };
}

export const ghRun = (args, input) => run('gh', args, { input });

export function firstUrl(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => /^https?:\/\//.test(line.trim()))
    .map((line) => line.trim())
    .pop();
}

export function installHint() {
  if (process.platform === 'win32') return 'winget install --id GitHub.cli';
  if (process.platform === 'darwin') return 'brew install gh';
  return 'https://github.com/cli/cli#installation';
}
