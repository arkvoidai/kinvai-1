# Performance budget and bundle report

## Implemented source-level changes

- Route components other than the homepage are loaded with React `lazy()` and `Suspense` in `src/app/router.tsx`.
- `HomePage` remains eager so the LCP hero is not delayed behind a route chunk.
- Admin, checkout, account, product detail, search, shop, legal and support page modules are imported dynamically; they are not statically imported by the home route.
- The homepage already memoises its collection/product lookup maps, spotlight product selection and unique formats using `useMemo`.
- The CSS motion tokens now restrict the shared press transition to `transform`; the global page styles retain reduced-motion handling.

## Bundle size measurement

**Status: NOT VERIFIED.** No production build was run in the connector session. There are no measured gzip sizes to report and no claim that the target has been met.

| Bundle | Measurement | Target / status |
|---|---:|---|
| Home route JavaScript, gzip | NOT MEASURED | Under 180 KB before images |
| Shared application JavaScript, gzip | NOT MEASURED | Measure after production build |
| Admin route chunk, gzip | NOT MEASURED | Must be outside home entry graph |
| Checkout route chunk, gzip | NOT MEASURED | Must be outside home entry graph |
| Total CSS | NOT MEASURED | Review generated build output |

After all legal owner markers are resolved, run:

```bash
bun run build
```

Record the Vite chunk output and gzip each emitted `.js` file (for example, `gzip -c dist/assets/<chunk>.js | wc -c`). Inspect the generated manifest or module graph to confirm the home entry does not import the admin or checkout chunks. Keep the measured values and build commit here.

## Items not verified

- Hero interactivity within 2.5 seconds on a mid-range phone.
- Real-device Core Web Vitals, LCP, INP and CLS.
- Preloading the two exact above-the-fold font files. The current document preconnects to Google Fonts and requests Geist/Instrument Serif through its stylesheet; exact WOFF2 preload URLs were not validated and are not claimed here.
- Image loading priority, intrinsic dimensions and below-the-fold lazy-loading, route by route.
- Whether the current production dataset exceeds the 48-item format-guide fetch page.
- No list virtualization was added; add it only if real catalogue size and profiling demonstrate a need.
