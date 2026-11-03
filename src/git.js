import { spawnSync } from 'node:child_process';
import { UserError } from './errors.js';

export function run(command, args, { cwd, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    input,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    code: result.error ? 127 : result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

export const git = (args, options) => run('git', ['-c', 'core.quotepath=false', ...args], options);

export function gitChecked(args, options) {
  const result = git(args, options);
  if (result.code !== 0) {
    const details = (result.stderr || result.stdout).trim();
    throw new UserError(`Команда git ${args.join(' ')} завершилась с ошибкой: ${details}`);
  }
  return result;
}

export function hasCommand(command) {
  return run(command, ['--version']).code === 0;
}

/** Verifies that git exists and the current folder is a repository, then moves to its root. */
export function enterRepository() {
  if (!hasCommand('git')) throw new UserError('Git не найден в PATH.');
  const result = git(['rev-parse', '--show-toplevel']);
  if (result.code !== 0) throw new UserError('Текущая папка не является Git-репозиторием.');
  const root = result.stdout.trim();
  process.chdir(root);
  return root;
}

export function currentBranch() {
  const result = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  // A repository without commits has no HEAD yet: fall back to the configured initial branch.
  if (result.code !== 0) return git(['symbolic-ref', '--short', 'HEAD']).stdout.trim() || 'HEAD';
  return result.stdout.trim();
}

/** Parses `git status --porcelain -z`. Renames and copies carry the original path in the next field. */
export function parseStatus(output) {
  const entries = output.split('\0');
  const changes = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    index += 1;
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    const paths = [path];
    if (/[RC]/.test(status) && index < entries.length) {
      paths.push(entries[index]);
      index += 1;
    }
    changes.push({ path, paths, status });
  }
  return changes;
}

export function changedFiles() {
  return parseStatus(gitChecked(['status', '--porcelain', '-z', '--untracked-files=all']).stdout);
}

export function repositoryFiles() {
  const result = gitChecked(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  return result.stdout.split('\0').filter(Boolean);
}

export const refExists = (ref) => git(['show-ref', '--verify', '--quiet', ref]).code === 0;

export function defaultBranch(remote, fallback) {
  const head = git(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]);
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim().replace(new RegExp(`^${remote}/`), '');
  for (const candidate of ['main', 'master', 'develop']) {
    if (refExists(`refs/remotes/${remote}/${candidate}`) || refExists(`refs/heads/${candidate}`)) return candidate;
  }
  return fallback;
}

export function remoteUrl(remote) {
  const result = git(['remote', 'get-url', remote]);
  return result.code === 0 ? result.stdout.trim() : null;
}

export function userName() {
  const result = git(['config', 'user.name']);
  return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

export function gitVersion() {
  const result = git(['--version']);
  return result.code === 0 ? result.stdout.trim() : null;
}
