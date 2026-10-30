import type { VisualArtifact, VisualArtifactInput, VisualArtifactRef } from '../../../shared/visualArtifacts';
import type { BoardItem } from '../../../shared/paper';
import { Database, type Db } from '../db';
import { HttpError, missing } from '../errors';
import { BOARD_KINDS, checkBoard, type BoardKind } from '../harness/board';

type Row = Record<string, unknown>;
const artifact = (row: Row): VisualArtifact => ({
  id: String(row.id),
  revision: Number(row.revision),
  documentId: String(row.document_id),
  item: row.item as BoardItem,
  createdAt: new Date(row.created_at as string).toISOString(),
  ...(row.conversation_id ? { conversationId: String(row.conversation_id) } : {}),
  ...(row.tour_id ? { tourId: String(row.tour_id) } : {}),
  ...(row.parent_id ? { parent: { id: String(row.parent_id), revision: Number(row.parent_revision) } } : {}),
});
const checkedItem = (item: BoardItem) => {
  if (!item || !BOARD_KINDS.includes(item.kind)) throw new HttpError(400, 'invalid_visual', 'Unknown visual kind.');
  const check = checkBoard(item.kind as BoardKind, item, JSON.stringify(item));
  if (!check.item || check.problems.length) throw new HttpError(400, 'invalid_visual', check.problems.join('; '));
  return check.item;
};
/** Private owner-checked, append-only persistence. Tour artifacts can only be forked, never revised. */
export class VisualArtifactService {
  constructor(private readonly db: Database) {}
  private async owned(db: Db, owner: string, documentId: string) {
    const result = await db.query('select id from documents where id=$1 and owner_id=$2 and deleted_at is null', [
      documentId,
      owner,
    ]);
    if (!result.rows.length) missing();
  }
  async get(owner: string, documentId: string, ref: VisualArtifactRef): Promise<VisualArtifact> {
    await this.owned(this.db.pool, owner, documentId);
    const { rows } = await this.db.query(
      'select a.*,r.revision,r.item,r.created_at from visual_artifacts a join visual_artifact_revisions r on r.artifact_id=a.id where a.id=$1 and a.document_id=$2 and a.owner_id=$3 and r.revision=$4',
      [ref.id, documentId, owner, ref.revision],
    );
    return rows[0] ? artifact(rows[0]) : missing();
  }
  async create(owner: string, documentId: string, input: VisualArtifactInput, tx?: Db): Promise<VisualArtifact> {
    const item = checkedItem(input.item);
    const run = async (db: Db) => {
      await this.owned(db, owner, documentId);
      if (input.conversationId && input.tourId)
        throw new HttpError(400, 'invalid_visual_origin', 'Choose a conversation or tour.');
      if (input.conversationId) {
        const { rows } = await db.query(
          'select id from document_conversations where id=$1 and document_id=$2 and owner_id=$3',
          [input.conversationId, documentId, owner],
        );
        if (!rows.length) missing();
      }
      if (input.tourId) {
        const { rows } = await db.query('select id from tours where id=$1 and document_id=$2', [
          input.tourId,
          documentId,
        ]);
        if (!rows.length) missing();
      }
      if (input.parent) {
        const { rows } = await db.query(
          'select r.revision from visual_artifacts a join visual_artifact_revisions r on r.artifact_id=a.id where a.id=$1 and a.document_id=$2 and a.owner_id=$3 and r.revision=$4',
          [input.parent.id, documentId, owner, input.parent.revision],
        );
        if (!rows.length) missing();
      }
      const {
        rows: [row],
      } = await db.query(
        'insert into visual_artifacts(owner_id,document_id,conversation_id,tour_id,parent_id,parent_revision) values($1,$2,$3,$4,$5,$6) returning *',
        [
          owner,
          documentId,
          input.conversationId ?? null,
          input.tourId ?? null,
          input.parent?.id ?? null,
          input.parent?.revision ?? null,
        ],
      );
      const {
        rows: [revision],
      } = await db.query(
        'insert into visual_artifact_revisions(artifact_id,revision,item) values($1,1,$2) returning revision,item,created_at',
        [row.id, JSON.stringify(item)],
      );
      return artifact({ ...row, ...revision });
    };
    return tx ? run(tx) : this.db.transaction(run);
  }
  async revise(owner: string, documentId: string, ref: VisualArtifactRef, item: BoardItem): Promise<VisualArtifact> {
    const checked = checkedItem(item);
    return this.db.transaction(async (db) => {
      await this.owned(db, owner, documentId);
      const {
        rows: [row],
      } = await db.query('select * from visual_artifacts where id=$1 and owner_id=$2 and document_id=$3 for update', [
        ref.id,
        owner,
        documentId,
      ]);
      if (!row) missing();
      if (!row.conversation_id)
        throw new HttpError(409, 'fork_tour_visual', 'Fork this visual into a conversation before changing it.');
      const {
        rows: [last],
      } = await db.query('select max(revision) as revision from visual_artifact_revisions where artifact_id=$1', [
        ref.id,
      ]);
      if (Number(last.revision) !== ref.revision)
        throw new HttpError(409, 'visual_revision_conflict', 'This visual has a newer revision.');
      const {
        rows: [revision],
      } = await db.query(
        'insert into visual_artifact_revisions(artifact_id,revision,item) values($1,$2,$3) returning revision,item,created_at',
        [ref.id, ref.revision + 1, JSON.stringify(checked)],
      );
      return artifact({ ...row, ...revision });
    });
  }
}
