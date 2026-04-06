import React, { useEffect, useState } from 'react';

export const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
      return savedTheme;
    }
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return systemDark ? 'dark' : 'light';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const changeTheme = (newTheme: 'light' | 'dark') => {
    setTheme(newTheme);
  };

  return (
    <div className="flex bg-slate-200/50 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 w-full max-w-[140px]">
      <button
        onClick={() => changeTheme('light')}
        className={`flex-1 flex items-center justify-center px-2 py-1 rounded-md text-xs font-bold transition-all ${
          theme === 'light'
            ? 'bg-white text-slate-800 shadow-sm'
            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
      >
        <span className="material-symbols-outlined text-[16px] mr-1.5">light_mode</span>
        Light
      </button>
      <button
        onClick={() => changeTheme('dark')}
        className={`flex-1 flex items-center justify-center px-2 py-1 rounded-md text-xs font-bold transition-all ${
          theme === 'dark'
            ? 'bg-slate-700 text-white shadow-sm'
            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
        }`}
      >
        <span className="material-symbols-outlined text-[16px] mr-1.5">dark_mode</span>
        Dark
      </button>
    </div>
  );
};
