## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Repository boundary

This repository is the canonical website source only. The canonical controller, field ingestors, PostgreSQL/TimescaleDB model, and telemetry publisher live in the private `future007s/xiqing-agri-system` repository. For cross-repository work, fetch both GitHub `main` branches and record both commit SHAs. Do not copy the publisher or field control code back into this public website repository. Pushing this repository's `main` may trigger a production Cloudflare Pages build.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
