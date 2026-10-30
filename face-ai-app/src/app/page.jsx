"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";

const MODEL_URL = "/models";
// Keep the overlay readable by updating it several times per second instead of every video frame.
const DETECTION_INTERVAL = 240;
const BOX_SMOOTHING = 0.2;
const VIDEO_SIZE = { width: 720, height: 560 };
const VIDEO_SETTINGS = {
  width: { ideal: 720 },
  height: { ideal: 560 },
  facingMode: { ideal: "user" },
};

function getExpression(expressions = {}) {
  const [name] = Object.entries(expressions).sort((a, b) => b[1] - a[1])[0] || ["unknown"];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function describeFace(result, index) {
  const gender = result.gender === "male" ? "Man" : "Woman";
  const age = Math.max(0, Math.round(result.age));
  return {
    id: index,
    gender,
    age: `${Math.max(0, age - 2)} - ${age + 2}`,
    expression: getExpression(result.expressions),
  };
}

export default function Home() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const faceApiRef = useRef(null);
  const intervalRef = useRef(null);
  const detectingRef = useRef(false);
  const lastResultsRef = useRef([]);
  const stableAgesRef = useRef([]);
  const overlayDimensionsRef = useRef(null);
  const renderFrameRef = useRef(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [modelError, setModelError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [cameraError, setCameraError] = useState("");
  const [cameraRetryCount, setCameraRetryCount] = useState(0);
  const [latestDetections, setLatestDetections] = useState([]);
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadModels() {
      setModelsReady(false);
      setModelError("");
      try {
        const faceapi = await import("face-api.js");
        faceApiRef.current = faceapi;
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
          faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL),
        ]);
        if (!cancelled) setModelsReady(true);
      } catch (error) {
        console.error("Unable to load face analysis models:", error);
        if (!cancelled) setModelError("Models could not be loaded. Check /public/models and try again.");
      }
    }

    loadModels();
    return () => {
      cancelled = true;
    };
  }, [retryCount]);

  const runDetection = useCallback(async () => {
    const video = webcamRef.current?.video;
    const canvas = canvasRef.current;
    const faceapi = faceApiRef.current;
    if (!modelsReady || !cameraReady || !video || video.readyState !== 4 || !canvas || !faceapi || detectingRef.current) return;

    detectingRef.current = true;
    try {
      const dimensions = { width: video.videoWidth, height: video.videoHeight };
      if (!dimensions.width || !dimensions.height) return;
      faceapi.matchDimensions(canvas, dimensions);
      overlayDimensionsRef.current = dimensions;

      const results = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .withFaceExpressions()
        .withAgeAndGender();

      // Resize detector coordinates to the actual video dimensions before painting the overlay.
      const validResults = results.filter((result) => {
        const box = result.detection?.box;
        return (
          box &&
          Number.isFinite(box.x) &&
          Number.isFinite(box.y) &&
          Number.isFinite(box.width) &&
          Number.isFinite(box.height)
        );
      });
      const resizedResults = faceapi.resizeResults(validResults, dimensions);
      if (resizedResults.length > 0) {
        const previousResults = lastResultsRef.current;
        lastResultsRef.current = resizedResults.map((result, index) => {
          const currentBox = result.detection.box;
          const previousBox = previousResults[index]?.detection?.box;
          const age = stableAgesRef.current[index] ?? Math.round(result.age);
          stableAgesRef.current[index] = age;
          if (!previousBox) return result;

          const smooth = (previousValue, currentValue) =>
            previousValue + (currentValue - previousValue) * BOX_SMOOTHING;
          const box = {
            x: smooth(previousBox.x, currentBox.x),
            y: smooth(previousBox.y, currentBox.y),
            width: smooth(previousBox.width, currentBox.width),
            height: smooth(previousBox.height, currentBox.height),
          };

          return {
            ...result,
            age,
            detection: {
              ...result.detection,
              box,
            },
          };
        });
        lastResultsRef.current = lastResultsRef.current.map((result, index) => ({
          ...result,
          age: stableAgesRef.current[index],
        }));
        setLatestDetections(lastResultsRef.current.map(describeFace));
      } else {
        lastResultsRef.current = [];
        stableAgesRef.current = [];
        setLatestDetections([]);
      }
    } catch (error) {
      console.error("Face detection failed:", error);
    } finally {
      detectingRef.current = false;
    }
  }, [cameraReady, modelsReady]);

  useEffect(() => {
    if (!modelsReady || !cameraReady) return undefined;

    const renderOverlay = () => {
      const canvas = canvasRef.current;
      const dimensions = overlayDimensionsRef.current;
      const context = canvas?.getContext("2d");
      if (canvas && dimensions && context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        lastResultsRef.current.forEach((result, index) => {
          const { x, y, width, height } = result.detection.box;
          const mirroredX = dimensions.width - x - width;
          const label = describeFace(result, index);
          const lines = [
            `Gender: ${label.gender}`,
            `Age: ${label.age}`,
            `Expression: ${label.expression}`,
          ];
          const textX = mirroredX;
          const firstBaseline = y + height + 22;

          context.strokeStyle = "red";
          context.lineWidth = 3;
          context.strokeRect(mirroredX, y, width, height);
          context.font = "18px monospace";
          context.textBaseline = "alphabetic";
          const textWidth = Math.max(...lines.map((line) => context.measureText(line).width));
          context.fillStyle = "rgba(255, 255, 255, 0.88)";
          context.fillRect(textX, firstBaseline - 18, textWidth + 8, 66);
          context.fillStyle = "black";
          lines.forEach((line, lineIndex) => {
            context.fillText(line, textX, firstBaseline + lineIndex * 22);
          });
        });
      }
      renderFrameRef.current = window.requestAnimationFrame(renderOverlay);
    };

    renderFrameRef.current = window.requestAnimationFrame(renderOverlay);
    return () => {
      if (renderFrameRef.current) window.cancelAnimationFrame(renderFrameRef.current);
      renderFrameRef.current = null;
    };
  }, [cameraReady, modelsReady]);

  useEffect(() => {
    if (!modelsReady || !cameraReady) return undefined;
    intervalRef.current = window.setInterval(runDetection, DETECTION_INTERVAL);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [cameraReady, modelsReady, runDetection]);

  const retryModels = () => {
    setLatestDetections([]);
    lastResultsRef.current = [];
    stableAgesRef.current = [];
    setRetryCount((count) => count + 1);
  };

  return (
    <main className="min-h-screen bg-gray-900 px-4 py-8 text-white sm:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-700 pb-5">
          <h1 className="text-3xl font-bold">🎭 Face AI Detector</h1>
          <p className="font-mono text-xs uppercase tracking-widest text-red-400">Live analysis // client-side</p>
        </header>

        {!modelsReady && !modelError && (
          <p className="animate-pulse font-mono text-yellow-300">Loading models...</p>
        )}
        {modelError && (
          <div className="flex flex-wrap items-center gap-4 text-sm text-red-300" role="alert">
            <p>{modelError}</p>
            <button className="border border-red-400 px-3 py-2 font-mono text-white hover:bg-red-950" onClick={retryModels}>
              Retry model loading
            </button>
          </div>
        )}
        {cameraError && (
          <div className="flex flex-wrap items-center gap-4 border-l-2 border-yellow-400 bg-gray-800 px-4 py-3 text-sm text-yellow-100" role="alert">
            <p>{cameraError} Allow camera permission, then try again.</p>
            <button
              className="border border-yellow-300 px-3 py-2 font-mono text-white hover:bg-yellow-950"
              onClick={() => {
                setCameraError("");
                setCameraReady(false);
                setCameraRetryCount((count) => count + 1);
              }}
            >
              Enable camera
            </button>
          </div>
        )}

        <section aria-label="Live webcam analysis" className="w-full">
          <div
            className="camera-frame relative mx-auto overflow-hidden rounded-2xl border-4 border-gray-700 bg-black"
          >
            <Webcam
              key={cameraRetryCount}
              ref={webcamRef}
              audio={false}
              mirrored
              width={VIDEO_SIZE.width}
              height={VIDEO_SIZE.height}
              videoConstraints={VIDEO_SETTINGS}
              onUserMedia={() => {
                setCameraError("");
                setCameraReady(true);
              }}
              onUserMediaError={(error) => {
                console.error("Webcam access failed:", error);
                setCameraReady(false);
                setCameraError(
                  error?.name === "NotAllowedError"
                    ? "Camera permission was denied."
                    : error?.name === "NotFoundError"
                      ? "No camera was found."
                      : error?.name === "NotReadableError"
                        ? "The camera is already being used by another app or browser tab."
                      : "The camera could not be started.",
                );
              }}
              className="absolute inset-0 h-full w-full"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill" }}
            />
            <canvas
              ref={canvasRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                zIndex: 5,
                transform: "none",
              }}
            />
            {!cameraReady && !cameraError && (
              <div className="absolute inset-0 grid place-items-center bg-black/70 font-mono text-sm text-gray-300">
                Waiting for camera...
              </div>
            )}
          </div>
        </section>

        <section aria-label="Latest detection results" className="rounded-lg bg-gray-800 p-4 font-mono text-sm">
          <h2 className="mb-3 text-xs uppercase tracking-widest text-gray-400">Latest detection</h2>
          {latestDetections.length === 0 ? (
            <p className="text-gray-300">No faces detected.</p>
          ) : (
            <ul className="space-y-2">
              {latestDetections.map((detection) => (
                <li key={detection.id} className="grid grid-cols-1 gap-1 border-t border-gray-700 pt-2 sm:grid-cols-3">
                  <span>Gender: {detection.gender}</span>
                  <span>Age: {detection.age}</span>
                  <span>Expression: {detection.expression}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}