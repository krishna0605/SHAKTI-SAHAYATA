/**
 * Web Worker for parsing tower dump CSV data off the main thread.
 */
import { parseTowerDumpCsv, type NormalizedTowerDump } from '../utils/towerDumpNormalization';

type ParseWorkerRequest = {
  id: number;
  content: string;
  operator?: string;
};

type ParseWorkerResponse =
  | { id: number; ok: true; records: NormalizedTowerDump[] }
  | { id: number; ok: false; error: string };

self.onmessage = (event: MessageEvent<ParseWorkerRequest>) => {
  const { id, content, operator } = event.data;
  try {
    const records = parseTowerDumpCsv(content, operator);
    const response: ParseWorkerResponse = { id, ok: true, records };
    self.postMessage(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const response: ParseWorkerResponse = { id, ok: false, error: message };
    self.postMessage(response);
  }
};
