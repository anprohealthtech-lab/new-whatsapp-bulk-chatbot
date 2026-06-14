const app = document.getElementById("app");
const params = new URLSearchParams(location.search);
const embedAgentId = params.get("embed");
const TOKEN_KEY = "voice_portal_token";
const USER_KEY = "voice_portal_user";
const DEFAULT_WIDGET = {
  title: "Ask our AI assistant",
  welcomeMessage: "Tap the microphone and ask a question.",
  accentColor: "#6d5dfc",
  avatarUrl: null,
  starterText: "Hello! Ask me anything and I will do my best to help.",
  starterAudioUrl: null,
  starterAudioMimeType: null,
};

if (embedAgentId) {
  renderEmbed(embedAgentId);
} else {
  bootstrapPortal();
}

async function bootstrapPortal() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    renderLogin();
    return;
  }
  try {
    const user = await api("/api/portal/me", { token });
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    await renderDashboard(user, token);
  } catch {
    clearAuth();
    renderLogin("Your session expired. Please sign in again.");
  }
}

function renderLogin(message = "") {
  app.innerHTML = `
    <main class="login-page">
      <section class="login-art">
        <div class="brand"><span class="brand-mark">${waveIcon()}</span> Anpro Voice</div>
        <div class="hero-copy">
          <p class="eyebrow">Conversational Q&A</p>
          <h1>Give your website a voice.</h1>
          <p>Turn your existing knowledge base into a natural voice assistant that visitors can speak with from any page.</p>
        </div>
        <div class="voice-orb">
          <span class="bars"><i></i><i></i><i></i><i></i><i></i></span>
          <span>Securely linked to your organization</span>
        </div>
      </section>
      <section class="login-form-wrap">
        <div class="login-card">
          <p class="kicker">Voice studio</p>
          <h2>Welcome back</h2>
          <p class="subtle">Sign in with the same account you use in the main platform. Your organization and user are linked automatically.</p>
          <form id="loginForm" class="form-stack">
            <div class="field">
              <label for="username">Username</label>
              <input id="username" name="username" autocomplete="username" required minlength="3" placeholder="Enter your username" />
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="current-password" required minlength="6" placeholder="Enter your password" />
            </div>
            <div id="loginError" class="form-error">${escapeHtml(message)}</div>
            <button id="loginButton" class="primary" type="submit">Sign in to Voice Studio</button>
          </form>
        </div>
      </section>
    </main>`;

  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("loginButton");
    const error = document.getElementById("loginError");
    button.disabled = true;
    button.textContent = "Signing in...";
    error.textContent = "";
    try {
      const result = await api("/api/portal/login", {
        method: "POST",
        body: {
          username: event.currentTarget.username.value.trim(),
          password: event.currentTarget.password.value,
        },
      });
      localStorage.setItem(TOKEN_KEY, result.token);
      localStorage.setItem(USER_KEY, JSON.stringify(result.user));
      await renderDashboard(result.user, result.token);
    } catch (requestError) {
      error.textContent = requestError.message;
      button.disabled = false;
      button.textContent = "Sign in to Voice Studio";
    }
  });
}

async function renderDashboard(user, token) {
  app.innerHTML = `
    <main class="dashboard">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">${waveIcon()}</span> Anpro Voice</div>
        <nav>
          <p class="nav-label">Workspace</p>
          <button class="nav-item" data-page="studio">${gridIcon()} Widget studio</button>
          <button class="nav-item" data-page="agents">${micIcon()} Voice agents</button>
          <button class="nav-item" data-page="install">${codeIcon()} Install guide</button>
        </nav>
        <div class="sidebar-footer">
          <div class="user-pill">
            <strong>${escapeHtml(user.username)}</strong>
            <span>${escapeHtml(user.organizationId)}</span>
          </div>
          <button id="logoutButton" class="nav-item">Sign out</button>
        </div>
      </aside>
      <section class="dashboard-main">
        <header class="topbar">
          <div id="pageHeading">
            <p class="eyebrow">Website assistant</p>
            <h1>Voice Q&A widget</h1>
            <p class="subtle">Brand your assistant, test the conversation, then add it to any website.</p>
          </div>
          <span class="status-chip">Tenant linked</span>
        </header>
        <div id="studioContent" class="card"><p class="subtle">Loading your voice agents...</p></div>
      </section>
    </main>`;
  document.getElementById("logoutButton").addEventListener("click", () => {
    clearAuth();
    renderLogin();
  });

  try {
    const agents = await api("/api/portal/agents", { token });
    const showPage = (page, updateHash = true) => {
      const safePage = ["studio", "agents", "install"].includes(page) ? page : "studio";
      document.querySelectorAll("[data-page]").forEach((button) => {
        button.classList.toggle("active", button.dataset.page === safePage);
      });
      renderPageHeading(safePage);
      if (safePage === "agents") renderAgentsPage(agents, token, showPage);
      else if (safePage === "install") renderInstallGuide(agents);
      else renderStudio(agents, token);
      if (updateHash && location.hash !== `#${safePage}`) history.pushState(null, "", `#${safePage}`);
    };
    document.querySelectorAll("[data-page]").forEach((button) => {
      button.addEventListener("click", () => showPage(button.dataset.page));
    });
    window.onpopstate = () => showPage(location.hash.slice(1), false);
    showPage(location.hash.slice(1) || "studio", false);
  } catch (error) {
    document.getElementById("studioContent").innerHTML =
      `<h2>Unable to load voice agents</h2><p class="subtle">${escapeHtml(error.message)}</p>`;
  }
}

function renderPageHeading(page) {
  const headings = {
    studio: {
      eyebrow: "Website assistant",
      title: "Voice Q&A widget",
      description: "Brand your assistant, test the conversation, then add it to any website.",
    },
    agents: {
      eyebrow: "Workspace",
      title: "Voice agents",
      description: "Review the voice assistants linked to this user and organization.",
    },
    install: {
      eyebrow: "Website setup",
      title: "Install guide",
      description: "Choose an assistant and add the secure voice widget to your website.",
    },
  };
  const heading = headings[page] || headings.studio;
  document.getElementById("pageHeading").innerHTML = `
    <p class="eyebrow">${heading.eyebrow}</p>
    <h1>${heading.title}</h1>
    <p class="subtle">${heading.description}</p>`;
}

function renderAgentsPage(agents, token, showPage) {
  const host = document.getElementById("studioContent");
  host.className = "";
  if (!agents.length) {
    host.innerHTML = `
      <section class="card empty-state">
        <div class="empty-icon">${micSvg()}</div>
        <h2>No voice agents yet</h2>
        <p class="subtle">Create a voice agent in the main platform. It will appear here for this linked tenant.</p>
      </section>`;
    return;
  }

  host.innerHTML = `
    <section class="agent-grid">
      ${agents.map((agent) => {
        const settings = normalizeWidget(agent.widgetSettings);
        return `
          <article class="card agent-card">
            <div class="agent-card-head">
              <div class="agent-avatar" data-agent-avatar="${escapeHtml(agent.id)}"></div>
              <span class="agent-status ${agent.status === "active" ? "active" : ""}">${escapeHtml(agent.status || "unknown")}</span>
            </div>
            <h2>${escapeHtml(agent.name)}</h2>
            <p class="subtle agent-description">${escapeHtml(settings.title)}</p>
            <dl class="agent-meta">
              <div><dt>Language</dt><dd>${escapeHtml(formatLabel(agent.languageMode || "match_speaker"))}</dd></div>
              <div><dt>Response</dt><dd>${escapeHtml(formatLabel(agent.responseMode || "voice"))}</dd></div>
              <div><dt>Starter voice</dt><dd>${settings.starterAudioUrl ? "Ready" : "Not generated"}</dd></div>
            </dl>
            <button class="secondary agent-edit" data-agent-id="${escapeHtml(agent.id)}">Open in Widget studio</button>
          </article>`;
      }).join("")}
    </section>`;

  agents.forEach((agent) => {
    renderAvatar(
      host.querySelector(`[data-agent-avatar="${cssEscape(agent.id)}"]`),
      normalizeWidget(agent.widgetSettings).avatarUrl,
      agent.name,
    );
  });
  host.querySelectorAll(".agent-edit").forEach((button) => {
    button.addEventListener("click", () => {
      showPage("studio");
      const select = document.getElementById("agentSelect");
      if (select) {
        select.value = button.dataset.agentId;
        select.dispatchEvent(new Event("change"));
      }
    });
  });
}

function renderInstallGuide(agents) {
  const host = document.getElementById("studioContent");
  host.className = "";
  if (!agents.length) {
    host.innerHTML = `
      <section class="card empty-state">
        <h2>Create a voice agent first</h2>
        <p class="subtle">An agent is required before an embed code can be generated.</p>
      </section>`;
    return;
  }

  host.innerHTML = `
    <div class="install-layout">
      <section class="card">
        <p class="step-number">Step 1</p>
        <h2>Choose the assistant</h2>
        <div class="field install-agent-field">
          <label for="installAgentSelect">Voice agent</label>
          <select id="installAgentSelect">
            ${agents.map((agent) => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`).join("")}
          </select>
        </div>
        <p class="step-number">Step 2</p>
        <h2>Paste the script</h2>
        <p class="subtle">Add this once before the closing <code>&lt;/body&gt;</code> tag on the pages where the voice assistant should appear.</p>
        <div class="embed-code install-code"><span id="installEmbedCode"></span><button id="copyInstallEmbed" class="copy-mini" title="Copy embed code">${copyIcon()}</button></div>
      </section>
      <section class="card guide-card">
        <p class="step-number">Step 3</p>
        <h2>Verify the widget</h2>
        <div class="guide-check"><span>1</span><p>Open the website over HTTPS so microphone permission is available.</p></div>
        <div class="guide-check"><span>2</span><p>Select <strong>Talk now</strong> and allow microphone access when prompted.</p></div>
        <div class="guide-check"><span>3</span><p>Ask a question from the agent's knowledge base and confirm the spoken reply.</p></div>
        <div class="guide-note">Session tokens are created automatically and expire after 10 minutes. Do not put organization IDs, user IDs, or secrets in the embed code.</div>
      </section>
    </div>`;

  const select = document.getElementById("installAgentSelect");
  const refreshCode = () => {
    document.getElementById("installEmbedCode").textContent =
      `<script src="${location.origin}/embed.js" data-agent-id="${select.value}" async></scr` + `ipt>`;
  };
  select.addEventListener("change", refreshCode);
  document.getElementById("copyInstallEmbed").addEventListener("click", async () => {
    await navigator.clipboard.writeText(document.getElementById("installEmbedCode").textContent);
    showToast("Embed code copied.");
  });
  refreshCode();
}

function renderStudio(agents, token) {
  const host = document.getElementById("studioContent");
  host.className = "";
  if (!agents.length) {
    host.innerHTML = `
      <section class="card">
        <h2>Create a voice agent first</h2>
        <p class="subtle">No voice agents are available for this account. Create one in the main application, then return here to publish its website widget.</p>
      </section>`;
    return;
  }

  let selectedAgent = agents[0];
  const initial = normalizeWidget(selectedAgent.widgetSettings);
  host.innerHTML = `
    <div class="studio-grid">
      <div>
        <section class="card">
          <div class="card-head">
            <div><h2>Widget identity</h2><p class="subtle">What visitors see when they open Q&A.</p></div>
          </div>
          <div class="settings-stack">
            <div class="field">
              <label for="agentSelect">Voice agent</label>
              <select id="agentSelect">${agents.map((agent) => `<option value="${agent.id}">${escapeHtml(agent.name)}</option>`).join("")}</select>
            </div>
            <div class="avatar-row">
              <div id="avatarPreview" class="avatar-preview"></div>
              <div>
                <label class="secondary upload-button">Upload assistant photo<input id="avatarInput" type="file" accept="image/png,image/jpeg,image/webp" /></label>
                <p class="subtle" style="margin:9px 0 0;font-size:12px">PNG, JPG or WebP. The image is resized before upload.</p>
              </div>
            </div>
            <div class="field">
              <label for="widgetTitle">Assistant title</label>
              <input id="widgetTitle" maxlength="80" />
            </div>
            <div class="field">
              <label for="welcomeMessage">Welcome message</label>
              <textarea id="welcomeMessage" maxlength="240"></textarea>
            </div>
            <div class="field">
              <label for="starterText">Spoken welcome and starter</label>
              <textarea id="starterText" maxlength="500" placeholder="What should the assistant say before listening?"></textarea>
              <p class="subtle" style="margin:0;font-size:12px">Generate this once. The cached audio plays when a visitor selects Talk now, then Q&A listening begins.</p>
            </div>
            <div class="actions">
              <button id="generateStarter" class="secondary">Generate starter voice</button>
              <button id="previewStarter" class="ghost" disabled>Preview voice</button>
            </div>
            <div class="field">
              <label for="accentColor">Brand color</label>
              <div class="color-row">
                <input id="accentColor" type="color" />
                <input id="accentText" maxlength="7" />
              </div>
            </div>
            <div class="actions">
              <button id="saveWidget" class="primary">Save and refresh preview</button>
              <button id="removeAvatar" class="secondary">Remove photo</button>
            </div>
          </div>
        </section>
        <section class="card">
          <h2>Install on your website</h2>
          <p class="subtle">Paste this once before the closing <code>&lt;/body&gt;</code> tag. The launcher and Q&A window are created automatically.</p>
          <div class="embed-code"><span id="embedCode"></span><button id="copyEmbed" class="copy-mini" title="Copy embed code">${copyIcon()}</button></div>
        </section>
      </div>
      <section>
        <div class="card-head"><div><h2>Live preview</h2><p class="subtle">This uses the same public experience as your website.</p></div></div>
        <div class="preview-shell"><iframe id="widgetPreview" title="Voice Q&A widget preview" allow="microphone; autoplay"></iframe></div>
      </section>
    </div>`;

  const titleInput = document.getElementById("widgetTitle");
  const welcomeInput = document.getElementById("welcomeMessage");
  const starterInput = document.getElementById("starterText");
  const colorInput = document.getElementById("accentColor");
  const colorText = document.getElementById("accentText");
  const avatarInput = document.getElementById("avatarInput");
  let avatarUrl = initial.avatarUrl;
  let starterAudioUrl = initial.starterAudioUrl;
  let starterAudioMimeType = initial.starterAudioMimeType;
  let generatedStarterText = initial.starterAudioUrl ? initial.starterText : "";

  function populate(agent) {
    selectedAgent = agent;
    const settings = normalizeWidget(agent.widgetSettings);
    avatarUrl = settings.avatarUrl;
    titleInput.value = settings.title;
    welcomeInput.value = settings.welcomeMessage;
    starterInput.value = settings.starterText;
    starterAudioUrl = settings.starterAudioUrl;
    starterAudioMimeType = settings.starterAudioMimeType;
    generatedStarterText = settings.starterAudioUrl ? settings.starterText : "";
    document.getElementById("previewStarter").disabled = !starterAudioUrl;
    colorInput.value = settings.accentColor;
    colorText.value = settings.accentColor;
    renderAvatar(document.getElementById("avatarPreview"), settings.avatarUrl, agent.name);
    refreshInstall();
    refreshPreview();
  }

  function refreshInstall() {
    const code = `<script src="${location.origin}/embed.js" data-agent-id="${selectedAgent.id}" async></scr` + `ipt>`;
    document.getElementById("embedCode").textContent = code;
  }

  function refreshPreview() {
    document.getElementById("widgetPreview").src = `/?embed=${encodeURIComponent(selectedAgent.id)}&v=${Date.now()}`;
  }

  document.getElementById("agentSelect").addEventListener("change", (event) => {
    populate(agents.find((agent) => agent.id === event.target.value) || agents[0]);
  });
  colorInput.addEventListener("input", () => { colorText.value = colorInput.value; });
  colorText.addEventListener("input", () => {
    if (/^#[0-9a-f]{6}$/i.test(colorText.value)) colorInput.value = colorText.value;
  });
  avatarInput.addEventListener("change", async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    try {
      avatarUrl = await resizeImage(file);
      renderAvatar(document.getElementById("avatarPreview"), avatarUrl, selectedAgent.name);
    } catch (error) {
      showToast(error.message);
    }
  });
  starterInput.addEventListener("input", () => {
    if (starterInput.value.trim() !== generatedStarterText) {
      starterAudioUrl = null;
      starterAudioMimeType = null;
      document.getElementById("previewStarter").disabled = true;
    }
  });
  document.getElementById("generateStarter").addEventListener("click", async (event) => {
    const text = starterInput.value.trim();
    if (!text) {
      showToast("Enter the spoken welcome text first.");
      return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Generating voice...";
    try {
      const result = await api(`/api/portal/agents/${selectedAgent.id}/starter-audio`, {
        method: "POST",
        token,
        body: { text },
      });
      starterAudioUrl = result.audioUrl;
      starterAudioMimeType = result.mimeType;
      generatedStarterText = text;
      document.getElementById("previewStarter").disabled = false;
      showToast(result.cached ? "Starter voice already cached." : "Starter voice generated.");
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Generate starter voice";
    }
  });
  document.getElementById("previewStarter").addEventListener("click", () => {
    if (starterAudioUrl) new Audio(starterAudioUrl).play().catch(() => showToast("Audio preview was blocked."));
  });
  document.getElementById("removeAvatar").addEventListener("click", () => {
    avatarUrl = null;
    avatarInput.value = "";
    renderAvatar(document.getElementById("avatarPreview"), null, selectedAgent.name);
  });
  document.getElementById("saveWidget").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const accentColor = colorText.value.trim();
    if (!/^#[0-9a-f]{6}$/i.test(accentColor)) {
      showToast("Enter a valid six-digit color, for example #6d5dfc.");
      return;
    }
    button.disabled = true;
    button.textContent = "Saving...";
    try {
      const updated = await api(`/api/portal/agents/${selectedAgent.id}/widget`, {
        method: "PATCH",
        token,
        body: {
          title: titleInput.value.trim(),
          welcomeMessage: welcomeInput.value.trim(),
          accentColor,
          avatarUrl,
          starterText: starterInput.value.trim(),
          starterAudioUrl,
          starterAudioMimeType,
        },
      });
      const index = agents.findIndex((agent) => agent.id === updated.id);
      if (index >= 0) agents[index] = updated;
      selectedAgent = updated;
      refreshPreview();
      showToast("Widget saved.");
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Save and refresh preview";
    }
  });
  document.getElementById("copyEmbed").addEventListener("click", async () => {
    await navigator.clipboard.writeText(document.getElementById("embedCode").textContent);
    showToast("Embed code copied.");
  });
  populate(selectedAgent);
}

async function renderEmbed(agentId) {
  app.innerHTML = `<main class="embed-page"><section class="voice-widget"><div class="conversation"><p class="welcome">Loading voice assistant...</p></div></section></main>`;
  try {
    const agent = await api(`/api/embed/${encodeURIComponent(agentId)}/config`);
    const settings = normalizeWidget(agent.widgetSettings);
    setAccent(settings.accentColor);
    app.innerHTML = `
      <main class="embed-page">
        <section class="voice-widget">
          <header class="widget-head">
            <div id="widgetAvatar" class="widget-avatar"></div>
            <div class="widget-title"><strong>${escapeHtml(settings.title)}</strong><span>Online and ready</span></div>
          </header>
          <div id="conversation" class="conversation">
            <div class="widget-hero">
              <div id="heroAvatar" class="hero-avatar"></div>
              <p id="welcome" class="welcome">${escapeHtml(settings.welcomeMessage)}</p>
            </div>
          </div>
          <footer class="widget-controls">
            <div id="voiceStatus" class="listen-status">${settings.starterAudioUrl ? "Your assistant will welcome you, then listen." : "Tap to ask a question"}</div>
            <div class="mic-row">
              <button id="micButton" class="mic-button talk-button" type="button" aria-label="Talk now">${micSvg()}<span>Talk now</span></button>
              <button id="endButton" class="end-button hidden" type="button">End</button>
            </div>
            <div class="powered">Voice Q&A powered by Anpro</div>
          </footer>
        </section>
      </main>`;
    renderAvatar(document.getElementById("widgetAvatar"), settings.avatarUrl, agent.name);
    renderAvatar(document.getElementById("heroAvatar"), settings.avatarUrl, agent.name);
    createVoiceRuntime(agentId, settings);
  } catch (error) {
    app.innerHTML = `<main class="embed-page"><section class="voice-widget"><div class="conversation"><p class="welcome">${escapeHtml(error.message)}</p></div></section></main>`;
  }
}

function createVoiceRuntime(agentId, settings) {
  const micButton = document.getElementById("micButton");
  const endButton = document.getElementById("endButton");
  const status = document.getElementById("voiceStatus");
  const conversation = document.getElementById("conversation");
  let ws;
  let mediaRecorder;
  let audioContext;
  let analyser;
  let silenceFrame;
  let maxTimer;
  let chunks = [];
  let sends = [];
  let sequence = 0;
  let mimeType = "audio/webm;codecs=opus";
  let sessionToken = "";
  let sessionId = crypto.randomUUID();
  let playbackQueue = [];
  let playing = false;
  let currentAudio;
  let replyReceived = false;
  let starterPlayed = false;

  micButton.addEventListener("click", async () => {
    if (playing) {
      send({ type: "barge_in", sessionId, sessionToken });
      cleanup();
    }
    if (mediaRecorder?.state === "recording") {
      stopRecording();
      return;
    }
    try {
      if (!starterPlayed && settings.starterAudioUrl) {
        starterPlayed = true;
        setStatus("Assistant is welcoming you...");
        await playStandaloneAudio(settings.starterAudioUrl);
      }
      await start();
    } catch (error) {
      setStatus(error.message);
      cleanup();
    }
  });
  endButton.addEventListener("click", () => {
    send({ type: "stop", sessionId, sessionToken });
    cleanup();
    setStatus("Conversation ended");
  });

  async function start() {
    unlockAudio();
    setStatus("Connecting...");
    const tokenResult = await api(`/api/embed/${encodeURIComponent(agentId)}/session-token`, { method: "POST" });
    sessionToken = tokenResult.token;
    sessionId = crypto.randomUUID();
    replyReceived = false;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${protocol}://${location.host}/browser/media`);
    ws.onopen = startRecording;
    ws.onerror = () => { setStatus("Unable to connect"); cleanup(); };
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "status") setStatus(humanStatus(message.status));
      if (message.type === "audio_chunk") enqueueAudio(message);
      if (message.type === "reply") {
        replyReceived = true;
        addMessage("user", message.transcript);
        addMessage("agent", message.text);
        if (!message.streaming) enqueueAudio(message);
        else if (!playing && !playbackQueue.length) finishTurn();
      }
      if (message.type === "error") {
        setStatus(message.error);
        cleanup();
      }
    };
  }

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    sends = [];
    sequence = 0;
    mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mimeType = mediaRecorder.mimeType || "audio/webm";
    monitorSilence(stream);
    mediaRecorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      chunks.push(event.data);
      const currentSequence = sequence++;
      sends.push(blobToBase64(event.data).then((audioBase64) => send({
        type: "audio_delta", audioBase64, sequence: currentSequence, mimeType,
        sessionId, sessionToken,
      })));
    };
    mediaRecorder.onstop = async () => {
      mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size < 1024) {
        setStatus("Please speak a little longer");
        cleanup(false);
        return;
      }
      await Promise.allSettled(sends);
      send({
        type: "audio_end",
        audioBase64: await blobToBase64(blob),
        mimeType,
        sessionId,
        sessionToken,
      });
      setStatus("Thinking...");
    };
    mediaRecorder.start(250);
    micButton.classList.add("recording");
    endButton.classList.remove("hidden");
    setStatus("Listening... tap when finished");
    maxTimer = setTimeout(stopRecording, 15000);
  }

  function stopRecording() {
    if (mediaRecorder?.state !== "recording") return;
    micButton.classList.remove("recording");
    setStatus("Preparing your question...");
    mediaRecorder.stop();
    stopMonitor();
  }

  function monitorSilence(stream) {
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const started = Date.now();
    let heardSpeech = false;
    let lastSpeech = started;
    const tick = () => {
      if (!analyser || mediaRecorder?.state !== "recording") return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / samples.length);
      const now = Date.now();
      if (rms > .018) {
        heardSpeech = true;
        lastSpeech = now;
      } else if (heardSpeech && now - started > 800 && now - lastSpeech > 1200) {
        stopRecording();
        return;
      }
      silenceFrame = requestAnimationFrame(tick);
    };
    silenceFrame = requestAnimationFrame(tick);
  }

  function enqueueAudio(message) {
    const audio = message.audioBase64
      ? new Audio(`data:${message.mimeType || "audio/mpeg"};base64,${message.audioBase64}`)
      : message.audioUrl ? new Audio(message.audioUrl) : null;
    if (!audio) return;
    playbackQueue.push(audio);
    playNext();
  }

  function playNext() {
    if (playing) return;
    const audio = playbackQueue.shift();
    if (!audio) {
      if (replyReceived) finishTurn();
      else setStatus("Preparing the rest of the answer...");
      return;
    }
    playing = true;
    currentAudio = audio;
    setStatus("Assistant is speaking");
    audio.onended = audio.onerror = () => {
      playing = false;
      currentAudio = null;
      playNext();
    };
    audio.play().catch(() => {
      playing = false;
      currentAudio = null;
      playNext();
    });
  }

  function finishTurn() {
    if (mediaRecorder?.state === "recording") return;
    ws?.close();
    ws = null;
    endButton.classList.add("hidden");
    setStatus("Tap to ask another question");
  }

  function cleanup(closeSocket = true) {
    stopMonitor();
    if (mediaRecorder?.state === "recording") {
      mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      mediaRecorder = null;
    }
    currentAudio?.pause();
    currentAudio = null;
    playbackQueue = [];
    playing = false;
    if (closeSocket) ws?.close();
    ws = null;
    micButton.classList.remove("recording");
    endButton.classList.add("hidden");
  }

  function stopMonitor() {
    if (silenceFrame) cancelAnimationFrame(silenceFrame);
    if (maxTimer) clearTimeout(maxTimer);
    audioContext?.close().catch(() => {});
    audioContext = null;
    analyser = null;
  }

  function send(message) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }
  function setStatus(text) { status.textContent = text; }
  function addMessage(role, text) {
    document.getElementById("welcome")?.remove();
    const row = document.createElement("div");
    row.className = `message ${role === "user" ? "user" : ""}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    conversation.appendChild(row);
    conversation.scrollTop = conversation.scrollHeight;
  }

  function playStandaloneAudio(url) {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      audio.onended = resolve;
      audio.onerror = resolve;
      audio.play().catch(resolve);
    });
  }
}

async function api(url, options = {}) {
  const headers = { accept: "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body) headers["content-type"] = "application/json";
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Request failed");
  return data;
}

function normalizeWidget(settings) {
  return { ...DEFAULT_WIDGET, ...(settings || {}) };
}

function renderAvatar(element, url, name) {
  element.textContent = "";
  if (url) {
    const image = document.createElement("img");
    image.src = url;
    image.alt = "";
    element.appendChild(image);
  } else {
    element.textContent = initials(name);
  }
}

function resizeImage(file) {
  if (!file.type.startsWith("image/")) return Promise.reject(new Error("Choose an image file."));
  if (file.size > 5 * 1024 * 1024) return Promise.reject(new Error("Photo must be smaller than 5 MB."));
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const size = 320;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      const scale = Math.max(size / image.width, size / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", .82));
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Could not read that photo.")); };
    image.src = objectUrl;
  });
}

function setAccent(hex) {
  document.documentElement.style.setProperty("--accent", hex);
  const rgb = hex.match(/[a-f\d]{2}/gi)?.map((value) => parseInt(value, 16)) || [109, 93, 252];
  document.documentElement.style.setProperty("--accent-rgb", rgb.join(","));
}
function initials(name) { return String(name || "AI").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function formatLabel(value) { return String(value || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&"); }
function clearAuth() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
function showToast(text) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
function unlockAudio() {
  const audio = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==");
  audio.volume = 0;
  audio.play().catch(() => {});
}
function humanStatus(value) {
  const labels = {
    "Transcription started": "Understanding your question...",
    "Agent started": "Finding the best answer...",
    "TTS started": "Preparing voice reply...",
    "Received audio": "Understanding your question...",
  };
  return labels[value] || value;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}
function waveIcon() { return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 13v-2M8 17V7m4 13V4m4 13V7m4 6v-2" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/></svg>`; }
function micSvg() { return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15Zm6-3.5a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.92V20H8.5a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2H13v-2.58A6 6 0 0 0 18 11.5Z"/></svg>`; }
function micIcon() { return `<span>${micSvg()}</span>`; }
function gridIcon() { return `<span>◫</span>`; }
function codeIcon() { return `<span>&lt;/&gt;</span>`; }
function copyIcon() { return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" stroke="currentColor" stroke-width="2"/></svg>`; }
