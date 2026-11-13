import fs from 'node:fs';
import path from 'node:path';
import { LOCK_FILE } from './grouping.js';
import { firstUrl, ghRun, ghStatus, installHint } from './gh.js';
import { git, refExists } from './git.js';
import { t } from './i18n.js';
import { parsePr, prPrompt } from './prompts.js';
import { applyImperative } from './text.js';
import * as ui from './ui.js';

const HEADINGS = {
  en: { done: 'What changed', test: 'How to test', checklist: 'Checklist', notes: 'Notes' },
  ru: { done: 'Что сделано', test: 'Как проверить', checklist: 'Чеклист', notes: 'Заметки' },
};

const CHECKLIST = {
  en: ['CI passes', 'Tests added or updated', 'Docs updated if behaviour changed'],
  ru: ['CI прошёл', 'Тесты добавлены или обновлены', 'Документация обновлена, если изменилось поведение'],
};

/** Commands a reviewer can run, taken from package.json. Empty for projects without npm scripts. */
export function detectCommands(root) {
  let scripts;
  try {
    scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {};
  } catch {
    return [];
  }
  if (Object.keys(scripts).length === 0) return [];
  const commands = [fs.existsSync(path.join(root, 'package-lock.json')) ? 'npm ci' : 'npm install'];
  if (scripts.lint) commands.push('npm run lint');
  if (scripts.test) commands.push('npm test');
  if (scripts.build) commands.push('npm run build');
  return commands;
}

export function renderPrBody({ lang = 'en', done, commands, checks, notes }) {
  const h = HEADINGS[lang] ?? HEADINGS.en;
  const out = [`## ${h.done}`, '', ...done.map((item) => `- ${item}`), ''];

  const test = [];
  if (commands.length > 0) test.push('```bash', ...commands, '```', '');
  if (checks.length > 0) test.push(...checks.map((item) => `- [ ] ${item}`), '');
  if (test.length > 0) out.push(`## ${h.test}`, '', ...test);

  out.push(`## ${h.checklist}`, '', ...(CHECKLIST[lang] ?? CHECKLIST.en).map((item) => `- [ ] ${item}`), '');
  if (notes.length > 0) out.push(`## ${h.notes}`, '', ...notes.map((item) => `- ${item}`), '');

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function fallbackTitle(branch, subjects) {
  const match = /^(feat|fix|refactor|perf|docs|style|test|build|ci|chore)\/(.+)$/.exec(branch);
  if (match) return `${match[1]}: ${match[2].replace(/[-_]/g, ' ')}`;
  return subjects[0] ?? branch;
}

/** Diff for deep mode: lock files are excluded and the text is capped to keep the request affordable. */
function diffForReview(range, maxChars) {
  const excludes = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'poetry.lock', 'Cargo.lock', 'go.sum']
    .map((name) => `:(exclude)${name}`);
  const patch = git(['diff', '--no-color', '-U2', range, '--', '.', ...excludes]).stdout;
  if (patch.length <= maxChars) return patch;
  return `${patch.slice(0, maxChars)}\n[diff truncated]`;
}

/**
 * Looks the base branch up on the remote. `exists` is null when the remote cannot be asked
 * (offline, no access): the pull request is then attempted anyway and gh reports the real reason.
 */
export function remoteBranch(remote, name) {
  const result = git(['ls-remote', '--exit-code', '--heads', remote, name]);
  if (result.code === 2) return { exists: false, tip: null };
  if (result.code !== 0) return { exists: null, tip: null };
  const tip = result.stdout.split(/\s+/)[0] || null;
  return { exists: true, tip };
}

export async function createPullRequest({ llm, opts, branch, base, fromCommit = null }) {
  ui.section(t('pr.section'));

  // Commits and diff are counted from the point where the branch was created, so only the work
  // done by this run is described, not everything the base branch has accumulated since main.
  let range;
  let logRange;
  let baseLabel = base;
  if (fromCommit) {
    range = `${fromCommit}..${branch}`;
    logRange = range;
  } else {
    const baseRef = refExists(`refs/remotes/${opts.remote}/${base}`) ? `${opts.remote}/${base}` : base;
    range = `${baseRef}...${branch}`;
    logRange = `${baseRef}..${branch}`;
    baseLabel = baseRef;
  }

  const log = git(['log', '--reverse', '--pretty=format:%s', logRange]).stdout;
  const subjects = log.split(/\r?\n/).filter((line) => line.trim());
  if (subjects.length === 0) {
    ui.warn(t('pr.noCommits', { base: baseLabel }));
    return null;
  }

  const remoteBase = remoteBranch(opts.remote, base);
  if (remoteBase.exists && remoteBase.tip && fromCommit && git(['cat-file', '-e', `${remoteBase.tip}^{commit}`]).code === 0) {
    const ahead = Number(git(['rev-list', '--count', `${remoteBase.tip}..${fromCommit}`]).stdout.trim());
    if (ahead > 0) ui.warn(t('pr.baseBehind', { base, remote: opts.remote, count: ahead }));
  }

  const stat = git(['diff', '--stat=100', range]).stdout;
  const deep = Boolean(opts.deepPr);
  const patch = deep ? diffForReview(range, opts.prMaxChars) : null;
  if (deep) ui.info(t('pr.deepNote', { chars: opts.prMaxChars }));

  let parsed = { title: null, done: [], checks: [], notes: [] };
  try {
    const prompt = prPrompt({ lang: opts.lang, subjects, stat, patch, deep });
    const answer = await llm.ask({ ...prompt, tier: 'large', maxTokens: deep ? 1200 : 400 });
    parsed = parsePr(answer, opts.lang);
  } catch (error) {
    ui.warn(t('pr.descFailed', { error: error.message }));
  }

  const title = parsed.title || applyImperative(fallbackTitle(branch, subjects), opts.lang);
  const done = parsed.done.length > 0 ? parsed.done : subjects;
  const body = renderPrBody({
    lang: opts.lang,
    done,
    commands: detectCommands(process.cwd()),
    checks: deep ? parsed.checks : [],
    notes: deep ? parsed.notes : [],
  });

  const status = ghStatus();
  const manual = (reason) => {
    ui.warn(reason);
    ui.info(t('pr.manualText'));
    ui.print('');
    ui.print(title);
    ui.print('');
    ui.print(body);
    return null;
  };
  if (!status.installed) return manual(t('pr.ghNotFound', { hint: installHint() }));
  if (!status.authed) return manual(t('pr.ghNotAuthed'));
  if (remoteBase.exists === false) return manual(t('pr.baseMissing', { base, remote: opts.remote }));

  const args = ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body-file', '-'];
  if (opts.draft) args.push('--draft');
  const result = ghRun(args, body);
  if (result.code !== 0) {
    ui.warn(t('pr.failed', { details: (result.stderr || result.stdout).trim() }));
    return null;
  }
  const url = firstUrl(result.stdout);
  ui.ok(url ? t('pr.created', { url }) : t('pr.createdNoUrl'));
  return url ?? true;
}
