# Security & privacy

## Keys

- Relay API keys and custom main-model keys are stored on the local machine only.
- The settings API returns only `keySet` / `customKeySet` flags; it never returns the key value.
- Never commit `.env`, `cover-studio.json`, `secrets.json`, DSH credentials or exported projects.
- The repository has no application backend; the plugin does not send local files to the maintainer.

## Feedback form

The in-app feedback button opens a public Feishu form. Submitted form content is stored in the maintainer's Feishu workspace. The plugin only opens the form and copies local diagnostics to the clipboard; it does not upload other files.

## Reporting a vulnerability

Please open a GitHub security advisory (if available) or contact the creator through the Bilibili profile listed in the studio's 制作人 page. Do not include API keys, private images or personal data in reports.

## Third-party assets

The Silueta model is downloaded separately by `npm run fetch-model` and is not committed. See `assets/models/LICENSE-NOTICE.md` for upstream licenses and attribution.
