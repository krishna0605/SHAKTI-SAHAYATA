"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export const GlowingEffect = ({
  className,
}: {
  className?: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const { left, top } = containerRef.current.getBoundingClientRect();
      const x = e.clientX - left;
      const y = e.clientY - top;
      containerRef.current.style.setProperty("--x", `${x}px`);
      containerRef.current.style.setProperty("--y", `${y}px`);
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("mousemove", handleMouseMove);
      return () => container.removeEventListener("mousemove", handleMouseMove);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute -inset-[1px] -z-10 rounded-xl opacity-0 transition duration-300 group-hover:opacity-100",
        className
      )}
      style={
        {
          background:
            "radial-gradient(400px circle at var(--x, 0px) var(--y, 0px), rgba(255,255,255,0.1), transparent 40%)",
        } as React.CSSProperties
      }
    />
  );
};
