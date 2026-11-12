// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import type { CSSProperties } from "react";
import { getCamera, type Aspect } from "@/lib/catalog";

/** A still made with the local image model, used wherever no picture is given. */
const SAMPLE = "/sample.jpg";

interface Props {
  cameraId: string;
  /** Frame to animate. Falls back to the bundled sample picture. */
  src?: string;
  aspect?: Aspect;
  duration?: number;
  className?: string;
}

/** Plays a camera preset over a still frame using CSS transforms. */
export function MotionPlayer({ cameraId, src, aspect = "16:9", duration = 5, className = "" }: Props) {
  const cam = getCamera(cameraId);
  const layer = {
    "--cam-from": cam.from,
    "--cam-to": cam.to,
    animation: cam.animation
      ? `${cam.animation} ${duration}s ease-in-out infinite`
      : `cam ${duration}s ${cam.easing} infinite alternate`,
  } as CSSProperties;

  return (
    <div
      className={`relative overflow-hidden bg-black ${className}`}
      style={{ aspectRatio: aspect.replace(":", " / ") }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src ?? SAMPLE} alt="" className="cam-layer size-full object-cover" style={layer} />
    </div>
  );
}
