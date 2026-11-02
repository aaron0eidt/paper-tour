# Adaptive teaching plans

New research-paper generations with a saved tour profile have a separate teaching-planning stage. It reads the complete paper text and uses all citable sentences, equations and figures. Older queued jobs and saved tours keep their existing behavior.

The model separates contribution, prerequisite, mechanism, evidence and limitation. Each concept records source IDs, prerequisite IDs, importance, audience-relative difficulty, confidence, a learning objective, a possible misconception and the benefit of a visual. These are inspectable teaching decisions, not private model reasoning or claims about a particular reader.

Validation rejects nonexistent sources, cycles, duplicate concept IDs, missing section accounting and proposed new visuals without a stated relationship/change. Targeted repairs receive the exact problems; an invalid teaching map is never silently published as a valid plan.

The model determines the complete concept map for the selected profile. Concept-led tours follow the explanation dependencies; overview changes emphasis while retaining the prerequisites and evidence needed to understand the claims. No preset concept count is imposed, and code does not discard concepts because their importance or the reader’s familiarity is lower. Paper order uses actual heading order and source locations; a floating diagram/table uses its supporting prose to determine its semantic section, rather than imposing an Abstract/Methods/Results template. Depth and audience remain independent of structure and provider model.

Visual planning receives these objectives. For new profile generations it chooses representations by usefulness instead of imposing the legacy per-kind and board-share quotas. Source annotation remains preferable when it explains the point directly. A numerical example should change visible inputs/intermediates/outputs; a caption or a decorative restatement is not a demonstration. Original values, source alignment and mathematical validation still apply.

The verified teaching map is saved with generation metadata. The activity feed exposes the planning stage with a readable label. It does not stream speculative reasoning.

Planning may span multiple output-sized responses, merged by stable concept IDs before narration starts. The entire source document remains available to every response. Large visual plans likewise split requests after output truncation while retaining every beat and previous decision. Output budgets are technical response limits, not total teaching quotas.

Profile jobs do not use elapsed generation time to lower reasoning effort, shorten understanding, or delete explanations/visuals. Individual provider requests still time out and may be retried, and cancellation remains effective. pg-boss requires an absolute job lease (the configured maximum is 24 hours); heartbeat refresh detects a lost claim but does not renew this lease.

Tests cover complete evidence vocabularies, paginated source/dependency checks, preservation of more than 30 planned concepts, actual cited section coverage, true paper order, cancellation and freedom to use an appropriate representation more than once.

A native computed plot, heatmap, scatter or distribution is itself a quantitative demonstration. It does not require redundant manual example frames simply because its narration discusses concrete values. Its function/data checks and the requirement to publish the selected visual still apply.
