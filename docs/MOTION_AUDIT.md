# Motion audit

**Scope: global CSS motion primitives.** This is a source inspection of `src/styles/tokens.css`, not a verified inventory of every component-level `motion/react` animation. A complete route-by-route audit still requires browser inspection and source search before claiming the motion system is fully cleared.

| Animation / transition | Properties | Duration | Trigger | Reduced-motion behavior |
|---|---|---:|---|---|
| `.kv-press:active` | transform (scale) | 160 ms | Active press on enabled control | Global reduced-motion rule collapses transition to 0.01 ms |
| `.kv-arrow-icon` | transform (rotate) | 240 ms | Hover on fine pointer / hover-capable device | Global reduced-motion rule collapses transition to 0.01 ms |
| `.kv-marquee-track` | transform (translateX) | 34 s default | Continuous format strip; pauses on fine-pointer hover | Animation disabled |
| `.kv-dot-pulse` | transform (scale), opacity | 1.1 s infinite | Loading indicator class is rendered | Animation duration 0.01 ms and one iteration |
| `.kv-skeleton` | opacity | 1.6 s infinite | Skeleton loading state is rendered | Animation duration 0.01 ms and one iteration |
| View-transition root crossfade | Browser view-transition fade (opacity) | 220 ms | Browser view transition is requested by navigation code | View-transition animations disabled |

The shared `.kv-press` transition was narrowed to `transform` only. The listed global CSS animations use only `transform` and/or `opacity`.

## Required follow-up before sign-off

- Search every `src/**/*.tsx` and `src/**/*.ts` use of `motion`, `animate`, `transition`, and `useAnimate`; record each unique effect with property, duration, trigger and reduced-motion behavior.
- Inspect each public route and each admin/checkout sheet or menu with keyboard and touch input.
- Check that no component animates layout, dimensions, color, shadow, filter or positional layout properties.
- Verify `prefers-reduced-motion: reduce` on a real browser. Source CSS alone is not runtime proof.
