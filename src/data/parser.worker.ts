/// <reference lib="webworker" />
import { build } from './build';
import { pack } from './pack';
import type { WorkerIn, WorkerOut } from './types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: WorkerOut, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

ctx.onmessage = (ev: MessageEvent<WorkerIn>) => {
  if (ev.data.type !== 'parse') return;
  try {
    const raw = build(ev.data.buffer, ev.data.fileName, (phase, fraction) =>
      post({ type: 'progress', phase, fraction }),
    );
    const data = pack(raw);
    post({ type: 'done', data }, [
      data.nameLang.buffer,
      data.nameSource.buffer,
      data.namePref.buffer,
      data.nameSub.buffer,
      data.subNameStart.buffer,
      data.subNameCount.buffer,
      data.subPrefName.buffer,
      data.nameOffsets.buffer,
    ]);
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
