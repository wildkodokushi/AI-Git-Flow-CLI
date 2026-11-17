const HELP = {
  ru: `AI Git Flow {version}: помощник для Git на основе нейросетей

Раскладывает ваши изменения по аккуратным коммитам, создаёт ветку, отправляет её
на GitHub и открывает pull request. Умеет также писать README, LICENSE и issue.

БЫСТРЫЙ СТАРТ
  1. aigf init              один раз: выбрать нейросеть и ввести ключ
  2. aigf --dry-run         посмотреть план коммитов, ничего не меняя
  3. aigf                   выполнить: ветка, коммиты, push и pull request

КОМАНДЫ
  aigf                      основная команда: ветка, коммиты, push, pull request
  aigf readme               создать README.md по содержимому проекта
  aigf license              создать файл LICENSE (MIT, Apache-2.0, GPL-3.0 и другие)
  aigf issue "описание"     превратить короткую заметку в issue на GitHub
  aigf init                 мастер настройки: нейросеть, ключ, модели
  aigf doctor               проверить окружение и качество выбранной модели
  aigf provider <действие>  нейросети: list, use, add, key, remove, models
  aigf config <действие>    настройки по умолчанию: show, path, set, unset

ЧАСТЫЕ СЦЕНАРИИ
  aigf -b feat/login        создать ветку feat/login и выполнить всё остальное
  aigf --stay               закоммитить прямо в текущую ветку, без новой ветки и PR
  aigf -y                   не задавать вопросов
  aigf --deep-pr            подробный PR: проверки и заметки для ревьюера (больше токенов)
  aigf --draft              открыть PR как черновик
  aigf --lang ru            тексты коммитов и PR на русском
  aigf issue "Кнопка входа не работает" --labels bug

ПАРАМЕТРЫ
  Ветка и коммиты
    -b, --branch <имя>      имя новой ветки; точка "." оставляет текущую ветку
    --stay                  не создавать ветку (PR при этом не создаётся)
    --dry-run               показать результат, ничего не меняя
    -y, --yes               не спрашивать подтверждение
    --no-push               не отправлять ветку на GitHub

  Pull request
    --base <ветка>          в какую ветку открыть PR (по умолчанию: от которой создана новая)
    --draft                 открыть PR как черновик
    --deep-pr               подробный PR (в запрос уходит diff)
    --pr-max-chars <число>  сколько символов diff отправлять для подробного PR (15000)
    --no-pr                 не создавать PR

  Язык и нейросеть
    --lang en|ru            язык генерируемых текстов: коммиты, PR, README, issue
    --ui-lang en|ru         язык интерфейса и подсказок
    --provider <имя>        нейросеть на один запуск
    --model <имя>           модель для коротких текстов (темы коммитов)
    --pr-model <имя>        модель для PR, README и issue

  Для license, issue и README
    --type <вид>            license: mit, apache-2.0, gpl-3.0 ...
    --author <имя>          license: правообладатель
    --year <год>            license: год
    --labels a,b            issue: метки
    --force                 перезаписать LICENSE или README.md без вопроса

  Служебные
    --insecure              не проверять TLS-сертификаты (небезопасно)
    -h, --help              эта справка
    -v, --version           версия

ПОДСКАЗКИ
  Параметр без значения покажет текущее: aigf --lang, aigf -b, aigf --provider
  Что-то не работает: aigf doctor
  Документация: https://github.com/wildkodokushi/AI-Git-Flow-CLI
`,
  en: `AI Git Flow {version}: a Git assistant powered by language models

Splits your changes into tidy commits, creates a branch, pushes it to GitHub
and opens a pull request. It can also write a README, a LICENSE and issues.

QUICK START
  1. aigf init              once: choose a model provider and enter your key
  2. aigf --dry-run         see the commit plan without changing anything
  3. aigf                   run it: branch, commits, push and pull request

COMMANDS
  aigf                      the main command: branch, commits, push, pull request
  aigf readme               create README.md from the project contents
  aigf license              create a LICENSE file (MIT, Apache-2.0, GPL-3.0 and others)
  aigf issue "description"  turn a short note into a GitHub issue
  aigf init                 setup wizard: provider, key, models
  aigf doctor               check the environment and the quality of the chosen model
  aigf provider <action>    providers: list, use, add, key, remove, models
  aigf config <action>      default settings: show, path, set, unset

COMMON SCENARIOS
  aigf -b feat/login        create the branch feat/login and do everything else
  aigf --stay               commit straight to the current branch, no new branch and no PR
  aigf -y                   do not ask any questions
  aigf --deep-pr            detailed PR: checks and notes for the reviewer (more tokens)
  aigf --draft              open the PR as a draft
  aigf --lang ru            commit and PR texts in Russian
  aigf issue "Login button does nothing" --labels bug

OPTIONS
  Branch and commits
    -b, --branch <name>     new branch name; "." keeps the current branch
    --stay                  do not create a branch (no PR is created either)
    --dry-run               show the result, change nothing
    -y, --yes               do not ask for confirmation
    --no-push               do not push the branch to GitHub

  Pull request
    --base <branch>         branch the PR targets (default: the one the new branch came from)
    --draft                 open the PR as a draft
    --deep-pr               detailed PR (the diff is sent to the model)
    --pr-max-chars <n>      how many diff characters to send for a detailed PR (15000)
    --no-pr                 do not create a PR

  Language and model
    --lang en|ru            language of generated texts: commits, PR, README, issue
    --ui-lang en|ru         language of the interface and tips
    --provider <name>       provider for this run only
    --model <name>          model for short texts (commit subjects)
    --pr-model <name>       model for PR, README and issue

  For license, issue and README
    --type <kind>           license: mit, apache-2.0, gpl-3.0 ...
    --author <name>         license: copyright holder
    --year <year>           license: year
    --labels a,b            issue: labels
    --force                 overwrite LICENSE or README.md without asking

  Other
    --insecure              skip TLS verification (unsafe)
    -h, --help              this help
    -v, --version           version

TIPS
  An option without a value shows the current one: aigf --lang, aigf -b, aigf --provider
  Something does not work: aigf doctor
  Documentation: https://github.com/wildkodokushi/AI-Git-Flow-CLI
`,
};

export const helpFor = (locale, version) => HELP[locale === 'ru' ? 'ru' : 'en'].replace('{version}', version);
