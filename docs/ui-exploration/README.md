# Motion UI exploration

This branch explores a shared interaction layer across the library, settings and reader. It is separate from `main` and stacked on the demo-removal changes in PR #22.

The existing typography, semantic theme tokens, floating question dock, agent orb, guided tours and Read aloud remain in use. The changes focus on making state and actions easier to understand:

- An inline tour-model control replaces the library’s model footnote. It opens the real model catalogue and saves the account preference explicitly.
- Document readiness and tour generation have distinct status badges. Generation details open on request; Activity and Retry remain direct actions. Cards no longer repeat the filename or nest a large interruption panel.
- Settings use a consistent back control and account menu. The profile surface has a bounded reading width.
- Menus, selectors, audio settings, tour-profile dialogs and conversations use Base UI’s focus, keyboard and collision handling through Animate UI.
- The player’s icon, reader tabs, selected PDF region, ask button and agent panel have bounded transitions. The question dock stays floating and both reading modes retain their existing behavior.
- Upload confirmations use Animate UI’s toast lifecycle, with a two-second timeout and hover/focus suspension.

## Implementation

- React / React DOM **19.3.1** and matching types, required by the current Animate UI package.
- `@animate-ui/react` **2.4.2**, `@base-ui/react` **1.9.0**, Motion **14.9.1**.
- A useLayouts Save Button adaptation for real async action states. The original illustrative timers are replaced by actual request state; the MIT notice is preserved in `player/src/ui/vendor/uselayouts-LICENSE`.
- UI SFX **0.4.0** for optional semantic sounds. Sounds default off, unlock only after interaction, stop while the page is hidden and stay silent during narration. Sound palette and volume are persisted per browser.
- Shared controls, transitions, sound lifecycle and preferences live in `player/src/ui`. Colors come from the existing theme; no Tailwind migration is required for this exploration.

The Vercel AI SDK workflow, source narration, model tool implementations, PDF coordinate system and TTS providers are not changed by this branch.

## Registry MCP

The project configuration in `.codex/config.toml` starts the shadcn MCP in the **player** directory through `npm --prefix player run --silent ui:mcp`. This matters because registry tools resolve `components.json` relative to their process directory. Codex loads the server after restarting the client in a trusted project.

The MCP was exercised over stdio: initialization, `tools/list`, `get_project_registries` and `view_items_in_registries` for `@uselayouts/save-button` succeeded. The registry is configured in `player/components.json`; `@/` aliases resolve in both TypeScript and Vite.

Current Animate UI primitives are imported from the v2 package. The project does not install archived v1 registry wrappers. Registry examples using Tailwind should be adapted to the theme layer before adding them to this CSS-based player.

References: [Animate UI](https://animate-ui.com/docs/installation), [useLayouts](https://uselayouts.com/components), [UI SFX](https://github.com/romainsimon/uisfx), [shadcn MCP](https://ui.shadcn.com/docs/mcp).

## Verification

- Complete player test suite and production build.
- Actual local library API and storage: PDF upload, completed ingestion, toast dismissal, rename and model-preference save using a disposable account.
- Browser checks for tour-profile selection, guided-tour controls, Read aloud, provider selection, voice search, conversation history, agent expansion, focus return and nested Escape behavior.
- At 1440px, 900px and 390px: viewport bounds for audio popovers, nested selectors and tour dialogs; mobile settings without horizontal overflow; dark/light palettes and reduced motion.
- UI SFX produced real non-silent Web Audio buffers. Persistence and the narration sound gate were checked in the browser.
- Axe WCAG A/AA checks found no violations on the library, inline model selector, dark settings, light settings, audio panel and tour-profile modal. The scoped design detector also reported no findings.

Reader checks use a synthetic PDF uploaded through the real application and a small persisted tour fixture bound to its real analysis. The interrupted state is also a test fixture. These checks establish UI behavior; they do not evaluate new live-model narration or provider-generated tour quality. Screenshots contain only that disposable test content.

The production build still reports a large main bundle and the existing Plotly chunk. Bundle splitting remains a separate performance consideration before adopting the exploration wholesale.
