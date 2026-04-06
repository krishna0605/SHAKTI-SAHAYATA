import { parseTowerDumpCsv, type NormalizedTowerDump } from './towerDumpNormalization';

type ParseWorkerRequest = {
  id: number;
  content: string;
  operator?: string;
};

type ParseWorkerResponse =
  | { id: number; ok: true; records: NormalizedTowerDump[] }
  | { id: number; ok: false; error: string };

let requestSeq = 0;

export async function parseTowerDumpCsvAsync(content: string, operator?: string): Promise<NormalizedTowerDump[]> {
  if (typeof Worker === 'undefined') {
    return parseTowerDumpCsv(content, operator);
  }

  return new Promise<NormalizedTowerDump[]>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/towerDumpParser.worker.ts', import.meta.url), { type: 'module' });
    const id = ++requestSeq;

    const cleanup = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };

    worker.onmessage = (event: MessageEvent<ParseWorkerResponse>) => {
      const msg = event.data;
      if (!msg || msg.id !== id) return;

      cleanup();
      if (msg.ok) {
        resolve(msg.records);
      } else {
        reject(new Error(msg.error || 'Tower dump parse failed in worker'));
      }
    };

    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Tower dump parser worker crashed'));
    };

    const payload: ParseWorkerRequest = { id, content, operator };
    worker.postMessage(payload);
  });
}
