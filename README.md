# はじまりから

作品や出来事の開始日から、経過日数と周年を表示するアプリです。Cloudflare Workers + D1 にデプロイします。

## ローカル起動

```sh
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

`.dev.vars` に `ADMIN_USER` と `ADMIN_PASSWORD` を設定してください。

## Cloudflareへの設定

```sh
npx wrangler login
npx wrangler d1 create started-on
# 表示されたdatabase_idをwrangler.jsoncに設定
npx wrangler d1 migrations apply started-on --remote
npx wrangler secret put ADMIN_USER
npx wrangler secret put ADMIN_PASSWORD
npm run deploy
```

公開画面は `/`、管理画面は `/admin` です。管理画面と管理APIはBasic認証で保護されます。

投稿はIPアドレスをハッシュ化して1分あたり5件に制限します。ハニーポット入力も使って簡単な自動投稿を弾きます。
