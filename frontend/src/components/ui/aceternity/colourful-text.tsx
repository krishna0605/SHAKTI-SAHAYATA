import { cn } from "@/lib/utils";

export const ColourfulText = ({
  text,
  className,
}: {
  text: string;
  className?: string;
}) => {
  return (
    <span
      className={cn(
        "bg-clip-text text-transparent bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600 dark:from-blue-400 dark:via-indigo-400 dark:to-purple-400 animate-gradient-x bg-[length:200%_auto]",
        className
      )}
    >
      {text}
    </span>
  );
};
