import React, { useEffect, useMemo, useRef, useState } from 'react';
import { caseAPI } from '../lib/apis';
import { isPotentialPromptInjection, sanitizeUserText } from '../lib/security';
import { useCaseContextStore } from '../../stores/caseContextStore';
import type { ActiveCaseContext } from '../../stores/caseContextStore';
import { apiClient, getAccessToken } from '../../lib/apiClient';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
  chartSpec?: ChartSpec | null;
  chartSpecs?: ChartSpec[] | null;
  caseSuggestions?: CompactCaseSuggestion[] | null;
  suggestionMode?: 'missing_case_context' | 'irrelevant_case_question' | null;
}

interface ChatBotProps {
  caseId?: string | null;
  caseType?: string | null;
}

interface CaseSuggestion extends ActiveCaseContext {
  matchRank?: number;
}

interface CompactCaseSuggestion {
  id: string;
  caseName: string | null;
  caseNumber?: string | null;
  firNumber?: string | null;
}

type LangMode = 'auto' | 'en' | 'hi' | 'gu';

type ChartSpec = {
  type: 'line' | 'bar';
  title?: string;
  xKey: string;
  yKey: string;
  data: Array<Record<string, unknown>>;
};

type TagContext = {
  query: string;
  start: number;
  end: number;
} | null;

const ChatChart: React.FC<{ spec: ChartSpec; dark: boolean }> = ({ spec, dark }) => {
  const data = Array.isArray(spec.data) ? spec.data : [];
  if (!spec?.xKey || !spec?.yKey || data.length === 0) return null;

  const axisTick = (isDark: boolean) => ({
    fill: isDark ? 'rgba(226,232,240,0.8)' : 'rgba(51,65,85,0.85)',
    fontSize: 11
  });
  const gridStroke = (isDark: boolean) => (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)');
  const tooltipStyle = (isDark: boolean) => ({
    backgroundColor: isDark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.98)',
    border: isDark ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.12)',
    borderRadius: 10
  });

  return (
    <div className="mt-3 rounded-xl border border-slate-200/70 dark:border-white/10 bg-white/70 dark:bg-black/10 p-3">
      {spec.title ? <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">{spec.title}</div> : null}
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          {spec.type === 'bar' ? (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke(dark)} />
              <XAxis dataKey={spec.xKey} tick={axisTick(dark)} />
              <YAxis tick={axisTick(dark)} />
              <Tooltip contentStyle={tooltipStyle(dark)} />
              <Bar dataKey={spec.yKey} fill="#60a5fa" />
            </BarChart>
          ) : (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke(dark)} />
              <XAxis dataKey={spec.xKey} tick={axisTick(dark)} />
              <YAxis tick={axisTick(dark)} />
              <Tooltip contentStyle={tooltipStyle(dark)} />
              <Line type="monotone" dataKey={spec.yKey} stroke="#34d399" strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group', 'by', 'order',
  'limit', 'offset', 'count', 'sum', 'avg', 'min', 'max', 'as', 'and', 'or', 'not', 'null', 'is', 'in',
  'distinct', 'case', 'when', 'then', 'else', 'end', 'with', 'union', 'all', 'having'
]);

const copyToClipboard = async (value: string) => {
  await navigator.clipboard.writeText(value);
};

const getAuthHeaders = (): Record<string, string> => {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const fetchWithAuthRecovery = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const doFetch = () => fetch(input, {
    credentials: 'include',
    ...init,
    headers: {
      ...init.headers,
      ...getAuthHeaders()
    }
  });

  let response = await doFetch();
  if (response.status === 401) {
    const refreshed = await apiClient.refreshAccessToken(false);
    if (refreshed) {
      response = await doFetch();
    }
  }
  return response;
};

const normalizeTagToken = (suggestion: CaseSuggestion) => {
  const name = suggestion.caseName?.trim();
  if (name) return `@"${name}"`;
  if (suggestion.caseNumber) return `@${suggestion.caseNumber}`;
  return `@${suggestion.id}`;
};

const extractExplicitTagRef = (value: string) => {
  const quoted = value.match(/@"([^"]{2,})"/);
  if (quoted?.[1]) return quoted[1].trim();

  const simple = value.match(/(?:^|\s)@([a-z0-9][a-z0-9_\-\/]{1,63})\b/i);
  return simple?.[1]?.trim() || null;
};

const normalizeLookupValue = (value: string | null | undefined) =>
  String(value || '').trim().toLowerCase();

const doesTagMatchSuggestion = (tagRef: string, suggestion: CaseSuggestion | CompactCaseSuggestion) => {
  const normalizedTag = normalizeLookupValue(tagRef);
  if (!normalizedTag) return false;

  return [
    suggestion.id,
    suggestion.caseName,
    suggestion.caseNumber,
    suggestion.firNumber
  ].some((candidate) => normalizeLookupValue(candidate) === normalizedTag);
};

const getTagContext = (value: string, caret: number): TagContext => {
  const uptoCaret = value.slice(0, caret);
  const start = uptoCaret.lastIndexOf('@');
  if (start < 0) return null;

  const before = start > 0 ? uptoCaret[start - 1] : ' ';
  if (before && !/\s|[(]/.test(before)) return null;

  const token = value.slice(start, caret);
  if (/\s/.test(token.slice(1)) && !token.startsWith('@"')) return null;
  if (token.startsWith('@"') && token.indexOf('"', 2) >= 0) return null;

  return {
    query: token.slice(1).replace(/^"/, ''),
    start,
    end: caret
  };
};

const inlineFormat = (text: string): React.ReactNode[] => {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return tokens.map((token, idx) => {
    if (token.startsWith('**') && token.endsWith('**')) return <strong key={`b-${idx}`}>{token.slice(2, -2)}</strong>;
    if (token.startsWith('`') && token.endsWith('`')) return <code key={`c-${idx}`} className="chat-inline-code">{token.slice(1, -1)}</code>;
    return <React.Fragment key={`t-${idx}`}>{token}</React.Fragment>;
  });
};

const isTableSeparator = (line: string) => /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());

const CopyIconButton: React.FC<{ onClick: () => void; copied: boolean; title: string }> = ({ onClick, copied, title }) => (
  <button type="button" className="chat-copy-btn" onClick={onClick} title={title}>
    <span className="material-symbols-outlined text-[15px]">{copied ? 'check' : 'content_copy'}</span>
  </button>
);

const SqlHighlight: React.FC<{ code: string }> = ({ code }) => (
  <>
    {code.split('\n').map((row, rowIdx) => {
      const parts = row.split(/(\s+|--.*$|'[^']*'|"(?:[^"]*)")/g).filter(Boolean);
      return (
        <div key={`sql-row-${rowIdx}`}>
          {parts.map((part, idx) => {
            const lower = part.toLowerCase();
            if (/^--/.test(part)) return <span key={`p-${rowIdx}-${idx}`} className="chat-sql-comment">{part}</span>;
            if (/^'.*'$/.test(part) || /^".*"$/.test(part)) return <span key={`p-${rowIdx}-${idx}`} className="chat-sql-string">{part}</span>;
            if (SQL_KEYWORDS.has(lower)) return <span key={`p-${rowIdx}-${idx}`} className="chat-sql-keyword">{part}</span>;
            if (/^\d+(\.\d+)?$/.test(part)) return <span key={`p-${rowIdx}-${idx}`} className="chat-sql-number">{part}</span>;
            return <span key={`p-${rowIdx}-${idx}`}>{part}</span>;
          })}
        </div>
      );
    })}
  </>
);

const CodeBlock: React.FC<{ language?: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);
  const isSql = (language || '').toLowerCase() === 'sql';

  const onCopy = async () => {
    await copyToClipboard(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1000);
  };

  return (
    <div className="chat-code-wrap">
      <div className="chat-code-top">
        <span className="chat-code-lang">{language || 'text'}</span>
        <CopyIconButton onClick={onCopy} copied={copied} title="Copy code" />
      </div>
      <pre className="chat-code-block">
        <code>{isSql ? <SqlHighlight code={code} /> : code}</code>
      </pre>
    </div>
  );
};

const TableBlock: React.FC<{ header: string[]; rows: string[][] }> = ({ header, rows }) => {
  const [copied, setCopied] = useState(false);
  const markdown = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');

  const onCopy = async () => {
    await copyToClipboard(markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1000);
  };

  return (
    <div className="chat-table-wrap">
      <div className="chat-table-top">
        <span>Table</span>
        <CopyIconButton onClick={onCopy} copied={copied} title="Copy table" />
      </div>
      <table className="chat-table">
        <thead>
          <tr>{header.map((h, idx) => <th key={`h-${idx}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rIdx) => (
            <tr key={`r-${rIdx}`}>
              {row.map((cell, cIdx) => <td key={`c-${rIdx}-${cIdx}`}>{inlineFormat(cell)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ChatCasePickerCard: React.FC<{
  suggestions: CompactCaseSuggestion[];
  dark: boolean;
  onSelect: (suggestion: CompactCaseSuggestion) => void;
}> = ({ suggestions, dark, onSelect }) => {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return null;

  return (
    <div className={`mt-3 rounded-xl border overflow-hidden ${dark ? 'border-white/10 bg-slate-900/70' : 'border-slate-200 bg-slate-50/90'}`}>
      <div className={`grid grid-cols-[72px_minmax(0,1.8fr)_minmax(0,1.3fr)_minmax(0,1.2fr)] text-[11px] font-semibold uppercase tracking-[0.08em] ${dark ? 'bg-slate-950/80 text-slate-400' : 'bg-white text-slate-500'}`}>
        <div className="px-3 py-2">ID</div>
        <div className="px-3 py-2">Case Name</div>
        <div className="px-3 py-2">Case Number</div>
        <div className="px-3 py-2">FIR Number</div>
      </div>
      <div>
        {suggestions.map((suggestion) => (
          <button
            key={`case-card-${suggestion.id}-${suggestion.caseNumber || suggestion.caseName || 'case'}`}
            type="button"
            onClick={() => onSelect(suggestion)}
            className={`grid w-full grid-cols-[72px_minmax(0,1.8fr)_minmax(0,1.3fr)_minmax(0,1.2fr)] text-left transition ${
              dark ? 'border-t border-white/5 hover:bg-blue-500/10' : 'border-t border-slate-200 hover:bg-blue-50'
            }`}
          >
            <div className="px-3 py-2 text-xs font-medium">{suggestion.id}</div>
            <div className="px-3 py-2 text-xs truncate">{suggestion.caseName || `Case ${suggestion.id}`}</div>
            <div className="px-3 py-2 text-xs truncate">{suggestion.caseNumber || 'N/A'}</div>
            <div className="px-3 py-2 text-xs truncate">{suggestion.firNumber || 'N/A'}</div>
          </button>
        ))}
      </div>
      <div className={`px-3 py-3 border-t ${dark ? 'border-white/10' : 'border-slate-200'}`}>
        <div className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Quick Tag</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={`quick-tag-${suggestion.id}`}
              type="button"
              onClick={() => onSelect(suggestion)}
              className={`rounded-full px-3 py-1 text-xs border transition ${
                dark
                  ? 'border-blue-400/20 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20'
                  : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
              }`}
            >
              @{suggestion.caseName || suggestion.caseNumber || suggestion.id}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const renderRichMessage = (text: string) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const chunk: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        chunk.push(lines[i]);
        i += 1;
      }
      i += 1;
      nodes.push(<CodeBlock key={`cb-${i}`} language={language} code={chunk.join('\n')} />);
      continue;
    }

    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim().split('|').map((c) => c.trim()).filter(Boolean));
        i += 1;
      }
      nodes.push(<TableBlock key={`tb-${i}`} header={header} rows={rows} />);
      continue;
    }

    if (trimmed.startsWith('### ')) {
      nodes.push(<h3 key={`h3-${i}`} className="chat-h3">{inlineFormat(trimmed.slice(4))}</h3>);
      i += 1;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      nodes.push(<h2 key={`h2-${i}`} className="chat-h2">{inlineFormat(trimmed.slice(3))}</h2>);
      i += 1;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      nodes.push(<h1 key={`h1-${i}`} className="chat-h1">{inlineFormat(trimmed.slice(2))}</h1>);
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
        i += 1;
      }
      nodes.push(<ul key={`ul-${i}`} className="chat-ul">{items.map((item, idx) => <li key={`li-${idx}`}>{inlineFormat(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      nodes.push(<ol key={`ol-${i}`} className="chat-ol">{items.map((item, idx) => <li key={`oi-${idx}`}>{inlineFormat(item)}</li>)}</ol>);
      continue;
    }

    nodes.push(<p key={`p-${i}`} className="chat-p">{inlineFormat(trimmed)}</p>);
    i += 1;
  }

  return nodes.length > 0 ? nodes : <p className="chat-p">{text}</p>;
};

const toActiveCaseSuggestion = (suggestion: CompactCaseSuggestion): CaseSuggestion => ({
  id: suggestion.id,
  caseName: suggestion.caseName || suggestion.caseNumber || `Case ${suggestion.id}`,
  caseNumber: suggestion.caseNumber || null,
  firNumber: suggestion.firNumber || null,
  caseType: null,
  operator: null,
  status: null,
  createdAt: null,
  updatedAt: null,
  hasFiles: false,
  availability: null,
  locked: true
});

const toResolvedActiveCase = (suggestion: CaseSuggestion): ActiveCaseContext => ({
  id: suggestion.id,
  caseName: suggestion.caseName,
  caseNumber: suggestion.caseNumber,
  firNumber: suggestion.firNumber,
  caseType: suggestion.caseType ?? null,
  operator: suggestion.operator ?? null,
  status: suggestion.status ?? null,
  createdAt: suggestion.createdAt ?? null,
  updatedAt: suggestion.updatedAt ?? null,
  hasFiles: suggestion.hasFiles ?? false,
  availability: suggestion.availability ?? null,
  locked: true
});

export const ChatBot: React.FC<ChatBotProps> = ({ caseId, caseType }) => {
  const activeCase = useCaseContextStore((state) => state.activeCase);
  const setActiveCase = useCaseContextStore((state) => state.setActiveCase);
  const clearActiveCase = useCaseContextStore((state) => state.clearActiveCase);
  const [isOpen, setIsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true;
    return document.documentElement.classList.contains('dark');
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: 'I can help you find the right module (CDR, SDR, IPDR, graphs, map view, AI tools) and troubleshoot common issues. What are you trying to do?',
      sender: 'bot',
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [caseSuggestions, setCaseSuggestions] = useState<CaseSuggestion[]>([]);
  const [caseSuggestionIndex, setCaseSuggestionIndex] = useState(0);
  const [caseSuggestionOpen, setCaseSuggestionOpen] = useState(false);
  const [isSearchingCases, setIsSearchingCases] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [preferredLanguage, setPreferredLanguage] = useState<LangMode>(() => {
    const saved = localStorage.getItem('chatbot_language_mode');
    return saved === 'en' || saved === 'hi' || saved === 'gu' ? saved : 'auto';
  });
  const [panelSize, setPanelSize] = useState<{ width: number; height: number }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('chatbot_panel_size') || '{}');
      const w = Number(saved?.width);
      const h = Number(saved?.height);
      if (Number.isFinite(w) && Number.isFinite(h)) return { width: Math.max(380, w), height: Math.max(460, h) };
    } catch {
      // ignore
    }
    return { width: 430, height: 560 };
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Keep in sync with ThemeToggle which toggles `documentElement.classList`.
    const update = () => setIsDarkTheme(document.documentElement.classList.contains('dark'));
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionBoxRef = useRef<HTMLDivElement>(null);
  const streamTimerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const resizingRef = useRef<{ active: boolean; startX: number; startY: number; startW: number; startH: number }>({
    active: false,
    startX: 0,
    startY: 0,
    startW: 0,
    startH: 0,
  });

  const resolveChatbotUrl = () => {
    const envChatbotUrl = import.meta.env.VITE_CHATBOT_URL?.trim();
    const envApiUrl = import.meta.env.VITE_API_URL?.trim();

    if (typeof window === 'undefined') return envChatbotUrl || `${envApiUrl || 'http://localhost:3001'}/api/chatbot/intent`;

    const host = window.location.hostname;
    const isLanAccess = host !== 'localhost' && host !== '127.0.0.1';
    const localhostPattern = /localhost|127\.0\.0\.1/i;
    const chatbotEnvIsLocalhost = !!envChatbotUrl && localhostPattern.test(envChatbotUrl);

    if (envChatbotUrl && !(isLanAccess && chatbotEnvIsLocalhost)) return envChatbotUrl;
    if (envApiUrl && !(isLanAccess && localhostPattern.test(envApiUrl))) return `${envApiUrl}/api/chatbot/intent`;
    return `${window.location.protocol}//${host}:3001/api/chatbot/intent`;
  };

  const chatbotUrl = resolveChatbotUrl();
  const chatbotStreamUrl = useMemo(() => chatbotUrl.replace(/\/api\/chatbot\/intent$/i, '/api/chatbot/intent/stream'), [chatbotUrl]);
  const diagnosticsUrl = useMemo(() => chatbotUrl.replace(/\/api\/chatbot\/intent$/i, '/api/chatbot/diagnostics'), [chatbotUrl]);
  const ragPreviewUrl = useMemo(() => chatbotUrl.replace(/\/api\/chatbot\/intent$/i, '/api/chatbot/rag/preview'), [chatbotUrl]);
  const chatbotSessionBaseUrl = useMemo(() => chatbotUrl.replace(/\/api\/chatbot\/intent$/i, '/api/chatbot/session'), [chatbotUrl]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('chatbot_language_mode', preferredLanguage);
  }, [preferredLanguage]);

  useEffect(() => {
    localStorage.setItem('chatbot_panel_size', JSON.stringify(panelSize));
  }, [panelSize]);

  useEffect(() => () => {
    if (streamTimerRef.current) window.clearInterval(streamTimerRef.current);
    abortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!caseSuggestionOpen) return;
      const target = event.target as Node | null;
      if (suggestionBoxRef.current?.contains(target) || inputRef.current?.contains(target)) return;
      setCaseSuggestionOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [caseSuggestionOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const input = inputRef.current;
    const caret = input?.selectionStart ?? inputValue.length;
    const tagContext = getTagContext(inputValue, caret);

    if (!tagContext) {
      setCaseSuggestions([]);
      setCaseSuggestionOpen(false);
      setCaseSuggestionIndex(0);
      return;
    }

    let cancelled = false;
    setIsSearchingCases(true);

    void caseAPI.search(tagContext.query, 8)
      .then((payload) => {
        if (cancelled) return;
        const suggestions = Array.isArray(payload?.data) ? payload.data as CaseSuggestion[] : [];
        setCaseSuggestions(suggestions);
        setCaseSuggestionOpen(true);
        setCaseSuggestionIndex(0);
      })
      .catch(() => {
        if (cancelled) return;
        setCaseSuggestions([]);
        setCaseSuggestionOpen(true);
        setCaseSuggestionIndex(0);
      })
      .finally(() => {
        if (!cancelled) setIsSearchingCases(false);
      });

    return () => {
      cancelled = true;
    };
  }, [inputValue, isOpen]);

  const stopStreaming = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (streamTimerRef.current) {
      window.clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    setIsStreaming(false);
  };

  const isBusy = isTyping || isStreaming || isSending;

  const streamAssistantReply = (
    fullText: string,
    charts: { chartSpec?: ChartSpec | null; chartSpecs?: ChartSpec[] | null } = {},
    meta: { caseSuggestions?: CompactCaseSuggestion[] | null; suggestionMode?: Message['suggestionMode'] } = {}
  ) => {
    stopStreaming();
    setIsStreaming(true);
    const id = `${Date.now()}-bot`;
    const chunks = fullText.match(/(\S+\s*|\n)/g) || [fullText];

    setMessages((prev) => [
      ...prev,
      {
        id,
        text: '',
        sender: 'bot',
        timestamp: new Date(),
        chartSpec: charts.chartSpec || null,
        chartSpecs: charts.chartSpecs || null,
        caseSuggestions: meta.caseSuggestions || null,
        suggestionMode: meta.suggestionMode || null
      }
    ]);

    let index = 0;
    streamTimerRef.current = window.setInterval(() => {
      index += 1;
      const nextText = chunks.slice(0, index).join('');
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: nextText } : m)));
      if (index >= chunks.length) {
        stopStreaming();
      }
    }, 14);
  };

  const startResize = (e: React.MouseEvent) => {
    if (isFullscreen) return;
    resizingRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startW: panelSize.width,
      startH: panelSize.height,
    };

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current.active) return;
      const dx = ev.clientX - resizingRef.current.startX;
      const dy = ev.clientY - resizingRef.current.startY;
      const maxW = Math.max(400, window.innerWidth - 24);
      const maxH = Math.max(460, window.innerHeight - 24);
      setPanelSize({
        width: Math.min(maxW, Math.max(380, resizingRef.current.startW + dx)),
        height: Math.min(maxH, Math.max(460, resizingRef.current.startH + dy)),
      });
    };

    const onUp = () => {
      resizingRef.current.active = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleCopyMessage = async (msg: Message) => {
    await copyToClipboard(msg.text);
  };

  const resetServerSession = async (existingSessionId: string | null) => {
    if (!existingSessionId) return;
    try {
      await fetchWithAuthRecovery(`${chatbotSessionBaseUrl}/${encodeURIComponent(existingSessionId)}`, {
        method: 'DELETE',
      });
    } catch {
      // Best effort only: we still clear the local session id.
    }
  };

  const applyCaseSuggestion = (suggestion: CaseSuggestion) => {
    const input = inputRef.current;
    const caret = input?.selectionStart ?? inputValue.length;
    const tagContext = getTagContext(inputValue, caret);
    const token = normalizeTagToken(suggestion);

    if (!tagContext) {
      setInputValue((prev) => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${token} `);
    } else {
      const nextValue = `${inputValue.slice(0, tagContext.start)}${token} ${inputValue.slice(tagContext.end)}`;
      setInputValue(nextValue);
      window.setTimeout(() => {
        const nextCaret = tagContext.start + token.length + 1;
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(nextCaret, nextCaret);
      }, 0);
    }

    setActiveCase({
      id: suggestion.id,
      caseName: suggestion.caseName,
      caseNumber: suggestion.caseNumber,
      firNumber: suggestion.firNumber,
      caseType: suggestion.caseType,
      operator: suggestion.operator,
      status: suggestion.status,
      createdAt: suggestion.createdAt,
      updatedAt: suggestion.updatedAt,
      hasFiles: suggestion.hasFiles,
      availability: suggestion.availability || null,
      locked: true
    });
    setCaseSuggestionOpen(false);
    setCaseSuggestions([]);
    setCaseSuggestionIndex(0);
  };

  const applyCompactCaseSuggestion = (suggestion: CompactCaseSuggestion) => {
    applyCaseSuggestion(toActiveCaseSuggestion(suggestion));
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!caseSuggestionOpen) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void handleSendMessage();
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCaseSuggestionIndex((prev) => (prev + 1) % Math.max(caseSuggestions.length, 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCaseSuggestionIndex((prev) => (prev - 1 + Math.max(caseSuggestions.length, 1)) % Math.max(caseSuggestions.length, 1));
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setCaseSuggestionOpen(false);
      return;
    }

    if (event.key === 'Enter') {
      if (caseSuggestions.length > 0) {
        event.preventDefault();
        applyCaseSuggestion(caseSuggestions[caseSuggestionIndex] || caseSuggestions[0]);
      }
    }
  };

  const handleSendMessage = async () => {
    if (isBusy) return;
    const trimmed = sanitizeUserText(inputValue, 4000).trim();
    if (!trimmed) return;
    const explicitTagRef = extractExplicitTagRef(trimmed);

    const isDiagnosticsCommand = /^\/(diag|diagnostics)\b/i.test(trimmed);
    const ragMatch = trimmed.match(/^\/rag\b\s*(.*)$/i);
    const isRagPreviewCommand = !!ragMatch;

    if (isPotentialPromptInjection(trimmed)) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), text: trimmed, sender: 'user', timestamp: new Date() },
        {
          id: `${Date.now()}-blocked`,
          text: '### SHAKTI SAHAYATA AI\n\nRequest blocked by security policy. Please rephrase without asking to reveal hidden prompts, secrets, or to bypass safety rules.',
          sender: 'bot',
          timestamp: new Date()
        }
      ]);
      setInputValue('');
      return;
    }

    setMessages((prev) => [...prev, { id: Date.now().toString(), text: trimmed, sender: 'user', timestamp: new Date() }]);
    setInputValue('');
    setIsTyping(true);
    setIsSending(true);

    try {
      const previousActiveCaseId = activeCase?.id || null;
      let requestCase: ActiveCaseContext | null = null;
      if (explicitTagRef) {
        try {
          const payload = await caseAPI.search(explicitTagRef, 8);
          const suggestions = Array.isArray(payload?.data) ? payload.data as CaseSuggestion[] : [];
          const exactMatch = suggestions.find((suggestion) => doesTagMatchSuggestion(explicitTagRef, suggestion));
          const resolvedSuggestion = exactMatch || suggestions[0] || null;

          if (resolvedSuggestion) {
            const resolvedCase = toResolvedActiveCase(resolvedSuggestion);
            requestCase = resolvedCase;
            setActiveCase(resolvedCase);
          } else {
            requestCase = null;
            clearActiveCase();
          }
        } catch {
          requestCase = null;
          clearActiveCase();
        }
      }

      const requestCaseId = explicitTagRef ? (requestCase?.id || caseId || null) : null;
      const requestCaseType = explicitTagRef ? (requestCase?.caseType || caseType || null) : null;
      const shouldResetSession =
        !explicitTagRef
        || (previousActiveCaseId && requestCaseId && previousActiveCaseId !== requestCaseId);

      let nextSessionId = sessionId;
      if (shouldResetSession && sessionId) {
        await resetServerSession(sessionId);
        nextSessionId = null;
        setSessionId(null);
      }

      if (isDiagnosticsCommand) {
        const res = await fetchWithAuthRecovery(diagnosticsUrl, { method: 'GET' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => ({}));
        const replyText = `### SHAKTI SAHAYATA AI\n\n**Diagnostics**\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
        streamAssistantReply(replyText);
        return;
      }

      if (isRagPreviewCommand) {
        const q = String(ragMatch?.[1] || '').trim();
        if (!q) {
          streamAssistantReply('### SHAKTI SAHAYATA AI\n\nUsage: `/rag <your question>`');
          return;
        }
        const res = await fetchWithAuthRecovery(`${ragPreviewUrl}?q=${encodeURIComponent(q)}`, { method: 'GET' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => ({}));
        const replyText = `### SHAKTI SAHAYATA AI\n\n**RAG Preview**\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
        streamAssistantReply(replyText);
        return;
      }

      const botMessageId = `${Date.now()}-bot`;
      setMessages((prev) => [
        ...prev,
        {
          id: botMessageId,
          text: '',
          sender: 'bot',
          timestamp: new Date(),
          chartSpec: null,
          chartSpecs: null,
          caseSuggestions: null,
          suggestionMode: null
        }
      ]);

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsStreaming(true);

      const res = await fetchWithAuthRecovery(chatbotStreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          query: trimmed,
          sessionId: nextSessionId,
          case_id: requestCaseId,
          case_name: explicitTagRef ? requestCase?.caseName || null : null,
          case_type: requestCaseType,
          preferredLanguage: preferredLanguage === 'auto' ? null : preferredLanguage,
          stream: true
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      if (!res.body) {
        throw new Error('Streaming response is unavailable.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamedText = '';
      let completed = false;

      const updateBotMessage = (patch: Partial<Message>) => {
        setMessages((prev) => prev.map((msg) => (msg.id === botMessageId ? { ...msg, ...patch } : msg)));
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const rawLine = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (rawLine) {
            let event: any;
            try {
              event = JSON.parse(rawLine);
            } catch {
              newlineIndex = buffer.indexOf('\n');
              continue;
            }
            if (event.type === 'session' && typeof event.sessionId === 'string' && event.sessionId) {
              setSessionId(event.sessionId);
            } else if (event.type === 'delta') {
              streamedText += String(event.delta || '');
              updateBotMessage({ text: streamedText });
            } else if (event.type === 'complete') {
              completed = true;
              if (typeof event.sessionId === 'string' && event.sessionId) setSessionId(event.sessionId);
              updateBotMessage({
                text: event.response || streamedText || 'I could not generate a response for that query.',
                chartSpec: event.chartSpec || null,
                chartSpecs: event.chartSpecs || null,
                caseSuggestions: Array.isArray(event.caseSuggestions) ? event.caseSuggestions as CompactCaseSuggestion[] : null,
                suggestionMode: event.suggestionMode || null
              });
            }
          }
          newlineIndex = buffer.indexOf('\n');
        }
      }

      if (!completed && buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          if (event.type === 'complete') {
            if (typeof event.sessionId === 'string' && event.sessionId) setSessionId(event.sessionId);
            setMessages((prev) => prev.map((msg) => (msg.id === botMessageId ? {
              ...msg,
              text: event.response || streamedText || 'I could not generate a response for that query.',
              chartSpec: event.chartSpec || null,
              chartSpecs: event.chartSpecs || null,
              caseSuggestions: Array.isArray(event.caseSuggestions) ? event.caseSuggestions as CompactCaseSuggestion[] : null,
              suggestionMode: event.suggestionMode || null
            } : msg)));
            completed = true;
          }
        } catch {
          // ignore incomplete tail
        }
      }

      if (!completed) {
        setMessages((prev) => prev.map((msg) => (msg.id === botMessageId ? {
          ...msg,
          text: streamedText || 'I could not generate a response for that query.'
        } : msg)));
      }
    } catch (error) {
      const aborted = (error as Error)?.name === 'AbortError';
      setMessages((prev) => [
        ...prev.filter((msg, index, arr) => !(index === arr.length - 1 && msg.sender === 'bot' && !msg.text)),
        {
          id: `${Date.now()}-error`,
          text: aborted ? '### SHAKTI SAHAYATA AI\n\nResponse stopped.' : ((error as Error).message || 'Chatbot service is unavailable right now.'),
          sender: 'bot',
          timestamp: new Date()
        },
      ]);
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setIsTyping(false);
      setIsSending(false);
    }
  };

  const panelClass = useMemo(
    () =>
      isDarkTheme
        ? 'bg-gradient-to-b from-slate-900/95 to-slate-950/95 border border-white/10 text-slate-100'
        : 'bg-gradient-to-b from-white to-slate-100 border border-slate-200 text-slate-800',
    [isDarkTheme]
  );

  return (
    <div className={`fixed z-50 ${isFullscreen ? 'inset-0 p-4' : 'bottom-6 right-6'}`}>
      {isOpen && (
        <div
          className={`mb-3 overflow-hidden backdrop-blur-xl shadow-2xl flex flex-col rounded-2xl relative ${panelClass} ${isFullscreen ? 'w-full h-full' : ''}`}
          style={!isFullscreen ? { width: panelSize.width, height: panelSize.height } : undefined}
        >
          <div className={`px-4 py-3 flex items-center justify-between border-b ${isDarkTheme ? 'border-white/10' : 'border-slate-200'}`}>
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-md flex items-center justify-center ${isDarkTheme ? 'bg-blue-500/15' : 'bg-blue-100'}`}>
                <span className="material-symbols-outlined text-blue-500 text-[20px]">smart_toy</span>
              </div>
              <div>
                <div className="text-sm font-semibold">SHAKTI SAHAYATA</div>
                <div className={`text-[11px] ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Online • Navigation and troubleshooting</div>
                {activeCase ? (
                  <div className={`mt-1 inline-flex items-center gap-2 rounded-full px-2 py-1 text-[10px] ${isDarkTheme ? 'bg-blue-500/15 text-blue-200' : 'bg-blue-100 text-blue-700'}`}>
                    <span className="material-symbols-outlined text-[13px]">gavel</span>
                    <span>{activeCase.caseNumber || activeCase.caseName}</span>
                    <button
                      type="button"
                      onClick={() => {
                        void resetServerSession(sessionId);
                        setSessionId(null);
                        clearActiveCase();
                      }}
                      className={`rounded-full px-1.5 py-0.5 ${isDarkTheme ? 'bg-slate-800 text-slate-200' : 'bg-white text-slate-600'}`}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={preferredLanguage}
                onChange={(e) => setPreferredLanguage(e.target.value as LangMode)}
                className={`text-xs rounded-md px-2 py-1 border focus:outline-none ${isDarkTheme ? 'bg-slate-800 text-slate-100 border-white/10' : 'bg-white text-slate-700 border-slate-300'}`}
              >
                <option value="auto">Auto</option>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="gu">Gujarati</option>
              </select>

              {isStreaming ? (
                <button
                  type="button"
                  onClick={stopStreaming}
                  className={`text-xs rounded-md px-2 py-1 border ${isDarkTheme ? 'bg-rose-900/30 text-rose-200 border-rose-400/20' : 'bg-rose-50 text-rose-700 border-rose-200'}`}
                >
                  Stop
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => setIsFullscreen((prev) => !prev)}
                className={`w-8 h-8 rounded-md flex items-center justify-center ${isDarkTheme ? 'hover:bg-white/10' : 'hover:bg-slate-200'}`}
                title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                <span className="material-symbols-outlined text-[18px]">{isFullscreen ? 'close_fullscreen' : 'open_in_full'}</span>
              </button>
            </div>
          </div>

          <div className={`px-4 py-2 flex gap-2 flex-wrap border-b ${isDarkTheme ? 'border-white/10' : 'border-slate-200'}`}>
            {[ 
              { label: 'FIR Summary', query: 'FIR 3 summary' },
              { label: 'CDR FIR', query: 'open CDR FIR #3' },
              { label: 'SQL Mode', query: '/sql SELECT COUNT(*) FROM cdr_records' },
              { label: 'Risk Predict', query: 'predict criminal activities for FIR 3' }
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setInputValue(item.query)}
                disabled={isBusy}
                className={`px-3 py-1 text-xs rounded-full border ${isDarkTheme ? 'bg-slate-800/70 text-slate-300 border-white/10 hover:bg-slate-700/70' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 custom-scrollbar">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[92%] px-4 py-3 rounded-2xl relative ${
                    msg.sender === 'user'
                      ? 'bg-blue-600 text-white text-[14px] leading-6'
                      : `${isDarkTheme ? 'bg-slate-800/80 border-white/10 text-slate-100' : 'bg-white border-slate-200 text-slate-800'} border chat-prose text-[14px] leading-6`
                  }`}
                >
                  {msg.sender === 'bot' ? (
                    <>
                      <button
                        type="button"
                        className="chat-msg-copy-btn"
                        onClick={() => handleCopyMessage(msg)}
                        title="Copy message"
                      >
                        <span className="material-symbols-outlined text-[15px]">content_copy</span>
                      </button>
                      {renderRichMessage(msg.text)}
                      {msg.suggestionMode === 'missing_case_context' && Array.isArray(msg.caseSuggestions) && msg.caseSuggestions.length > 0 ? (
                        <ChatCasePickerCard
                          suggestions={msg.caseSuggestions}
                          dark={isDarkTheme}
                          onSelect={applyCompactCaseSuggestion}
                        />
                      ) : null}
                      {Array.isArray(msg.chartSpecs) && msg.chartSpecs.length > 0
                        ? msg.chartSpecs.map((spec, idx) => <ChatChart key={`${msg.id}-ch-${idx}`} spec={spec} dark={isDarkTheme} />)
                        : (msg.chartSpec ? <ChatChart spec={msg.chartSpec} dark={isDarkTheme} /> : null)}
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap m-0">{msg.text}</p>
                  )}
                  <div className={`text-[10px] mt-1 text-right ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className={`px-4 py-2 rounded-xl border flex gap-1 ${isDarkTheme ? 'bg-slate-800/80 border-white/10' : 'bg-white border-slate-200'}`}>
                  <span className={`w-2 h-2 rounded-full animate-bounce ${isDarkTheme ? 'bg-slate-400' : 'bg-slate-500'}`} />
                  <span className={`w-2 h-2 rounded-full animate-bounce delay-150 ${isDarkTheme ? 'bg-slate-400' : 'bg-slate-500'}`} />
                  <span className={`w-2 h-2 rounded-full animate-bounce delay-300 ${isDarkTheme ? 'bg-slate-400' : 'bg-slate-500'}`} />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className={`p-3 border-t ${isDarkTheme ? 'border-white/10 bg-slate-900/80' : 'border-slate-200 bg-slate-50/90'}`}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex gap-2 items-center"
            >
              <div className="relative flex-1">
                <input
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder={activeCase ? 'Tag the case again in this message using @ before asking...' : 'Tag a case in this message using @ before asking a case question...'}
                  disabled={isBusy}
                  className={`w-full rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-1 ${
                    isDarkTheme
                      ? 'bg-slate-800/80 text-slate-200 placeholder-slate-500 focus:ring-blue-500'
                      : 'bg-white text-slate-900 placeholder-slate-400 border border-slate-300 focus:ring-blue-400'
                  }`}
                />
                {caseSuggestionOpen ? (
                  <div
                    ref={suggestionBoxRef}
                    className={`absolute left-0 right-0 bottom-[calc(100%+0.5rem)] rounded-xl border shadow-xl overflow-hidden z-20 ${
                      isDarkTheme ? 'bg-slate-900 border-white/10' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className={`px-3 py-2 text-[11px] uppercase tracking-[0.12em] ${isDarkTheme ? 'text-slate-400 bg-slate-950/80' : 'text-slate-500 bg-slate-50'}`}>
                      {isSearchingCases ? 'Searching cases...' : 'Tag a case'}
                    </div>
                    {caseSuggestions.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto">
                        {caseSuggestions.map((suggestion, index) => (
                          <button
                            key={`${suggestion.id}-${suggestion.caseNumber || suggestion.caseName}`}
                            type="button"
                            onClick={() => applyCaseSuggestion(suggestion)}
                            className={`w-full text-left px-3 py-3 border-b last:border-b-0 ${
                              isDarkTheme ? 'border-white/5' : 'border-slate-100'
                            } ${index === caseSuggestionIndex
                              ? (isDarkTheme ? 'bg-blue-500/15' : 'bg-blue-50')
                              : (isDarkTheme ? 'hover:bg-slate-800/80' : 'hover:bg-slate-50')
                            }`}
                          >
                            <div className="text-sm font-semibold">{suggestion.caseName || `Case ${suggestion.id}`}</div>
                            <div className={`mt-1 text-xs ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                              ID: {suggestion.id}
                              {suggestion.caseNumber ? ` | Case No: ${suggestion.caseNumber}` : ''}
                              {suggestion.firNumber ? ` | FIR: ${suggestion.firNumber}` : ''}
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className={`px-3 py-4 text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                        {isSearchingCases ? 'Looking up matching cases...' : 'No matching cases found.'}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              <button
                type="submit"
                aria-label="Send message"
                disabled={!inputValue.trim() || isBusy}
                className="w-10 h-10 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-white text-[18px]">send</span>
              </button>
            </form>
          </div>

          {!isFullscreen && (
            <button
              type="button"
              onMouseDown={startResize}
              className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize opacity-70 hover:opacity-100"
              title="Resize chat panel"
            >
              <span className="material-symbols-outlined text-[14px]">drag_handle</span>
            </button>
          )}
        </div>
      )}

      {!isFullscreen && (
        <button
          onClick={() => setIsOpen((prev) => !prev)}
          className={`w-14 h-14 rounded-full border shadow-xl flex items-center justify-center hover:scale-105 transition ${isDarkTheme ? 'bg-slate-900 border-white/10' : 'bg-white border-slate-300'}`}
        >
          {isOpen ? (
            <span className={`material-symbols-outlined text-3xl ${isDarkTheme ? 'text-white' : 'text-slate-700'}`}>close</span>
          ) : (
            <span className="material-symbols-outlined text-blue-500 text-3xl">support_agent</span>
          )}
        </button>
      )}
    </div>
  );
};
