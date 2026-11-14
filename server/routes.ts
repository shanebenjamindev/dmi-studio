// REST API: the modules' routes, and the health check.
import { Router, json } from './http';
import { FFMPEG } from './config';
import { registerWorkspace } from './workspace';
import { registerNotifications } from './notifications';
import { registerAuth } from './auth';
import { registerReports } from './reports';
import { registerAdsSummary } from './ads-summary';
import { registerAds } from './ads';
import { registerTasks } from './tasks';
import { registerBoards } from './boards';
import { registerAdmin } from './admin';
import { registerCustomerTabs } from './customer-tabs';
import { registerQuickNotes } from './quick-notes';
import { registerSearch } from './search';
import { registerSupport } from './support';
import { registerMcp } from './mcp';
import { registerAssistant } from './assistant';

export const api = new Router();

api.get('/api/health', (_q, res) => json(res, 200, { ok: true, ffmpeg: !!FFMPEG, version: '2.0.0' }));

registerAuth(api);
registerNotifications(api);
registerWorkspace(api);
registerReports(api);
registerAds(api);
registerAdsSummary(api);
registerTasks(api);
registerBoards(api);
registerAdmin(api);
registerCustomerTabs(api);
registerQuickNotes(api);
registerSearch(api);
registerSupport(api);
registerMcp(api);
registerAssistant(api);
