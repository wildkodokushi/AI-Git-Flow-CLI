import fs from 'node:fs';
import path from 'node:path';
import { UserError } from '../errors.js';
import { enterRepository, userName } from '../git.js';
import { LICENSES, licenseText, normalizeLicenseKey } from '../licenses.js';
import * as ui from '../ui.js';

async function pickLicense(requested) {
  if (requested) return normalizeLicenseKey(requested);
  const keys = Object.keys(LICENSES);
  const index = await ui.choose('Выберите лицензию:', keys.map((key) => ({ label: key, hint: LICENSES[key].description })));
  return keys[index];
}

export async function confirmOverwrite(name, force) {
  if (force) return true;
  return ui.confirm(`Файл ${name} уже существует. Перезаписать?`, false);
}

export async function licenseCommand(opts) {
  ui.banner('Создание файла лицензии');
  const root = enterRepository();

  const key = await pickLicense(opts.type);
  let holder = opts.author || userName();
  if (!holder) holder = await ui.ask('Правообладатель (имя автора):');
  if (!holder) throw new UserError('Правообладатель не указан.');

  const text = await licenseText(key, { year: opts.year, holder: holder.trim(), insecure: opts.insecure });
  if (opts.dryRun) {
    ui.section('Предпросмотр (dry-run)');
    ui.print(text);
    return 0;
  }

  const existing = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].find((name) => fs.existsSync(path.join(root, name)));
  const target = existing ?? 'LICENSE';
  if (existing && !(await confirmOverwrite(target, opts.force))) {
    ui.info('Операция отменена.');
    return 0;
  }
  fs.writeFileSync(path.join(root, target), text, 'utf8');
  ui.ok(`Файл ${target} создан: лицензия ${key}, правообладатель ${holder.trim()}, год ${opts.year}`);
  ui.info('Закоммитить и отправить файл можно командой: aiflow');
  return 0;
}
