import { hasCommand, gitVersion } from '../git.js';
import { ghStatus, installHint } from '../gh.js';
import { createLlm } from '../llm.js';
import { SAMPLES } from '../samples.js';
import * as ui from '../ui.js';
import { buildCommitMessage, fallbackMessage, toSubject } from '../text.js';
import { commitPrompt, issuePrompt, parseIssue, parsePr, parseReadme, prPrompt, readmePrompt } from '../prompts.js';

const status = (state) => ({ pass: ui.c.green('PASS'), warn: ui.c.yellow('WARN'), fail: ui.c.red('FAIL') })[state];

/**
 * Calibration: the same prompts and parsers the tool uses in real work are run against a fixed sample.
 * This is the practical "minimum model bar": a model is fit for a tier if it follows the output formats.
 */
export async function runCalibration(llm, lang = 'en') {
  const results = [];
  const record = (id, tier, state, note) => results.push({ id, tier, state, note });
  const attempt = async (id, tier, fn) => {
    try {
      await fn();
    } catch (error) {
      record(id, tier, 'fail', error.message);
    }
  };

  await attempt('commit-format', 'small', async () => {
    const prompt = commitPrompt(SAMPLES.codeGroup, SAMPLES.codeContext, 'en');
    const answer = await llm.ask({ ...prompt, tier: 'small', maxTokens: 80 });
    const message = buildCommitMessage(SAMPLES.codeGroup, answer, 'en');
    const singleLine = answer.trim().split(/\r?\n/).length === 1 && !answer.includes('```');
    if (message === fallbackMessage(SAMPLES.codeGroup)) record('commit-format', 'small', 'fail', `Ответ не удалось разобрать: ${answer.slice(0, 80)}`);
    else if (!singleLine) record('commit-format', 'small', 'warn', 'Ответ содержит лишний текст, но был успешно очищен.');
    else record('commit-format', 'small', 'pass', message);
  });

  await attempt('commit-language', 'small', async () => {
    const prompt = commitPrompt(SAMPLES.docsGroup, SAMPLES.docsContext, 'ru');
    const answer = await llm.ask({ ...prompt, tier: 'small', maxTokens: 80 });
    const subject = toSubject(answer, 100) ?? '';
    if (/[а-яё]/i.test(subject)) record('commit-language', 'small', 'pass', subject);
    else record('commit-language', 'small', 'fail', `Модель не ответила по-русски: ${subject.slice(0, 80)}`);
  });

  await attempt('pull-request', 'large', async () => {
    const prompt = prPrompt({ lang, subjects: SAMPLES.subjects, stat: SAMPLES.stat, patch: null, deep: false });
    const parsed = parsePr(await llm.ask({ ...prompt, tier: 'large', maxTokens: 400 }), lang);
    if (parsed.title && parsed.done.length >= 2) record('pull-request', 'large', 'pass', parsed.title);
    else record('pull-request', 'large', 'fail', 'Нет заголовка или описания в ожидаемом формате.');
  });

  await attempt('readme', 'large', async () => {
    const prompt = readmePrompt(SAMPLES.info, SAMPLES.tree, '', lang);
    const { description, features } = parseReadme(await llm.ask({ ...prompt, tier: 'large', maxTokens: 500 }));
    if (description && features.length >= 2) record('readme', 'large', 'pass', `${features.length} пунктов`);
    else record('readme', 'large', 'fail', 'Нет DESCRIPTION/FEATURES в ожидаемом формате.');
  });

  await attempt('issue', 'large', async () => {
    const prompt = issuePrompt(SAMPLES.issue, lang);
    const parsed = parseIssue(await llm.ask({ ...prompt, tier: 'large', maxTokens: 700 }));
    if (parsed.title && parsed.body && parsed.body.includes('##')) record('issue', 'large', 'pass', parsed.title);
    else record('issue', 'large', 'fail', 'Нет TITLE/BODY в ожидаемом формате.');
  });

  return results;
}

export function verdict(results) {
  const tierOk = (tier) => results.filter((r) => r.tier === tier).every((r) => r.state !== 'fail');
  return { small: tierOk('small'), large: tierOk('large') };
}

export function printCalibration(results, models) {
  const labels = {
    'commit-format': 'Формат темы коммита',
    'commit-language': 'Язык ответа',
    'pull-request': 'Описание pull request',
    readme: 'Данные для README',
    issue: 'Структура issue',
  };
  for (const result of results) {
    ui.print(`  ${status(result.state)}  ${labels[result.id].padEnd(24)} ${ui.c.gray(result.note)}`);
  }
  const { small, large } = verdict(results);
  ui.print('');
  if (small) ui.ok(`Модель ${models.small} подходит для тем коммитов.`);
  else ui.warn(`Модель ${models.small} плохо справляется с темами коммитов. Выберите более сильную: aigf init`);
  if (large) ui.ok(`Модель ${models.large} подходит для README, PR и issue.`);
  else ui.warn(`Модель ${models.large} не справилась с длинными текстами. Для README, PR и issue нужна модель сильнее.`);
}

export async function doctorCommand(opts, config) {
  ui.banner('Диагностика');
  let failures = 0;

  ui.section('Окружение');
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) ui.ok(`Node.js ${process.versions.node}`);
  else {
    ui.warn(`Node.js ${process.versions.node}: нужна версия 20 или новее.`);
    failures += 1;
  }
  const version = hasCommand('git') ? gitVersion() : null;
  if (version) ui.ok(version);
  else {
    ui.warn('Git не найден в PATH.');
    failures += 1;
  }
  const gh = ghStatus();
  if (gh.installed && gh.authed) ui.ok('GitHub CLI установлен и авторизован.');
  else if (gh.installed) ui.warn('GitHub CLI не авторизован: gh auth login (нужен для PR и issue).');
  else ui.warn(`GitHub CLI не найден (нужен для PR и issue): ${installHint()}`);

  ui.section('Провайдер');
  let llm;
  try {
    llm = createLlm(opts, config);
    ui.info(`Провайдер: ${llm.name}`);
    ui.info(`Модели: ${llm.models.small} (короткие тексты), ${llm.models.large} (длинные тексты)`);
    await llm.ready();
    ui.ok('Подключение и авторизация работают.');
  } catch (error) {
    ui.warn(error.message);
    return 1;
  }

  if (opts.quick) return failures > 0 ? 1 : 0;

  ui.section('Проверка модели');
  ui.info('Выполняется 5 коротких запросов (около 3 000 токенов).');
  const results = await runCalibration(llm, opts.lang);
  printCalibration(results, llm.models);
  ui.info(`Использовано токенов: ${llm.usage.total || 'нет данных'}`);
  return failures > 0 ? 1 : 0;
}
