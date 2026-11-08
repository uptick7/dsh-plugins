window.__ModuleLoader__.load({
  id: '@uptick7/dsh-message-edit',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'message-edit';
    /** Retain-consumer label for the edit flow's Session references. */
    const SRC = 'messageEdit';
    /** First-line sentinel the host half intercepts in agent/pre-step. */
    const SENTINEL = '\u2063';

    /** English dictionary (fallback locale). */
    const en = {
      'edit.action': 'Edit message',
      'edit.copy': 'Copy',
      'edit.copied': 'Copied',
      'edit.send': 'Send',
      'edit.cancel': 'Cancel',
      'edit.sending': 'Sending…',
      'edit.hint': 'The message is replaced in this session; all subsequent messages leave the context.',
      'edit.error.fork': 'Cannot edit this message here',
      'edit.error.prompt': 'Failed to send the edited message',
    };

    /** Russian dictionary. */
    const ru = {
      'edit.action': 'Редактировать сообщение',
      'edit.copy': 'Копировать',
      'edit.copied': 'Скопировано',
      'edit.send': 'Отправить',
      'edit.cancel': 'Отмена',
      'edit.sending': 'Отправка…',
      'edit.hint': 'Сообщение будет заменено в этой же сессии; все последующие сообщения уйдут из контекста.',
      'edit.error.fork': 'Это сообщение нельзя отредактировать здесь',
      'edit.error.prompt': 'Не удалось отправить отредактированное сообщение',
    };

    //#region styles
    /**
     * Plugin styles. Copied visual language from the shipped chat user row and
     * message actions (Chat View patterns), renamed under this plugin's prefix;
     * only theme tokens and shipped-used tokens with fallbacks are referenced.
     */
    const STYLE_ID = 'dsh-message-edit-style';
    const CSS = `
.dshmsg-edit-row{flex-direction:column;align-items:flex-end;gap:6px;display:flex}
[data-chat-flow-kind="message-edit-shadow"]:has([data-message-edit-empty]){display:none!important}
.dshmsg-edit-actions{height:calc(28px + var(--dsh-content-font-delta,0px));align-items:center;gap:8px;display:flex}
.dshmsg-edit-time{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap;padding-right:12px}
.dshmsg-edit-btn{position:relative;width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;justify-content:center;align-items:center;padding:6px;display:inline-flex}
.dshmsg-edit-btn svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}
.dshmsg-edit-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshmsg-edit-btn:focus-visible{outline:1.5px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
/* Older user rows keep their actions hidden until the row is hovered, like the shipped strip. */
@media (hover:hover){
  [data-chat-flow-kind=user]:has(~[data-chat-flow-kind=user]) .dshmsg-edit-actions,
  [data-chat-flow-kind=user]:has(~[data-chat-flow-kind=steering]) .dshmsg-edit-actions{opacity:0;transition:opacity 80ms}
  [data-chat-flow-kind=user]:has(~[data-chat-flow-kind=user]):hover .dshmsg-edit-actions,
  [data-chat-flow-kind=user]:has(~[data-chat-flow-kind=user]):focus-within .dshmsg-edit-actions,
  [data-chat-flow-kind=user]:has(~[data-chat-flow-kind=steering]):hover .dshmsg-edit-actions,
  [data-chat-flow-kind=user]:has(~[data-chat-flow-kind=steering]):focus-within .dshmsg-edit-actions{opacity:1}
}
/* Native-tooltip substitute: a small host-pattern label below the button. */
.dshmsg-edit-tip{pointer-events:none;z-index:30;position:absolute;top:calc(100% + 4px);right:0;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:0.5px solid var(--dsw-alias-border-l2,#0000001f);border-radius:var(--dsw-radius-sm,6px);box-shadow:var(--dsw-elevation-panel,0 4px 16px #00000026);font-size:12px;line-height:16px;padding:4px 8px;white-space:nowrap;display:none}
.dshmsg-edit-btn:hover .dshmsg-edit-tip,.dshmsg-edit-btn:focus-visible .dshmsg-edit-tip{display:block}
/* In-place editor card. */
.dshmsg-edit-card{width:min(560px,82%);background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xl,16px);padding:10px 12px;display:flex;flex-direction:column;gap:8px;box-sizing:border-box}
.dshmsg-edit-input{width:100%;min-height:64px;max-height:320px;background:0 0;border:none;resize:vertical;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));white-space:pre-wrap;word-break:break-word;padding:0;margin:0;outline:none;box-sizing:border-box}
.dshmsg-edit-input:focus-visible{outline:none}
.dshmsg-edit-bar{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.dshmsg-edit-hint{flex:1;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(18px + var(--dsh-content-font-delta-secondary,0px));text-align:left}
.dshmsg-edit-error{color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:18px;text-align:left;flex:1;min-width:0}
.dshmsg-edit-cancel{border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:18px;padding:5px 12px}
.dshmsg-edit-cancel:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshmsg-edit-cancel:disabled{cursor:default;opacity:.5}
.dshmsg-edit-submit{border-radius:var(--dsw-radius-sm);border:none;background:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));color:var(--dsw-alias-bg-base);cursor:pointer;font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:18px;font-weight:600;padding:5px 14px}
.dshmsg-edit-submit:hover{filter:brightness(1.08)}
.dshmsg-edit-submit:disabled{cursor:default;opacity:.5}
.dshmsg-edit-submit:focus-visible,.dshmsg-edit-cancel:focus-visible{outline:1.5px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
`;
    //#endregion

    //#region helpers
    /** Durable sequences are nonnegative safe integers (including seq zero). */
    function isSeq(value) {
      return Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
    }

    /**
     * Split one user-message content list into text, attachments, and extra
     * blocks, mirroring the shipped Chat content preparation.
     * @param content - ordered durable content blocks.
     * @returns joined text, attachment parts, and remaining blocks.
     */
    function contentParts(content) {
      const texts = [];
      const attachments = [];
      const rest = [];
      for (const block of content) {
        const b = block;
        if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
        else if (b.type === 'image' && b.attachment !== undefined) attachments.push({ type: 'image', image: { attachment: b.attachment } });
        else if (b.type === 'file' && b.attachment !== undefined) attachments.push({ type: 'file', file: b.attachment });
        else rest.push(block);
      }
      return { text: texts.join(''), attachments, rest };
    }

    /** Write text to the clipboard; resolves to false on failure. */
    async function writeClipboard(text) {
      try {
        if (navigator.clipboard !== undefined && window.isSecureContext !== false) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch { /* fall through */ }
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch {
        return false;
      }
    }

    /** Compact local clock label for a message timestamp. */
    function formatClock(time) {
      try {
        return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch {
        return '';
      }
    }
    //#endregion

    //#region icons
    const iconProps = { 'aria-hidden': true, focusable: 'false' };
    const PencilIcon = () => h('svg', {
      ...iconProps,
      viewBox: '0 0 20 20',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.5',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }, h('path', { d: 'M13.6 3.1a1.9 1.9 0 0 1 2.7 2.7l-9 9-3.8.9a.6.6 0 0 1-.7-.7l.9-3.8 9-9z' }), h('path', { d: 'M12.4 4.4l2.9 2.9' }));
    const CopyIcon = () => h('svg', {
      ...iconProps,
      viewBox: '0 0 20 20',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.5',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }, h('rect', { x: '7', y: '7', width: '9.5', height: '9.5', rx: '2' }), h('path', { d: 'M5.5 13H4.7A1.7 1.7 0 0 1 3 11.3V4.7A1.7 1.7 0 0 1 4.7 3h6.6A1.7 1.7 0 0 1 13 4.7v.8' }));
    const CheckIcon = () => h('svg', {
      ...iconProps,
      viewBox: '0 0 20 20',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.8',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }, h('path', { d: 'M4 10.5l4 4 8-9' }));
    //#endregion

    //#region edit card
    /**
     * Self-contained in-place editor card bound to one plugin context. Owns the
     * draft state, the sentinel submission into the SAME session, and error
     * surfacing; shared by the user-message renderer and the shadow marker.
     * @param ctx - client plugin context carrying the sessions service.
     * @returns the editor card component.
     */
    function makeEditCard(ctx) {
      const EditCard = React.memo(function EditCard({ sessionId, startSeq, initialText, t, onClose }) {
        const tr = typeof t === 'function' ? t : ((key) => key);
        const [draft, setDraft] = React.useState(typeof initialText === 'string' ? initialText : '');
        const [phase, setPhase] = React.useState('idle'); // idle | sending
        const [error, setError] = React.useState(null);
        const inputRef = React.useRef(null);
        React.useEffect(() => {
          if (inputRef.current !== null) {
            inputRef.current.focus();
            const end = inputRef.current.value.length;
            inputRef.current.setSelectionRange(end, end);
          }
        }, []);
        const busy = phase !== 'idle';
        const canSubmit = draft.trim() !== '' && !busy;
        const cancel = () => {
          if (!busy) onClose();
        };
        const onInputKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            cancel();
            return;
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        };

        /**
         * Submit the edited text into the SAME session through a normal prompt.
         * The first line carries the sentinel header with the edited message's
         * seq; the host half intercepts it in pre-step, shadows the previous
         * exchange with a surface replacement, and commits the plain edited text.
         * @returns nothing; state transitions surface the outcome.
         */
        async function submit() {
          const text = draft;
          if (text.trim() === '' || busy) return;
          if (typeof sessionId !== 'string' || sessionId === '') {
            setError(tr('edit.error.fork'));
            return;
          }
          if (!isSeq(startSeq)) {
            setError(tr('edit.error.fork'));
            return;
          }
          setError(null);
          setPhase('sending');
          try {
            // Do not enqueue an edit if stopping the old turn failed. Idle cancel
            // is already successful in the Session API; both RPC errors and
            // rejected promises must reach the editor's error surface.
            const cancelled = await ctx.sessions.using(sessionId, { source: SRC }, (ref) => ref.binding.session.cancel());
            if (!cancelled.ok) {
              throw new Error(`${cancelled.error.code}: ${cancelled.error.message}`);
            }
            const marked = SENTINEL + JSON.stringify({ s: startSeq }) + '\n' + text;
            const outcome = await ctx.sessions.using(sessionId, { source: SRC }, (ref) => ref.binding.session.prompt([{ type: 'text', text: marked }], 'queue'));
            if (!outcome.ok) {
              throw new Error(`${outcome.error.code}: ${outcome.error.message}`);
            }
            // Admitted: the host replaces the previous exchange; this session
            // keeps rendering the conversation with the fresh answer.
            onClose();
          } catch (sendError) {
            setError(`${tr('edit.error.prompt')}${sendError instanceof Error && sendError.message ? ` (${sendError.message})` : ''}`);
          } finally {
            setPhase('idle');
          }
        }

        const rows = Math.min(12, Math.max(2, draft.split('\n').length + 1));
        return h('div', { className: 'dshmsg-edit-row' }, h('div', { className: 'dshmsg-edit-card' }, [
          h('textarea', {
            className: 'dshmsg-edit-input',
            ref: inputRef,
            value: draft,
            rows,
            disabled: busy,
            spellCheck: false,
            'aria-label': tr('edit.action'),
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: onInputKeyDown,
            key: 'input',
          }),
          h('div', { className: 'dshmsg-edit-bar', key: 'bar' }, [
            error !== null
              ? h('span', { className: 'dshmsg-edit-error', key: 'error' }, error)
              : h('span', { className: 'dshmsg-edit-hint', key: 'hint' }, tr('edit.hint')),
            h('button', {
              type: 'button',
              className: 'dshmsg-edit-cancel',
              disabled: busy,
              onClick: cancel,
              key: 'cancel',
            }, tr('edit.cancel')),
            h('button', {
              type: 'button',
              className: 'dshmsg-edit-submit',
              disabled: !canSubmit,
              onClick: submit,
              key: 'submit',
            }, phase === 'sending' ? tr('edit.sending') : tr('edit.send')),
          ]),
        ]));
      });
      return EditCard;
    }
    //#endregion

    //#region shadow marker
    /**
     * One `display:none` rule per shadowed Turn. Flow rows carry the numeric
     * `data-chat-turn` attribute, and a surface replacement shadows whole Turns
     * (the edited message opens its Turn; everything through the current tail
     * leaves the model context), so per-Turn rules are exact: rows of unrelated
     * earlier Turns stay visible, and later Turns — including the edit's own —
     * are never matched. A rule also hides the older marker row once a newer
     * edit lands, collapsing repeated edits into the latest one.
     * @param turns - shadowed Turn numbers.
     * @returns the folded CSS text.
     */
    function shadowCss(turns, scope) {
      if (!Array.isArray(turns)) return '';
      return [...new Set(turns.filter(isSeq))].map((turn) => `${scope} [data-chat-flow-key][data-chat-turn="${turn}"]{display:none!important}`).join('');
    }

    /**
     * Build the shadow-marker renderer bound to one plugin context. For current
     * logs the marker is an invisible CSS host: the edited message renders
     * natively from the committed batch row, and this row only mounts the rules
     * folding the replaced Turns out of view. Legacy logs (whose replacement
     * carried the edited text) render through the marker itself, pencil
     * included — the original bubble is hidden there.
     * @param ctx - client plugin context carrying the sessions service.
     * @param EditCard - shared in-place editor card component.
     * @returns the keyed Chat renderer component.
     */
    function makeShadowEditMarker(ctx, EditCard) {
      const ShadowEditMarker = React.memo(function ShadowEditMarker({ node, sessionId, useSession, t, renderFactorySlot, loadImage }) {
        const data = node.data;
        const tr = typeof t === 'function' ? t : ((key) => key);
        const renderContent = typeof renderFactorySlot === 'function' ? renderFactorySlot : (() => null);
        const loadImages = typeof loadImage === 'function' ? loadImage : (() => undefined);
        const hookSessionId = typeof useSession === 'function' ? useSession((session) => (session !== undefined && session !== null && typeof session.sessionId === 'string' ? session.sessionId : undefined)) : undefined;
        const resolvedSessionId = typeof sessionId === 'string' && sessionId !== '' ? sessionId : hookSessionId;
        const markerRef = React.useRef(null);
        // React ids are unique across mounted instances, including plugin reloads.
        // Hex encoding keeps the attribute token and CSS selector independent of
        // both session ids and the punctuation in React's id format.
        const scopeId = 'message-edit-' + Array.from(React.useId(), (char) => char.codePointAt(0).toString(16)).join('-');
        React.useLayoutEffect(() => {
          if (typeof resolvedSessionId !== 'string' || resolvedSessionId === '') return;
          // Installed ChatView: column[data-chat-flow] > flow SlotOutlet > rows.
          // Groups contain nested [data-chat-flow] containers, so the nearest
          // flow SLOT (not the nearest data-chat-flow) is the session boundary.
          const root = markerRef.current?.closest('[data-slot="conversation.chat.flow"]');
          if (!root) return; // Never fall back to global turn selectors.
          const attr = 'data-message-edit-scope';
          const tokens = () => (root.getAttribute(attr) || '').split(' ').filter(Boolean);
          root.setAttribute(attr, [...tokens(), scopeId].join(' '));
          const style = document.createElement('style');
          const scope = `[data-slot="conversation.chat.flow"][${attr}~="${scopeId}"]`;
          style.textContent = shadowCss(data.turns, scope);
          document.head.appendChild(style);
          return () => {
            style.remove();
            const remaining = tokens().filter((token) => token !== scopeId);
            if (remaining.length) root.setAttribute(attr, remaining.join(' '));
            else root.removeAttribute(attr);
          };
        }, [resolvedSessionId, data.turns, scopeId]);
        const text = typeof data.text === 'string' ? data.text : '';
        const [editing, setEditing] = React.useState(false);
        const [copied, setCopied] = React.useState(false);
        const copiedTimer = React.useRef(null);
        React.useEffect(() => () => {
          if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
        }, []);
        // Current-style replacement: empty content, the edited text lives in the
        // committed batch row — nothing to draw here.
        if (text === '') return h('div', { ref: markerRef, hidden: true, 'data-message-edit-empty': '' });
        const onCopy = () => {
          if (copied) return;
          writeClipboard(text).then((ok) => {
            if (!ok) return;
            setCopied(true);
            if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => {
              copiedTimer.current = null;
              setCopied(false);
            }, 1000);
          });
        };
        if (editing) {
          return h('div', { className: 'dshmsg-edit-row', ref: markerRef }, h(EditCard, {
            sessionId: resolvedSessionId,
            startSeq: node.anchorSeq,
            initialText: text,
            t: tr,
            onClose: () => setEditing(false),
          }));
        }
        const canEdit = typeof resolvedSessionId === 'string' && resolvedSessionId !== '' && isSeq(node.anchorSeq);
        const actions = h('div', { className: 'dshmsg-edit-actions' }, [
          typeof data.time === 'number' ? h('span', { className: 'dshmsg-edit-time', key: 'time' }, formatClock(data.time)) : null,
          h('button', {
            type: 'button',
            className: 'dshmsg-edit-btn',
            'aria-label': copied ? tr('edit.copied') : tr('edit.copy'),
            onClick: onCopy,
            key: 'copy',
          }, copied ? h(CheckIcon) : h(CopyIcon), copied ? h('span', { className: 'dshmsg-edit-tip', role: 'tooltip' }, tr('edit.copied')) : h('span', { className: 'dshmsg-edit-tip', role: 'tooltip' }, tr('edit.copy'))),
          h('button', {
            type: 'button',
            className: 'dshmsg-edit-btn',
            'aria-label': tr('edit.action'),
            onClick: () => setEditing(true),
            key: 'edit',
            disabled: !canEdit ? true : undefined,
            style: canEdit ? undefined : { opacity: 0.35, cursor: 'default' },
          }, h(PencilIcon), h('span', { className: 'dshmsg-edit-tip', role: 'tooltip' }, canEdit ? tr('edit.action') : `${tr('edit.action')} (—)`)),
        ]);
        // Same surface the shipped renderer uses: content via the shared user-content Factory.
        return h('div', { className: 'dshmsg-edit-row', ref: markerRef }, [
          renderContent('conversation.chat.user.content', {
            content: { text, attachments: [], extraBlocks: [] },
            loadImage: loadImages,
            interactive: true,
          }),
          actions,
        ]);
      });
      return ShadowEditMarker;
    }
    //#endregion

    /**
     * Build the editable user-message renderer bound to one plugin context.
     * @param ctx - client plugin context carrying the sessions service.
     * @param EditCard - shared in-place editor card component.
     * @returns the keyed Chat renderer component.
     */
    function makeEditableUserMessage(ctx, EditCard) {
      const EditableUserMessage = React.memo(function EditableUserMessage({ node, renderFactorySlot, loadImage, sessionId, useSession, t }) {
        const data = node.data;
        const parts = React.useMemo(() => contentParts(data.content), [data.content]);
        // Standard-props defense: degrade instead of crashing the slot entry.
        const tr = typeof t === 'function' ? t : ((key) => key);
        const renderContent = typeof renderFactorySlot === 'function' ? renderFactorySlot : (() => null);
        const loadImages = typeof loadImage === 'function' ? loadImage : (() => undefined);
        // The session id arrives either as a standard prop or through the session hook.
        const hookSessionId = typeof useSession === 'function' ? useSession((session) => (session !== undefined && session !== null && typeof session.sessionId === 'string' ? session.sessionId : undefined)) : undefined;
        const resolvedSessionId = typeof sessionId === 'string' && sessionId !== '' ? sessionId : hookSessionId;
        const [editing, setEditing] = React.useState(false);
        const [copied, setCopied] = React.useState(false);
        const copiedTimer = React.useRef(null);

        React.useEffect(() => () => {
          if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
        }, []);

        const onCopy = () => {
          if (copied) return;
          writeClipboard(parts.text).then((ok) => {
            if (!ok) return;
            setCopied(true);
            if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => {
              copiedTimer.current = null;
              setCopied(false);
            }, 1000);
          });
        };

        // The durable log seq of the user/message event lives on the node payload
        // (anchorSeq mirrors it); the node object itself carries no `seq` field.
        const messageSeq = typeof data.seq === 'number' ? data.seq : node.anchorSeq;
        if (editing) {
          return h(EditCard, {
            sessionId: resolvedSessionId,
            startSeq: messageSeq,
            initialText: parts.text,
            t: tr,
            onClose: () => setEditing(false),
          });
        }
        const canEdit = typeof resolvedSessionId === 'string' && resolvedSessionId !== '' && isSeq(messageSeq);
        const actions = h('div', { className: 'dshmsg-edit-actions' }, [
          h('span', { className: 'dshmsg-edit-time', key: 'time' }, formatClock(data.time)),
          h('button', {
            type: 'button',
            className: 'dshmsg-edit-btn',
            'aria-label': copied ? tr('edit.copied') : tr('edit.copy'),
            onClick: onCopy,
            key: 'copy',
          }, copied ? h(CheckIcon) : h(CopyIcon), copied ? h('span', { className: 'dshmsg-edit-tip', role: 'tooltip' }, tr('edit.copied')) : h('span', { className: 'dshmsg-edit-tip', role: 'tooltip' }, tr('edit.copy'))),
          h('button', {
            type: 'button',
            className: 'dshmsg-edit-btn',
            'aria-label': tr('edit.action'),
            onClick: () => setEditing(true),
            key: 'edit',
            disabled: !canEdit ? true : undefined,
            style: canEdit ? undefined : { opacity: 0.35, cursor: 'default' },
          }, h(PencilIcon), h('span', { className: 'dshmsg-edit-tip', role: 'tooltip' }, canEdit ? tr('edit.action') : `${tr('edit.action')} (—)`)),
        ]);
        // Same surface the shipped renderer uses: content via the shared user-content Factory.
        return h('div', { className: 'dshmsg-edit-row' }, [
          renderContent('conversation.chat.user.content', {
            content: {
              text: parts.text,
              attachments: parts.attachments,
              extraBlocks: parts.rest,
              ...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels },
            },
            loadImage: loadImages,
            facts: {
              ...data.referenceLabels === undefined ? {} : { sessionLabels: data.referenceLabels },
              ...data.skillNames === undefined ? {} : { skillNames: data.skillNames },
            },
            interactive: true,
          }),
          actions,
        ]);
      });
      return EditableUserMessage;
    }
    //#endregion

    /**
     * Conversation Definition observing this plugin's surface replacements. The
     * host shadows the previous exchange with an EMPTY `developer/message`
     * replacement (no wire message) and commits the plain edited text as the
     * batch — the batch row then renders the edited message natively. This
     * Definition contributes only the invisible marker node whose renderer
     * mounts the CSS folding the replaced Turns out of view. Legacy logs (an
     * earlier build replaced `user/message` with the edited text) keep
     * rendering through the marker itself.
     *
     * Turn boundaries are tracked in the same Definition: `turn/start` instances
     * record `{turn, startSeq}` and chain backwards through `reader.previous`,
     * `turn/end` closes the range. A replacement then hides exactly the Turns
     * overlapping `[startSeq..endSeq]` — never the newer edit Turn, whose start
     * seq sits above the replacement's range end.
     * @param uiConversation - the Conversation service to register into.
     * @returns nothing.
     */
    function registerShadowDefinition(uiConversation) {
      const replacement = (event) => {
        const op = event.surfaceOp;
        return op !== null && typeof op === 'object' && op.op === 'replace'
          && isSeq(op.startSeq) && isSeq(op.endSeq) && op.endSeq >= op.startSeq && isSeq(event.seq) ? op : null;
      };
      uiConversation.events.register({
        kind: 'message-edit-shadow',
        target: 'chat',
        match: {
          'user/message': (event) => {
            const op = replacement(event);
            if (op === null) return null;
            const id = event.data?.id;
            return typeof id === 'string' && id.startsWith('edited-') ? { id: String(event.seq), role: 'start' } : null;
          },
          'developer/message': (event) => {
            const op = replacement(event);
            if (op === null) return null;
            const message = event.data?.message;
            return typeof message?.id === 'string' && message.id.startsWith('edited-')
              && Array.isArray(message.content) && message.content.length === 0
              ? { id: String(event.seq), role: 'start' } : null;
          },
          'turn/start': (event) => ({ id: `turn-${event.data?.turn}`, role: 'start' }),
          'turn/end': (event) => ({ id: `turn-${event.data?.turn}`, role: 'update' }),
        },
        start: (_context, match, reader) => {
          const event = match.event;
          if (event.type === 'turn/start') {
            return { turn: event.data?.turn, startSeq: event.seq, endSeq: null, prev: reader.previous('message-edit-shadow')?.state ?? null };
          }
          const op = replacement(event);
          if (op === null) return undefined;
          // A Turn is shadowed when its seq range intersects the replacement
          // range. The edit Turn's own start seq sits above `op.endSeq`, so it
          // never intersects; open Turns have no end seq yet.
          const turns = [];
          const prev = reader.previous('message-edit-shadow')?.state ?? null;
          let nextTurnStart = Infinity;
          for (let node = prev; node !== null && node !== undefined; node = node.prev) {
            if (!isSeq(node.turn) || !isSeq(node.startSeq)) continue;
            // prev is a snapshot: turn/end can close a newer instance without
            // updating an older marker's prev.endSeq. The next turn/start is
            // therefore also an upper bound for this turn, even if it was open
            // when the snapshot was taken.
            const endSeq = Math.min(isSeq(node.endSeq) ? node.endSeq : Infinity, nextTurnStart - 1);
            if (node.startSeq <= op.endSeq && endSeq >= op.startSeq) turns.push(node.turn);
            nextTurnStart = node.startSeq;
          }
          const block = event.type === 'user/message' && Array.isArray(event.data?.content)
            ? event.data.content.find((part) => part?.type === 'text')
            : undefined;
          return { anchorSeq: event.seq, startSeq: op.startSeq, turns, prev, time: event.time, text: typeof block?.text === 'string' ? block.text : '' };
        },
        update: (context, match) => {
          if (match?.event.type === 'turn/end' && context.state !== undefined) return { ...context.state, endSeq: match.event.seq };
          return context.state;
        },
        buildViewNode: (context) => {
          const state = context.state;
          if (state === undefined || !Array.isArray(state.turns) || state.turns.length === 0) return null;
          return {
            key: context.key,
            kind: 'message-edit-shadow',
            id: context.id,
            target: 'chat',
            anchorSeq: state.anchorSeq,
            location: context.start !== undefined ? context.start.location : { kind: 'unresolved' },
            visibility: 'visible',
            data: { turns: state.turns, startSeq: state.startSeq, time: state.time, text: state.text },
          };
        },
      });
    }

    return {
      inject: ['slots', 'sessions', 'locale', 'uiConversation'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.id = STYLE_ID;
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'message-edit: stylesheet');

        ctx.effect(() => ctx.locale.register(NS, { en }), 'message-edit: dictionaries');
        ctx.effect(() => ctx.locale.register(NS, 'ru', ru), 'message-edit: russian dictionary');

        ctx.effect(() => registerShadowDefinition(ctx.uiConversation), 'message-edit: shadow definition');

        const EditCard = makeEditCard(ctx);
        const EditableUserMessage = makeEditableUserMessage(ctx, EditCard);
        // Reuse the shipped renderer key: re-registering a key replaces that node renderer.
        // Slot entries sort by ascending `priority ?? 0`; the shipped registration declares
        // none, so an explicit lower number puts this entry first and wins the 'user' key.
        ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
          name: 'conversation.chat.node',
          key: 'user',
          priority: -1,
          locale: NS,
          inject: (sessionId) => ({ sessionId }),
        }, EditableUserMessage));
        // Own marker kind: a flow row at the replacement's position that mounts
        // the folding CSS and hosts the re-edit affordance.
        ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
          name: 'conversation.chat.node',
          key: 'message-edit-shadow',
          locale: NS,
          inject: (sessionId) => ({ sessionId }),
        }, makeShadowEditMarker(ctx, EditCard)));
      },
    };
  },
});
