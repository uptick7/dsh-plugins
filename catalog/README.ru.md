[English](README.md) | Русский

# Заявка в каталог

Готовая к копированию заявка для общественного каталога плагинов
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin#contributing) —
он же источник вкладки **Плагины → Discover** в веб-GUI DSH и
[dsh-market](https://github.com/dsh-market/dsh-market).

Файл `uptick7__dsh-plugins.yml` — вся заявка: откройте PR в тот репозиторий, добавив файл как `data/plugins/uptick7__dsh-plugins.yml`. Больше ничего не нужно — README и индекс маркета перегенерируются автоматически после слияния.

## Перед открытием PR

- [ ] Плагин устанавливается: `package.json` объявляет манифест `dsh.bundle` (проверяется автоматически в каждом PR).
- [ ] У GitHub-репозитория проставлен topic `dsh-plugin` (страница репозитория → About → шестерёнка → Topics).
- [ ] Репозиторию больше суток.
