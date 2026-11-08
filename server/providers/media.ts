// Video / image / voice generation. Every hosted platform needs a paid API, so DMI Workspace no longer
// ships any; only the offline demo provider (DMS_MOCK=1) runs through the job queue.
import { findProvider } from './registry';
import { ProviderError } from './llm';
import { mockMedia } from './mock';

export interface JobInput {
  prompt: string;
  aspect?: string;      // 16:9 | 9:16 | 1:1
  duration?: number;    // seconds wanted
  voice?: string;
  instructions?: string;
}
export type Done = { url?: string; buffer?: Buffer; mime?: string };
export type SubmitResult = { remoteId?: string; meta?: any; done?: Done };
export type PollResult = { status: 'running' | 'succeeded' | 'failed'; done?: Done; error?: string };

export async function submitJob(providerId: string, _model: string, kind: string, input: JobInput): Promise<SubmitResult> {
  const p = findProvider(providerId);
  if (!p?.mock) throw new ProviderError('Không có nhà cung cấp ' + providerId, 400);
  if (p.kind !== kind) throw new ProviderError(`${p.name} không hỗ trợ loại "${kind}"`, 400);
  return { done: await mockMedia(kind, input) };
}

export async function pollJob(_providerId: string, _remoteId: string, _meta: any): Promise<PollResult> {
  return { status: 'failed', error: 'Nhà cung cấp không hỗ trợ polling' };
}
