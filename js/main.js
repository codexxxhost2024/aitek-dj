import { MultimodalLiveClient } from "./core/websocket-client.js"
import { AudioStreamer } from "./audio/audio-streamer.js"
import { AudioRecorder } from "./audio/audio-recorder.js"
import { CONFIG } from "./config/config.js"
import { Logger } from "./utils/logger.js"
import { VideoManager } from "./video/video-manager.js"
import { ScreenRecorder } from "./video/screen-recorder.js"
import { searchMemory, addMemory } from "./utils/memory.js" // Import Memo AI functions
import { ApplicationError } from "./utils/error-boundary.js"

/**
 * @fileoverview Main entry point for the application.
 * Initializes and manages the UI, audio, video, and WebSocket interactions.
 * Now includes Memo AI integration to persist chat history and use it as long-term memory.
 */

// === DOM Elements ===
const logsContainer = document.getElementById("logs-container")
const messageInput = document.getElementById("message-input")
const sendButton = document.getElementById("send-button")
const micButton = document.getElementById("mic-button")
const micIcon = document.getElementById("mic-icon")
const audioVisualizer = document.getElementById("audio-visualizer")
const connectButton = document.getElementById("connect-button")
const cameraButton = document.getElementById("camera-button")
const cameraIcon = document.getElementById("camera-icon")
const stopVideoButton = document.getElementById("stop-video")
const screenButton = document.getElementById("screen-button")
const screenIcon = document.getElementById("screen-icon")
const screenContainer = document.getElementById("screen-container")
const screenPreview = document.getElementById("screen-preview")
const inputAudioVisualizer = document.getElementById("input-audio-visualizer")
const voiceSelect = document.getElementById("voice-select")
const sampleRateInput = document.getElementById("sample-rate-input")
const systemInstructionInput = document.getElementById("system-instruction")
const applyConfigButton = document.getElementById("apply-config")
const configToggle = document.getElementById("config-toggle")
const toggleLogs = document.getElementById("toggle-logs")
const logsWrapper = document.querySelector(".logs-wrapper")
const configContainer = document.getElementById("config-container")

// === Theme Switcher ===
const themeToggle = document.getElementById("theme-toggle")
const root = document.documentElement
const savedTheme = localStorage.getItem("theme") || "dark"
root.setAttribute("data-theme", savedTheme)
// No need to change text content anymore since we're using CSS to show the icon

themeToggle.addEventListener("click", () => {
  const currentTheme = root.getAttribute("data-theme")
  const newTheme = currentTheme === "dark" ? "light" : "dark"
  root.setAttribute("data-theme", newTheme)
  localStorage.setItem("theme", newTheme)
  // No need to change text content anymore since we're using CSS to show the icon
})

// === State Variables ===
let isRecording = false
let audioStreamer = null
let audioCtx = null
let isConnected = false
let audioRecorder = null
let isVideoActive = false
let videoManager = null
let isScreenSharing = false
let screenRecorder = null
let isUsingTool = false

// Global variables for Memo AI integration – store latest conversation turn
let lastUserMessage = ""
let lastAssistantMessage = ""

// === Multimodal Client ===
const client = new MultimodalLiveClient({ apiKey: CONFIG.API.KEY })

// === Initialize Configuration Values ===
voiceSelect.value = CONFIG.VOICE.NAME
sampleRateInput.value = CONFIG.AUDIO.OUTPUT_SAMPLE_RATE
systemInstructionInput.value = CONFIG.SYSTEM_INSTRUCTION.TEXT

// Configuration presets
const CONFIG_PRESETS = {
  friendly: {
    voice: "Aoede",
    sampleRate: 27000,
    systemInstruction: "You are a friendly and warm AI assistant. Use a casual, approachable tone and be encouraging.",
  },
  professional: {
    voice: "Charon",
    sampleRate: 24000,
    systemInstruction:
      "You are a professional AI expert. Maintain a formal tone, be precise and thorough in your explanations. Focus on accuracy and clarity in all interactions.",
  },
  tired: {
    voice: "Aoede",
    sampleRate: 16000,
    systemInstruction:
      "You are very tired, exhausted, and grumpy. Respond in a lazy and unenthusiastic tone unless absolutely necessary.",
  },
}

/**
 * Updates the configuration and reconnects if needed.
 */
async function updateConfiguration() {
  const newVoice = voiceSelect.value
  const newSampleRate = Number.parseInt(sampleRateInput.value)
  const newInstruction = systemInstructionInput.value.trim()

  if (isNaN(newSampleRate) || newSampleRate < 1000 || newSampleRate > 48000) {
    logMessage("Invalid sample rate. Must be between 1000 and 48000 Hz.", "system")
    return
  }

  CONFIG.VOICE.NAME = newVoice
  CONFIG.AUDIO.OUTPUT_SAMPLE_RATE = newSampleRate
  CONFIG.SYSTEM_INSTRUCTION.TEXT = newInstruction

  localStorage.setItem("gemini_voice", newVoice)
  localStorage.setItem("gemini_output_sample_rate", newSampleRate.toString())
  localStorage.setItem("gemini_system_instruction", newInstruction)

  if (audioStreamer) {
    audioStreamer.stop()
    audioStreamer = null
  }

  if (isConnected) {
    logMessage("Reconnecting to apply configuration changes...", "system")
    await disconnectFromWebsocket()
    await connectToWebsocket()
  }

  logMessage("Configuration updated successfully", "system")
  if (window.innerWidth <= 768) {
    configContainer.classList.remove("active")
    configToggle.classList.remove("active")
  }
}

// Load saved configuration if exists
if (localStorage.getItem("gemini_voice")) {
  CONFIG.VOICE.NAME = localStorage.getItem("gemini_voice")
  voiceSelect.value = CONFIG.VOICE.NAME
}
if (localStorage.getItem("gemini_output_sample_rate")) {
  CONFIG.AUDIO.OUTPUT_SAMPLE_RATE = Number.parseInt(localStorage.getItem("gemini_output_sample_rate"))
  sampleRateInput.value = CONFIG.AUDIO.OUTPUT_SAMPLE_RATE
}
if (localStorage.getItem("gemini_system_instruction")) {
  CONFIG.SYSTEM_INSTRUCTION.TEXT = localStorage.getItem("gemini_system_instruction")
  systemInstructionInput.value = CONFIG.SYSTEM_INSTRUCTION.TEXT
}

applyConfigButton.addEventListener("click", updateConfiguration)
configToggle.addEventListener("click", () => {
  configContainer.classList.toggle("active")
  configToggle.classList.toggle("active")
})
document.addEventListener("click", (event) => {
  if (!configContainer.contains(event.target) && !configToggle.contains(event.target) && window.innerWidth > 768) {
    configContainer.classList.remove("active")
    configToggle.classList.remove("active")
  }
})
configContainer.addEventListener("click", (event) => {
  event.stopPropagation()
})
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    configContainer.classList.remove("active")
    configToggle.classList.remove("active")
  }
})
toggleLogs.addEventListener("click", () => {
  logsWrapper.classList.toggle("collapsed")
  // No need to change text content anymore since we're using CSS to show the icon
})
function handleMobileView() {
  if (window.innerWidth <= 768) {
    logsWrapper.classList.add("collapsed")
    // No need to change text content anymore since we're using CSS to show the icon
  } else {
    logsWrapper.classList.remove("collapsed")
    // No need to change text content anymore since we're using CSS to show the icon
  }
}
window.addEventListener("resize", handleMobileView)
handleMobileView()
document.querySelectorAll(".preset-button").forEach((button) => {
  button.addEventListener("click", () => {
    const preset = CONFIG_PRESETS[button.dataset.preset]
    if (preset) {
      voiceSelect.value = preset.voice
      sampleRateInput.value = preset.sampleRate
      systemInstructionInput.value = preset.systemInstruction
      updateConfiguration()
      button.style.backgroundColor = "var(--primary-color)"
      button.style.color = "white"
      setTimeout(() => {
        button.style.backgroundColor = ""
        button.style.color = ""
      }, 200)
    }
  })
})

/**
 * Logs a message to the UI.
 */
function logMessage(message, type = "system") {
  const logEntry = document.createElement("div")
  logEntry.classList.add("log-entry", type)
  const timestamp = document.createElement("span")
  timestamp.classList.add("timestamp")
  timestamp.textContent = new Date().toLocaleTimeString()
  logEntry.appendChild(timestamp)
  const emoji = document.createElement("span")
  emoji.classList.add("emoji")
  switch (type) {
    case "system":
      emoji.textContent = "⚙️"
      break
    case "user":
      emoji.textContent = "🫵"
      break
    case "ai":
      emoji.textContent = "🤖"
      break
  }
  logEntry.appendChild(emoji)
  const messageText = document.createElement("span")
  messageText.textContent = message
  logEntry.appendChild(messageText)
  logsContainer.appendChild(logEntry)
  logsContainer.scrollTop = logsContainer.scrollHeight
}

/**
 * Updates the microphone icon.
 */
function updateMicIcon() {
  micIcon.textContent = isRecording ? "mic_off" : "mic"
  micButton.style.backgroundColor = isRecording ? "#ea4335" : "#4285f4"
}

/**
 * Updates the audio visualizer.
 */
function updateAudioVisualizer(volume, isInput = false) {
  const visualizer = isInput ? inputAudioVisualizer : audioVisualizer
  const audioBar = visualizer.querySelector(".audio-bar") || document.createElement("div")
  if (!visualizer.contains(audioBar)) {
    audioBar.classList.add("audio-bar")
    visualizer.appendChild(audioBar)
  }
  audioBar.style.width = `${volume * 100}%`
  volume > 0 ? audioBar.classList.add("active") : audioBar.classList.remove("active")
}

/**
 * Initializes the audio context and streamer.
 */
async function ensureAudioInitialized() {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  if (!audioStreamer) {
    audioStreamer = new AudioStreamer(audioCtx)
    audioStreamer.sampleRate = CONFIG.AUDIO.OUTPUT_SAMPLE_RATE
    await audioStreamer.initialize()
  }
  return audioStreamer
}

/**
 * Handles the microphone toggle.
 */
async function handleMicToggle() {
  if (!isRecording) {
    try {
      await ensureAudioInitialized()
      audioRecorder = new AudioRecorder()
      const inputAnalyser = audioCtx.createAnalyser()
      inputAnalyser.fftSize = 256
      const inputDataArray = new Uint8Array(inputAnalyser.frequencyBinCount)
      await audioRecorder.start((base64Data) => {
        if (isUsingTool) {
          client.sendRealtimeInput([
            {
              mimeType: "audio/pcm;rate=16000",
              data: base64Data,
              interrupt: true,
            },
          ])
        } else {
          client.sendRealtimeInput([
            {
              mimeType: "audio/pcm;rate=16000",
              data: base64Data,
            },
          ])
        }
        inputAnalyser.getByteFrequencyData(inputDataArray)
        const inputVolume = Math.max(...inputDataArray) / 255
        updateAudioVisualizer(inputVolume, true)
      })
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const source = audioCtx.createMediaStreamSource(stream)
      source.connect(inputAnalyser)
      await audioStreamer.resume()
      isRecording = true
      Logger.info("Microphone started")
      logMessage("Microphone started", "system")
      updateMicIcon()
    } catch (error) {
      Logger.error("Microphone error:", error)
      logMessage(`Error: ${error.message}`, "system")
      isRecording = false
      updateMicIcon()
    }
  } else {
    if (audioRecorder && isRecording) {
      audioRecorder.stop()
    }
    isRecording = false
    logMessage("Microphone stopped", "system")
    updateMicIcon()
    updateAudioVisualizer(0, true)
  }
}

/**
 * Connects to the WebSocket server.
 */
async function connectToWebsocket() {
  const config = {
    model: CONFIG.API.MODEL_NAME,
    generationConfig: {
      responseModalities: "audio",
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: CONFIG.VOICE.NAME,
          },
        },
      },
    },
    systemInstruction: {
      parts: [
        {
          text: CONFIG.SYSTEM_INSTRUCTION.TEXT,
        },
      ],
    },
  }
  try {
    await client.connect(config)
    isConnected = true
    connectButton.textContent = "Disconnect"
    connectButton.classList.add("connected")
    messageInput.disabled = false
    sendButton.disabled = false
    micButton.disabled = false
    cameraButton.disabled = false
    screenButton.disabled = false
    logMessage("Connected to Gemini 2.0 Flash Multimodal Live API", "system")
    const initAudioHandler = async () => {
      try {
        await ensureAudioInitialized()
        document.removeEventListener("click", initAudioHandler)
      } catch (error) {
        Logger.error("Audio initialization error:", error)
      }
    }
    document.addEventListener("click", initAudioHandler)
    logMessage("Audio initialized", "system")
  } catch (error) {
    const errorMessage = error.message || "Unknown error"
    Logger.error("Connection error:", error)
    logMessage(`Connection error: ${errorMessage}`, "system")
    isConnected = false
    connectButton.textContent = "Connect"
    connectButton.classList.remove("connected")
    messageInput.disabled = true
    sendButton.disabled = true
    micButton.disabled = true
    cameraButton.disabled = true
    screenButton.disabled = true
  }
}

/**
 * Disconnects from the WebSocket server.
 */
function disconnectFromWebsocket() {
  client.disconnect()
  isConnected = false
  if (audioStreamer) {
    audioStreamer.stop()
    if (audioRecorder) {
      audioRecorder.stop()
      audioRecorder = null
    }
    isRecording = false
    updateMicIcon()
  }
  connectButton.textContent = "Connect"
  connectButton.classList.remove("connected")
  messageInput.disabled = true
  sendButton.disabled = true
  micButton.disabled = true
  cameraButton.disabled = true
  screenButton.disabled = true
  logMessage("Disconnected from server", "system")
  if (videoManager) {
    stopVideo()
  }
  if (screenRecorder) {
    stopScreenSharing()
  }
}

/**
 * Handles sending a text message with Memo AI integration.
 * Retrieves relevant memories from Mem0 and appends them as context.
 */
async function handleSendMessage() {
  const message = messageInput.value.trim()
  if (!message) return

  logMessage(message, "user")
  lastUserMessage = message // Save for memory later

  // Retrieve relevant memories from Mem0 (using user 'default')
  let memoriesText = ""
  try {
    const memories = await searchMemory(message, "default")
    if (memories && memories.length > 0) {
      memoriesText = memories.map((entry) => entry.memory || entry.text || "").join("\n")
    }
  } catch (error) {
    Logger.error("Error retrieving memories:", error)
  }

  // Compose composite message with context if available
  const compositeMessage = memoriesText ? `${message}\n\nContext from past conversations:\n${memoriesText}` : message

  client.send({ text: compositeMessage })
  messageInput.value = ""
}

/**
 * Event listeners for sending messages.
 */
sendButton.addEventListener("click", async () => {
  await handleSendMessage()
})
messageInput.addEventListener("keypress", async (event) => {
  if (event.key === "Enter") {
    await handleSendMessage()
  }
})

/**
 * On turn completion, save the conversation turn (user and assistant messages) to Mem0.
 */
client.on("turncomplete", async () => {
  isUsingTool = false
  logMessage("Turn complete", "system")
  if (lastUserMessage && lastAssistantMessage) {
    try {
      await addMemory("default", [
        { role: "user", content: lastUserMessage },
        { role: "assistant", content: lastAssistantMessage },
      ])
      lastUserMessage = ""
      lastAssistantMessage = ""
    } catch (error) {
      Logger.error("Error saving conversation to memory:", error)
    }
  }
})

/**
 * Accumulates assistant reply text and logs it.
 */
client.on("content", (data) => {
  if (data.modelTurn) {
    if (data.modelTurn.parts.some((part) => part.functionCall)) {
      isUsingTool = true
      Logger.info("Model is using a tool")
    } else if (data.modelTurn.parts.some((part) => part.functionResponse)) {
      isUsingTool = false
      Logger.info("Tool usage completed")
    }
    const text = data.modelTurn.parts.map((part) => part.text).join("")
    if (text) {
      logMessage(text, "ai")
      lastAssistantMessage += text
    }
  }
})

client.on("open", () => {
  logMessage("WebSocket connection opened", "system")
})
client.on("log", (log) => {
  logMessage(`${log.type}: ${JSON.stringify(log.message)}`, "system")
})
client.on("close", (event) => {
  logMessage(`WebSocket connection closed (code ${event.code})`, "system")
})
client.on("audio", async (data) => {
  try {
    const streamer = await ensureAudioInitialized()
    streamer.addPCM16(new Uint8Array(data))
  } catch (error) {
    logMessage(`Error processing audio: ${error.message}`, "system")
  }
})
client.on("interrupted", () => {
  audioStreamer?.stop()
  isUsingTool = false
  Logger.info("Model interrupted")
  logMessage("Model interrupted", "system")
})
client.on("setupcomplete", () => {
  logMessage("Setup complete", "system")
})
client.on("error", (error) => {
  if (error instanceof ApplicationError) {
    Logger.error(`Application error: ${error.message}`, error)
  } else {
    Logger.error("Unexpected error", error)
  }
  logMessage(`Error: ${error.message}`, "system")
})
client.on("message", (message) => {
  if (message.error) {
    Logger.error("Server error:", message.error)
    logMessage(`Server error: ${message.error}`, "system")
  }
})

micButton.addEventListener("click", handleMicToggle)
connectButton.addEventListener("click", () => {
  if (isConnected) {
    disconnectFromWebsocket()
  } else {
    connectToWebsocket()
  }
})
messageInput.disabled = true
sendButton.disabled = true
micButton.disabled = true
connectButton.textContent = "Connect"

/**
 * Handles the video toggle. Starts or stops video streaming.
 */
async function handleVideoToggle() {
  Logger.info("Video toggle clicked, current state:", { isVideoActive, isConnected })
  if (!isVideoActive) {
    try {
      Logger.info("Attempting to start video")
      if (!videoManager) {
        videoManager = new VideoManager()
      }
      await videoManager.start((frameData) => {
        if (isConnected) {
          client.sendRealtimeInput([frameData])
        }
      })
      isVideoActive = true
      cameraIcon.textContent = "videocam_off"
      cameraButton.classList.add("active")
      Logger.info("Camera started successfully")
      logMessage("Camera started", "system")
    } catch (error) {
      Logger.error("Camera error:", error)
      logMessage(`Error: ${error.message}`, "system")
      isVideoActive = false
      videoManager = null
      cameraIcon.textContent = "videocam"
      cameraButton.classList.remove("active")
    }
  } else {
    Logger.info("Stopping video")
    stopVideo()
  }
}

/**
 * Stops the video streaming.
 */
function stopVideo() {
  if (videoManager) {
    videoManager.stop()
    videoManager = null
  }
  isVideoActive = false
  cameraIcon.textContent = "videocam"
  cameraButton.classList.remove("active")
  logMessage("Camera stopped", "system")
}

cameraButton.addEventListener("click", handleVideoToggle)
stopVideoButton.addEventListener("click", stopVideo)
cameraButton.disabled = true

/**
 * Handles the screen share toggle. Starts or stops screen sharing.
 */
async function handleScreenShare() {
  if (!isScreenSharing) {
    try {
      screenContainer.style.display = "block"
      screenRecorder = new ScreenRecorder()
      await screenRecorder.start(screenPreview, (frameData) => {
        if (isConnected) {
          client.sendRealtimeInput([
            {
              mimeType: "image/jpeg",
              data: frameData,
            },
          ])
        }
      })
      isScreenSharing = true
      screenIcon.textContent = "stop_screen_share"
      screenButton.classList.add("active")
      Logger.info("Screen sharing started")
      logMessage("Screen sharing started", "system")
    } catch (error) {
      Logger.error("Screen sharing error:", error)
      logMessage(`Error: ${error.message}`, "system")
      isScreenSharing = false
      screenIcon.textContent = "screen_share"
      screenButton.classList.remove("active")
      screenContainer.style.display = "none"
    }
  } else {
    stopScreenSharing()
  }
}

/**
 * Stops the screen sharing.
 */
function stopScreenSharing() {
  if (screenRecorder) {
    screenRecorder.stop()
    screenRecorder = null
  }
  isScreenSharing = false
  screenIcon.textContent = "screen_share"
  screenButton.classList.remove("active")
  screenContainer.style.display = "none"
  logMessage("Screen sharing stopped", "system")
}

screenButton.addEventListener("click", handleScreenShare)
screenButton.disabled = true