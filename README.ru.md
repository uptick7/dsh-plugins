[English](README.md) | Русский

# DSH Plugins

Коллекция плагинов для [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh) — по одному самодостаточному каталогу на плагин. Репозиторий не ограничен веб-плагинами: подходят и серверные, и смешанные.

## Плагины

| Плагин | npm-пакет | Версия | Описание |
|---|---|---|---|
| [message-edit](message-edit/) | [`@uptick7/dsh-message-edit`](https://www.npmjs.com/package/@uptick7/dsh-message-edit) | 1.5.1 | Правка отправленного сообщения «на месте»: исправленный текст заменяет предыдущий обмен в контексте той же сессии, сессия продолжается без fork. |
| [commands-bridge](commands-bridge/) | [`@uptick7/dsh-commands-bridge`](https://www.npmjs.com/package/@uptick7/dsh-commands-bridge) | 1.0.0 | Мост markdown slash-команд: общие (`~/.agents/commands`), агентные (`~/.dsh/commands`) и проектные (`<cwd>/.agents/commands`) директории подключаются к реестру команд, страница Settings → Commands показывает описание, argument-hint и тумблеры. |

## Установка

### Из npm (рекомендуется)

Каждый плагин — обычный JS-пакет, опубликованный на npm; сборка TypeScript/Vite не требуется. Установите в профиль DSH (замените `web` на имя своего профиля), затем перезапустите host:

```sh
dsh plugin --profile web add @uptick7/dsh-message-edit
dsh plugin --profile web add @uptick7/dsh-commands-bridge
```

Либо из веб-GUI: **Плагины** (Plugin Manager) → найти пакет по имени → установить.

### Из исходников

Склонируйте репозиторий и укажите в профиле DSH путь к каталогу плагина: добавьте `"link:<абсолютный-путь>/message-edit"` (или `commands-bridge`) в `dependencies` профиля **и** имя пакета в `dsh.profile.bundles`. Подробности и ограничения — в README самого плагина.

## Разработка

Каталоги плагинов независимы друг от друга:

```sh
cd message-edit
npm test        # node --test; требуется локальная установка DSH
npm run check   # проверка синтаксиса
```

Тесты используют настоящие DSH `Session` и V4 codec (без запросов к модели). DSH ищется через `npm root -g`; другая установка:

```sh
DSH_ROOT=/path/to/@deepseek-ai/dsh npm test
```

## Релизы

Оба пакета публикуются из CI: поднимите `version` в `package.json` плагина, поставьте тег `<плагин>-v<версия>` (например `message-edit-v1.5.2`) — [релиз-воркфлоу](.github/workflows/release.yml) прогонит проверки и опубликует пакет в npm с секретом `NPM_TOKEN` репозитория. Вручную тоже можно: аккаунт npm со scope `uptick7`, затем `npm publish` внутри каталога плагина.

После первого релиза стоит добавить репозиторий в общественный каталог — PR из одного файла в [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin#contributing) (`data/plugins/uptick7__dsh-plugins.yml`) и topic `dsh-plugin` на GitHub-репозитории, иначе каталог не примет. Заготовки заявок лежат в [catalog/](catalog/).

## Участие в разработке

- Один каталог на плагин, назван по имени плагина.
- В каждом плагине — собственный двуязычный README (`README.md` + `README.ru.md`), `package.json` и тесты.
- Плагины не должны зависеть друг от друга.
- npm-идентичность плагина должна быть согласованной: имя пакета в `package.json`, `name:` в его `cordis.patch.yml` и `id` клиентского модуля совпадают.

## Лицензия

Распространяется по [лицензии MIT](LICENSE).
