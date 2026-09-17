# はじまりから

作品や出来事の開始日から、経過日数と周年を表示するアプリです。Cloudflare Workers + D1 で動作します。

## ローカル起動

```sh
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

`.dev.vars` の管理者パスワードを変更してください。Turnstileにはローカルテスト用のキーが入っています。公開環境では必ずCloudflare Turnstileで実際のウィジェットを作成し、実際のキーを使用してください。

## Cloudflareへの設定

```sh
npx wrangler login
npx wrangler d1 create hajimari-kara
# 表示されたdatabase_idをwrangler.jsoncに設定
npm run db:migrate:remote
npx wrangler secret put ADMIN_USER
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET
npm run deploy
```

公開画面は `/`、管理画面は `/admin` です。管理画面と管理APIはBasic認証で保護されます。投稿にはTurnstile認証が必要です。公開一覧は20件ずつ表示され、並び替えと棒グラフ表示ができます。

`.dev.vars` はGit管理とビルド成果物から除外されます。管理者パスワードとTurnstileの秘密キーは公開しないでください。
