import React, { useState } from 'react'

const SQL_KEYWORDS = new Set([
    'select', 'from', 'where', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group', 'by', 'order',
    'limit', 'offset', 'count', 'sum', 'avg', 'min', 'max', 'as', 'and', 'or', 'not', 'null', 'is', 'in',
    'distinct', 'case', 'when', 'then', 'else', 'end', 'with', 'union', 'all', 'having'
])

const copyToClipboard = async (value: string) => {
    await navigator.clipboard.writeText(value)
}

const inlineFormat = (text: string): React.ReactNode[] => {
    const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean)
    return tokens.map((token, idx) => {
        if (token.startsWith('**') && token.endsWith('**')) return <strong key={`b-${idx}`}>{token.slice(2, -2)}</strong>
        if (token.startsWith('`') && token.endsWith('`')) return <code key={`c-${idx}`} className="chat-inline-code">{token.slice(1, -1)}</code>
        return <React.Fragment key={`t-${idx}`}>{token}</React.Fragment>
    })
}

const isTableSeparator = (line: string) => /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim())

const CopyIconButton: React.FC<{ onClick: () => void; copied: boolean; title: string }> = ({ onClick, copied, title }) => (
    <button type="button" className="chat-copy-btn" onClick={onClick} title={title}>
        <span className="material-symbols-outlined text-[15px]">{copied ? 'check' : 'content_copy'}</span>
    </button>
)

const SqlHighlight: React.FC<{ code: string }> = ({ code }) => (
    <>
        {code.split('\n').map((row, rowIdx) => {
            const parts = row.split(/(\s+|--.*$|'[^']*'|"(?:[^"]*)")/g).filter(Boolean)
            return (
                <div key={`sql-row-${rowIdx}`}>
                    {parts.map((part, idx) => {
                        const lower = part.toLowerCase()
                        if (/^--/.test(part)) return <span key={`p-${rowIdx}-${idx}`} className="chat-sql-comment">{part}</span>
                        if (/^'.*'$/.test(part) || /^".*"$/.test(part)) return <span key={`p-${rowIdx}-${idx}`} className="chat-sql-string">{part}</span>
                        if (SQL_KEYWORDS.has(lower)) return <span key={`p-${rowIdx}-${idx}`} className="chat-sql-keyword">{part}</span>
                        if (/^\d+(\.\d+)?$/.test(part)) return <span key={`p-${rowIdx}-${idx}`} className="chat-sql-number">{part}</span>
                        return <span key={`p-${rowIdx}-${idx}`}>{part}</span>
                    })}
                </div>
            )
        })}
    </>
)

const CodeBlock: React.FC<{ language?: string; code: string }> = ({ language, code }) => {
    const [copied, setCopied] = useState(false)
    const isSql = (language || '').toLowerCase() === 'sql'

    const onCopy = async () => {
        await copyToClipboard(code)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1000)
    }

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
    )
}

const TableBlock: React.FC<{ header: string[]; rows: string[][] }> = ({ header, rows }) => {
    const [copied, setCopied] = useState(false)
    const markdown = [
        `| ${header.join(' | ')} |`,
        `| ${header.map(() => '---').join(' | ')} |`,
        ...rows.map((r) => `| ${r.join(' | ')} |`),
    ].join('\n')

    const onCopy = async () => {
        await copyToClipboard(markdown)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1000)
    }

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
    )
}

export const renderRichMessage = (text: string) => {
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    const nodes: React.ReactNode[] = []
    let i = 0

    while (i < lines.length) {
        const trimmed = lines[i].trim()
        if (!trimmed) {
            i += 1
            continue
        }

        if (trimmed.startsWith('```')) {
            const language = trimmed.slice(3).trim()
            const chunk: string[] = []
            i += 1
            while (i < lines.length && !lines[i].trim().startsWith('```')) {
                chunk.push(lines[i])
                i += 1
            }
            i += 1
            nodes.push(<CodeBlock key={`cb-${i}`} language={language} code={chunk.join('\n')} />)
            continue
        }

        if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            const header = trimmed.split('|').map((c) => c.trim()).filter(Boolean)
            i += 2
            const rows: string[][] = []
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                rows.push(lines[i].trim().split('|').map((c) => c.trim()).filter(Boolean))
                i += 1
            }
            nodes.push(<TableBlock key={`tb-${i}`} header={header} rows={rows} />)
            continue
        }

        if (trimmed.startsWith('### ')) {
            nodes.push(<h3 key={`h3-${i}`} className="chat-h3">{inlineFormat(trimmed.slice(4))}</h3>)
            i += 1
            continue
        }
        if (trimmed.startsWith('## ')) {
            nodes.push(<h2 key={`h2-${i}`} className="chat-h2">{inlineFormat(trimmed.slice(3))}</h2>)
            i += 1
            continue
        }
        if (trimmed.startsWith('# ')) {
            nodes.push(<h1 key={`h1-${i}`} className="chat-h1">{inlineFormat(trimmed.slice(2))}</h1>)
            i += 1
            continue
        }

        if (/^[-*]\s+/.test(trimmed)) {
            const items: string[] = []
            while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
                items.push(lines[i].trim().replace(/^[-*]\s+/, ''))
                i += 1
            }
            nodes.push(<ul key={`ul-${i}`} className="chat-ul">{items.map((item, idx) => <li key={`li-${idx}`}>{inlineFormat(item)}</li>)}</ul>)
            continue
        }

        if (/^\d+\.\s+/.test(trimmed)) {
            const items: string[] = []
            while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
                items.push(lines[i].trim().replace(/^\d+\.\s+/, ''))
                i += 1
            }
            nodes.push(<ol key={`ol-${i}`} className="chat-ol">{items.map((item, idx) => <li key={`oi-${idx}`}>{inlineFormat(item)}</li>)}</ol>)
            continue
        }

        nodes.push(<p key={`p-${i}`} className="chat-p">{inlineFormat(trimmed)}</p>)
        i += 1
    }

    return nodes.length > 0 ? nodes : <p className="chat-p">{text}</p>
}
