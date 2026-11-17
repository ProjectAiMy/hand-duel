// Camera + MediaPipe Hand Landmarker wrapper.
// MediaPipe is imported lazily so the game still works (button mode) if the CDN is unreachable.

const MP_VERSION = "0.10.14";
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
/** Camera capture sizes. Smaller frames upload to the GPU faster: less lag on slow machines. */
export const QUALITY = { low: [640, 480], medium: [1280, 720], high: [1920, 1080] };

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class CameraError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class Tracker {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.facingMode = "user";
    this.landmarker = null;
    this.connections = [];
    this.lastVideoTime = -1;
    this.numHands = 1;
    this.quality = "medium"; // capture size, see QUALITY
    this.mirrorPref = true; // show the front camera like a mirror
  }

  async loadModel() {
    const { FilesetResolver, HandLandmarker } = await import(`${MP_URL}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numHands: this.numHands,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts("GPU"));
    } catch {
      // Some mobile GPUs / browsers lack WebGL2 support for the GPU delegate.
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts("CPU"));
    }
    this.connections = HandLandmarker.HAND_CONNECTIONS;
  }

  async startCamera(facingMode = this.facingMode) {
    if (!window.isSecureContext) {
      throw new CameraError("insecure", "Camera needs HTTPS (or localhost). Open this page over https://.");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError("unsupported", "This browser can't access the camera.");
    }
    this.stopCamera();
    const [w, h] = QUALITY[this.quality] || QUALITY.medium;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode, width: { ideal: w }, height: { ideal: h } },
      });
    } catch (e) {
      const map = {
        NotAllowedError: [
          "denied",
          "Camera blocked. Click the camera / lock icon in the address bar and set Camera to Allow, then reload. " +
            "On a Mac also check System Settings → Privacy & Security → Camera and turn your browser on.",
        ],
        NotFoundError: ["notfound", "No camera was found on this device."],
        NotReadableError: ["busy", "The camera is in use by another app."],
        OverconstrainedError: ["notfound", "That camera isn't available."],
      };
      const [code, msg] = map[e.name] || ["unknown", `Couldn't start the camera (${e.name || e}).`];
      throw new CameraError(code, msg);
    }
    this.facingMode = facingMode;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.lastVideoTime = -1;
  }

  stopCamera() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  async cameraCount() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === "videoinput").length;
    } catch {
      return 1;
    }
  }

  get mirrored() {
    return this.facingMode === "user" && this.mirrorPref;
  }

  /** 1 hand for solo/online, 2 for two players sharing one camera. */
  async setNumHands(n) {
    if (this.landmarker && this.numHands !== n) await this.landmarker.setOptions({ numHands: n });
    this.numHands = n;
  }

  /**
   * Run detection on the current frame. Returns null if there's no new frame, else an
   * array of hands: { landmarks (normalised image coords, for drawing), world (metric 3D,
   * for classifying), screenX (0 = left edge of what the player sees) }.
   */
  detect(now) {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || v.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = v.currentTime;
    const res = this.landmarker.detectForVideo(v, now);
    return (res.landmarks || []).map((landmarks, i) => {
      const cx = landmarks.reduce((s, p) => s + p.x, 0) / landmarks.length;
      return {
        landmarks,
        world: res.worldLandmarks?.[i] || null,
        screenX: this.mirrored ? 1 - cx : cx,
      };
    });
  }
}
