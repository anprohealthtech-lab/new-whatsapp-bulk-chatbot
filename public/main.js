const talkButton = document.getElementById("talkButton");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const organizationIdInput = document.getElementById("organizationId");
const userIdInput = document.getElementById("userId");

let ws;
let mediaRecorder;
let audioContext;
let analyser;
let silenceMonitorId;
let maxRecordingTimer;
let audioChunks = [];
let sessionId = crypto.randomUUID();

const ORG_STORAGE_KEY = "voice_agent_organization_id";
const USER_STORAGE_KEY = "voice_agent_user_id";
const SILENCE_THRESHOLD = 0.018;
const SILENCE_MS = 1200;
const MIN_RECORDING_MS = 800;
const MAX_RECORDING_MS = 15000;

organizationIdInput.value = localStorage.getItem(ORG_STORAGE_KEY) || "";
userIdInput.value = localStorage.getItem(USER_STORAGE_KEY) || "";

function addEntry(label, text) {
  const entry = document.createElement("p");
  entry.className = "entry";
  entry.innerHTML = `<span class="label">${label}</span>${text}`;
  logEl.prepend(entry);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function formatStatus(message) {
  const parts = [message.status];
  if (typeof message.elapsedMs === "number") parts.push(`(${message.elapsedMs}ms)`);
  if (message.detail) parts.push(`- ${message.detail}`);
  return parts.join(" ");
}

function playAgentAudio(message) {
  const audio = message.audioBase64
    ? new Audio(`data:${message.mimeType || "audio/mpeg"};base64,${message.audioBase64}`)
    : message.audioUrl
      ? new Audio(message.audioUrl)
      : null;

  if (!audio) {
    addEntry("Error", "TTS returned no playable audio.");
    return;
  }

  audio.play().catch((error) => {
    addEntry("Error", `Audio playback failed: ${error.message}`);
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

async function start() {
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

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "status") {
      setStatus(message.status);
      addEntry("Status", formatStatus(message));
    }
    if (message.type === "reply") {
      addEntry("You", message.transcript);
      addEntry("Agent", message.text);
      setStatus("Playing reply");
      playAgentAudio(message);
      resetControls("Idle");
    }
    if (message.type === "error") {
      addEntry("Error", message.error);
      resetControls("Error");
    }
  };

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  startSilenceMonitor(stream);

  const preferredMimeType = "audio/webm;codecs=opus";
  const options = MediaRecorder.isTypeSupported(preferredMimeType)
    ? { mimeType: preferredMimeType }
    : undefined;
  mediaRecorder = new MediaRecorder(stream, options);

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size) audioChunks.push(event.data);
  };

  mediaRecorder.onstop = async () => {
    try {
      mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
      if (ws.readyState !== WebSocket.OPEN) return;

      const mimeType = mediaRecorder.mimeType || preferredMimeType;
      const audioBlob = new Blob(audioChunks, { type: mimeType });
      if (audioBlob.size < 1024) {
        addEntry("Error", "Recording was too short. Please speak for a little longer.");
        resetControls("Too short");
        return;
      }

      const audioBase64 = await blobToBase64(audioBlob);
      setStatus("Thinking");

      ws.send(
        JSON.stringify({
          type: "audio",
          audioBase64,
          mimeType,
          sessionId,
          organizationId,
          userId
        })
      );
    } catch (error) {
      addEntry("Error", error.message);
      resetControls("Error");
    }
  };

  ws.onopen = () => {
    mediaRecorder.start();
    talkButton.textContent = "Stop";
    talkButton.disabled = false;
    talkButton.classList.add("recording");
    setStatus("Recording");
    maxRecordingTimer = window.setTimeout(() => {
      if (mediaRecorder?.state === "recording") {
        stop("Max recording reached");
      }
    }, MAX_RECORDING_MS);
  };

  ws.onerror = () => {
    addEntry("Error", "Voice socket connection failed.");
    resetControls("Error");
  };
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
  talkButton.textContent = "Start";
  talkButton.disabled = false;
  talkButton.classList.remove("recording");
  setStatus(status);
}

talkButton.addEventListener("click", () => {
  if (mediaRecorder?.state === "recording") {
    stop();
  } else {
    start().catch((error) => {
      addEntry("Error", error.message);
      resetControls("Error");
    });
  }
});
