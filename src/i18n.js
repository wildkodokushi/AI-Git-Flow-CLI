// Interface language. Generated texts (commit subjects, PR, README) follow `--lang`;
// the interface itself follows `--ui-lang`, AIGF_UI_LANG, the saved setting or the system locale.

const STRINGS = {
  en: {
    'banner.commit': 'Branch, commits and pull request',
    'common.cancelled': 'Cancelled.',
    'commit.section.analyse': '1. Analysing changes',
    'commit.nothing': 'Nothing to commit.',
    'commit.changedFiles': 'Changed files: {count}',
    'commit.provider': 'Provider: {name}, model: {model}',
    'commit.connected': 'Connected to the model.',
    'commit.section.plan': '2. Building the plan',
    'commit.groups': 'Groups: {count}',
    'commit.messageProgress': 'Message {index} of {count}: {key}',
    'commit.messageFailed': 'Could not get a message for group "{key}": {error}',
    'commit.planTitle': 'Commit plan',
    'commit.dryRun': 'Dry run: nothing was changed.',
    'commit.applyPlan': 'Apply the plan?',
    'commit.section.branch': '3. Branch',
    'commit.detached': 'The repository is in detached HEAD state. Switch to a branch or create a new one.',
    'commit.staying': 'Staying on branch {branch}, no new branch is created.',
    'commit.created': 'Created branch {branch}',
    'commit.section.commits': '4. Commits',
    'commit.skipped': 'Skipped (no changes): {message}',
    'commit.failed': 'Could not create commit "{message}": {details}',
    'commit.leftover': 'Uncommitted files left: {count}. Check git status.',
    'commit.pushSkipped': 'Push skipped (--no-push).',
    'commit.noRemote': 'Remote "{remote}" is not configured. Push skipped.',
    'commit.section.push': '5. Push',
    'commit.pushed': 'Branch {branch} pushed to {remote}',
    'commit.noPrOnCurrent': 'No pull request is created when working on the current branch.',
    'commit.section.summary': 'Summary',
    'commit.summaryBranch': 'Branch: {branch}',
    'commit.summaryCount': 'Commits created: {count}',
    'commit.summaryUsage': 'Model requests: {requests}, tokens: {tokens}',
    'commit.noData': 'n/a',
    'commit.currentBranch': 'Current branch: {branch}',
    'commit.branchPrompt': 'New branch name (e.g. feat/home-swiper). Enter . to stay on the current branch:',
    'commit.branchMissing': 'Branch name is missing. Cancelled.',
    'commit.invalidBranch': 'Invalid branch name: {name}',
    'commit.branchExists': 'Branch {name} already exists.',
    'pr.section': 'Pull request',
    'pr.noCommits': 'No commits relative to {base}. Pull request was not created.',
    'pr.descFailed': 'Could not generate the pull request text: {error}',
    'pr.ghNotFound': 'GitHub CLI (gh) was not found. Install it: {hint}',
    'pr.ghNotAuthed': 'GitHub CLI is not logged in. Run: gh auth login',
    'pr.manualText': 'Pull request text for manual creation:',
    'pr.failed': 'Could not create the pull request: {details}',
    'pr.created': 'Pull request created: {url}',
    'pr.createdNoUrl': 'Pull request created.',
    'pr.deepNote': 'Deep mode: sending up to {chars} characters of the diff.',
    'cli.unknownCommand': 'Unknown command "{command}". Help: aigf help',
  },
  ru: {
    'banner.commit': 'Ветка, коммиты и pull request',
    'common.cancelled': 'Операция отменена.',
    'commit.section.analyse': '1. Анализ изменений',
    'commit.nothing': 'Нет изменений для коммита.',
    'commit.changedFiles': 'Изменённых файлов: {count}',
    'commit.provider': 'Провайдер: {name}, модель: {model}',
    'commit.connected': 'Подключение к модели установлено.',
    'commit.section.plan': '2. Формирование плана',
    'commit.groups': 'Групп: {count}',
    'commit.messageProgress': 'Сообщение {index} из {count}: {key}',
    'commit.messageFailed': 'Не удалось получить сообщение для группы "{key}": {error}',
    'commit.planTitle': 'План коммитов',
    'commit.dryRun': 'Режим dry-run: изменения не внесены.',
    'commit.applyPlan': 'Выполнить план?',
    'commit.section.branch': '3. Ветка',
    'commit.detached': 'Репозиторий в состоянии detached HEAD. Перейдите на ветку или создайте новую.',
    'commit.staying': 'Остаёмся в ветке {branch}, новая ветка не создаётся.',
    'commit.created': 'Создана ветка {branch}',
    'commit.section.commits': '4. Коммиты',
    'commit.skipped': 'Пропущено (нет изменений): {message}',
    'commit.failed': 'Не удалось создать коммит "{message}": {details}',
    'commit.leftover': 'Остались незафиксированные файлы: {count}. Проверьте git status.',
    'commit.pushSkipped': 'Отправка пропущена (--no-push).',
    'commit.noRemote': 'Удалённый репозиторий "{remote}" не настроен. Отправка пропущена.',
    'commit.section.push': '5. Отправка',
    'commit.pushed': 'Ветка {branch} отправлена в {remote}',
    'commit.noPrOnCurrent': 'Pull request не создаётся при работе в текущей ветке.',
    'commit.section.summary': 'Итог',
    'commit.summaryBranch': 'Ветка: {branch}',
    'commit.summaryCount': 'Создано коммитов: {count}',
    'commit.summaryUsage': 'Запросов к модели: {requests}, токенов: {tokens}',
    'commit.noData': 'нет данных',
    'commit.currentBranch': 'Текущая ветка: {branch}',
    'commit.branchPrompt': 'Имя новой ветки (например, feat/home-swiper). Напишите . чтобы остаться в текущей ветке:',
    'commit.branchMissing': 'Имя ветки не указано. Операция отменена.',
    'commit.invalidBranch': 'Недопустимое имя ветки: {name}',
    'commit.branchExists': 'Ветка {name} уже существует.',
    'pr.section': 'Pull request',
    'pr.noCommits': 'Нет коммитов относительно {base}. Pull request не создаётся.',
    'pr.descFailed': 'Не удалось сгенерировать текст PR: {error}',
    'pr.ghNotFound': 'GitHub CLI (gh) не найден. Установите: {hint}',
    'pr.ghNotAuthed': 'GitHub CLI не авторизован. Выполните: gh auth login',
    'pr.manualText': 'Текст pull request для ручного создания:',
    'pr.failed': 'Не удалось создать pull request: {details}',
    'pr.created': 'Pull request создан: {url}',
    'pr.createdNoUrl': 'Pull request создан.',
    'pr.deepNote': 'Глубокий режим: в запрос передаётся до {chars} символов diff.',
    'cli.unknownCommand': 'Неизвестная команда "{command}". Справка: aigf help',
  },
};

let forced = null;

export function setUiLocale(value) {
  forced = value === 'ru' ? 'ru' : 'en';
}

export function uiLocale() {
  if (forced) return forced;
  const fromEnv = process.env.AIGF_UI_LANG;
  if (fromEnv) return fromEnv.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  let system = '';
  try {
    system = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
  } catch {
    system = '';
  }
  return system.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function t(key, vars = {}) {
  const table = STRINGS[uiLocale()] ?? STRINGS.en;
  const text = table[key] ?? STRINGS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}
