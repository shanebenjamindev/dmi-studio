// REST API: the modules' routes, and the health check.
import { Router, json } from './http';
import { FFMPEG } from './config';
import { registerWorkspace } from './workspace';
import { registerBrands } from './brands';
import { registerNotifications } from './notifications';
import { registerAuth } from './auth';
import { registerReports } from './reports';
import { registerAdsSummary } from './ads-summary';
import { registerAds } from './ads';
import { registerTasks } from './tasks';
import { registerBoards } from './boards';
import { registerChatFiles } from './chat-files';
import { registerChatPerms } from './chat-perms';
import { registerAdmin } from './admin';
import { registerCustomerTabs } from './customer-tabs';
import { registerQuickNotes } from './quick-notes';
import { registerSearch } from './search';
import { registerSupport } from './support';
import { registerMcp } from './mcp';
import { registerAssistant } from './assistant';
import { registerMailbox } from './mailbox';

export const api = new Router();

api.get('/api/health', (_q, res) => json(res, 200, { ok: true, ffmpeg: !!FFMPEG, version: '2.0.0' }));

registerAuth(api);
registerNotifications(api);
registerWorkspace(api);
registerBrands(api);
registerReports(api);
registerAds(api);
registerAdsSummary(api);
registerTasks(api);
registerBoards(api);
registerChatFiles(api);
registerChatPerms(api);
registerAdmin(api);
registerCustomerTabs(api);
registerQuickNotes(api);
registerSearch(api);
registerSupport(api);
registerMcp(api);
registerAssistant(api);
registerMailbox(api);
