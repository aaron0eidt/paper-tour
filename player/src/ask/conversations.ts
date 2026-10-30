import type {
  Conversation,
  ConversationContext,
  ConversationSummary,
  CreateConversation,
} from '../../../shared/conversations';
import { apiRequest } from '../library/client';

const path = (documentId: string, id?: string) =>
  `/api/documents/${encodeURIComponent(documentId)}/conversations${id ? `/${encodeURIComponent(id)}` : ''}`;
export const listConversations = (documentId: string, signal?: AbortSignal) =>
  apiRequest<{ conversations: ConversationSummary[] }>(path(documentId), { signal }).then((r) => r.conversations);
export const getConversation = (documentId: string, id: string, signal?: AbortSignal) =>
  apiRequest<Conversation>(path(documentId, id), { signal });
export const createConversation = (documentId: string, input: CreateConversation, signal?: AbortSignal) =>
  apiRequest<Conversation>(path(documentId), { method: 'POST', body: JSON.stringify(input), signal });

/** Incomplete turns remain visible, but are never sent back as successful model history. */
export function latestAnswer(conversation: Conversation | null) {
  return (
    conversation?.messages
      .slice()
      .reverse()
      .find((m) => m.answer?.steps.length) ?? null
  );
}

/** A resumed thread keeps its source analysis. Current selections and visuals remain explicit per-turn context. */
export function threadContext(current: ConversationContext, conversation: Conversation | null): ConversationContext {
  if (!conversation) return current;
  if (current.analysisId && current.analysisId !== conversation.context.analysisId) {
    const last = conversation.messages.at(-1)?.context ?? conversation.context;
    return { ...last, analysisId: conversation.context.analysisId };
  }
  return { ...current, analysisId: conversation.context.analysisId };
}

export function conversationLabel(context: ConversationContext): string {
  return [
    context.page || context.selection?.page ? `Page ${context.page ?? context.selection?.page}` : '',
    context.selection ? 'Selected region' : context.figureId ? 'Figure or equation' : 'Document',
  ]
    .filter(Boolean)
    .join(' · ');
}
