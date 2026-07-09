/* Living Well Desk chat widget.
 * Embed on the storefront with:
 *   <script src="https://desk.livingwellwithdrmichelle.com/chat-widget.js" defer data-brand="living-well"></script>
 * Talks to POST /api/chat on the desk. Self-contained: no dependencies.
 */
(function () {
  if (window.__lwChatLoaded) return;
  window.__lwChatLoaded = true;

  var script = document.currentScript || document.querySelector('script[src*="chat-widget.js"]');
  var BRAND = (script && script.getAttribute("data-brand")) || "living-well";
  var API = (function () {
    try {
      return new URL(script.src).origin + "/api/chat";
    } catch (e) {
      return "https://desk.livingwellwithdrmichelle.com/api/chat";
    }
  })();

  var SAGE = "#6E9277", TEAL = "#2E4959", NAVY = "#29404E", MINT = "#EAF0EC";

  // Session id survives page navigation within the tab.
  var sessionId = sessionStorage.getItem("lw-chat-session");
  if (!sessionId) {
    sessionId = "cw-" + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    sessionStorage.setItem("lw-chat-session", sessionId);
  }
  var history = [];
  try { history = JSON.parse(sessionStorage.getItem("lw-chat-history") || "[]"); } catch (e) {}

  var css = [
    "#lw-chat-bubble{position:fixed;bottom:20px;right:20px;z-index:2147483000;width:56px;height:56px;border-radius:50%;background:" + SAGE + ";border:none;cursor:pointer;box-shadow:0 4px 14px rgba(41,64,78,.3);display:flex;align-items:center;justify-content:center;transition:transform .15s ease}",
    "#lw-chat-bubble:hover{transform:scale(1.06)}",
    "#lw-chat-panel{position:fixed;bottom:90px;right:20px;z-index:2147483000;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(41,64,78,.25);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif}",
    "#lw-chat-panel.open{display:flex}",
    "#lw-chat-head{background:" + SAGE + ";color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}",
    "#lw-chat-head b{font-size:15px;font-weight:600}",
    "#lw-chat-head span{font-size:11px;opacity:.85;display:block}",
    "#lw-chat-msgs{flex:1;overflow-y:auto;padding:14px;background:#fbfcfb;display:flex;flex-direction:column;gap:8px}",
    "@keyframes lw-pop{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}",
    "@keyframes lw-dot{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}",
    ".lw-m{max-width:85%;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;animation:lw-pop .3s cubic-bezier(.25,1.2,.4,1) both;transform-origin:bottom}",
    ".lw-m.user{transform-origin:bottom right}",
    ".lw-m.bot{transform-origin:bottom left}",
    ".lw-dots{display:inline-flex;gap:4px;padding:2px 0}",
    ".lw-dots i{width:7px;height:7px;border-radius:50%;background:#8aa593;animation:lw-dot 1.2s infinite}",
    ".lw-dots i:nth-child(2){animation-delay:.15s}",
    ".lw-dots i:nth-child(3){animation-delay:.3s}",
    ".lw-m.bot{background:" + MINT + ";color:" + NAVY + ";align-self:flex-start;border-bottom-left-radius:4px}",
    ".lw-m.user{background:" + TEAL + ";color:#fff;align-self:flex-end;border-bottom-right-radius:4px}",
    ".lw-m.typing{color:#8aa593;font-style:italic;background:" + MINT + "}",
    "#lw-chat-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e3ebe5;background:#fff}",
    "#lw-chat-input{flex:1;border:1px solid #cfdcd3;border-radius:10px;padding:9px 12px;font-size:13.5px;outline:none;font-family:inherit;resize:none;max-height:90px}",
    "#lw-chat-input:focus{border-color:" + SAGE + "}",
    "#lw-chat-send{background:" + SAGE + ";color:#fff;border:none;border-radius:10px;padding:0 16px;font-size:13.5px;font-weight:600;cursor:pointer}",
    "#lw-chat-send:disabled{opacity:.5}",
    "#lw-chat-foot{font-size:10px;color:#9aa8a0;text-align:center;padding:4px 8px 8px;background:#fff}",
    "@media (max-width:480px){#lw-chat-panel{right:8px;bottom:80px}}"
  ].join("\n");

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var bubble = document.createElement("button");
  bubble.id = "lw-chat-bubble";
  bubble.setAttribute("aria-label", "Chat with us");
  bubble.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M21 12c0 4.418-4.03 8-9 8-1.05 0-2.06-.16-3-.455L4 21l1.5-3.5C4.56 16.13 4 14.63 4 13c0-4.418 4.03-8 9-8s8 2.582 8 7z" fill="#fff"/></svg>';

  var panel = document.createElement("div");
  panel.id = "lw-chat-panel";
  panel.innerHTML =
    '<div id="lw-chat-head"><div><b>Living Well Support</b><span>Ask us anything about our products or your order</span></div></div>' +
    '<div id="lw-chat-msgs"></div>' +
    '<form id="lw-chat-form"><textarea id="lw-chat-input" rows="1" placeholder="Type your question…"></textarea><button id="lw-chat-send" type="submit">Send</button></form>' +
    '<div id="lw-chat-foot">AI assistant — for health questions, please talk with your dentist or doctor.</div>';

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  var msgs = panel.querySelector("#lw-chat-msgs");
  var form = panel.querySelector("#lw-chat-form");
  var input = panel.querySelector("#lw-chat-input");
  var send = panel.querySelector("#lw-chat-send");

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "lw-m " + (role === "user" ? "user" : "bot");
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  function greet() {
    if (history.length === 0) {
      addMsg("bot", "Hi! I'm the Living Well assistant. I can help with product questions, shipping, returns, or checking on your order. How can I help?");
    } else {
      history.forEach(function (m) { addMsg(m.role, m.content); });
    }
  }
  var greeted = false;

  bubble.addEventListener("click", function () {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      if (!greeted) { greet(); greeted = true; }
      input.focus();
    }
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || send.disabled) return;
    input.value = "";
    addMsg("user", text);
    history.push({ role: "user", content: text });
    sessionStorage.setItem("lw-chat-history", JSON.stringify(history));

    var typing = addMsg("bot", "");
    typing.classList.add("typing");
    typing.innerHTML = '<span class="lw-dots"><i></i><i></i><i></i></span>';
    send.disabled = true;

    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand: BRAND, sessionId: sessionId, messages: history }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        typing.remove();
        var reply = data.reply || "Sorry, something went wrong. Please email support@livingwellwithdrmichelle.com.";
        addMsg("bot", reply);
        history.push({ role: "assistant", content: reply });
        sessionStorage.setItem("lw-chat-history", JSON.stringify(history));
      })
      .catch(function () {
        typing.remove();
        addMsg("bot", "Sorry, I couldn't connect just now. Please email support@livingwellwithdrmichelle.com and the team will help you.");
      })
      .finally(function () {
        send.disabled = false;
        input.focus();
      });
  });
})();
