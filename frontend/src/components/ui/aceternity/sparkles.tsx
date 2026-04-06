"use client";
import { useEffect, useState } from "react";
import Particles, { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";
import { cn } from "@/lib/utils";

type ParticlesProps = {
  id?: string;
  className?: string;
  background?: string;
  particleSize?: number;
  minSize?: number;
  maxSize?: number;
  speed?: number;
  particleColor?: string;
  particleDensity?: number;
};
export const SparklesCore = (props: ParticlesProps) => {
  const {
    id,
    className,
    background,
    minSize,
    maxSize,
    speed,
    particleColor,
    particleDensity,
  } = props;
  const [init, setInit] = useState(false);
  useEffect(() => {
    initParticlesEngine(async (engine) => {
      await loadSlim(engine);
    }).then(() => {
      setInit(true);
    });
  }, []);

  if (!init) return null;

  return (
    <div className={cn("opacity-100", className)}>
      <Particles
        id={id || "tsparticles"}
        className={cn("h-full w-full")}
        options={{
          background: {
            color: {
              value: background || "transparent",
            },
          },
          fullScreen: {
            enable: false,
            zIndex: 1,
          },
          fpsLimit: 120,
          interactivity: {
            events: {
              onHover: {
                enable: false, // subtle/minimal setting
              },
            },
          },
          particles: {
            color: {
              value: particleColor || "#ffffff",
            },
            move: {
              enable: true,
              direction: "none",
              outModes: {
                default: "out",
              },
              random: false,
              speed: {
                min: 0.1,
                max: speed || 0.5, // 0.5 for subtle motion
              },
              straight: false,
            },
            number: {
              density: {
                enable: true,
                width: 400,
                height: 400,
              },
              value: particleDensity || 80,
            },
            opacity: {
              value: {
                min: 0.1,
                max: 0.5, // Reduced max opacity for subtle
              },
              animation: {
                enable: true,
                speed: 1, // slower shimmer
                sync: false,
              },
            },
            size: {
              value: {
                min: minSize || 0.5,
                max: maxSize || 1.5, // smaller particles
              },
            },
            shape: {
              type: "circle",
            },
          },
          detectRetina: true,
        }}
      />
    </div>
  );
};
