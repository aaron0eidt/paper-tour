import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type {
  Conversation,
  ConversationAnswer,
  ConversationContext,
  ConversationMessage,
  ConversationSummary,
  CreateConversation,
} from '../../shared/conversations';
import type { AskRequest, AskTurn } from './harness/ask-types';
import { Database, type Db } from './db';
import { HttpError, missing } from './errors';

const iso = (value: string | Date) => new Date(value).toISOString();
const summary = (r: QueryResultRow): ConversationSummary => ({
  id: r.id,
  documentId: r.document_id,
  title: r.title,
  context: r.context,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  messageCount: Number(r.message_count ?? 0),
});
const message = (r: QueryResultRow): ConversationMessage => ({
  id: r.id,
  question: r.question,
  context: r.context,
  answer: r.answer,
  status: r.status,
  createdAt: iso(r.created_at),
  completedAt: r.completed_at ? iso(r.completed_at) : null,
  error: r.error,
});

/** Only successfully completed exchanges become model history. Browser-supplied history is never trusted. */
export function conversationHistory(
  messages: Pick<ConversationMessage, 'question' | 'answer' | 'status'>[],
): AskTurn[] {
  return messages
    .filter((m) => m.status === 'completed' && m.answer)
    .slice(-4)
    .map((m) => ({
      question: m.question,
      answer: m
        .answer!.steps.map((step) => step.say)
        .join(' ')
        .slice(0, 2000),
    }));
}

export function conversationContext(request: AskRequest): ConversationContext {
  const { analysisId, tourId, stepId, page, figureId, selection, activeVisual, visualId, visualRevision } = request;
  return { analysisId, tourId, stepId, page, figureId, selection, activeVisual, visualId, visualRevision };
}

/** Owner and document checks live in every query, including turn completion after a disconnected browser. */
export class ConversationStore {
  constructor(private readonly db: Database) {}

  private async owned(owner: string, documentId: string, id: string, db: Db = this.db.pool, lock = false) {
    const {
      rows: [row],
    } = await db.query(
      `select c.* from document_conversations c join documents d on d.id=c.document_id
       where c.id=$1 and c.document_id=$2 and c.owner_id=$3 and d.owner_id=$3 and d.deleted_at is null
       ${lock ? 'for update of c' : ''}`,
      [id, documentId, owner],
    );
    return row ?? missing();
  }

  async list(owner: string, documentId: string): Promise<ConversationSummary[]> {
    const {
      rows: [doc],
    } = await this.db.query('select id from documents where id=$1 and owner_id=$2 and deleted_at is null', [
      documentId,
      owner,
    ]);
    if (!doc) missing();
    const { rows } = await this.db.query(
      `select c.*, (select count(*) from conversation_messages m where m.conversation_id=c.id) as message_count
       from document_conversations c where document_id=$1 and owner_id=$2 order by updated_at desc, id`,
      [documentId, owner],
    );
    return rows.map(summary);
  }

  async get(owner: string, documentId: string, id: string): Promise<Conversation> {
    const row = await this.owned(owner, documentId, id);
    const { rows } = await this.db.query(
      'select * from conversation_messages where conversation_id=$1 order by created_at, id',
      [id],
    );
    return { ...summary({ ...row, message_count: rows.length }), messages: rows.map(message) };
  }

  async create(owner: string, documentId: string, input: CreateConversation): Promise<Conversation> {
    return this.db.transaction(async (db) => {
      const {
        rows: [doc],
      } = await db.query(
        'select current_analysis_id from documents where id=$1 and owner_id=$2 and deleted_at is null',
        [documentId, owner],
      );
      if (!doc) return missing();
      const context = { ...input.context };
      const {
        rows: [analysis],
      } = await db.query("select id from analyses where document_id=$1 and id=$2 and status in ('ready','limited')", [
        documentId,
        context.analysisId ?? doc.current_analysis_id,
      ]);
      if (!analysis) throw new HttpError(409, 'analysis_not_ready', 'The document analysis is not ready yet.');
      context.analysisId = analysis.id;
      if (context.tourId) {
        const {
          rows: [tour],
        } = await db.query('select id from tours where id=$1 and document_id=$2 and analysis_id=$3', [
          context.tourId,
          documentId,
          analysis.id,
        ]);
        if (!tour)
          throw new HttpError(400, 'analysis_mismatch', 'The selected tour belongs to a different document analysis.');
      }
      const {
        rows: [row],
      } = await db.query(
        'insert into document_conversations(owner_id,document_id,analysis_id,title,context) values($1,$2,$3,$4,$5) returning *',
        [owner, documentId, analysis.id, input.title?.trim().slice(0, 160) || 'New conversation', context],
      );
      return { ...summary(row), messages: [] };
    });
  }

  async rename(owner: string, documentId: string, id: string, title: string): Promise<Conversation> {
    await this.owned(owner, documentId, id);
    if (!title.trim()) throw new HttpError(400, 'invalid_title', 'Enter a conversation title.');
    await this.db.query('update document_conversations set title=$2,updated_at=now() where id=$1', [id, title.trim()]);
    return this.get(owner, documentId, id);
  }

  /** Lock before reading history and inserting a turn so two tabs cannot answer from divergent histories. */
  async begin(owner: string, documentId: string, id: string, request: AskRequest) {
    return this.db.transaction(async (db) => {
      const thread = await this.owned(owner, documentId, id, db, true);
      if (request.analysisId !== thread.analysis_id)
        throw new HttpError(
          409,
          'conversation_analysis_mismatch',
          'Open this conversation with its original document analysis, or start a new conversation.',
        );
      // A process restart must not leave a conversation permanently locked.
      await db.query(
        "update conversation_messages set status='failed',error='The previous answer was interrupted.',completed_at=now() where conversation_id=$1 and status='pending' and created_at < now()-interval '5 minutes'",
        [id],
      );
      const {
        rows: [pending],
      } = await db.query("select id from conversation_messages where conversation_id=$1 and status='pending'", [id]);
      if (pending)
        throw new HttpError(
          409,
          'conversation_busy',
          'An answer is already being written in this conversation. Wait for it to finish or start a new conversation.',
        );
      const { rows } = await db.query(
        "select * from conversation_messages where conversation_id=$1 and status='completed' order by created_at desc, id desc limit 4",
        [id],
      );
      const messageId = randomUUID();
      await db.query(
        "insert into conversation_messages(id,conversation_id,question,context,status) values($1,$2,$3,$4,'pending')",
        [messageId, id, request.question, conversationContext(request)],
      );
      await db.query(
        "update document_conversations set updated_at=now(), title=case when title='New conversation' then $2 else title end where id=$1",
        [id, request.question.slice(0, 160)],
      );
      return { messageId, history: conversationHistory(rows.reverse().map(message)) };
    });
  }

  async finish(
    owner: string,
    documentId: string,
    id: string,
    messageId: string,
    status: Exclude<ConversationMessage['status'], 'pending'>,
    answer: ConversationAnswer | null,
    error?: string,
  ) {
    await this.db.transaction(async (db) => {
      await this.owned(owner, documentId, id, db, true);
      await db.query(
        "update conversation_messages set status=$3,answer=$4,error=$5,completed_at=now() where conversation_id=$1 and id=$2 and status='pending'",
        [id, messageId, status, answer, error ?? null],
      );
      await db.query('update document_conversations set updated_at=now() where id=$1', [id]);
    });
  }
}
