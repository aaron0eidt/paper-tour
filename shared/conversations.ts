import type { BoardItem, Step } from './paper';
import type { RegionSelection } from './selection';

/** The source the learner was looking at. Each message keeps its own immutable snapshot. */
export interface ConversationContext {
  analysisId?: string;
  tourId?: string;
  stepId?: string;
  page?: number;
  figureId?: string;
  selection?: RegionSelection;
  activeVisual?: BoardItem;
  visualId?: string;
  visualRevision?: number;
}

/** Answer steps are saved independently of tours so they can be replayed without editing a tour. */
export interface ConversationAnswer {
  answerable: 'yes' | 'partly' | 'no';
  language?: string;
  steps: Step[];
  followups: string[];
  conversationId?: string;
  messageId?: string;
}

export interface ConversationSummary {
  id: string;
  documentId: string;
  title: string;
  context: ConversationContext;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationMessage {
  id: string;
  question: string;
  context: ConversationContext;
  answer: ConversationAnswer | null;
  status: 'pending' | 'completed' | 'cancelled' | 'failed';
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface Conversation extends ConversationSummary {
  messages: ConversationMessage[];
}

export interface CreateConversation {
  title?: string;
  context?: ConversationContext;
}
