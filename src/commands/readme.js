import fs from 'node:fs';
import path from 'node:path';
import { enterRepository, remoteUrl, repositoryFiles } from '../git.js';
import { createLlm } from '../llm.js';
import { parseReadme, readmePrompt } from '../prompts.js';
import { buildReadme, excerpts, formatTree, projectInfo } from '../readme-builder.js';
import * as ui from '../ui.js';
import { UserError } from '../errors.js';
import { confirmOverwrite } from './license.js';

export async function readmeCommand(opts, config) {
  ui.banner('Генерация README.md');
  const root = enterRepository();

  ui.section('1. Анализ проекта');
  const files = repositoryFiles();
  if (files.length === 0) throw new UserError('В репозитории нет файлов для анализа.');
  const info = projectInfo(root, files);
  const tree = formatTree(files);
  const excerpt = excerpts(root, files);
  ui.info(`Файлов: ${files.length}. Обнаружено технологий: ${info.stack.length}`);

  ui.section('2. Генерация описания');
  const llm = createLlm(opts, config);
  ui.info(`Провайдер: ${llm.name}, модель: ${llm.models.large}`);
  await llm.ready();

  let narrative = { description: null, features: [] };
  try {
    const prompt = readmePrompt(info, tree, excerpt, opts.lang);
    narrative = parseReadme(await llm.ask({ ...prompt, tier: 'large', maxTokens: 500 }));
  } catch (error) {
    ui.warn(`Не удалось сгенерировать описание: ${error.message}`);
  }

  const text = buildReadme({ info, narrative, tree, files, root, remote: remoteUrl(opts.remote), lang: opts.lang });
  if (opts.dryRun) {
    ui.section('Предпросмотр (dry-run)');
    ui.print(text);
    return 0;
  }

  const target = path.join(root, 'README.md');
  if (fs.existsSync(target) && !(await confirmOverwrite('README.md', opts.force))) {
    ui.info('Операция отменена. Предпросмотр можно получить с параметром --dry-run.');
    return 0;
  }
  fs.writeFileSync(target, text, 'utf8');
  ui.ok('Файл README.md создан.');
  ui.info('Проверьте текст и при необходимости отредактируйте, затем выполните: aiflow');
  return 0;
}
