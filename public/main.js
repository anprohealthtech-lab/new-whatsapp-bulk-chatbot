const talkButton = document.getElementById("talkButton");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const organizationIdInput = document.getElementById("organizationId");
const userIdInput = document.getElementById("userId");
const modeInput = document.getElementById("mode");
const flowIdInput = document.getElementById("flowId");
const cacheTokenInput = document.getElementById("cacheToken");
const generateCacheButton = document.getElementById("generateCacheButton");
const refreshCacheButton = document.getElementById("refreshCacheButton");
const cacheStatusEl = document.getElementById("cacheStatus");
const chunkListEl = document.getElementById("chunkList");

let ws;
let mediaRecorder;
let audioContext;
let analyser;
let silenceMonitorId;
let maxRecordingTimer;
let audioChunks = [];
let audioChunkSequence = 0;
let pendingAudioChunkSends = [];
let playbackQueue = [];
let playbackActive = false;
let playbackDoneStatus = null;
let currentPlaybackAudio = null;
let pendingFlowListen = null;
let sessionId = crypto.randomUUID();
let currentMimeType = "audio/webm;codecs=opus";

const ORG_STORAGE_KEY = "voice_agent_organization_id";
const USER_STORAGE_KEY = "voice_agent_user_id";
const CACHE_TOKEN_STORAGE_KEY = "voice_agent_cache_token";
const SILENCE_THRESHOLD = 0.018;
const SILENCE_MS = 1200;
const MIN_RECORDING_MS = 800;
const MAX_RECORDING_MS = 15000;
const FLOW_LISTEN_ARM_DELAY_MS = 350;

organizationIdInput.value = localStorage.getItem(ORG_STORAGE_KEY) || "";
userIdInput.value = localStorage.getItem(USER_STORAGE_KEY) || "";
cacheTokenInput.value = localStorage.getItem(CACHE_TOKEN_STORAGE_KEY) || "";

function addEntry(label, text) {
  const entry = document.createElement("p");
  entry.className = "entry";
  entry.innerHTML = `<span class="label">${label}</span>${text}`;
  logEl.prepend(entry);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setCacheStatus(text) {
  cacheStatusEl.textContent = text;
}

function formatStatus(message) {
  const parts = [message.status];
  if (typeof message.elapsedMs === "number") parts.push(`(${message.elapsedMs}ms)`);
  if (message.detail) parts.push(`- ${message.detail}`);
  return parts.join(" ");
}

function enqueueAgentAudio(message, onDone) {
  const hasBase64 = Boolean(message.audioBase64);
  const hasUrl = Boolean(message.audioUrl);
  addEntry(
    "Audio",
    `Queued chunk ${message.index ?? 0} (${message.mimeType || "unknown"}, base64=${hasBase64}, url=${hasUrl})`
  );

  const audio = message.audioBase64
    ? new Audio(`data:${message.mimeType || "audio/mpeg"};base64,${message.audioBase64}`)
    : message.audioUrl
      ? new Audio(message.audioUrl)
      : null;

  if (!audio) {
    addEntry("Error", "TTS returned no playable audio.");
    return;
  }

  audio.preload = "auto";
  audio.volume = 1;
  playbackQueue.push({ audio, onDone });
  talkButton.textContent = "Interrupt";
  talkButton.disabled = false;
  playNextAudio();
}

function playNextAudio() {
  if (playbackActive) return;

  const item = playbackQueue.shift();
  if (!item) {
    if (pendingFlowListen) {
      const nextListen = pendingFlowListen;
      pendingFlowListen = null;
      setStatus("Listening soon");
      window.setTimeout(() => {
        startRecording(nextListen.organizationId, nextListen.userId).catch((error) => {
          addEntry("Error", error.message);
          resetControls("Error");
        });
      }, FLOW_LISTEN_ARM_DELAY_MS);
      return;
    }

    if (playbackDoneStatus) {
      const status = playbackDoneStatus;
      playbackDoneStatus = null;
      resetControls(status);
    }
    return;
  }

  playbackActive = true;
  currentPlaybackAudio = item.audio;
  item.audio.onended = () => {
    addEntry("Audio", "Chunk finished");
    playbackActive = false;
    currentPlaybackAudio = null;
    item.onDone?.();
    playNextAudio();
  };
  item.audio.onerror = () => {
    playbackActive = false;
    currentPlaybackAudio = null;
    addEntry("Error", `Audio playback failed. readyState=${item.audio.readyState} networkState=${item.audio.networkState}`);
    item.onDone?.();
    playNextAudio();
  };
  addEntry("Audio", "Playing chunk");
  item.audio.play().catch((error) => {
    playbackActive = false;
    currentPlaybackAudio = null;
    addEntry("Error", `Audio playback failed: ${error.message}`);
    item.onDone?.();
    playNextAudio();
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sendAudioMessage(message) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function startFlowListeningAfterPlayback(organizationId, userId) {
  pendingFlowListen = { organizationId, userId };
  if (playbackActive || playbackQueue.length) {
    setStatus("Waiting for audio to finish");
    return;
  }

  playNextAudio();
}

function getTenantInput() {
  const organizationId = organizationIdInput.value.trim();
  const userId = userIdInput.value.trim();
  if (!organizationId || !userId) {
    throw new Error("Enter Organization ID and User ID first.");
  }

  localStorage.setItem(ORG_STORAGE_KEY, organizationId);
  localStorage.setItem(USER_STORAGE_KEY, userId);
  localStorage.setItem(CACHE_TOKEN_STORAGE_KEY, cacheTokenInput.value.trim());
  return { organizationId, userId, flowId: flowIdInput.value };
}

function cacheHeaders() {
  const token = cacheTokenInput.value.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function refreshCacheChunks() {
  const params = getTenantInput();
  setCacheStatus("Loading");
  const query = new URLSearchParams(params);
  const response = await fetch(`/api/voice-flow-audio?${query}`, {
    headers: cacheHeaders()
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Failed to load cached chunks.");

  renderChunks(data.chunks || []);
  setCacheStatus(`${data.chunks?.length || 0} chunks`);
}

async function generateCacheChunks() {
  const body = getTenantInput();
  setCacheStatus("Generating");
  generateCacheButton.disabled = true;
  refreshCacheButton.disabled = true;
  try {
    const response = await fetch("/api/voice-flow-audio/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...cacheHeaders()
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Failed to generate chunks.");

    const createdCount = (data.generated || []).filter((chunk) => !chunk.cached).length;
    const cachedCount = (data.generated || []).filter((chunk) => chunk.cached).length;
    addEntry("Cache", `Generated ${createdCount}, reused ${cachedCount}.`);
    await refreshCacheChunks();
  } finally {
    generateCacheButton.disabled = false;
    refreshCacheButton.disabled = false;
  }
}

function renderChunks(chunks) {
  chunkListEl.innerHTML = "";
  if (!chunks.length) {
    chunkListEl.textContent = "No cached chunks yet.";
    return;
  }

  for (const chunk of chunks) {
    const row = document.createElement("div");
    row.className = "chunk-row";
    const details = document.createElement("div");
    details.innerHTML = `<strong>${chunk.node_id} #${chunk.chunk_index}</strong><span>${chunk.text}</span>`;

    const play = document.createElement("button");
    play.type = "button";
    play.className = "icon-button";
    play.textContent = "Play";
    play.addEventListener("click", () => {
      enqueueAgentAudio({
        index: chunk.chunk_index,
        audioUrl: chunk.audio_url,
        mimeType: chunk.mime_type
      });
    });

    row.append(details, play);
    chunkListEl.append(row);
  }
}

async function start() {
  unlockAudioPlayback();

  const organizationId = organizationIdInput.value.trim();
  const userId = userIdInput.value.trim();

  if (!organizationId || !userId) {
    addEntry("Error", "Enter a valid Organization ID and User ID before recording.");
    setStatus("Missing tenant IDs");
    return;
  }

  localStorage.setItem(ORG_STORAGE_KEY, organizationId);
  localStorage.setItem(USER_STORAGE_KEY, userId);

  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}/browser/media`);
  audioChunks = [];
  audioChunkSequence = 0;
  pendingAudioChunkSends = [];
  const mode = modeInput.value;

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "status") {
      setStatus(message.status);
      addEntry("Status", formatStatus(message));
    }
    if (message.type === "audio_chunk") {
      setStatus(`Queued chunk ${message.index + 1}`);
      enqueueAgentAudio(message);
    }
    if (message.type === "flow_transcript") {
      addEntry("You", message.transcript);
    }
    if (message.type === "flow_listen") {
      addEntry("Status", "Flow is listening");
      startFlowListeningAfterPlayback(organizationId, userId);
    }
    if (message.type === "flow_end") {
      addEntry("Status", "Flow ended");
      if (playbackActive || playbackQueue.length) {
        playbackDoneStatus = "Idle";
      } else {
        resetControls("Idle");
      }
    }
    if (message.type === "reply") {
      addEntry("You", message.transcript);
      addEntry("Agent", message.text);
      if (message.streaming) {
        setStatus("Finishing playback");
        if (playbackActive || playbackQueue.length) {
          playbackDoneStatus = "Idle";
        } else {
          resetControls("Idle");
        }
      } else {
        setStatus("Playing reply");
        enqueueAgentAudio(message, () => resetControls("Idle"));
      }
    }
    if (message.type === "error") {
      addEntry("Error", message.error);
      resetControls("Error");
    }
  };

  ws.onopen = () => {
    if (mode === "flow") {
      talkButton.textContent = "Stop";
      talkButton.disabled = false;
      talkButton.classList.add("recording");
      setStatus("Flow speaking");
      sendAudioMessage({
        type: "start_flow",
        sessionId,
        organizationId,
        userId,
        flowId: flowIdInput.value
      });
    } else {
      startRecording(organizationId, userId).catch((error) => {
        addEntry("Error", error.message);
        resetControls("Error");
      });
    }
  };

  ws.onerror = () => {
    addEntry("Error", "Voice socket connection failed.");
    resetControls("Error");
  };
}

async function startRecording(organizationId, userId) {
  cleanupAudio();
  audioChunks = [];
  pendingAudioChunkSends = [];
  audioChunkSequence = 0;

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  startSilenceMonitor(stream);

  currentMimeType = "audio/webm;codecs=opus";
  const options = MediaRecorder.isTypeSupported(currentMimeType)
    ? { mimeType: currentMimeType }
    : undefined;
  mediaRecorder = new MediaRecorder(stream, options);
  currentMimeType = mediaRecorder.mimeType || currentMimeType;

  mediaRecorder.ondataavailable = async (event) => {
    if (!event.data.size) return;
    audioChunks.push(event.data);
    const sequence = audioChunkSequence++;
    const sendPromise = blobToBase64(event.data).then((audioBase64) => {
      sendAudioMessage({
        type: "audio_delta",
        audioBase64,
        sequence,
        mimeType: currentMimeType,
        sessionId,
        organizationId,
        userId
      });
    });
    pendingAudioChunkSends.push(sendPromise);
  };

  mediaRecorder.onstop = async () => {
    try {
      mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
      if (ws.readyState !== WebSocket.OPEN) return;

      const audioBlob = new Blob(audioChunks, { type: currentMimeType });
      if (audioBlob.size < 1024) {
        addEntry("Error", "Recording was too short. Please speak for a little longer.");
        resetControls("Too short");
        return;
      }

      await Promise.allSettled(pendingAudioChunkSends);
      const audioBase64 = await blobToBase64(audioBlob);
      setStatus("Thinking");
      sendAudioMessage({
        type: "audio_end",
        audioBase64,
        mimeType: currentMimeType,
        sessionId,
        organizationId,
        userId
      });
      audioChunks = [];
      pendingAudioChunkSends = [];
      audioChunkSequence = 0;
    } catch (error) {
      addEntry("Error", error.message);
      resetControls("Error");
    }
  };

  mediaRecorder.start(250);
  talkButton.textContent = "Stop";
  talkButton.disabled = false;
  talkButton.classList.add("recording");
  setStatus("Recording");
  maxRecordingTimer = window.setTimeout(() => {
    if (mediaRecorder?.state === "recording") {
      stop("Max recording reached");
    }
  }, MAX_RECORDING_MS);
}

function unlockAudioPlayback() {
  const silentAudio = new Audio(
    "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA=="
  );
  silentAudio.volume = 0;
  silentAudio.play().catch(() => {});
}

function stop() {
  if (mediaRecorder?.state === "recording") {
    talkButton.disabled = true;
    setStatus("Preparing audio");
    mediaRecorder.stop();
  }
}

function startSilenceMonitor(stream) {
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;

  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  const startedAt = Date.now();
  let hasSpeech = false;
  let lastSpeechAt = startedAt;

  const tick = () => {
    if (!analyser || mediaRecorder?.state !== "recording") {
      silenceMonitorId = window.requestAnimationFrame(tick);
      return;
    }

    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const normalized = (sample - 128) / 128;
      sum += normalized * normalized;
    }

    const rms = Math.sqrt(sum / samples.length);
    const now = Date.now();
    if (rms > SILENCE_THRESHOLD) {
      hasSpeech = true;
      lastSpeechAt = now;
      setStatus("Recording");
    } else if (hasSpeech && now - startedAt > MIN_RECORDING_MS && now - lastSpeechAt > SILENCE_MS) {
      setStatus("Pause detected");
      stop();
      return;
    }

    silenceMonitorId = window.requestAnimationFrame(tick);
  };

  silenceMonitorId = window.requestAnimationFrame(tick);
}

function cleanupAudio() {
  if (silenceMonitorId) {
    window.cancelAnimationFrame(silenceMonitorId);
    silenceMonitorId = undefined;
  }
  if (maxRecordingTimer) {
    window.clearTimeout(maxRecordingTimer);
    maxRecordingTimer = undefined;
  }
  audioContext?.close().catch(() => {});
  audioContext = undefined;
  analyser = undefined;
}

function resetControls(status) {
  cleanupAudio();
  ws?.close();
  mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
  currentPlaybackAudio?.pause();
  currentPlaybackAudio = null;
  playbackQueue = [];
  playbackActive = false;
  playbackDoneStatus = null;
  pendingFlowListen = null;
  talkButton.textContent = "Start";
  talkButton.disabled = false;
  talkButton.classList.remove("recording");
  setStatus(status);
}

async function interruptAndRestart() {
  sendAudioMessage({ type: "barge_in", sessionId });
  resetControls("Interrupted");
  await start();
}

talkButton.addEventListener("click", () => {
  if (playbackActive || playbackQueue.length) {
    interruptAndRestart().catch((error) => {
      addEntry("Error", error.message);
      resetControls("Error");
    });
  } else if (mediaRecorder?.state === "recording") {
    stop();
  } else {
    start().catch((error) => {
      addEntry("Error", error.message);
      resetControls("Error");
    });
  }
});

generateCacheButton.addEventListener("click", () => {
  generateCacheChunks().catch((error) => {
    addEntry("Error", error.message);
    setCacheStatus("Error");
  });
});

refreshCacheButton.addEventListener("click", () => {
  refreshCacheChunks().catch((error) => {
    addEntry("Error", error.message);
    setCacheStatus("Error");
  });
});
