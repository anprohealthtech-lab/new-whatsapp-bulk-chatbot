const talkButton = document.getElementById("talkButton");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

let ws;
let mediaRecorder;
let sessionId = crypto.randomUUID();

function addEntry(label, text) {
  const entry = document.createElement("p");
  entry.className = "entry";
  entry.innerHTML = `<span class="label">${label}</span>${text}`;
  logEl.prepend(entry);
}

function setStatus(text) {
  statusEl.textContent = text;
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
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}/browser/media`);

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "status") {
      setStatus(message.status);
    }
    if (message.type === "reply") {
      addEntry("You", message.transcript);
      addEntry("Agent", message.text);
      if (message.audioBase64) {
        const audio = new Audio(
          `data:${message.mimeType || "audio/mpeg"};base64,${message.audioBase64}`
        );
        audio.play();
      } else if (message.audioUrl) {
        new Audio(message.audioUrl).play();
      }
      setStatus("Listening");
    }
    if (message.type === "error") {
      addEntry("Error", message.error);
      setStatus("Error");
    }
  };

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: "audio/webm;codecs=opus"
  });

  mediaRecorder.ondataavailable = async (event) => {
    if (!event.data.size || ws.readyState !== WebSocket.OPEN) return;
    const audioBase64 = await blobToBase64(event.data);
    ws.send(
      JSON.stringify({
        type: "audio",
        audioBase64,
        sessionId
      })
    );
  };

  mediaRecorder.start(3500);
  talkButton.textContent = "Stop";
  talkButton.classList.add("recording");
  setStatus("Listening");
}

function stop() {
  mediaRecorder?.stop();
  mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
  ws?.close();
  talkButton.textContent = "Start";
  talkButton.classList.remove("recording");
  setStatus("Idle");
}

talkButton.addEventListener("click", () => {
  if (mediaRecorder?.state === "recording") {
    stop();
  } else {
    start().catch((error) => {
      addEntry("Error", error.message);
      setStatus("Error");
    });
  }
});
