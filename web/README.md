# Kairo web frontend

React 18 + TypeScript (strict) + Vite 5. Dark theme is primary; a light theme
toggle lives in the top bar.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm test           # vitest unit tests
npm run build      # production build (dist/)
```

The dev server proxies `/api` and `/v1` to `http://localhost:8080` (the Go
backend, see the repository root README).

## Data modes

Set in `.env` (see `.env.example`):

- `VITE_DATA_MODE=demo` - public demonstration build. All data is bundled
  deterministic synthetic data generated in the browser from
  `VITE_DEMO_SCENARIO_SEED` (mulberry32). Labelled as synthetic throughout.
- `VITE_DATA_MODE=api` - calls the backend at `VITE_API_BASE_URL`, sending
  `project_id` as a query parameter plus an `X-Api-Key` (project key) or
  `X-Admin-Token` header taken from sessionStorage values you enter on the
  Settings page. There is **no silent fallback** from API mode to demo data:
  API failures render error states.

Both modes implement the same `KairoDataProvider` interface
(`src/lib/data-source/`), so pages never know which provider is active beyond
the explicit mode indicator in the top bar.

## Static hosting / SPA fallback

Direct navigation to nested routes (for example `/traces/<id>`) must return
`index.html`. `public/_redirects` covers Netlify and Cloudflare Pages. The
included `Dockerfile` builds the app and serves it with nginx using
`try_files $uri $uri/ /index.html;` for the same fallback.

## Honesty notes

- A "request" everywhere in this UI is a span with `span_kind = server`;
  durations are stored in nanoseconds and formatted to ns/us/ms/s.
- Metrics with no samples render as "No data", never as zero.
- Dependency edges are inferred from observed traces only.
