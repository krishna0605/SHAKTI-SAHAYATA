import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

export const HoverEffect = ({
  items,
  className,
}: {
  items: {
    title: string;
    description: string;
    icon?: React.ReactNode;
  }[];
  className?: string;
}) => {
  let [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div
      className={cn(
        "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 py-10",
        className
      )}
    >
      {items.map((item, idx) => (
        <div
          key={item?.title}
          className="relative group block p-2 h-full w-full"
          onMouseEnter={() => setHoveredIndex(idx)}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <AnimatePresence>
            {hoveredIndex === idx && (
              <motion.span
                className="absolute inset-0 h-full w-full bg-neutral-200 dark:bg-slate-800/[0.8] block rounded-3xl"
                layoutId="hoverBackground"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  transition: { duration: 0.15 },
                }}
                exit={{
                  opacity: 0,
                  transition: { duration: 0.15, delay: 0.1 },
                }}
              />
            )}
          </AnimatePresence>
          <div className="relative z-50">
            <div className="p-4 bg-white dark:bg-surface-900 border border-transparent dark:border-white/[0.2] group-hover:border-slate-700 relative z-50 rounded-2xl h-full flex flex-col items-start gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-100 to-shakti-100 text-shakti-700 dark:from-blue-500/10 dark:to-shakti-500/10 dark:text-shakti-200">
                {item.icon}
              </div>
              <h4 className="text-zinc-900 dark:text-zinc-100 font-bold tracking-wide mt-2">
                {item.title}
              </h4>
              <p className="mt-2 text-zinc-600 dark:text-zinc-400 tracking-wide leading-relaxed text-sm">
                {item.description}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
