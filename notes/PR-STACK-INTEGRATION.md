# Reviewed stack integration

Integrates PRs #8–#11 and the signed reader commits `c364f7a` (choose a tour when opening a PDF) and `d36c0e1`
(personal automatic zoom ceiling). Existing saved tours and conversation records remain compatible.

## Corrections made before merging

- Plotly uses an explicit recursive key vocabulary, rejects relayout paths, embedded controls, frames, resource URLs
  and CSS URL expressions. Previously stored figures pass the same gate before browser rendering. A generated image
  CSP permits only the application, inline/blob images and the configured storage origin.
- Public authored-visual writes perform runtime/render inspection. Native boards stay inline in their source tour
  instead of being re-grounded against their own JSON during artifact publication. Regression coverage includes a
  document timeline with a negative notice-period offset.
- Returning from a question resumes a previously playing tour; browsing elsewhere retains its separate handler.
- First-turn suggested-question prefetch is stateless and can share a server cache entry with the actual conversation
  request. The actual request still records the turn. Existing conversation history, visual state, analysis and owner
  continue to separate cache entries. Conversations with history do not advertise stateless answers as ready.
- Worked concepts refer to their own overview by ID, including concepts without a figure/equation target.
- Identical headings across all six paper-card chapters trigger model repair. Per-field instructions require
  content-specific headings; this covers the observed greetings/status placeholders without substituting titles.
- Harness version advances to 35. Prompt guidance distinguishes choosing no visual during planning from repairing
  an already-required visual. Documentation distinguishes the legacy step ceiling from uncapped teaching profiles.

## Intentional policies and remaining work

The user explicitly requested no artificial concept/step quotas and no silent removal of required explanations or
visuals. Those policies are preserved despite contrary suggestions in the reviews. Invalid required content can still
stop a generation after its repairs. Existing technical limits and cancellation remain in effect.

This integration does not claim to resolve every review suggestion: earlier first output, recoverable failed partial
tours, conversation pagination, moving server QuickJS off the API event loop, and rendered Plotly image review remain
follow-up work. Plotly currently receives structural/resource and independent numeric validation. The generator is
still large; successful tests do not establish explanation quality across all papers. No reviewer approvals were
dismissed or manufactured.

## Verification

- Full database-backed server suite: 977 tests, 970 passed, 7 skipped, no failures.
- Full player suite and production builds passed.
- Script suite: 84 passed.
- Python ingestion suite: 123 run, 2 skipped, no failures.
- Local API health and generated development CSP verified. No paid model generation was needed for merge validation.
