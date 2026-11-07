'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export interface QrCameraScannerProps {
  /** Invoked when a QR code payload is detected and decoded. */
  onScan: (decodedText: string) => void;
  /** Invoked when camera fails or is blocked. */
  onError?: (error: Error) => void;
  /** Whether scanning is active. Set false to pause scanning without unmounting. */
  active?: boolean;
  /** Optional callback to switch to manual code entry */
  onSwitchToManual?: () => void;
  /** Optional CSS class name */
  className?: string;
}

type CameraStatus = 'initializing' | 'active' | 'denied' | 'unsupported' | 'error';

export function QrCameraScanner({
  onScan,
  onError,
  active = true,
  onSwitchToManual,
  className = '',
}: QrCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const isScanningRef = useRef<boolean>(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [status, setStatus] = useState<CameraStatus>('initializing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState<boolean>(false);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [scanSuccess, setScanSuccess] = useState<boolean>(false);

  // Play gentle audio chime and haptic buzz on successful scan
  const playScanFeedback = useCallback(() => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([40, 60, 40]);
      }
      if (typeof window !== 'undefined') {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.15);
        }
      }
    } catch {
      // Audio or vibration unavailable in background/environment
    }
  }, []);

  const stopCamera = useCallback(() => {
    isScanningRef.current = false;
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsTorchOn(false);
  }, []);

  const handleScanSuccess = useCallback(
    (decoded: string) => {
      if (!isScanningRef.current) return;
      isScanningRef.current = false;
      setScanSuccess(true);
      playScanFeedback();
      onScanRef.current(decoded);
    },
    [playScanFeedback],
  );

  const startScanLoop = useCallback(() => {
    isScanningRef.current = true;
    let lastProcessedTime = 0;

    // Check for native BarcodeDetector support
    let nativeBarcodeDetector: { detect: (src: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> } | null = null;
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const BarcodeDetectorClass = (window as unknown as { BarcodeDetector: new (opts?: { formats: string[] }) => typeof nativeBarcodeDetector }).BarcodeDetector;
        nativeBarcodeDetector = new BarcodeDetectorClass({ formats: ['qr_code'] });
      } catch {
        nativeBarcodeDetector = null;
      }
    }

    const processFrame = async (timestamp: number) => {
      if (!isScanningRef.current) return;

      // Throttle analysis to ~10-12 checks per second (every 80-100ms) to conserve CPU & battery
      if (timestamp - lastProcessedTime > 85) {
        lastProcessedTime = timestamp;
        const video = videoRef.current;

        if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const vw = video.videoWidth;
          const vh = video.videoHeight;

          if (vw > 0 && vh > 0) {
            let decodedText: string | null = null;

            // 1. Try hardware-accelerated native BarcodeDetector if supported
            if (nativeBarcodeDetector) {
              try {
                const barcodes = await nativeBarcodeDetector.detect(video);
                if (barcodes.length > 0 && barcodes[0]?.rawValue) {
                  decodedText = barcodes[0].rawValue;
                }
              } catch {
                // Fallback to jsQR on any hardware error
              }
            }

            // 2. Fallback to pure JS jsqr decoder
            if (!decodedText) {
              let canvas = canvasRef.current;
              if (!canvas) {
                canvas = document.createElement('canvas');
                canvasRef.current = canvas;
              }

              // Downscale large 1080p/4k streams to max 640px for real-time QR parsing speed
              const scale = Math.min(1, 640 / Math.max(vw, vh));
              const cw = Math.floor(vw * scale);
              const ch = Math.floor(vh * scale);
              canvas.width = cw;
              canvas.height = ch;

              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(video, 0, 0, cw, ch);
                const imageData = ctx.getImageData(0, 0, cw, ch);
                const qr = jsQR(imageData.data, cw, ch, {
                  inversionAttempts: 'dontInvert',
                });
                if (qr && qr.data) {
                  decodedText = qr.data;
                }
              }
            }

            if (decodedText && isScanningRef.current) {
              handleScanSuccess(decodedText);
              return;
            }
          }
        }
      }

      if (isScanningRef.current) {
        animFrameRef.current = requestAnimationFrame(processFrame);
      }
    };

    animFrameRef.current = requestAnimationFrame(processFrame);
  }, [handleScanSuccess]);

  const initCamera = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      setErrorMessage('Camera access is not supported by this browser or device.');
      return;
    }

    stopCamera();
    setStatus('initializing');
    setErrorMessage(null);
    setScanSuccess(false);

    try {
      // Query video inputs to see if flip camera toggle is useful
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoInputs.length > 1);
      } catch {
        // enumeration failure is non-fatal
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      // Inspect torch support
      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          const capabilities = (track as unknown as { getCapabilities?: () => { torch?: boolean } }).getCapabilities?.();
          setHasTorch(Boolean(capabilities?.torch));
        } catch {
          setHasTorch(false);
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        setStatus('active');
        startScanLoop();
      }
    } catch (err: unknown) {
      const errorObj = err as { name?: string; message?: string };
      let friendlyMessage = 'Unable to open camera.';

      if (errorObj.name === 'NotAllowedError' || errorObj.name === 'PermissionDeniedError') {
        setStatus('denied');
        friendlyMessage = 'Camera permission was denied. Please allow camera access in your browser settings to scan QR codes.';
      } else if (errorObj.name === 'NotFoundError' || errorObj.name === 'DevicesNotFoundError') {
        setStatus('unsupported');
        friendlyMessage = 'No camera found on this device.';
      } else {
        setStatus('error');
        friendlyMessage = errorObj.message || 'Unable to start camera scanner.';
      }

      setErrorMessage(friendlyMessage);
      if (onError && err instanceof Error) {
        onError(err);
      }
    }
  }, [facingMode, onError, startScanLoop, stopCamera]);

  // Toggle flashlight/torch on supported mobile devices
  const toggleTorch = async () => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    try {
      const nextState = !isTorchOn;
      await (track as unknown as { applyConstraints: (c: { advanced: Array<{ torch: boolean }> }) => Promise<void> }).applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setIsTorchOn(nextState);
    } catch {
      // torch toggling failed
    }
  };

  // Switch between back (environment) and front (user) cameras
  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Start camera when component mounts or facingMode/active changes
  useEffect(() => {
    if (active) {
      initCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [active, facingMode, initCamera, stopCamera]);

  return (
    <div
      className={`relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-plug-border bg-plug-black p-3 sm:p-5 text-white ${className}`}
      aria-label="QR Code Camera Scanner"
    >
      {/* Viewfinder Container */}
      <div className="relative aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-neutral-950 border border-plug-border shadow-inner flex items-center justify-center">
        {/* Live Video Feed */}
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          aria-label="Camera Live Viewfinder"
          className={`h-full w-full object-cover transition-opacity duration-300 ${
            status === 'active' ? 'opacity-100' : 'opacity-20'
          }`}
        />

        {/* Viewfinder Overlay with Reticle & Brackets */}
        {status === 'active' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {/* Dark vignette mask outside target frame */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />

            {/* Target Reticle (Clear cutout box) */}
            <div
              className={`relative h-56 w-56 sm:h-64 sm:w-64 rounded-2xl border-2 transition-all duration-300 ${
                scanSuccess
                  ? 'border-emerald-400 bg-emerald-500/20 shadow-[0_0_30px_rgba(52,211,153,0.5)]'
                  : 'border-white/60 shadow-[0_0_20px_rgba(255,255,255,0.15)]'
              }`}
            >
              {/* Corner brackets */}
              <span className="absolute -top-1 -left-1 h-6 w-6 rounded-tl-lg border-t-4 border-l-4 border-white" />
              <span className="absolute -top-1 -right-1 h-6 w-6 rounded-tr-lg border-t-4 border-r-4 border-white" />
              <span className="absolute -bottom-1 -left-1 h-6 w-6 rounded-bl-lg border-b-4 border-l-4 border-white" />
              <span className="absolute -bottom-1 -right-1 h-6 w-6 rounded-br-lg border-b-4 border-r-4 border-white" />

              {/* Animated Laser Scan Beam */}
              {!scanSuccess && (
                <div
                  className="absolute inset-x-2 h-0.5 bg-gradient-to-r from-transparent via-white to-transparent shadow-[0_0_8px_#ffffff] animate-bounce"
                  style={{ animationDuration: '2s' }}
                />
              )}

              {/* Success Badge */}
              {scanSuccess && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400 text-2xl font-black text-black shadow-lg">
                    ✓
                  </span>
                  <span className="text-xs font-mono font-bold tracking-wider text-emerald-300 uppercase">
                    QR Scanned!
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading / Initializing State */}
        {status === 'initializing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-plug-black/90 p-4 text-center">
            <svg
              className="h-8 w-8 animate-spin text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <p className="text-xs font-medium text-neutral-300">Opening camera scanner...</p>
          </div>
        )}

        {/* Error / Denied / Unsupported State */}
        {(status === 'denied' || status === 'unsupported' || status === 'error') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-plug-surface p-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-lg font-bold">
              📷
            </span>
            <p className="text-sm font-semibold text-white">Camera Unavailable</p>
            <p className="text-xs leading-relaxed text-neutral-300 max-w-xs">{errorMessage}</p>

            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={initCamera}
                className="inline-flex min-h-10 items-center rounded-xl border border-white bg-white px-4 text-xs font-bold text-plug-black hover:bg-neutral-200 transition-colors"
              >
                Retry Camera
              </button>
              {onSwitchToManual && (
                <button
                  type="button"
                  onClick={onSwitchToManual}
                  className="inline-flex min-h-10 items-center rounded-xl border border-plug-border bg-plug-elevated px-4 text-xs font-semibold text-neutral-200 hover:border-white hover:text-white transition-colors"
                >
                  Enter Manually
                </button>
              )}
            </div>
          </div>
        )}

        {/* Top Floating Controls Bar */}
        {status === 'active' && (
          <div className="absolute top-3 inset-x-3 flex items-center justify-between z-10 pointer-events-auto">
            {/* Flashlight / Torch Toggle */}
            {hasTorch ? (
              <button
                type="button"
                onClick={toggleTorch}
                aria-label={isTorchOn ? 'Turn flashlight off' : 'Turn flashlight on'}
                className={`flex h-10 w-10 items-center justify-center rounded-xl border backdrop-blur-md transition-all ${
                  isTorchOn
                    ? 'border-amber-400 bg-amber-400 text-black shadow-[0_0_12px_rgba(251,191,36,0.5)]'
                    : 'border-white/30 bg-black/60 text-white hover:bg-black/80'
                }`}
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </button>
            ) : <div />}

            {/* Camera Switch / Flip Button */}
            {hasMultipleCameras && (
              <button
                type="button"
                onClick={toggleFacingMode}
                aria-label={`Switch to ${facingMode === 'environment' ? 'front' : 'rear'} camera`}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/30 bg-black/60 backdrop-blur-md text-white hover:bg-black/80 transition-all"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m3 16 4 4 4-4" />
                  <path d="M7 20V4" />
                  <path d="m21 8-4-4-4 4" />
                  <path d="M17 4v16" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Helpful Instructions & Manual Entry Option */}
      <div className="mt-4 flex flex-col items-center gap-2 text-center">
        <p className="text-xs text-plug-muted font-medium">
          Align the customer&apos;s phone QR code within the frame to scan automatically.
        </p>

        {onSwitchToManual && (
          <button
            type="button"
            onClick={onSwitchToManual}
            className="mt-1 text-xs font-mono font-semibold text-neutral-300 underline decoration-neutral-600 hover:text-white transition-colors"
          >
            Having trouble? Enter code manually
          </button>
        )}
      </div>
    </div>
  );
}

export default QrCameraScanner;

