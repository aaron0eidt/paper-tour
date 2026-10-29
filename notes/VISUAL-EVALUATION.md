# Visual generation evaluation — 29 October 2026

Real runs used Muse Spark 1.3 Contributor with the user's configured connection and pinned uploaded analyses. Evaluation outputs, source images, requests and manifests remain local in ignored `.data/visual-eval/`. These runs did not replace library tours.

## Cases and observed results

| Paper | Initial run (@14) | Successful follow-up |
| --- | --- | --- |
| Attention Is All You Need | Failed after 15 beats: rounded intermediate arithmetic | @15: 21 steps, 224.917 s, 30 calls. Subsequent quality review exposed a truncated complex example; @20 reassembled and revalidated all 21 steps with 21 saved calls and one new provider call (77.866 s). |
| Sticky Routing | 22 steps, 131.243 s, 29 calls; technically valid but weak visual choices and an incorrect verbal axis direction | @15: 21 steps, 222.117 s, 27 calls. Original two-axis frontier retained; narration now correctly describes rightward hit-rate gains and upward perplexity cost. |
| Geometry-Aware Multi-Objective Optimization | First request rejected: repeated source enums exceeded the provider's 3,000-value budget | @16: 22 steps, 194.936 s, 30 calls, no final publication problems. Earlier @15 attempt exposed signed-value provenance failures. |

The final results above have no canonical tour/board validation problems. This is a small, stochastic case study, not a speed benchmark or proof that every generated explanation is correct. In particular, medium reasoning made some runs slower. Resumed timings measure repair and reassembly, not fresh whole-document generation.

## Findings and repairs

- The long-paper schema repeated the same evidence enum six times (5,440 entries in the failing case). A shared `$defs` reference retains every allowed source ID while fitting the provider budget. Regression checks both late-paper evidence and invented IDs.
- A diagnostic provider response used all 6,000 output tokens, including 5,725 reasoning tokens, leaving an incomplete 799-character JSON answer. Detailed directions and repairs now receive 12,000 tokens with medium reasoning; routine overviews retain low reasoning and 6,000. A stream that explicitly finishes for length is classified as truncated even without a final DONE sentinel.
- Rounded intermediate results retain exact checked values, while deliberately rounded literal substitutions remain valid. Wrong results, undeclared operands and arbitrary expressions still fail. Scientific notation, signed unit constants, mathematical indices and component ordinals no longer produce the observed false positives.
- Signed bars use the reader's existing zero-centered layout; authoring no longer rejects negative source measurements or illustrative values. Browser playback verified negative bars extending left, positive bars right, with readable labels.
- Floating prose plus tiny arrows cannot pass as a meaningful diagram. An isolated scalar matrix cannot satisfy a worked example's visual requirement. Quantitative plots, genuine component transformations or connected diagram nodes remain available.
- Prompts require axis-direction checks against the actual image, preserving multi-metric tradeoffs, appropriate visual selection, stable objects, and shared axes for quantitative vector comparisons. Repairs must update narration and anchors together with changed values and dimensions.

## Rendered review

The browser review covered all three papers, including original-diagram component boxes, original-plot cues, formula/source alignment, vector scenes, live input/intermediate/output bars and pause behavior. Screenshots are local:

- `.data/visual-eval/attention-source-proof.png`: precise boxes on original Transformer components.
- `.data/visual-eval/sticky-source-proof.png`: labels outside the source plot and timed plot cues.
- `.data/visual-eval/geometry-vector-proof.png`: illustrative vector direction beside the source oracle table.
- `.data/visual-eval/final-live-proof.png`: final checked signed intermediate values beside the original FFN equation.

Review rejected a technically valid scalar-card sequence and detected stale narration after repair. The final Attention example instead shows two inputs, four signed hidden candidates and two computed outputs, with narration matching the displayed quantities. This establishes a useful transformation in this sample; model-selected pedagogy and visual density still need judgement. No paper IDs, formulas or coordinates were added to production code.

Saved-response replay was evaluation tooling only: each reused output passed current production validation again; missing/rejected beats used real new provider calls. It does not introduce a production resume feature or conceal failed fresh attempts. Failed manifests remain available alongside successful ones.
