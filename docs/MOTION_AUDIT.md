# Motion audit

**Source inventory:** `src/lib/motion/index.tsx` and `src/styles/tokens.css`. The entries below are the shared motion helpers and global CSS animations identified in those files. This is a source-level inventory; a full rendered route pass is still required to confirm every component actually using them and to find any one-off transition classes outside the shared helpers.

| Animation | Animated properties | Duration | Trigger | Reduced-motion behavior |
|---|---|---:|---|---|
| `Reveal` | `transform: translateY(16px → 0)`, `opacity: 0 → 1` | 360 ms plus a caller-provided delay capped at 400 ms | First time at least 15% enters viewport | Helper returns static content without motion |
| `TileIn` | `transform: translate/scale(.98 → 1)`, `opacity: 0 → 1` | 340 ms; 45 ms stagger capped at item index 7 | First time at least 10% enters viewport | Helper returns static content without motion |
| `SplitHeadline` | `transform: translateY(18% or 45% → 0)`; optional `opacity: .01 → 1` when `immediate=false` | 380 ms; 35 ms per-word stagger capped at 7 | First time at least 20% enters viewport | Renders plain text spans |
| `Magnetic` | Motion `x/y` transform, maximum 6 px | Spring: stiffness 380, damping 36 | Pointer movement and pointer leave on fine-pointer devices | Disabled when reduced motion is requested |
| `Tilt` | CSS `transform: perspective/rotateX/rotateY` | 220 ms transform transition; pointer updates via animation frame | Pointer movement and pointer leave on fine-pointer devices | Disabled when reduced motion is requested |
| `PageTransition` | `opacity: .85 → 1` | 160 ms | Route pathname changes | Returns children without a transition |
| `.kv-press:active` | `transform: scale(.98)` | 160 ms | Active press on an enabled control | Global reduced-motion rule collapses transitions to 0.01 ms |
| `.kv-arrow-icon` | `transform: rotate(45deg)` | 240 ms | Hover on a fine pointer | Global reduced-motion rule collapses transitions to 0.01 ms |
| `.kv-marquee-track` | `transform: translateX` | 34 s default; configurable by CSS custom property | Continuous format strip; pauses on fine-pointer hover | Animation disabled |
| `.kv-dot-pulse` | `transform: scale`, `opacity` | 1.1 s infinite | Loading indicator is rendered | Duration set to 0.01 ms and one iteration |
| `.kv-skeleton` | `opacity` | 1.6 s infinite | Skeleton loading state is rendered | Duration set to 0.01 ms and one iteration |
| View-transition root crossfade | Browser view-transition fade (`opacity`) | 220 ms | Browser view transition requested by navigation | View-transition animations disabled |

The text-based `CountUp` animation was removed. It now renders the final value immediately so that the shared motion set stays within the transform/opacity rule.

All shared motion helpers use only transform and/or opacity. The `Tilt` helper writes only the CSS `transform` property; `Magnetic` uses Motion's x/y transform values. `Marquee` animates only transform. The shared press transition was narrowed to `transform` only.

## Required runtime follow-up

- Inspect every public route at phone, tablet and desktop widths and identify any one-off `transition-*` or `animate-*` classes outside these shared helpers.
- Inspect all admin and checkout sheets/menus with touch and keyboard input.
- Confirm no component-level transition animates layout, dimensions, color, shadow, filter or other properties.
- Verify `prefers-reduced-motion: reduce` in a real browser. Source inspection is not runtime proof.
