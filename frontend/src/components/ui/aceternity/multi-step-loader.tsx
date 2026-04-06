"use client";
import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

const CheckIcon = ({ className }: { className?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={cn("w-6 h-6 ", className)}
    >
      <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
};

export const MultiStepLoader = ({
  loadingStates,
  loading,
  duration = 2000,
}: {
  loadingStates: { text: string }[];
  loading?: boolean;
  duration?: number;
}) => {
  const [currentState, setCurrentState] = useState(0);

  React.useEffect(() => {
    if (!loading) {
      setCurrentState(0);
      return;
    }
    const timeout = setTimeout(() => {
      setCurrentState((prevState) =>
        loadingStates.length - 1 === prevState ? prevState : prevState + 1
      );
    }, duration);

    return () => clearTimeout(timeout);
  }, [currentState, loading, duration, loadingStates.length]);

  return (
    <AnimatePresence>
      {loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-black/80 backdrop-blur-md"
        >
          <div className="relative max-w-sm w-full mx-4">
            <div className="flex flex-col gap-4">
              {loadingStates.map((state, index) => {
                const distance = index - currentState;
                const opacity = Math.max(1 - Math.abs(distance) * 0.4, 0);

                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ 
                      opacity: opacity, 
                      y: distance * 5, 
                      scale: index === currentState ? 1.05 : 1
                    }}
                    transition={{
                      duration: 0.5,
                    }}
                    className={cn(
                      "flex items-center gap-3",
                      index === currentState 
                        ? "text-black dark:text-white" 
                        : "text-slate-400 dark:text-slate-600"
                    )}
                  >
                    {index < currentState ? (
                      <CheckIcon className="text-emerald-500" />
                    ) : (
                      <div
                        className={cn(
                          "w-6 h-6 rounded-full border-2",
                          index === currentState
                            ? "border-blue-500 border-t-transparent animate-spin"
                            : "border-slate-300 dark:border-slate-700"
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "text-lg font-medium",
                        index === currentState && "text-blue-600 dark:text-blue-400"
                      )}
                    >
                      {state.text}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
