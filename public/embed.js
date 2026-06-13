(function () {
  var script = document.currentScript;
  var agentId = script && script.getAttribute("data-agent-id");
  if (!agentId || document.getElementById("anpro-voice-launcher")) return;

  var base = new URL(script.src).origin;
  var accent = script.getAttribute("data-color") || "#6d5dfc";
  var launcher = document.createElement("button");
  launcher.id = "anpro-voice-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open voice assistant");
  launcher.innerHTML = '<span data-avatar style="width:44px;height:44px;border-radius:14px;display:grid;place-items:center;overflow:hidden;background:rgba(255,255,255,.18);font-weight:800">AI</span><span style="display:grid;text-align:left;line-height:1.15"><strong data-title style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Voice assistant</strong><small style="margin-top:4px;opacity:.82">Talk now</small></span><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15Zm6-3.5a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.92V20H8.5a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2H13v-2.58A6 6 0 0 0 18 11.5Z"/></svg>';
  launcher.style.cssText = "position:fixed;right:22px;bottom:22px;z-index:2147483646;min-width:218px;height:66px;border:0;border-radius:20px;display:flex;align-items:center;gap:11px;padding:10px 14px;color:#fff;background:" + accent + ";box-shadow:0 12px 34px rgba(30,25,70,.28);cursor:pointer;font:14px Arial,sans-serif";

  var frame = document.createElement("iframe");
  frame.title = "Voice Q&A assistant";
  frame.allow = "microphone; autoplay";
  frame.src = base + "/?embed=" + encodeURIComponent(agentId);
  frame.style.cssText = "position:fixed;right:22px;bottom:94px;z-index:2147483645;width:min(420px,calc(100vw - 28px));height:min(620px,calc(100vh - 120px));border:0;border-radius:24px;background:transparent;filter:drop-shadow(0 22px 50px rgba(30,25,70,.2));opacity:0;pointer-events:none;transform:translateY(14px) scale(.98);transform-origin:bottom right;transition:opacity .2s ease,transform .2s ease";

  var open = false;
  launcher.addEventListener("click", function () {
    open = !open;
    frame.style.opacity = open ? "1" : "0";
    frame.style.pointerEvents = open ? "auto" : "none";
    frame.style.transform = open ? "translateY(0) scale(1)" : "translateY(14px) scale(.98)";
    launcher.setAttribute("aria-label", open ? "Close voice assistant" : "Open voice assistant");
  });
  document.body.appendChild(frame);
  document.body.appendChild(launcher);

  fetch(base + "/api/embed/" + encodeURIComponent(agentId) + "/config")
    .then(function (response) { return response.ok ? response.json() : Promise.reject(); })
    .then(function (agent) {
      var settings = agent.widgetSettings || {};
      var title = launcher.querySelector("[data-title]");
      var avatar = launcher.querySelector("[data-avatar]");
      if (settings.title) title.textContent = settings.title;
      if (settings.accentColor) launcher.style.background = settings.accentColor;
      if (settings.avatarUrl) {
        avatar.textContent = "";
        var image = document.createElement("img");
        image.src = settings.avatarUrl;
        image.alt = "";
        image.style.cssText = "width:100%;height:100%;object-fit:cover";
        avatar.appendChild(image);
      } else if (agent.name) {
        avatar.textContent = agent.name.split(/\s+/).slice(0, 2).map(function (part) { return part.charAt(0); }).join("").toUpperCase();
      }
    })
    .catch(function () {});
})();
