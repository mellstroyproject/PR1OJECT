# Чеклист запуска NextProject

## 1. Файлы
- [ ] Заменить на сервере: `index.html`, `server.js`, `messenger.js`, `messenger.html`, `sw.js`, `manifest.webmanifest`, `README.md`
- [ ] Положить рядом с `server.js`: иконки `icon-180.png`, `icon-192.png`, `icon-512.png`
- [ ] Положить рядом с `server.js` мелодию звонка `ring.mp3` (только если есть права на использование)
- [ ] `npm install` (должны стоять `web-push` и `grammy`)

## 2. Переменные окружения (Render → Environment)
- [ ] `SITE_URL` — адрес сайта, например `https://nextproject-unnr.onrender.com` или свой домен
- [ ] `TG_BOT_TOKEN`, `TG_ADMINS`, `TG_CHANNEL`, `TG_WEBHOOK_SECRET` — Telegram-бот
- [ ] `VAPID_PUBLIC`, `VAPID_PRIVATE`, `VAPID_SUBJECT` — push-уведомления (ключи: `npx web-push generate-vapid-keys`)
- [ ] `TURN_URL`, `TURN_USER`, `TURN_PASS` — необязательно, для звонков за NAT

## 3. Проверка после деплоя
- [ ] Главная открывается, видна кнопка «Чат»
- [ ] `/robots.txt` и `/sitemap.xml` открываются
- [ ] `/yandex_e579aaaa9eb23608.html` показывает строку `Verification: e579aaaa9eb23608`
- [ ] Вход через Steam работает, чат открывается
- [ ] Звонок между двумя аккаунтами: звук идёт
- [ ] Плашка и звук входящего звонка на любой странице
- [ ] Telegram: `/call ник` присылает кнопку со ссылкой

## 4. Поиск
- [ ] Яндекс Вебмастер: нажать «Подтвердить» на странице HTML-файла
- [ ] Яндекс Вебмастер: «Индексирование» → «Файлы Sitemap» → `/sitemap.xml`
- [ ] Google Search Console: добавить ресурс, подтвердить, отправить `/sitemap.xml`
- [ ] Ссылки на сайт в Telegram-канале, Steam-группе, Discord, ВК
- [ ] Через 1–2 недели проверить `site:адрес` в поиске

## 5. Домен (по желанию)
- [ ] Купить домен, добавить в Render → Custom Domains
- [ ] Прописать DNS-записи у регистратора
- [ ] Поменять `SITE_URL` на новый адрес и перезапустить сервис
- [ ] Добавить новый адрес в Яндекс Вебмастер и Google Search Console
