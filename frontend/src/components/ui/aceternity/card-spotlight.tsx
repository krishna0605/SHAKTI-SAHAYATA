"use client";

import { useMotionValue, motion, useMotionTemplate } from "framer-motion";
import type { HTMLAttributes, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const CardSpotlight = ({
  children,
  radius = 250,
  color = "#262626",
  className,
  ...props
}: {
  radius?: number;
  color?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  function handleMouseMove({
    currentTarget,
    clientX,
    clientY,
  }: ReactMouseEvent<HTMLDivElement>) {
    let { left, top } = currentTarget.getBoundingClientRect();

    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  return (
    <div
      className={cn(
        "group/spotlight p-10 rounded-xl relative border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black overflow-hidden",
        className
      )}
      onMouseMove={handleMouseMove}
      {...props}
    >
      <motion.div
        className="pointer-events-none absolute z-0 -inset-px rounded-xl opacity-0 transition duration-300 group-hover/spotlight:opacity-100"
        style={{
          background: color,
          maskImage: useMotionTemplate`
            radial-gradient(
              ${radius}px circle at ${mouseX}px ${mouseY}px,
              white,
              transparent 80%
            )
          `,
        }}
      />
      {children}
    </div>
  );
};
