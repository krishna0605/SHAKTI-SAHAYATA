"use client";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export const BackgroundBeams = ({
  className,
}: {
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "absolute inset-0 z-0 overflow-hidden pointer-events-none w-full h-full",
        className
      )}
    >
      <div className="absolute inset-0 bg-neutral-950 [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black)]"></div>
      <svg
        className="absolute inset-0 w-full h-[150%] sm:h-full stroke-neutral-800/20"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="pattern"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <path d="M0 40V0H40" fill="none" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#pattern)" />
        <motion.circle
          cx="50%"
          cy="50%"
          initial={{ r: 0, opacity: 0 }}
          animate={{ r: 800, opacity: [0, 0.5, 0] }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: "linear",
          }}
          className="stroke-blue-500/30"
          strokeWidth="1"
          fill="none"
        />
      </svg>
    </div>
  );
};
