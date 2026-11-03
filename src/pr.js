import { firstUrl, ghRun, ghStatus, installHint } from './gh.js';
import { git } from './git.js';
import { prPrompt, parsePr } from './prompts.js';
import { applyImperative } from './text.js';
import { refExists } from './git.js';
import * as ui from './ui.js';

function fallbackTitle(branch, subjects) {
  const match = /^(feat|fix|refactor|perf|docs|style|test|build|ci|chore)\/(.+)$/.exec(branch);
  if (match) return `${match[1]}: ${match[2].replace(/[-_]/g, ' ')}`;
  return subjects[0] ?? branch;
}

export function renderPrBody(summary, subjects) {
  const lines = [];
  if (summary) lines.push('## Summary', '', summary, '');
  lines.push('## Changes', '', ...subjects.map((s) => `- ${s}`));
  return `${lines.join('\n')}\n`;
}

export async function createPullRequest({ llm, opts, branch, base }) {
  ui.section('Pull request');
  const baseRef = refExists(`refs/remotes/${opts.remote}/${base}`) ? `${opts.remote}/${base}` : base;

  const log = git(['log', '--reverse', '--pretty=format:%s', `${baseRef}..${branch}`]);
  const subjects = log.stdout.split(/\r?\n/).filter((l) => l.trim());
  if (subjects.length === 0) {
    ui.warn(`Нет коммитов относительно ${baseRef}. Pull request не создаётся.`);
    return null;
  }
  const stat = git(['diff', '--stat=100', `${baseRef}...${branch}`]).stdout;

  let title = null;
  let summary = '';
  try {
    const prompt = prPrompt(subjects, stat, opts.lang);
    const answer = await llm.ask({ ...prompt, tier: 'large', maxTokens: 400 });
    ({ title, summary } = parsePr(answer, opts.lang));
  } catch (error) {
    ui.warn(`Не удалось сгенерировать описание PR: ${error.message}`);
  }
  if (!title) title = applyImperative(fallbackTitle(branch, subjects), opts.lang);
  const body = renderPrBody(summary, subjects);

  const status = ghStatus();
  if (!status.installed || !status.authed) {
    ui.warn(status.installed ? 'GitHub CLI не авторизован. Выполните: gh auth login' : `GitHub CLI (gh) не найден. Установите: ${installHint()}`);
    ui.info('Текст pull request для ручного создания:');
    ui.print('');
    ui.print(title);
    ui.print('');
    ui.print(body);
    return null;
  }

  const args = ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body-file', '-'];
  if (opts.draft) args.push('--draft');
  const result = ghRun(args, body);
  if (result.code !== 0) {
    ui.warn(`Не удалось создать pull request: ${(result.stderr || result.stdout).trim()}`);
    return null;
  }
  const url = firstUrl(result.stdout);
  ui.ok(url ? `Pull request создан: ${url}` : 'Pull request создан.');
  return url ?? true;
}
