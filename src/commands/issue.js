import { UserError } from '../errors.js';
import { firstUrl, ghRun, ghStatus, installHint } from '../gh.js';
import { currentBranch, enterRepository, git, repositoryFiles } from '../git.js';
import { createLlm } from '../llm.js';
import { issuePrompt, parseIssue } from '../prompts.js';
import * as ui from '../ui.js';

export async function issueCommand(opts, config, rest) {
  ui.banner('Создание issue на GitHub');
  enterRepository();

  let request = rest.join(' ').trim();
  if (!request) request = (await ui.ask('Опишите проблему или задачу:')).trim();
  if (!request) throw new UserError('Описание не указано.');

  const llm = createLlm(opts, config);
  ui.info(`Провайдер: ${llm.name}, модель: ${llm.models.large}`);
  await llm.ready();

  const recent = git(['log', '-5', '--pretty=format:%s']).stdout;
  let topLevel = [];
  try {
    topLevel = [...new Set(repositoryFiles().map((f) => f.split('/')[0]))].slice(0, 40);
  } catch {
    // An empty repository has no files yet.
  }

  let parsed = { type: 'task', title: null, body: null };
  try {
    const prompt = issuePrompt({ request, branch: currentBranch(), recent, topLevel }, opts.lang);
    parsed = parseIssue(await llm.ask({ ...prompt, tier: 'large', maxTokens: 700 }));
  } catch (error) {
    ui.warn(`Не удалось сгенерировать issue: ${error.message}`);
  }
  const title = parsed.title || request.slice(0, 70).trim();
  const body = parsed.body || request;

  let labels = [];
  if (opts.labels) labels = opts.labels.split(',').map((l) => l.trim()).filter(Boolean);
  else if (parsed.type === 'bug') labels = ['bug'];
  else if (parsed.type === 'feature') labels = ['enhancement'];

  ui.section('Issue');
  ui.print(ui.c.white(title));
  if (labels.length) ui.print(ui.c.gray(`Метки: ${labels.join(', ')}`));
  ui.print('');
  ui.print(body);
  ui.print('');

  if (opts.dryRun) {
    ui.info('Режим dry-run: issue не создан.');
    return 0;
  }
  if (!opts.yes && !(await ui.confirm('Создать issue?'))) {
    ui.info('Операция отменена.');
    return 0;
  }

  const status = ghStatus();
  if (!status.installed || !status.authed) {
    ui.warn(status.installed ? 'GitHub CLI не авторизован. Выполните: gh auth login' : `GitHub CLI (gh) не найден. Установите: ${installHint()}`);
    ui.info('Текст выше можно использовать для ручного создания issue.');
    return 0;
  }

  const baseArgs = ['issue', 'create', '--title', title, '--body-file', '-'];
  let result = ghRun([...baseArgs, ...labels.flatMap((l) => ['--label', l])], `${body}\n`);
  if (result.code !== 0 && labels.length > 0 && /label/i.test(result.stderr + result.stdout)) {
    ui.warn('Метки отсутствуют в репозитории. Повторная попытка без меток.');
    result = ghRun(baseArgs, `${body}\n`);
  }
  if (result.code !== 0) throw new UserError(`Не удалось создать issue: ${(result.stderr || result.stdout).trim()}`);
  const url = firstUrl(result.stdout);
  ui.ok(url ? `Issue создан: ${url}` : 'Issue создан.');
  return 0;
}

