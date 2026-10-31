// Full-screen panels that stand in for the desktop app's extra windows (dashboards, the API keys
// window, the OANDA token window). Each is a same-origin iframe over the terminal, so the terminal
// keeps running underneath (paper account, alerts) and the dashboards still reach it over
// BroadcastChannel. The Android back button and the header arrow close the top one.

const stack = []; // { kind, el, onClose }

const CSS = `
.oc-ovl{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:#0a0a0a;
  padding-bottom:var(--oc-safe-bottom,0px);
  transform:translateX(100%);transition:transform .22s ease-out}
.oc-ovl.in{transform:none}
.oc-ovl header{display:flex;align-items:center;gap:4px;height:52px;flex-shrink:0;padding:0 6px;
  padding-top:var(--oc-safe-top,0px);box-sizing:content-box;background:#111318;border-bottom:1px solid #23272f;
  color:#e6e8ec;font:600 16px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.oc-ovl header button{width:44px;height:44px;border:0;background:none;color:inherit;border-radius:22px;
  display:flex;align-items:center;justify-content:center}
.oc-ovl header button:active{background:#23272f}
.oc-ovl iframe{flex:1;width:100%;border:0;background:#0a0a0a}
`;

function ensureStyle() {
  if (document.getElementById("oc-ovl-style")) return;
  const s = document.createElement("style");
  s.id = "oc-ovl-style";
  s.textContent = CSS;
  document.head.appendChild(s);
}

const BACK_ICON =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

/**
 * Open (or bring back) a full-screen panel.
 * @param {string} kind one panel per kind, e.g. "portfolio" or "keys"
 * @param {string} url same-origin page
 * @param {string} title header text
 * @param {() => void} [onClose]
 */
export function openOverlay(kind, url, title, onClose) {
  ensureStyle();
  const open = stack.find((o) => o.kind === kind);
  if (open) {
    stack.splice(stack.indexOf(open), 1);
    stack.push(open);
    open.el.style.zIndex = String(2147483000 + stack.length);
    return open;
  }
  const el = document.createElement("div");
  el.className = "oc-ovl";
  el.dataset.overlay = kind;
  el.style.zIndex = String(2147483001 + stack.length);
  const header = document.createElement("header");
  const back = document.createElement("button");
  back.setAttribute("aria-label", "Back");
  back.innerHTML = BACK_ICON;
  back.onclick = () => closeOverlay(kind);
  const h = document.createElement("span");
  h.textContent = title;
  header.append(back, h);
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = title;
  el.append(header, frame);
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("in")));
  const entry = { kind, el, frame, onClose };
  stack.push(entry);
  return entry;
}

/** Close a panel by kind; returns whether one was open. */
export function closeOverlay(kind) {
  const i = stack.findIndex((o) => o.kind === kind);
  if (i < 0) return false;
  const [o] = stack.splice(i, 1);
  o.el.classList.remove("in");
  setTimeout(() => o.el.remove(), 240);
  try {
    o.onClose?.();
  } catch (err) {
    console.error("[overlay] onClose", err);
  }
  return true;
}

/** Close the top panel (Android back); returns whether one was open. */
export function closeTopOverlay() {
  const top = stack[stack.length - 1];
  return top ? closeOverlay(top.kind) : false;
}

/** The panel whose iframe is `win`, if any. */
export function overlayOf(win) {
  return stack.find((o) => o.frame.contentWindow === win) ?? null;
}

export const overlayCount = () => stack.length;
