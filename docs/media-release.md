# Media runtime release — 2026-09-06

Production uses Cloudflare Pages Git integration (`main`, `npm run build`, `dist`) and Pages Functions. The root Wrangler file is only for an optional standalone Worker; production bindings are configured in the Pages dashboard.

- `DB`: existing `xiqing-agri-media` D1 database.
- `MEDIA_PRIVATE_BUCKET`: existing `xiqing-agri-media` R2 bucket.
- `MEDIA_UPLOAD_TOKEN`: existing encrypted secret, retained without rotation.
- `DEFAULT_TIMEZONE_OFFSET`: `+08:00`.

The bucket and media/audit tables were empty before release. No legacy media migration was necessary. Public access through the custom media domain was disabled; r2.dev access was already disabled. Do not enable either direct public endpoint for this bucket.

The production database already contained the structures from migrations 0001 and 0002. Only 0004 was applied for this release. Migration 0003 is an unrelated public traceability design and remains unapplied; do not blindly apply every numbered migration. The media API does not require 0003.

Run `npm test`, `npm run check`, and `npm run build` before release. API tests use actual SQLite transactions with an R2 test double. After deployment, check both languages, the public empty media list, and rejection of anonymous upload/management requests. A successful build alone does not verify bindings.

Recovery: retain D1's pre-change Time Travel bookmark in the private release record. The schema change is additive. If the media runtime fails, keep the bucket private and disable media actions while repairing it; do not restore direct public storage access. Existing media authorization is not changed by a build rollback.
