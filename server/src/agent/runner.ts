import { MuseClient } from '../muse/client';
import { recordedCalls } from '../ai/recorded-calls';
import { indexElements } from '../elements';
import type { TourImage } from '../tour-generator';
import { reviewAuthoredWithModel } from '../visuals/model-author';
import { VisualArtifactService } from '../visuals/artifacts';
import { persistTourVisuals } from '../visuals/persistence';
import { assertReviewedState, prepareReviewedChapter, reviewedAudits } from './chapter-visuals';
import { createHash } from 'node:crypto';
import { tourDirection } from '../../../shared/tourDirection';
import { tourProfileGuidance } from '../../../shared/tourProfiles';
import { setTimeout as delay } from 'node:timers/promises';
import type { QueryResultRow } from 'pg';
import type { Config } from '../config';
import { Database } from '../db';
import type { FileStorage } from '../storage';
import { DocumentService, type Enqueue } from '../service';
import type { SettingsService } from '../settings';
import type { PrepareTourImages } from '../tour-worker';
import { generationRecorder } from '../activity';
import { ProcessingError } from '../errors';
import { isContributorModel } from '../muse/models';
import { paperContext } from '../muse/context';
import { writingInstructions, PROMPT_VERSION } from './writing';
import { MAX_CONTENT_PAGES, walkthroughGoals } from '../muse/planning';
import { TourValidationError } from '../muse/schema';
import { ResponsesClient, responseUsage, type AgentResponse, type ResponseItem } from './responses';
import {
  AGENT_VERSION,
  AGENT_INSTRUCTIONS,
  AGENT_TOOLS,
  paperTools,
  executeTool,
  paperManifest,
  requiredVisuals,
  toolOutput,
  type RunState,
  type VisualSource,
} from './tools';
import { preparedVisuals, hydrateImages } from './visuals';
import { scheduleAgent } from './store';
import { replayHistory, historyCoversCheckpoint } from './history';
import { checkProgress } from './progress';
import { workflowDirective } from './workflow';
import { strictVisualObservationTool, shallowChapterTool } from './strict-tools';
const WIRE_TOOLS = AGENT_TOOLS.map(strictVisualObservationTool).map(shallowChapterTool);

export class PaperAgent {
  constructor(
    readonly db: Database,
    readonly storage: FileStorage,
    readonly config: Config,
    readonly enqueue: Enqueue,
    readonly settings: SettingsService,
    readonly prepare: PrepareTourImages,
    readonly transport: typeof fetch = fetch,
  ) {}
  private async load(id: string) {
    const {
      rows: [run],
    } = await this.db.query(
      `select r.*,g.document_id,g.analysis_id,g.model,g.profile,g.status as generation_status,d.owner_id,d.upload_path,d.tour_allow_training,a.doc
      from agent_runs r join tour_generations g on g.id=r.generation_id join documents d on d.id=g.document_id join analyses a on a.id=g.analysis_id
      where r.id=$1 and d.deleted_at is null`,
      [id],
    );
    return run;
  }
  private async locked<T>(id: string, run: () => Promise<T>) {
    const connection = await this.db.pool.connect();
    try {
      const {
        rows: [lock],
      } = await connection.query('select pg_try_advisory_lock(hashtextextended($1,0)) as acquired', ['agent:' + id]);
      if (!lock.acquired) return;
      return await run();
    } finally {
      try {
        await connection.query('select pg_advisory_unlock(hashtextextended($1,0))', ['agent:' + id]);
      } finally {
        connection.release();
      }
    }
  }
  private async pause(run: QueryResultRow, reason: string, configuration = false) {
    await this.db.transaction(async (tx) => {
      const {
        rows: [current],
      } = await tx.query('select status from agent_runs where id=$1 for update', [run.id]);
      if (!current || ['completed', 'cancelled'].includes(current.status)) return;
      await tx.query("update agent_runs set status='paused',reason=$2,updated_at=now() where id=$1", [run.id, reason]);
      await tx.query('update tour_generations set status=$2,error=$3,error_code=$4,updated_at=now() where id=$1', [
        run.generation_id,
        configuration ? 'needs_configuration' : 'paused',
        reason,
        configuration ? 'configuration_error' : 'agent_paused',
      ]);
      await generationRecorder(tx, run.generation_id, '', run.id)('run.paused', { reason });
    });
  }
  async start(generationId: string) {
    const {
      rows: [generation],
    } = await this.db.query('select document_id,agent_run_id from tour_generations where id=$1 and engine=$2', [
      generationId,
      'agent',
    ]);
    if (!generation?.agent_run_id) return;
    await this.db.transaction((tx) => scheduleAgent(tx, this.enqueue, generation.agent_run_id, generation.document_id));
  }
  async reconcile() {
    const { rows } = await this.db.query(
      "select r.id,g.document_id from agent_runs r join tour_generations g on g.id=r.generation_id join documents d on d.id=g.document_id where r.status in ('queued','running','pausing') and d.deleted_at is null",
    );
    for (const run of rows) await this.db.transaction((tx) => scheduleAgent(tx, this.enqueue, run.id, run.document_id));
  }
  private task(run: QueryResultRow, checkpoint = false, replay = false): ResponseItem[] {
    const rules = writingInstructions(this.config.muse.language, run.doc).replace(
      'Return the structured draft only.',
      'Save chapters with tools and call finish_tour when complete.',
    );
    return [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `TOUR TASK. Use the paper context already loaded. ${rules}\n${tourProfileGuidance(run.profile)}\nSource IDs for view_visuals: ${JSON.stringify(paperManifest(run.doc))}.\n${checkpoint ? 'Resume from this verified checkpoint. Images from an earlier context section must be requested again if needed.' : 'Previously verified observations and any saved work:'}\n${JSON.stringify(replay ? { title: run.state.title, plan: run.state.plan, savedChapters: Object.keys(run.state.chapters), observedSources: Object.keys(run.state.observations) } : { ...run.state, loopWatch: undefined })}\nPrioritize missing observations and chapters. Do not request visual sources already delivered in this context just to repair tool arguments. Batch independent source reads. Once an observation is saved, use it to write the tour rather than reading the same source again.`,
          },
        ],
      },
    ];
  }
  async turn(runId: string, wakeIndex?: number, signal = AbortSignal.timeout(this.config.muse.timeoutMs)) {
    return this.locked(runId, async () => {
      let run = await this.load(runId);
      if (
        !run ||
        ['completed', 'failed', 'cancelled', 'paused'].includes(run.status) ||
        (wakeIndex !== undefined && wakeIndex !== run.wake_index)
      )
        return;
      // An orphaned running turn has no finally checkpoint. Account for its journal age once.
      // Downtime counts conservatively; explicit resume grants a fresh budget segment.
      if (run.status === 'running') {
        await this.db.query(
          `update agent_runs set status='queued',runtime_ms=runtime_ms+greatest(0,floor(extract(epoch from (now()-coalesce((select max(created_at) from agent_events where agent_run_id=$1 and type='model.started' and data->>'callId'=$2),now())))*1000))::bigint where id=$1 and status='running'`,
          [run.id, `${run.id}:${run.turn_index}`],
        );
        await generationRecorder(
          this.db.pool,
          run.generation_id,
          '',
          run.id,
        )('run.recovered', { step: run.turn_index });
        run = await this.load(run.id);
        if (!run) return;
      }
      const started = Date.now();
      const stateBefore = structuredClone(run.state) as RunState;
      try {
        if (run.status === 'pausing') return await this.pause(run, 'Paused by user');
        const access = await this.settings.resolveMuse(run.owner_id, run.model);
        if (!access.config.apiKey) return await this.pause(run, 'Connect Meta in Profile & Settings to resume.', true);
        if (isContributorModel(run.model) && !run.tour_allow_training)
          return await this.pause(run, 'Contributor mode has not been selected for this document.', true);
        const credentialVersion = createHash('sha256')
          .update(access.version + ':' + access.config.apiKey)
          .digest('hex');
        const record = generationRecorder(this.db.pool, run.generation_id, access.config.apiKey, run.id);
        await record('turn.started', {
          step: run.turn_index,
          queueWaitMs: Math.max(0, started - new Date(run.updated_at).getTime()),
        });
        if (walkthroughGoals(run.doc).requiredPages.length > MAX_CONTENT_PAGES)
          return await this.pause(run, 'This paper exceeds the supported content-page limit.');
        const limits = this.config.agent ?? { maxTurns: 64, maxOutputTokens: 128000, maxRuntimeMs: 1200000 };
        if (
          run.turns - (run.budget_base.turns ?? 0) >= limits.maxTurns ||
          Number(run.output_tokens) - (run.budget_base.output ?? 0) >= limits.maxOutputTokens ||
          Number(run.runtime_ms) - (run.budget_base.runtime ?? 0) >= limits.maxRuntimeMs
        )
          return await this.pause(run, 'Run budget reached. Resume to continue from this checkpoint.');
        signal = AbortSignal.any([
          signal,
          AbortSignal.timeout(
            Math.max(1, limits.maxRuntimeMs - (Number(run.runtime_ms) - (run.budget_base.runtime ?? 0))),
          ),
        ]);
        const claimed = await this.db.query(
          "update agent_runs set status='running',updated_at=now() where id=$1 and status in ('queued','running') returning id",
          [run.id],
        );
        if (!claimed.rowCount) return;
        await this.db.query(
          "update tour_generations set status='generating',error=null,error_code=null,updated_at=now() where id=$1 and status not in ('ready','cancelled')",
          [run.generation_id],
        );
        const contextVersion = `${AGENT_VERSION}:${createHash('sha256')
          .update(
            JSON.stringify({
              instructions: AGENT_INSTRUCTIONS,
              tools: WIRE_TOOLS,
              writingVersion: PROMPT_VERSION,
              language: this.config.muse.language,
              reasoning: 'medium',
            }),
          )
          .digest('hex')
          .slice(0, 16)}`;
        let session = run.session_id
          ? (await this.db.query('select * from paper_sessions where id=$1', [run.session_id])).rows[0]
          : undefined;
        if (session && session.context_version !== contextVersion) return await this.pause(run, 'context_changed');
        if (session && session.credential_version !== credentialVersion)
          return await this.pause(run, 'credentials_changed');
        if (!session) {
          const context = paperContext(run.doc),
            contextKey = createHash('sha256')
              .update(
                JSON.stringify({
                  owner: run.owner_id,
                  analysis: run.analysis_id,
                  model: run.model,
                  credential: credentialVersion,
                  version: contextVersion,
                  writingVersion: PROMPT_VERSION,
                  instructions: AGENT_INSTRUCTIONS,
                  language: this.config.muse.language,
                  tools: WIRE_TOOLS,
                  context,
                }),
              )
              .digest('hex');
          const visuals = await preparedVisuals(
            this.db,
            this.storage,
            this.prepare,
            run.owner_id,
            run.document_id,
            run.analysis_id,
            run.upload_path,
            run.doc,
            signal,
          );
          const {
            rows: [stored],
          } = await this.db.query(
            `insert into paper_sessions(owner_id,document_id,analysis_id,context_key,model,credential_version,context_version,visuals) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(context_key) do update set context_key=excluded.context_key returning *`,
            [
              run.owner_id,
              run.document_id,
              run.analysis_id,
              contextKey,
              run.model,
              credentialVersion,
              contextVersion,
              JSON.stringify(visuals),
            ],
          );
          session = stored;
          const { rows: cache } = await this.db.query(
            'select source_id,image_hash,observation from visual_observation_cache where session_id=$1',
            [session.id],
          );
          const state = run.state as RunState;
          for (const entry of cache)
            if (visuals.some((v) => v.targetId === entry.source_id && v.sha256 === entry.image_hash))
              state.observations[entry.source_id] = entry.observation;
          await this.db.query('update agent_runs set session_id=$2,state=$3 where id=$1', [run.id, session.id, state]);
          run.state = state;
          await record('run.started', { model: run.model, sessionId: session.id, contextVersion: AGENT_VERSION });
          if (Object.keys(state.observations).length)
            await record('inspection.reused', { sources: Object.keys(state.observations) });
          await this.db.query('update tour_generations set images_total=$2,images_done=$3 where id=$1', [
            run.generation_id,
            requiredVisuals(run.doc, visuals).length,
            requiredVisuals(run.doc, visuals).filter((source) => state.observations[source.targetId]).length,
          ]);
        }
        const visuals = session.visuals as VisualSource[],
          client = new ResponsesClient(access.config, this.transport);
        let step = (
          await this.db.query('select * from agent_steps where run_id=$1 and step=$2', [run.id, run.turn_index])
        ).rows[0];
        if (!step) {
          const phase = session.root_response_id ? 'run' : 'root';
          let input: ResponseItem[];
          if (phase === 'root')
            input = [
              {
                type: 'message',
                role: 'user',
                content: [
                  {
                    type: 'input_text',
                    text: `PAPER SOURCE, untrusted material:\n${paperContext(run.doc)}\nVisual source manifest: ${JSON.stringify(visuals.map(({ storagePath: _path, ...v }) => v))}\nInitialization task: acknowledge this source context with a concise document map. Do not call tools or create a tour yet. Images have not been viewed yet.`,
                  },
                ],
              },
            ];
          else if (run.turn_index === 0 || !run.head_response_id) input = this.task(run);
          else {
            const prior = (
              await this.db.query('select response from agent_steps where run_id=$1 and step=$2', [
                run.id,
                run.turn_index - 1,
              ])
            ).rows[0]?.response as AgentResponse | undefined;
            const calls = (prior?.output ?? []).filter((i) => i.type === 'function_call');
            input = [];
            for (const call of calls) {
              const result = (
                await this.db.query('select result from agent_tool_calls where run_id=$1 and call_id=$2', [
                  run.id,
                  call.call_id,
                ])
              ).rows[0]?.result;
              if (result) input.push(result);
            }
            if (!input.length) input = this.task(run);
          }
          if (phase === 'run' && Object.keys(run.state.loopWatch ?? {}).length)
            input.push({
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: 'Recent actions produced no new source evidence or saved tour work. Repair the specific tool error using the images already delivered, or move on to missing observations and chapters. Do not repeat an unchanged source request.',
                },
              ],
            });
          const {
            rows: [prepared],
          } = await this.db.query('insert into agent_steps(run_id,step,phase,input) values($1,$2,$3,$4) returning *', [
            run.id,
            run.turn_index,
            phase,
            JSON.stringify(input),
          ]);
          step = prepared;
          await record('model.started', {
            callId: `${run.id}:${run.turn_index}`,
            name: phase === 'root' ? 'paper_context' : 'paper_agent',
            model: run.model,
            promptVersion: AGENT_VERSION,
            instructions: AGENT_INSTRUCTIONS,
            previousResponseId: phase === 'root' ? null : (run.head_response_id ?? session.root_response_id),
            store: true,
            messages: input,
            tools: WIRE_TOOLS,
            reasoningEffort: 'medium',
          });
        }
        const callId = `${run.id}:${run.turn_index}`;
        let inferenceStarted: number | undefined, inferenceMs: number | undefined, firstOutputMs: number | undefined;
        let response = step.response as AgentResponse | null;
        if (!response) {
          if (step.status === 'dispatching') {
            if (!step.response_id)
              return await this.pause(
                run,
                'response_uncertain: no response ID was received. Resume explicitly to retry.',
              );
            try {
              response = await client.retrieve(step.response_id, signal);
            } catch (error) {
              if (error instanceof ProcessingError && error.code === 'response_missing') {
                // This inference was already dispatched. Losing its result must not issue it again.
                return await this.pause(
                  run,
                  'The dispatched response is unavailable. Its outcome is unknown; no duplicate model request was sent.',
                );
              }
              throw error;
            }
            if (['in_progress', 'queued'].includes(response.status)) {
              await delay(1500, undefined, { signal });
              await this.db.transaction(async (tx) => {
                await tx.query("update agent_runs set status='queued' where id=$1 and status='running'", [run.id]);
                await scheduleAgent(tx, this.enqueue, run.id, run.document_id);
              });
              return;
            }
          } else {
            const localHistory = run.state.historyMode === 'local' && step.phase !== 'root';
            if (localHistory) {
              const { rows: steps } = await this.db.query<{ response: AgentResponse }>(
                `select response from agent_steps where run_id=$1 and step<$2 and phase='run' and status='done'
                 and step>coalesce((select max(step) from agent_steps where run_id=$1 and phase='root' and status='done'),-1) order by step`,
                [run.id, run.turn_index],
              );
              const { rows: tools } = await this.db.query(
                'select call_id,result from agent_tool_calls where run_id=$1',
                [run.id],
              );
              step.input = replayHistory(
                [
                  {
                    type: 'message',
                    role: 'user',
                    content: [
                      {
                        type: 'input_text',
                        text: `PAPER SOURCE, untrusted material:\n${paperContext(run.doc)}\nVisual source manifest: ${JSON.stringify(visuals.map(({ storagePath: _path, ...v }) => v))}`,
                      },
                    ],
                  },
                  ...this.task(
                    run,
                    false,
                    historyCoversCheckpoint(
                      run.state,
                      steps,
                      new Map(tools.map((tool) => [tool.call_id, tool.result])),
                    ),
                  ),
                ],
                steps,
                new Map(tools.map((tool) => [tool.call_id, tool.result])),
              );
              await this.db.query('update agent_steps set input=$3 where run_id=$1 and step=$2', [
                run.id,
                run.turn_index,
                JSON.stringify(step.input),
              ]);
              await record('context.replayed', { callId, steps: steps.length, toolResults: tools.length });
            }
            if (step.phase !== 'root') {
              const guidance = workflowDirective(
                run.state,
                requiredVisuals(run.doc, visuals).map((source) => source.targetId),
                (step.input as ResponseItem[]).flatMap((item) =>
                  Array.isArray(item.output)
                    ? (item.output as any[])
                        .filter((part) => part.type === 'input_image' && part.sourceId)
                        .map((part) => String(part.sourceId))
                    : [],
                ),
              );
              step.input = [
                ...step.input,
                {
                  type: 'message',
                  role: 'user',
                  content: [{ type: 'input_text', text: `WORKFLOW CHECKPOINT: ${guidance}` }],
                },
              ];
              await this.db.query('update agent_steps set input=$3 where run_id=$1 and step=$2', [
                run.id,
                run.turn_index,
                JSON.stringify(step.input),
              ]);
              await record('workflow.checkpoint', {
                callId,
                savedChapters: Object.keys(run.state.chapters).length,
                plannedChapters: run.state.plan.length,
                observedSources: Object.keys(run.state.observations).length,
                nextAction: guidance,
              });
            }
            const previous = step.phase === 'root' ? undefined : (run.head_response_id ?? session.root_response_id);
            const request: Record<string, unknown> = {
              instructions: AGENT_INSTRUCTIONS,
              tools: WIRE_TOOLS,
              ...(step.phase === 'root' ? { tool_choice: 'none' } : {}),
              reasoning: { effort: 'medium' },
              input: await hydrateImages(step.input, this.storage, visuals),
              ...(previous && !localHistory ? { previous_response_id: previous } : {}),
              prompt_cache_key: AGENT_VERSION,
              max_output_tokens: Math.min(
                step.phase === 'root' ? 4096 : 16384,
                limits.maxOutputTokens - (Number(run.output_tokens) - (run.budget_base.output ?? 0)),
              ),
            };
            if (Number(request.max_output_tokens) < 16)
              return await this.pause(run, 'Output budget reached. Resume to continue.');
            let tokens: number;
            try {
              tokens = await client.count(request, signal);
            } catch (error) {
              if (error instanceof ProcessingError && error.code === 'response_missing') {
                if (localHistory) throw error;
                await this.useLocalHistory(run, record);
                return;
              }
              throw error;
            }
            if (tokens + Number(request.max_output_tokens) > Math.floor(1048576 * 0.8)) {
              if (localHistory)
                return await this.pause(
                  run,
                  'The locally restored conversation exceeds the context budget. Saved work is retained.',
                );
              if (
                step.phase === 'root' ||
                step.input.some((i: any) => JSON.stringify(i).includes('Resume from this verified checkpoint.'))
              )
                return await this.pause(run, 'The full paper and verified checkpoint exceed the context budget.');
              await this.resetContext(run, session.id);
              return;
            }
            await record('context.measured', { callId, inputTokens: tokens });
            // Record the final input after local replay and workflow guidance, with
            // stored source references rather than hydrated image data.
            await record('model.prepared', {
              callId,
              messages: step.input,
              previousResponseId: request.previous_response_id ?? null,
              historyMode: localHistory ? 'local' : 'provider',
              tools: WIRE_TOOLS,
            });
            const beforeDispatch = await this.load(run.id);
            if (!beforeDispatch || ['cancelled', 'paused'].includes(beforeDispatch.status)) return;
            if (beforeDispatch.status === 'pausing') return await this.pause(run, 'Paused by user');
            await this.db.query("update agent_steps set status='dispatching' where run_id=$1 and step=$2", [
              run.id,
              run.turn_index,
            ]);
            try {
              inferenceStarted = Date.now();
              response = await client.create(
                request,
                {
                  created: async (id) => {
                    await this.db.query('update agent_steps set response_id=$3 where run_id=$1 and step=$2', [
                      run.id,
                      run.turn_index,
                      id,
                    ]);
                    await record('response.created', { callId, responseId: id });
                  },
                  delta: async (delta) => {
                    firstOutputMs ??= Date.now() - inferenceStarted!;
                    await record('model.delta', { callId, delta });
                  },
                  toolStarted: async (toolCallId, name) => {
                    firstOutputMs ??= Date.now() - inferenceStarted!;
                    await record('model.tool.started', { callId, toolCallId, name });
                  },
                },
                signal,
              );
              inferenceMs = Date.now() - inferenceStarted;
            } catch (error) {
              if (!localHistory && error instanceof ProcessingError && error.code === 'response_missing') {
                await this.useLocalHistory(run, record);
                return;
              }
              throw error;
            }
          }
          const received = response;
          await this.db.transaction(async (tx) => {
            const usage = received.usage ? responseUsage(received) : undefined;
            await tx.query(
              "update agent_steps set status='received',response=$3,response_id=$4 where run_id=$1 and step=$2",
              [run.id, run.turn_index, JSON.stringify(received), received.id],
            );
            await tx.query('update agent_runs set turns=turns+1,output_tokens=output_tokens+$2 where id=$1', [
              run.id,
              usage?.completionTokens ?? 0,
            ]);
            await generationRecorder(
              tx,
              run.generation_id,
              access.config.apiKey,
              run.id,
            )(received.status === 'completed' ? 'model.completed' : 'model.failed', {
              callId,
              ...(received.status !== 'completed' ? { code: received.status } : {}),
              responseId: received.id,
              output: received.output.filter((item) => item.type !== 'reasoning'),
              ...(usage ? { usage } : { usageUnavailable: true }),
              durationMs: Date.now() - started,
              ...(inferenceStarted !== undefined && inferenceMs !== undefined
                ? {
                    timing: {
                      preparationMs: inferenceStarted - started,
                      inferenceMs,
                      ...(firstOutputMs !== undefined ? { firstOutputMs } : {}),
                    },
                  }
                : {}),
            });
          });
        }
        if (response.status !== 'completed')
          return await this.pause(run, `Model response ${response.status}. Resume to continue from saved work.`);
        const delivered = Object.fromEntries(
          (step.input as ResponseItem[]).flatMap((item) =>
            Array.isArray(item.output)
              ? (item.output as any[])
                  .filter((part) => part.type === 'input_image' && part.sourceId)
                  .map((part) => [part.sourceId, part.sha256])
              : [],
          ),
        );
        if (Object.keys(delivered).length)
          await this.db.query(
            "update agent_runs set state=jsonb_set(jsonb_set(state,'{delivered}',coalesce(state->'delivered','{}'::jsonb) || $2::jsonb),'{presented}',coalesce(state->'presented','{}'::jsonb) || $2::jsonb) where id=$1",
            [run.id, JSON.stringify(delivered)],
          );
        const latestRun = await this.load(run.id);
        if (!latestRun || latestRun.status === 'cancelled') return;
        run = latestRun;
        if (run.status === 'pausing') return await this.pause(run, 'Paused by user');
        if (step.phase === 'root') {
          if (response.output.some((i) => i.type === 'function_call'))
            return await this.pause(run, 'Context initialization unexpectedly requested tools.');
          await this.db.query('update paper_sessions set root_response_id=$2 where id=$1', [session.id, response.id]);
        } else {
          const scope = {
            owner: run.owner_id,
            documentId: run.document_id,
            analysisId: run.analysis_id,
            doc: run.doc,
            visuals,
            language: this.config.muse.language,
            availableSources: Object.keys(run.state.delivered ?? {}),
            service: new DocumentService(this.db, this.storage, this.enqueue),
          };
          const calls = response.output.filter((item) => item.type === 'function_call');
          const visualReview = { client: new MuseClient(access.config, this.transport), signal };
          // Reads may run concurrently; writes below are always serialized and committed with their results.
          const reads = calls.filter((call) => paperTools.effect(String(call.name)) === 'read');
          for (let offset = 0; offset < reads.length; offset += 4)
            await Promise.all(
              reads.slice(offset, offset + 4).map((call) => this.tool(run, scope, call, record, visualReview)),
            );
          for (const call of calls.filter((call) => paperTools.effect(String(call.name)) !== 'read')) {
            if (await this.tool(run, scope, call, record, visualReview)) return;
          }
        }
        const toolCalls = response.output.filter((item) => item.type === 'function_call');
        const { rows: toolResults } = await this.db.query(
          'select call_id,result from agent_tool_calls where run_id=$1 and call_id=any($2::text[])',
          [run.id, toolCalls.map((call) => String(call.call_id))],
        );
        const failedCalls = new Set(
          toolResults
            .filter((tool) => {
              try {
                return tool.result.output?.some(
                  (part: any) => part.type === 'input_text' && JSON.parse(part.text)?.error,
                );
              } catch {
                return false;
              }
            })
            .map((tool) => String(tool.call_id)),
        );
        await this.db.transaction(async (tx) => {
          const {
            rows: [latest],
          } = await tx.query('select status,state from agent_runs where id=$1 for update', [run.id]);
          if (['cancelled', 'completed'].includes(latest?.status)) return;
          const progress =
            step.phase === 'root'
              ? { counts: {}, repeated: [] }
              : checkProgress(stateBefore, latest.state, toolCalls, failedCalls);
          await tx.query("update agent_runs set state=jsonb_set(state,'{loopWatch}',$2::jsonb) where id=$1", [
            run.id,
            JSON.stringify(progress.counts),
          ]);
          await tx.query("update agent_steps set status='done' where run_id=$1 and step=$2", [run.id, run.turn_index]);
          const stalled = progress.repeated.length > 0;
          const paused = latest.status === 'pausing' || stalled;
          await tx.query(
            'update agent_runs set head_response_id=$2,turn_index=turn_index+1,status=$3,updated_at=now() where id=$1',
            [run.id, response!.id, paused ? 'paused' : 'queued'],
          );
          await tx.query('update tour_generations set status=$2,updated_at=now() where id=$1', [
            run.generation_id,
            paused ? 'paused' : 'generating',
          ]);
          if (stalled) {
            const reason = `no_progress: ${progress.repeated.join(', ')} repeated without new source evidence or saved tour work. Progress is saved; review the failed action before resuming.`;
            await tx.query('update agent_runs set reason=$2 where id=$1', [run.id, reason]);
            await generationRecorder(
              tx,
              run.generation_id,
              '',
              run.id,
            )('run.paused', { reason, repeatedActions: progress.repeated });
          }
          if (!paused) await scheduleAgent(tx, this.enqueue, run.id, run.document_id);
        });
      } catch (error) {
        const known = error instanceof ProcessingError ? error : null;
        if (await this.load(run.id))
          await generationRecorder(
            this.db.pool,
            run.generation_id,
            '',
            run.id,
          )('model.failed', { callId: `${run.id}:${run.turn_index}`, code: known?.code ?? 'agent_interrupted' });
        if (!known)
          console.error('Paper agent interrupted', {
            runId: run.id,
            name: error instanceof Error ? error.name : 'Error',
            frames: error instanceof Error ? error.stack?.split('\n').slice(1, 5) : undefined,
          });
        // A rejected request is safe to retry on resume. An unknown dispatch is never blindly reissued.
        if (known && ['muse_rate_limited', 'muse_auth_failed', 'muse_request_rejected'].includes(known.code))
          await this.db.query(
            "update agent_steps set status='prepared' where run_id=$1 and step=$2 and response_id is null",
            [run.id, run.turn_index],
          );
        await this.pause(
          run,
          known?.code ?? 'Agent interrupted. Resume from the saved checkpoint.',
          ['muse_auth_failed', 'muse_not_configured'].includes(known?.code ?? ''),
        );
      } finally {
        await this.db.query('update agent_runs set runtime_ms=runtime_ms+$2,updated_at=now() where id=$1', [
          run.id,
          Date.now() - started,
        ]);
      }
    });
  }
  private async useLocalHistory(run: QueryResultRow, record: ReturnType<typeof generationRecorder>) {
    await this.db.transaction(async (tx) => {
      const {
        rows: [current],
      } = await tx.query('select status from agent_runs where id=$1 for update', [run.id]);
      if (!current || ['cancelled', 'completed', 'paused'].includes(current.status)) return;
      const paused = current.status === 'pausing';
      // Only a request explicitly rejected before inference can return to prepared.
      await tx.query("update agent_steps set status='prepared' where run_id=$1 and step=$2 and response_id is null", [
        run.id,
        run.turn_index,
      ]);
      await tx.query(
        "update agent_runs set state=jsonb_set(state,'{historyMode}','\"local\"'::jsonb),status=$2,updated_at=now() where id=$1",
        [run.id, paused ? 'paused' : 'queued'],
      );
      await tx.query('update tour_generations set status=$2,updated_at=now() where id=$1', [
        run.generation_id,
        paused ? 'paused' : 'generating',
      ]);
      if (!paused) await scheduleAgent(tx, this.enqueue, run.id, run.document_id);
    });
    await record('context.fallback', {
      reason: 'provider_history_unavailable',
      mode: 'local',
      savedWorkPreserved: true,
    });
  }
  private async resetContext(run: QueryResultRow, sessionId: string) {
    const state = run.state as RunState;
    state.presented = {};
    state.delivered = {};
    await this.db.transaction(async (tx) => {
      const {
        rows: [session],
      } = await tx.query('select root_response_id from paper_sessions where id=$1', [sessionId]);
      await tx.query("delete from agent_steps where run_id=$1 and step=$2 and status='prepared'", [
        run.id,
        run.turn_index,
      ]);
      await tx.query('update agent_runs set head_response_id=$2,state=$3 where id=$1', [
        run.id,
        session.root_response_id,
        JSON.stringify(state),
      ]);
      await tx.query("insert into agent_steps(run_id,step,phase,input) values($1,$2,'run',$3)", [
        run.id,
        run.turn_index,
        JSON.stringify(this.task({ ...run, state }, true)),
      ]);
      await generationRecorder(
        tx,
        run.generation_id,
        '',
        run.id,
      )('context.reset', { reason: 'context_budget', checkpoint: true });
      await scheduleAgent(tx, this.enqueue, run.id, run.document_id);
    });
  }
  private async tool(
    run: QueryResultRow,
    scope: Parameters<typeof executeTool>[0],
    call: ResponseItem,
    record: ReturnType<typeof generationRecorder>,
    review: { client: MuseClient; signal: AbortSignal },
  ): Promise<boolean> {
    const callId = String(call.call_id),
      name = String(call.name);
    if (
      (await this.db.query('select 1 from agent_tool_calls where run_id=$1 and call_id=$2', [run.id, callId])).rowCount
    )
      return false;
    let args: unknown;
    try {
      args = JSON.parse(String(call.arguments));
    } catch {
      args = null;
    }
    const toolStarted = Date.now();
    await record('tool.started', { callId, name, arguments: args });
    let readResult: Awaited<ReturnType<typeof executeTool>> | undefined;
    let preparedArgs = args;
    let reviewedVisuals: string[] = [];
    let preflightError: unknown;
    let audits = new Set<string>();
    if (name === 'upsert_tour_chapter' || name === 'finish_tour') {
      try {
        const latest = await this.load(run.id);
        if (!latest || ['cancelled', 'completed', 'paused'].includes(latest.status)) return true;
        if (latest.status === 'pausing') {
          await this.pause(latest, 'Paused by user');
          return true;
        }
        const { rows: journal } = await this.db.query(
          "select result from agent_tool_calls where run_id=$1 and name='upsert_tour_chapter'",
          [run.id],
        );
        audits = reviewedAudits(journal);
        if (name === 'finish_tour') assertReviewedState(scope, latest.state, audits);
        else {
          const elements = new Map(indexElements(scope.doc).map((element) => [element.id, element]));
          const images: TourImage[] = [];
          let visualIndex = 0;
          const { call: recorded } = recordedCalls(
            review.client,
            { documentId: scope.documentId, analysisId: scope.analysisId, doc: scope.doc, images, onEvent: record },
            run.model,
            AGENT_VERSION + ':visual-review',
          );
          const client = {
            complete: async (...parameters: Parameters<MuseClient['complete']>) => {
              const [messages, callName, schema, maxTokens, within, , , effort] = parameters;
              const budget = await this.load(run.id);
              if (!budget || ['cancelled', 'completed', 'paused', 'pausing'].includes(budget.status))
                throw new Error('The agent was interrupted before visual review. Saved work is preserved.');
              const limits = this.config.agent ?? { maxTurns: 64, maxOutputTokens: 128000, maxRuntimeMs: 1200000 };
              const available =
                limits.maxOutputTokens - (Number(budget.output_tokens) - Number(budget.budget_base?.output ?? 0));
              if (available < 128 || Number(budget.turns) - Number(budget.budget_base?.turns ?? 0) >= limits.maxTurns)
                throw new Error(
                  'Visual review reached the run budget. Resume from the saved checkpoint before resubmitting this chapter.',
                );
              const completion = await recorded(
                messages,
                callName,
                schema,
                Math.min(maxTokens, available),
                effort ?? 'low',
                within ?? review.signal,
              );
              await this.db.query('update agent_runs set turns=turns+1,output_tokens=output_tokens+$2 where id=$1', [
                run.id,
                completion.usage.completionTokens,
              ]);
              return completion;
            },
          };
          const checked = await prepareReviewedChapter(
            scope,
            latest.state,
            args,
            async (item, step) => {
              review.signal.throwIfAborted();
              const refs = new Set([step.source, ...step.evidence, ...item.sourceRefs]);
              const pages = new Set([...refs].flatMap((id) => elements.get(id)?.page ?? []));
              const sources = scope.visuals
                .filter((source) => refs.has(source.targetId) || pages.has(source.page))
                .sort((a, b) => Number(refs.has(b.targetId)) - Number(refs.has(a.targetId)))
                .slice(0, 3);
              const sourceImages: string[] = [];
              for (const source of sources) {
                let image = images.find((image) => image.targetId === source.targetId);
                if (!image) {
                  const [hydrated] = (await hydrateImages(
                    [{ type: 'input_image', storagePath: source.storagePath, sha256: source.sha256 }],
                    this.storage,
                    scope.visuals,
                  )) as { image_url: string }[];
                  image = {
                    targetId: source.targetId,
                    kind: source.kind,
                    page: source.page,
                    label: source.label,
                    dataUrl: hydrated.image_url,
                  };
                  images.push(image);
                }
                sourceImages.push(image.dataUrl);
              }
              const visualCall = `${callId}:visual:${step.id}:${++visualIndex}`;
              await record('tool.started', {
                callId: visualCall,
                name: 'render_visual',
                arguments: { step: step.id, kind: item.kind },
              });
              try {
                const visual = await reviewAuthoredWithModel(item, {
                  client,
                  narration: step.say,
                  evidence: [...refs].map((id) => `[${id}] ${elements.get(id)?.text ?? 'Unknown source'}`).join('\n'),
                  sourceImages,
                  allowedSourceRefs: [...elements.keys()],
                  signal: review.signal,
                });
                await record('tool.completed', {
                  callId: visualCall,
                  name: 'render_visual',
                  output: { reviewed: true, step: step.id },
                });
                return visual;
              } catch (error) {
                await record('tool.completed', {
                  callId: visualCall,
                  name: 'render_visual',
                  output: { error: error instanceof Error ? error.message : 'Rendered review failed' },
                });
                throw error;
              }
            },
            audits,
          );
          preparedArgs = checked.args;
          reviewedVisuals = checked.audits;
        }
      } catch (error) {
        preflightError = error;
      }
    }
    if (paperTools.effect(name) === 'read') {
      try {
        readResult = await executeTool(scope, run.state, name, args);
      } catch (error) {
        readResult = { state: run.state, output: { error: error instanceof Error ? error.message : 'Read failed' } };
      }
    }
    return this.db.transaction(async (tx) => {
      const {
        rows: [current],
      } = await tx.query('select * from agent_runs where id=$1 for update', [run.id]);
      if (!current || ['cancelled', 'completed', 'paused'].includes(current.status)) return true;
      if (current.status === 'pausing') {
        await tx.query("update agent_runs set status='paused',reason='Paused by user',updated_at=now() where id=$1", [
          run.id,
        ]);
        await tx.query(
          "update tour_generations set status='paused',error='Paused by user',error_code='agent_paused',updated_at=now() where id=$1",
          [run.generation_id],
        );
        await generationRecorder(tx, run.generation_id, '', run.id)('run.paused', { reason: 'Paused by user' });
        return true;
      }
      const {
        rows: [owned],
      } = await tx.query('select 1 from documents where id=$1 and owner_id=$2 and deleted_at is null', [
        scope.documentId,
        scope.owner,
      ]);
      if (!owned) return true;
      // Run lock serializes turns; this row lock also orders independently computed read results.
      if ((await tx.query('select 1 from agent_tool_calls where run_id=$1 and call_id=$2', [run.id, callId])).rowCount)
        return false;
      let result: Awaited<ReturnType<typeof executeTool>>;
      try {
        if (preflightError) throw preflightError;
        if (name === 'finish_tour') assertReviewedState(scope, current.state, audits);
        result = readResult
          ? { ...readResult, state: current.state }
          : await executeTool(scope, current.state, name, preparedArgs);
        if (name === 'upsert_tour_chapter' && reviewedVisuals.length)
          result.output = { ...(result.output as Record<string, unknown>), reviewedVisuals };
      } catch (error) {
        result = {
          state: current.state,
          output: {
            error:
              error instanceof TourValidationError
                ? error.problems
                : error instanceof Error
                  ? error.message
                  : 'Tool failed',
          },
        };
      }
      const output = toolOutput(callId, result.output, result.images);
      await tx.query('insert into agent_tool_calls(run_id,call_id,name,arguments,result) values($1,$2,$3,$4,$5)', [
        run.id,
        callId,
        name,
        JSON.stringify(args),
        JSON.stringify(output),
      ]);
      await tx.query('update agent_runs set state=$2 where id=$1', [run.id, JSON.stringify(result.state)]);
      if (name === 'record_visual_observations' && !(result.output as any)?.error) {
        for (const [id, observation] of Object.entries(result.state.observations)) {
          const source = scope.visuals.find((v) => v.targetId === id)!;
          await tx.query(
            'insert into visual_observation_cache(session_id,source_id,image_hash,observation) values($1,$2,$3,$4) on conflict(session_id,source_id) do update set observation=excluded.observation',
            [current.session_id, id, source.sha256, JSON.stringify(observation)],
          );
        }
      }
      const stage = paperTools.stage(name);
      await tx.query('update tour_generations set stage=$2,images_done=$3,updated_at=now() where id=$1', [
        run.generation_id,
        stage,
        requiredVisuals(scope.doc, scope.visuals).filter((source) => result.state.observations[source.targetId]).length,
      ]);
      await generationRecorder(
        tx,
        run.generation_id,
        '',
        run.id,
      )('tool.completed', {
        callId,
        name,
        output: result.output,
        durationMs: Date.now() - toolStarted,
        ...(result.images ? { images: result.images.map(({ storagePath: _path, ...v }) => v) } : {}),
      });
      if (result.finished) {
        const {
          rows: [doc],
        } = await tx.query('select deleted_at from documents where id=$1 for update', [scope.documentId]);
        if (!doc || doc.deleted_at) return true;
        const {
          rows: [tour],
        } = await tx.query(
          'insert into tours(document_id,analysis_id,title,script,generation_id) values($1,$2,$3,$4,$5) on conflict(generation_id) do update set generation_id=excluded.generation_id returning id',
          [scope.documentId, scope.analysisId, result.finished.tour.title, result.finished.tour, run.generation_id],
        );
        const published = await persistTourVisuals(
          new VisualArtifactService(this.db),
          scope.owner,
          scope.documentId,
          scope.analysisId,
          tour.id,
          result.finished.tour,
          tx,
        );
        await tx.query('update tours set script=$2 where id=$1', [tour.id, JSON.stringify(published)]);
        await tx.query(
          "update tour_generations set status='ready',stage='validating',result_tour_id=$2,metadata=$3,completed_at=now(),updated_at=now() where id=$1",
          [
            run.generation_id,
            tour.id,
            JSON.stringify({
              engine: 'agent',
              profile: run.profile ?? null,
              model: run.model,
              agentVersion: AGENT_VERSION,
              usage: { outputTokens: Number(current.output_tokens), turns: current.turns },
              stepEvidence: result.finished.evidence,
              visualObservations: result.state.observations,
            }),
          ],
        );
        await tx.query(
          "update agent_runs set status='completed',head_response_id=(select response_id from agent_steps where run_id=$1 and step=agent_runs.turn_index),reason=null,updated_at=now() where id=$1",
          [run.id],
        );
        await tx.query("update agent_steps set status='done' where run_id=$1 and step=$2", [run.id, run.turn_index]);
        await generationRecorder(tx, run.generation_id, '', run.id)('tour.direction', tourDirection(published));
        await generationRecorder(tx, run.generation_id, '', run.id)('run.completed', { tourId: tour.id });
        await tx.query('update documents set updated_at=now() where id=$1', [scope.documentId]);
        return true;
      }
      return false;
    });
  }
}
