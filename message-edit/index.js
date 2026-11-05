/**
 * Host half of the message-edit bundle.
 *
 * The client submits the edited text through a normal prompt whose first line
 * carries a sentinel header: `\u2063{"s":<startSeq>}\n<edited text>`. This half
 * intercepts that prompt in `agent/pre-step` — before the accepted user batch
 * commits — and:
 *
 * 1. appends a `developer/message` surface replacement
 *    (`surfaceOp: {op:'replace', startSeq, endSeq}` + the complete
 *    `sourceEventSeqs` set) whose message content is EMPTY: it retains the
 *    replaced surface position while contributing no wire message, so the
 *    original exchange and everything after it leave the model context;
 * 2. rewrites the batch message into the plain edited text — the only
 *    model-visible copy, appended right after the retained history.
 *
 * The model-visible wire request therefore reads
 * [history before the edit] + [edited message] + [this step's answer] — the
 * edited prompt answers as if it had been the original. The replacement lands
 * in `pre-step`, before this step's request is assembled. No fork, no session
 * change, no service lines. The append-only audit log is retained; this is not
 * physical erasure of stored events or rollback of external tool side effects.
 */
const SENTINEL = '\u2063';

export const inject = ['agents'];

/** First text block of a message, or undefined. */
function firstText(message) {
  const block = Array.isArray(message?.content) ? message.content.find((part) => part?.type === 'text') : undefined;
  return typeof block?.text === 'string' ? block.text : undefined;
}

export function apply(ctx) {
  /** agent -> pre-step registration disposer. */
  const disposers = new Map();

  const preStep = async (payload, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || !Array.isArray(decision.messages)) return decision;
    const marked = decision.messages.filter((message) => (firstText(message) ?? '').startsWith(SENTINEL));
    if (marked.length === 0) return decision;
    // Never fall back to submitting the protocol header as an ordinary prompt:
    // that would silently answer with the history the user asked to remove.
    if (marked.length !== 1) throw new Error('[message-edit] Send only one edit at a time.');
    const message = marked[0];
    const raw = firstText(message);
    const newline = raw.indexOf('\n', SENTINEL.length);
    let startSeq;
    try {
      startSeq = JSON.parse(raw.slice(SENTINEL.length, newline)).s;
    } catch {
      throw new Error('[message-edit] Invalid edit header.');
    }
    if (newline === -1 || !Number.isSafeInteger(startSeq) || startSeq < 0 || Object.is(startSeq, -0)) {
      throw new Error('[message-edit] Invalid message sequence.');
    }
    const editedText = raw.slice(newline + 1);
    if (editedText.trim() === '') throw new Error('[message-edit] Edited message cannot be empty.');
    if (payload.signal.aborted) return { kind: 'reject' };
    const { agent, turn, step } = payload;
    if (![turn, step].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('[message-edit] Invalid pre-step turn/step counters.');
    }
    const nodes = agent.session.surface.nodes;
    const startIndex = nodes.indexOf(startSeq);
    if (startIndex === -1) throw new Error('[message-edit] Message is no longer in context. Refresh the conversation before editing.');
    // eventAt is the installed Session API for an exact durable sequence.
    const original = agent.session.eventAt(startSeq);
    if (original?.type !== 'user/message') throw new Error('[message-edit] Only user messages can be edited.');
    const originalMessage = agent.session.deriveEventMessage(original);
    // Preserve image/file/reference blocks (including any active projections).
    // Only replace text, keeping the first text block's position among attachments.
    let inserted = false;
    const content = originalMessage.content.flatMap((part) => {
      if (part.type !== 'text') return [part];
      if (inserted) return [];
      inserted = true;
      return [{ type: 'text', text: editedText }];
    });
    if (!inserted) content.unshift({ type: 'text', text: editedText });
    const messages = decision.messages.map((item) => item === message ? { ...item, content } : item);
    const endSeq = nodes[nodes.length - 1];
    // Empty developer nodes shadow the old suffix without adding a wire message.
    // Both counters are mandatory in the current DSH event format.
    agent.session.append('developer/message', {
      turn,
      step,
      message: { role: 'developer', id: `edited-${endSeq}`, source: { kind: 'message-edit' }, content: [] },
    }, {
      surfaceOp: { op: 'replace', startSeq, endSeq },
      sourceEventSeqs: nodes.slice(startIndex),
    });
    return { ...decision, messages, startsRequestSeries: true };
  };

  const attach = (agent) => {
    if (disposers.has(agent)) return;
    disposers.set(agent, agent.ctx.effect(() => agent.ctx.on('agent/pre-step', preStep, 'message-edit: pre-step'), 'message-edit: pre-step binding'));
  };

  // Attach to agents that are already live (an open session predates this plugin generation).
  for (const agent of ctx.agents.list()) attach(agent);
  ctx.on('agent/created', ({ agent }) => attach(agent));
  ctx.on('agent/disposed', ({ agent }) => {
    const dispose = disposers.get(agent);
    if (dispose !== undefined) {
      disposers.delete(agent);
      dispose();
    }
  });

  ctx.effect(() => () => {
    for (const dispose of disposers.values()) dispose();
    disposers.clear();
  }, 'message-edit: cleanup');
}
