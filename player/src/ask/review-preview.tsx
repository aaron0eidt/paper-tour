// Temporary review preview for the AskPanel (deleted after the review). No network: fetch is scripted, and the
// Supabase session is an in-memory stub that is never written to storage or broadcast to other tabs.
import '../styles.css';

type Outcome = 'yes' | 'partly' | 'no' | 'error' | 'busy';
const control = { outcome: 'yes' as Outcome, delay: 1200 };
(window as unknown as { __ask: typeof control }).__ask = control;

// Auth stub: a fake, far-future session for this page only.
const isAuthKey = (key: string) => key.startsWith('sb-') && key.includes('-auth-token');
const fake = JSON.stringify({
  access_token: 'review-preview-access',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 36000,
  refresh_token: 'review-preview-refresh',
  user: {
    id: '00000000-0000-4000-8000-000000000000',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'preview@example.test',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
  },
});
const getItem = Storage.prototype.getItem;
const setItem = Storage.prototype.setItem;
const removeItem = Storage.prototype.removeItem;
Storage.prototype.getItem = function (key: string) {
  if (isAuthKey(key)) return key.endsWith('-auth-token') ? fake : null;
  return getItem.call(this, key);
};
Storage.prototype.setItem = function (key: string, value: string) {
  if (!isAuthKey(key)) setItem.call(this, key, value);
};
Storage.prototype.removeItem = function (key: string) {
  if (!isAuthKey(key)) removeItem.call(this, key);
};
delete (window as { BroadcastChannel?: unknown }).BroadcastChannel;

const answer = (answerable: 'yes' | 'partly' | 'no') => ({
  answerable,
  steps: [
    {
      id: 'ask-1a2b3c4d-1',
      say: 'The authors scale the dot products because they grow large when d k is large.',
      actions: [{ type: 'focus', target: 'p2.s4' }],
    },
  ],
  followups: ['What is d_k in the base model?', 'Does scaling change the BLEU score on English-to-German translation?'],
});

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.includes('/ask')) throw new TypeError('Network disabled in the review preview');
  const signal = init?.signal;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, control.delay);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (control.outcome === 'error')
    return json(502, {
      error: { code: 'answer_failed', message: 'The model could not answer this. Try asking it another way.' },
    });
  if (control.outcome === 'busy')
    return json(429, { error: { code: 'model_busy', message: 'The model is busy right now. Ask again in a moment.' } });
  return json(200, answer(control.outcome));
}) as typeof fetch;

const [{ createRoot }, { createElement: h, useState }, { AskPanel }] = await Promise.all([
  import('react-dom/client'),
  import('react'),
  import('./AskPanel'),
]);

function Preview() {
  const [ended, setEnded] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const note = (e: string) => setEvents((list) => [...list.slice(-3), e]);
  const page = h(
    'div',
    { className: 'pv-page' },
    h('h3', null, '3.2 Scaled Dot-Product Attention'),
    ...Array.from({ length: 9 }, (_, i) =>
      h(
        'p',
        { key: i },
        'We compute the dot products of the query with all keys, divide each by the square root of d_k, and apply a softmax function to obtain the weights on the values.',
      ),
    ),
  );
  return h(
    'div',
    { className: 'pv' },
    h(
      'div',
      { className: 'pv-bar' },
      h('label', null, h('input', { type: 'checkbox', checked: ended, onChange: () => setEnded(!ended) }), ' ended'),
      h('span', { className: 'pv-log' }, events.join(' · ')),
    ),
    h(
      'div',
      { className: 'pv-stage' },
      page,
      h(AskPanel, {
        className: 'ask-dock',
        documentId: '7694558d-f7e2-4cbd-9355-978ec677b254',
        tourId: '5a0d3f8e-7b8e-4c55-bb4c-0f2f1f8b9c3d',
        stepId: 'method-1',
        suggestions: [
          'Why divide by the square root of d_k?',
          'How does multi-head attention differ from single-head attention?',
          'What does the model reach on English-to-French?',
        ],
        ended,
        onAsk: (q: string) => note(`ask: ${q}`),
        onAnswer: (steps: unknown[]) => note(`answer: ${steps.length} step(s)`),
        onResume: () => note('resume'),
      }),
    ),
  );
}

const style = document.createElement('style');
style.textContent = `
.pv { display: grid; grid-template-rows: auto 1fr; grid-template-columns: minmax(0, 1fr); height: 100%; }
.pv-bar { display: flex; gap: 16px; align-items: center; padding: 8px 16px; font-size: 12px; color: var(--muted);
  border-bottom: 1px solid var(--line); background: var(--panel); }
.pv-log { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.pv-stage { position: relative; overflow: hidden; background: var(--stage-bg); --ask-dock-bottom: 24px; }
.pv-page { width: min(760px, calc(100% - 32px)); margin: 24px auto; padding: 40px 56px; background: #fff; color: #222;
  font: 15px/1.6 Georgia, serif; box-shadow: 0 10px 40px rgba(0,0,0,.4); }
`;
document.head.append(style);
createRoot(document.getElementById('root')!).render(h(Preview));
