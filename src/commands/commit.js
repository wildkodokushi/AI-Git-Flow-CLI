import { UserError } from '../errors.js';
import {
  changedFiles, currentBranch, defaultBranch, enterRepository, git, gitChecked, refExists, remoteUrl,
} from '../git.js';
import { LOCK_FILE, buildPlan } from '../grouping.js';
import { createLlm } from '../llm.js';
import { createPullRequest } from '../pr.js';
import { commitPrompt } from '../prompts.js';
import { buildCommitMessage, fallbackMessage } from '../text.js';
import * as ui from '../ui.js';

const CHUNK = 100;

function addPaths(paths) {
  for (let i = 0; i < paths.length; i += CHUNK) {
    gitChecked(['add', '-A', '--', ...paths.slice(i, i + CHUNK)]);
  }
}

function groupContext(group, maxChars) {
  const paths = group.paths.slice(0, 40);
  const stat = git(['diff', '--cached', '--stat=100', '--', ...paths]).stdout;
  const patchPaths = paths.filter((p) => !LOCK_FILE.test(p));
  if (patchPaths.length === 0) return stat;
  let patch = git(['diff', '--cached', '-U1', '--no-color', '--', ...patchPaths]).stdout;
  if (patch.length > maxChars) patch = `${patch.slice(0, maxChars)}\n[diff truncated]`;
  return `${stat}\n\n${patch}`;
}

function showPlan(plan) {
  ui.section('План коммитов');
  plan.forEach((group, index) => {
    ui.print(`${ui.c.gray(String(index + 1).padStart(2))}. ${ui.c.white(group.message)}`);
    for (const file of group.files.slice(0, 6)) ui.print(ui.c.gray(`      ${file}`));
    if (group.files.length > 6) ui.print(ui.c.gray(`      ... и ещё ${group.files.length - 6}`));
  });
  ui.print('');
}

/** Returns "." to stay on the current branch, otherwise a valid new branch name. */
async function resolveBranch(requested, current) {
  let name = requested;
  const interactive = requested === undefined;
  for (;;) {
    if (name === undefined || name === '') {
      ui.print(ui.c.gray(`Текущая ветка: ${current}`));
      name = await ui.ask('Имя новой ветки (например, feat/home-swiper). Напишите . чтобы остаться в текущей ветке:');
      if (!name) throw new UserError('Имя ветки не указано. Операция отменена.');
    }
    name = name.trim();
    if (name === '.') return '.';

    const problem =
      git(['check-ref-format', '--branch', name]).code !== 0
        ? `Недопустимое имя ветки: ${name}`
        : refExists(`refs/heads/${name}`)
          ? `Ветка ${name} уже существует.`
          : null;
    if (!problem) return name;
    if (!interactive) throw new UserError(problem);
    ui.warn(problem);
    name = undefined;
  }
}

export async function commitCommand(opts, config) {
  ui.banner('Ветка, коммиты и pull request');
  enterRepository();

  ui.section('1. Анализ изменений');
  const changes = changedFiles();
  if (changes.length === 0) {
    ui.ok('Нет изменений для коммита.');
    return 0;
  }
  ui.info(`Изменённых файлов: ${changes.length}`);

  const startBranch = currentBranch();
  const base = opts.base || defaultBranch(opts.remote, startBranch);

  const llm = createLlm(opts, config);
  ui.info(`Провайдер: ${llm.name}, модель: ${llm.models.small}`);
  await llm.ready();
  ui.ok('Подключение к модели установлено.');

  ui.section('2. Формирование плана');
  const plan = buildPlan(changes, opts.maxCodeGroups);
  ui.info(`Групп: ${plan.length}`);

  // The index is rebuilt per group during execution; here it only serves diff generation.
  gitChecked(['reset', '-q']);
  gitChecked(['add', '-A']);
  try {
    let number = 1;
    for (const group of plan) {
      ui.info(`Сообщение ${number} из ${plan.length}: ${group.key}`);
      number += 1;
      try {
        const prompt = commitPrompt(group, groupContext(group, opts.maxDiffChars), opts.lang);
        const answer = await llm.ask({ ...prompt, tier: 'small', maxTokens: 80 });
        group.message = buildCommitMessage(group, answer, opts.lang);
      } catch (error) {
        ui.warn(`Не удалось получить сообщение для группы "${group.key}": ${error.message}`);
        group.message = fallbackMessage(group);
      }
    }
  } finally {
    git(['reset', '-q']);
  }
  showPlan(plan);

  if (opts.dryRun) {
    ui.info('Режим dry-run: изменения не внесены.');
    return 0;
  }
  if (!opts.yes && !(await ui.confirm('Выполнить план?'))) {
    ui.info('Операция отменена.');
    return 0;
  }

  ui.section('3. Ветка');
  const choice = opts.stay ? '.' : await resolveBranch(opts.branch, startBranch);
  const stay = choice === '.';
  let branch;
  if (stay) {
    if (startBranch === 'HEAD') throw new UserError('Репозиторий в состоянии detached HEAD. Перейдите на ветку или создайте новую.');
    branch = startBranch;
    ui.info(`Остаёмся в ветке ${branch}, новая ветка не создаётся.`);
  } else {
    branch = choice;
    gitChecked(['switch', '-c', branch]);
    ui.ok(`Создана ветка ${branch}`);
  }

  ui.section('4. Коммиты');
  let created = 0;
  for (const group of plan) {
    addPaths(group.paths);
    const result = git(['commit', '-q', '-F', '-'], { input: `${group.message}\n` });
    if (result.code !== 0) {
      const text = `${result.stdout}\n${result.stderr}`;
      if (/nothing (added )?to commit|no changes added/.test(text)) {
        ui.warn(`Пропущено (нет изменений): ${group.message}`);
        continue;
      }
      throw new UserError(`Не удалось создать коммит "${group.message}": ${text.trim()}`);
    }
    created += 1;
    ui.ok(group.message);
  }
  const left = changedFiles();
  if (left.length > 0) ui.warn(`Остались незафиксированные файлы: ${left.length}. Проверьте git status.`);

  if (opts.noPush) {
    ui.info('Отправка пропущена (--no-push).');
  } else if (!remoteUrl(opts.remote)) {
    ui.warn(`Удалённый репозиторий "${opts.remote}" не настроен. Отправка пропущена.`);
  } else {
    ui.section('5. Отправка');
    gitChecked(['push', '-u', opts.remote, branch]);
    ui.ok(`Ветка ${branch} отправлена в ${opts.remote}`);
    if (stay) ui.info('Pull request не создаётся при работе в текущей ветке.');
    else if (!opts.noPr) await createPullRequest({ llm, opts, branch, base });
  }

  ui.section('Итог');
  ui.info(`Ветка: ${branch}`);
  ui.info(`Создано коммитов: ${created}`);
  if (llm.usage.requests > 0) {
    ui.info(`Запросов к модели: ${llm.usage.requests}, токенов: ${llm.usage.total || 'нет данных'}`);
  }
  return 0;
}
