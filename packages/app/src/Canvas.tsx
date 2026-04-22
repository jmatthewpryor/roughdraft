import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

interface CanvasProps {
  children: ReactNode;
  onPointerDownOnCanvas?: () => void;
}

interface Camera {
  x: number;
  y: number;
  z: number;
}

type PinchState = "not-sure" | "panning" | "zooming";
type ZoomGestureSource = "wheel" | "touch" | "gesture";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const MAX_WHEEL_ZOOM_STEP = 10;
const TOUCH_PAN_THRESHOLD = 16;
const TOUCH_ZOOM_THRESHOLD = 24;
const TOUCH_PAN_TO_ZOOM_THRESHOLD = 64;
const WHEEL_ZOOM_END_DELAY_MS = 48;
const ZOOM_INERTIA_DECAY = 0.012;
const MIN_ZOOM_INERTIA_VELOCITY = 0.00004;
const MAX_ZOOM_INERTIA_VELOCITY = 0.01;

const CanvasScaleContext = createContext(1);

export function useCanvasScale() {
  return useContext(CanvasScaleContext);
}

function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function Canvas({ children, onPointerDownOnCanvas }: CanvasProps) {
  const cameraRef = useRef<Camera>({ x: 0, y: 0, z: 1 });
  const [camera, setCameraState] = useState<Camera>(cameraRef.current);
  const [isPanning, setIsPanning] = useState(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const isPinchingRef = useRef(false);
  const touchPinchRef = useRef({
    state: "not-sure" as PinchState,
    initialCamera: cameraRef.current,
    initialDistance: 1,
    initialCenter: { x: 0, y: 0 },
    previousCenter: { x: 0, y: 0 },
  });
  const zoomGestureRef = useRef({
    source: null as ZoomGestureSource | null,
    velocity: 0,
    lastSampleTime: 0,
    anchor: { x: 0, y: 0 },
    wheelEndTimer: null as number | null,
  });
  const zoomMomentumRef = useRef({
    frame: null as number | null,
    velocity: 0,
    lastFrameTime: 0,
    anchor: { x: 0, y: 0 },
  });

  const setCamera = useCallback((next: Camera) => {
    cameraRef.current = next;
    setCameraState(next);
  }, []);

  const updateCamera = useCallback((updater: (prev: Camera) => Camera) => {
    const next = updater(cameraRef.current);
    setCamera(next);
  }, [setCamera]);

  const zoomAtScreenPoint = useCallback(
    (nextZoom: number, screenX: number, screenY: number) => {
      const prev = cameraRef.current;
      const zoom = clampZoom(nextZoom);

      if (zoom === prev.z) return false;

      const pageX = (screenX - prev.x) / prev.z;
      const pageY = (screenY - prev.y) / prev.z;

      setCamera({
        x: screenX - pageX * zoom,
        y: screenY - pageY * zoom,
        z: zoom,
      });

      return true;
    },
    [setCamera]
  );

  const stopZoomMomentum = useCallback(() => {
    const momentum = zoomMomentumRef.current;
    if (momentum.frame !== null) {
      cancelAnimationFrame(momentum.frame);
      momentum.frame = null;
    }
    momentum.velocity = 0;
    momentum.lastFrameTime = 0;
  }, []);

  const clearWheelZoomEndTimer = useCallback(() => {
    const gesture = zoomGestureRef.current;
    if (gesture.wheelEndTimer !== null) {
      window.clearTimeout(gesture.wheelEndTimer);
      gesture.wheelEndTimer = null;
    }
  }, []);

  const startZoomMomentum = useCallback(
    (velocity: number, anchorX: number, anchorY: number) => {
      stopZoomMomentum();

      const momentum = zoomMomentumRef.current;
      momentum.velocity = Math.max(
        -MAX_ZOOM_INERTIA_VELOCITY,
        Math.min(MAX_ZOOM_INERTIA_VELOCITY, velocity)
      );
      momentum.anchor = { x: anchorX, y: anchorY };
      momentum.lastFrameTime = 0;

      const step = (timestamp: number) => {
        const state = zoomMomentumRef.current;

        if (state.lastFrameTime === 0) {
          state.lastFrameTime = timestamp;
          state.frame = requestAnimationFrame(step);
          return;
        }

        const dt = Math.min(32, timestamp - state.lastFrameTime);
        state.lastFrameTime = timestamp;
        state.velocity *= Math.exp(-ZOOM_INERTIA_DECAY * dt);

        if (Math.abs(state.velocity) < MIN_ZOOM_INERTIA_VELOCITY) {
          stopZoomMomentum();
          return;
        }

        const currentZoom = cameraRef.current.z;
        const nextZoom = currentZoom * Math.exp(state.velocity * dt);
        const didZoom = zoomAtScreenPoint(
          nextZoom,
          state.anchor.x,
          state.anchor.y
        );

        if (!didZoom || cameraRef.current.z === currentZoom) {
          stopZoomMomentum();
          return;
        }

        state.frame = requestAnimationFrame(step);
      };

      momentum.frame = requestAnimationFrame(step);
    },
    [stopZoomMomentum, zoomAtScreenPoint]
  );

  const resetZoomGesture = useCallback(() => {
    clearWheelZoomEndTimer();
    const gesture = zoomGestureRef.current;
    gesture.source = null;
    gesture.velocity = 0;
    gesture.lastSampleTime = 0;
  }, [clearWheelZoomEndTimer]);

  const beginZoomGesture = useCallback(
    (source: ZoomGestureSource, anchorX: number, anchorY: number) => {
      stopZoomMomentum();
      clearWheelZoomEndTimer();

      const gesture = zoomGestureRef.current;
      if (gesture.source !== source) {
        gesture.velocity = 0;
        gesture.lastSampleTime = 0;
      }
      gesture.source = source;
      gesture.anchor = { x: anchorX, y: anchorY };
    },
    [clearWheelZoomEndTimer, stopZoomMomentum]
  );

  const sampleZoomGesture = useCallback(
    (
      previousZoom: number,
      nextZoom: number,
      anchorX: number,
      anchorY: number,
      timestamp: number
    ) => {
      if (previousZoom === nextZoom) return;

      const gesture = zoomGestureRef.current;
      const deltaLog = Math.log(nextZoom / previousZoom);
      if (!Number.isFinite(deltaLog)) return;

      gesture.anchor = { x: anchorX, y: anchorY };

      if (gesture.lastSampleTime > 0) {
        const dt = Math.max(1, timestamp - gesture.lastSampleTime);
        const velocity = Math.max(
          -MAX_ZOOM_INERTIA_VELOCITY,
          Math.min(MAX_ZOOM_INERTIA_VELOCITY, deltaLog / dt)
        );

        gesture.velocity =
          gesture.velocity === 0 ? velocity : gesture.velocity * 0.35 + velocity * 0.65;
      }

      gesture.lastSampleTime = timestamp;
    },
    []
  );

  const finishZoomGesture = useCallback(
    (velocityScale = 1) => {
      clearWheelZoomEndTimer();

      const gesture = zoomGestureRef.current;
      const velocity = gesture.velocity * velocityScale;
      const { x, y } = gesture.anchor;

      gesture.source = null;
      gesture.velocity = 0;
      gesture.lastSampleTime = 0;

      if (Math.abs(velocity) >= MIN_ZOOM_INERTIA_VELOCITY) {
        startZoomMomentum(velocity, x, y);
      }
    },
    [clearWheelZoomEndTimer, startZoomMomentum]
  );

  const scheduleWheelZoomEnd = useCallback(() => {
    clearWheelZoomEndTimer();
    zoomGestureRef.current.wheelEndTimer = window.setTimeout(() => {
      finishZoomGesture(0.9);
    }, WHEEL_ZOOM_END_DELAY_MS);
  }, [clearWheelZoomEndTimer, finishZoomGesture]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const canvasEl: HTMLDivElement = element;
    const doc = canvasEl.ownerDocument;

    const normalizeWheel = (event: WheelEvent) => {
      let deltaX = event.deltaX;
      let deltaY = event.deltaY;
      let deltaZ = 0;

      if (event.ctrlKey || event.metaKey) {
        const clamped = Math.min(
          MAX_WHEEL_ZOOM_STEP,
          Math.abs(deltaY)
        ) * Math.sign(deltaY);
        deltaZ = -clamped / 100;
      } else if (event.shiftKey) {
        const clamped = Math.min(
          MAX_WHEEL_ZOOM_STEP,
          Math.abs(deltaY)
        ) * Math.sign(deltaY);
        deltaZ = -clamped / 100;
        deltaY = 0;
      }

      return {
        x: -deltaX,
        y: -deltaY,
        z: deltaZ,
      };
    };

    const getTouchCenterAndDistance = (touches: TouchList | Touch[]) => {
      const [first, second] = Array.from(touches);
      const center = {
        x: (first.clientX + second.clientX) / 2,
        y: (first.clientY + second.clientY) / 2,
      };

      return {
        center,
        distance: Math.hypot(
          second.clientX - first.clientX,
          second.clientY - first.clientY
        ),
      };
    };

    const preventGesture = (e: Event) => e.preventDefault();

    let safariGestureStartZoom = cameraRef.current.z;
    const useGestureEvents =
      !/iPad|iPhone|iPod/.test(navigator.userAgent) && "GestureEvent" in window;

    canvasEl.addEventListener("wheel", handleWheel, { passive: false });

    function handleWheel(e: WheelEvent) {
      e.preventDefault();

      const rect = canvasEl.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const delta = normalizeWheel(e);

      if (delta.z !== 0) {
        beginZoomGesture("wheel", screenX, screenY);
        const previousZoom = cameraRef.current.z;
        const didZoom = zoomAtScreenPoint(
          previousZoom * (1 + delta.z),
          screenX,
          screenY
        );
        if (didZoom) {
          sampleZoomGesture(
            previousZoom,
            cameraRef.current.z,
            screenX,
            screenY,
            e.timeStamp
          );
        }
        scheduleWheelZoomEnd();
        return;
      }

      resetZoomGesture();
      stopZoomMomentum();
      updateCamera((prev) => ({
        ...prev,
        x: prev.x + delta.x,
        y: prev.y + delta.y,
      }));
    }

    function handleTouchStart(e: TouchEvent) {
      if (!(e.target instanceof Node) || !canvasEl.contains(e.target)) return;
      if (e.touches.length !== 2) return;

      e.preventDefault();
      const { center, distance } = getTouchCenterAndDistance(e.touches);
      isPinchingRef.current = true;
      setIsPanning(false);
      beginZoomGesture("touch", center.x, center.y);

      touchPinchRef.current = {
        state: "not-sure",
        initialCamera: cameraRef.current,
        initialDistance: Math.max(distance, 1),
        initialCenter: center,
        previousCenter: center,
      };
    }

    function handleTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2) return;
      if (!(e.target instanceof Node) || !canvasEl.contains(e.target)) return;

      e.preventDefault();
      const pinch = touchPinchRef.current;
      const { center, distance } = getTouchCenterAndDistance(e.touches);
      const dx = center.x - pinch.previousCenter.x;
      const dy = center.y - pinch.previousCenter.y;

      pinch.previousCenter = center;

      const touchDistance = Math.abs(distance - pinch.initialDistance);
      const originDistance = Math.hypot(
        center.x - pinch.initialCenter.x,
        center.y - pinch.initialCenter.y
      );

      if (pinch.state === "not-sure") {
        if (touchDistance > TOUCH_ZOOM_THRESHOLD) {
          pinch.state = "zooming";
        } else if (originDistance > TOUCH_PAN_THRESHOLD) {
          pinch.state = "panning";
        }
      } else if (
        pinch.state === "panning" &&
        touchDistance > TOUCH_PAN_TO_ZOOM_THRESHOLD
      ) {
        pinch.state = "zooming";
      }

      if (pinch.state === "zooming") {
        beginZoomGesture("touch", center.x, center.y);
        const previous = cameraRef.current;
        const panned = {
          ...previous,
          x: previous.x + dx,
          y: previous.y + dy,
        };
        const zoom = clampZoom(
          pinch.initialCamera.z * (distance / pinch.initialDistance)
        );
        const pageX = (center.x - panned.x) / panned.z;
        const pageY = (center.y - panned.y) / panned.z;
        const next = {
          x: center.x - pageX * zoom,
          y: center.y - pageY * zoom,
          z: zoom,
        };

        setCamera(next);
        sampleZoomGesture(previous.z, next.z, center.x, center.y, e.timeStamp);
      } else if (pinch.state === "panning") {
        updateCamera((prev) => ({
          ...prev,
          x: prev.x + dx,
          y: prev.y + dy,
        }));
      }
    }

    function handleTouchEnd() {
      if (touchPinchRef.current.state !== "not-sure" || isPinchingRef.current) {
        isPinchingRef.current = false;
      }

      if (touchPinchRef.current.state === "zooming") {
        finishZoomGesture();
      } else {
        resetZoomGesture();
      }

      if (touchPinchRef.current.state !== "not-sure") {
        touchPinchRef.current.state = "not-sure";
      }
    }

    function handleGestureStart(e: Event) {
      const ge = e as Event & {
        scale: number;
        clientX: number;
        clientY: number;
      };
      if (!(ge.target instanceof Node) || !canvasEl.contains(ge.target)) return;

      e.preventDefault();
      safariGestureStartZoom = cameraRef.current.z;
      isPinchingRef.current = true;
      setIsPanning(false);
      const rect = canvasEl.getBoundingClientRect();
      beginZoomGesture(
        "gesture",
        ge.clientX - rect.left,
        ge.clientY - rect.top
      );
    }

    function handleGestureChange(e: Event) {
      const ge = e as Event & {
        scale: number;
        clientX: number;
        clientY: number;
      };
      if (!(ge.target instanceof Node) || !canvasEl.contains(ge.target)) return;

      e.preventDefault();
      const rect = canvasEl.getBoundingClientRect();
      const screenX = ge.clientX - rect.left;
      const screenY = ge.clientY - rect.top;
      beginZoomGesture("gesture", screenX, screenY);
      const previousZoom = cameraRef.current.z;
      const didZoom = zoomAtScreenPoint(
        safariGestureStartZoom * ge.scale,
        screenX,
        screenY
      );

      if (didZoom) {
        sampleZoomGesture(
          previousZoom,
          cameraRef.current.z,
          screenX,
          screenY,
          e.timeStamp
        );
      }
    }

    function handleGestureEnd(e: Event) {
      if (!(e.target instanceof Node) || !canvasEl.contains(e.target)) return;
      e.preventDefault();
      isPinchingRef.current = false;
      finishZoomGesture();
    }

    canvasEl.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvasEl.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvasEl.addEventListener("touchend", handleTouchEnd);
    canvasEl.addEventListener("touchcancel", handleTouchEnd);

    if (useGestureEvents) {
      canvasEl.addEventListener("gesturestart", handleGestureStart);
      canvasEl.addEventListener("gesturechange", handleGestureChange);
      canvasEl.addEventListener("gestureend", handleGestureEnd);
    }

    doc.addEventListener("gesturestart", preventGesture);
    doc.addEventListener("gesturechange", preventGesture);
    doc.addEventListener("gestureend", preventGesture);

    return () => {
      canvasEl.removeEventListener("wheel", handleWheel);
      canvasEl.removeEventListener("touchstart", handleTouchStart);
      canvasEl.removeEventListener("touchmove", handleTouchMove);
      canvasEl.removeEventListener("touchend", handleTouchEnd);
      canvasEl.removeEventListener("touchcancel", handleTouchEnd);
      if (useGestureEvents) {
        canvasEl.removeEventListener("gesturestart", handleGestureStart);
        canvasEl.removeEventListener("gesturechange", handleGestureChange);
        canvasEl.removeEventListener("gestureend", handleGestureEnd);
      }
      doc.removeEventListener("gesturestart", preventGesture);
      doc.removeEventListener("gesturechange", preventGesture);
      doc.removeEventListener("gestureend", preventGesture);
      resetZoomGesture();
      stopZoomMomentum();
    };
  }, [
    beginZoomGesture,
    finishZoomGesture,
    resetZoomGesture,
    sampleZoomGesture,
    scheduleWheelZoomEnd,
    setCamera,
    stopZoomMomentum,
    updateCamera,
    zoomAtScreenPoint,
  ]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isPinchingRef.current) return;

      // Only start panning if clicking directly on the canvas container or inner div
      const target = e.target as HTMLElement;
      if (
        target.classList.contains("canvas-container") ||
        target.classList.contains("canvas-inner")
      ) {
        e.preventDefault();
        resetZoomGesture();
        stopZoomMomentum();
        setIsPanning(true);
        lastPointer.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        onPointerDownOnCanvas?.();
      }
    },
    [onPointerDownOnCanvas, resetZoomGesture, stopZoomMomentum]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanning || isPinchingRef.current) return;
      const dx = e.clientX - lastPointer.current.x;
      const dy = e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      updateCamera((prev) => ({
        ...prev,
        x: prev.x + dx,
        y: prev.y + dy,
      }));
    },
    [isPanning, updateCamera]
  );

  const handlePointerUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  return (
    <CanvasScaleContext.Provider value={camera.z}>
      <div
        ref={containerRef}
        className={`canvas-container ${isPanning ? "canvas-grabbing" : "canvas-grab"}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="canvas-inner"
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`,
            transformOrigin: "0 0",
          }}
        >
          <div className="canvas-grid" aria-hidden="true" />
          {children}
        </div>
      </div>
    </CanvasScaleContext.Provider>
  );
}
