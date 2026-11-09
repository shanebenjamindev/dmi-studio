// The English guide: what each screenshot of shots.mjs is called and what its numbers point at (same order as there),
// and English for the interface words the screenshots look for. Interface text comes from the app's own dictionary
// (web/src/i18n/en.ts), so the guide finds and names buttons as English users see them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DICT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/src/i18n/en.ts');

/** Words looked for inside longer interface text (the dictionary knows only whole texts). */
const PARTS = {
  'trạng thái': 'status',
  'dự án': 'project',
  'Sắp xếp theo': 'Sort by',
  'Tìm trong Workspace': 'Search Workspace',
  'Tìm tên': 'Search name',
};

/** English for a piece of Vietnamese interface text, as the app shows it (unknown text, such as people's data, stays). */
export function english() {
  const src = fs.readFileSync(DICT, 'utf8'), exact = new Map(), patterns = [];
  for (const [, k, v] of src.matchAll(/^ {2}("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*"),?$/gm)) {
    const vi = JSON.parse(k), en = JSON.parse(v);
    if (!/\{\d+\}/.test(vi)) { exact.set(vi, en); continue; }
    const re = new RegExp('^' + vi.split(/\{\d+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([\\s\\S]+?)') + '$');
    patterns.push([re, en]);
  }
  return (s) => {
    if (s == null || s === '') return s;
    if (PARTS[s]) return PARTS[s];
    if (exact.has(s)) return exact.get(s);
    for (const [re, en] of patterns) { const m = re.exec(s); if (m) return en.replace(/\{(\d+)\}/g, (_, i) => m[+i + 1] ?? ''); }
    return s;
  };
}

/** Each screenshot's title and the meaning of its numbers. */
export const SHOTS_EN = {
  '01-dang-nhap': { title: 'The sign-in page', notes: [
    'Sign-in email, given to you by an admin.',
    'Password (at least 8 characters).',
    'Show or hide the password you are typing.',
    'Sign in.',
    'Forgot password: get a reset link by email.',
    'Interface language (Tiếng Việt / English).',
  ] },
  '02-quen-mat-khau': { title: 'Asking for a password reset', notes: [
    'Your sign-in email.',
    'Send the password reset link.',
    'Confirmation (always the same, whether or not the email has an account).',
    'Back to the sign-in page.',
  ] },
  '03-giao-dien': { title: 'The layout after signing in', notes: [
    'Main menu: Workspace, Client, Tasks, Reports, Tools, Admin.',
    'Search everything: clients, tasks, projects, boards, members, notes (shortcut ⌘K / Ctrl K).',
    'Messenger: chat with colleagues.',
    'Quick notes: start a note of your own.',
    'Notifications: tasks given to you, comments, status changes…',
    'Light, dark or device theme.',
    'Account: profile, change password, language, sign out.',
    'Support: send a question or a bug report to the developer.',
    'Reminders: newly assigned, overdue and due-today tasks.',
  ] },
  '04-workspace': { title: 'Workspace: the list of boards', notes: [
    'The workspace and the boards you can open.',
    'Workspace members.',
    'A board: its name, privacy and the people on it (hover a picture for the name).',
    'Create a new board.',
    'Search cards or boards in the Workspace.',
    'Create new: board, task, project, client…',
    'The dock: Messenger, Planner (calendar), Board, Switch board.',
  ] },
  '05-board': { title: 'A board: columns follow the workflow', notes: [
    'Board name (board managers click it to rename).',
    'View: Board, Table, Calendar…',
    'Star the board to list it under "Starred boards".',
    'Who can see the board (private: only people invited).',
    'Filter cards by member, label, due date, client…',
    'Invite people to the board and set their access.',
    'A column = a step in the task workflow. A column can have its own colour.',
    'A card = a task: labels, client, project, due date, checklist, assignees.',
    'Add a card (task) to the column.',
    'Add a new column.',
  ] },
  '06-mau-cot': { title: 'The column menu: a colour for the whole column', notes: [
    'List colour: colour the whole column (everyone sees it).',
    'Add a card to the top of the column.',
    'Sort the column’s cards by date created, name or due date.',
    'Archive the whole column.',
  ] },
  '07-the': { title: 'A card (task) opened', notes: [
    'The current column (step); click it to move the card to another column.',
    'Open the task linked to the card on the Tasks page.',
    'Add: members, labels, dates, checklist, attachment, cover…',
    'The task’s client and project.',
    'Assignees (the card’s members) and labels.',
    'Start and due dates; tick the box to mark it done.',
    'Task description.',
    'Result: handover note and files.',
    'Checklist and its progress.',
    'Comments and the card’s activity.',
  ] },
  '08-planner': { title: 'Planner: your calendar beside the board', notes: [
    'Planner: your dated cards on a calendar; drag cards between the calendar and the board.',
    'Drag this gap to resize the panes (double-click to reset).',
    'Show / hide Planner.',
  ] },
  '09-messenger': { title: 'Messenger: chat inside the company', notes: [
    'Chat window: the company’s general channel or a direct message with one person.',
    'Type a message and press Enter to send; emoji and pictures too.',
    'Voice call / video call / voice message: not working yet (a notice only).',
    'Open Messenger from the dock (or the icon on the top bar).',
  ] },
  '10-cong-viec': { title: 'My tasks', notes: [
    'Section column: My tasks, Projects, and projects by client.',
    'Assigned to me / Assigned by me / Following.',
    'Add a new task.',
    'Search by name, project, label, code.',
    'Filter by status.',
    'Filter by project.',
    'Group the list: by due date, status, project…',
    'The "Today" group: tasks due today.',
  ] },
  '11-cong-viec-chi-tiet': { title: 'A task opened beside the list', notes: [
    'Task list (narrower while a task is open).',
    'Drag to resize the list; double-click to reset.',
    'Task details: status, assignees, due date, description, comments…',
  ] },
  '12-tao-cong-viec': { title: 'Adding a task', notes: [
    'Task name (required).',
    'Assignees: one or more employees.',
    'The task’s project (leave empty for a general task).',
    'Due: Today, Tomorrow, or pick another date.',
    'Description, with formatting (bold, lists, links…).',
    'More options: start date, status, labels, followers…',
    'Create the task.',
  ] },
  '13-du-an': { title: 'Projects and their status', notes: [
    'Add a new project.',
    'Group by client or by project status.',
    'A project: status, overdue tasks, assignees, progress.',
    'Status set by the project manager (Paused / Cancelled).',
    'Status that follows the tasks: Not started, In progress, Done.',
  ] },
  '14-du-an-chi-tiet': { title: 'A project opened, and setting its status', notes: [
    'The project’s current status.',
    'Managers set Paused / Cancelled, or let it follow task progress.',
    'The project’s campaigns and tasks.',
  ] },
  '15-khach-hang': { title: 'Clients: the list', notes: [
    'Views: List, Kanban, Cards.',
    'Totals: clients, projects and tasks done.',
    'Add a client.',
    'Search by name, contact, email, phone, needs.',
    'Filter by needs, status, tag, source, owner, Drive.',
    'Group by status, tag, source or owner.',
    'A group (here, the "Prospect" status).',
    'Edit or delete the client (if you may).',
  ] },
  '16-khach-hang-kanban': { title: 'Clients: Kanban by status', notes: [
    'A column = a client status; drag a client to another column to change its status.',
  ] },
  '17-khach-hang-chi-tiet': { title: 'A client opened', notes: [
    'The client’s workflow: click a step to change the status.',
    'Sections: Overview, Projects, Tasks, Drive, Reports, Members, History.',
    'Edit the client’s details.',
    'Progress of the client’s tasks.',
    'Contact and owner.',
  ] },
  '18-them-khach-hang': { title: 'Adding a client', notes: [
    'Starting status (the first step is chosen; you can change it).',
    'Client name (required).',
    'Warning when the name looks like an existing client’s (you can still create it).',
    'Create the client.',
  ] },
  '19-bao-cao': { title: 'Client reports', notes: [
    'Reports: All reports, Meta Ads.',
    'Choose the client for a new report.',
    'Create the report.',
  ] },
  '20-meta-ads': { title: 'Meta Ads (not connected)', notes: [
    'Connect with a Meta access token (ads_read permission) to see ad figures.',
  ] },
  '21-chuyen-doi': { title: 'Tools: Format converter', notes: [
    'Drag and drop or choose files; they are converted on your computer, not uploaded.',
    'What can be converted: video, audio, images, subtitles, spreadsheets.',
    'Open the video Editor.',
  ] },
  '22-trinh-dung': { title: 'Tools: the video Editor', notes: [
    'Create a new video project.',
  ] },
  '23-quan-tri': { title: 'Admin: Statistics overview', notes: [
    'The admin sections (shown according to your permissions).',
    'Key figures for the period.',
    'Export the figures.',
  ] },
  '24-nhan-vien': { title: 'Admin: Employees', notes: [
    'Add an employee: name, email, password, department, position.',
    'Export the list as a CSV file.',
    'Search by name, email, phone.',
    'The list: department, position, role, status, last sign-in, open tasks.',
  ] },
  '25-phan-quyen': { title: 'Admin: Roles and permissions', notes: [
    'Create a new role (a set of permissions).',
    'A role: level, people, permissions; click to edit its permissions.',
    'Give roles to employees.',
  ] },
  '26-thong-bao': { title: 'Notifications', notes: [
    'The bell: how many notifications are unread.',
    'Mark all as read.',
    'A notification: click to open the task or card (and mark it read).',
  ] },
  '27-nhac-viec': { title: 'Reminders', notes: [
    'Important / Today / Late.',
    'Overdue or due-today tasks (need attention).',
    'Open the full task list.',
  ] },
  '28-tim-kiem': { title: 'Search everything', notes: [
    'Type what you look for (no accents needed: "anh duong" finds "Ánh Dương").',
    'Narrow the results: All, Members, Tasks, Clients, Projects, Boards & cards, Notes.',
    'Results by group; use ↑ ↓ and Enter to open one.',
  ] },
  '29-ghi-chu': { title: 'Quick notes', notes: [
    'A note: drag its top bar to move it, its corner to resize; it saves as you type.',
    'Formatting: bold, italic, code, headings, lists, checklists, pictures.',
  ] },
  '30-ho-so': { title: 'My profile', notes: [
    'Edit your name and phone number.',
    'Change password.',
    'Account details: email, phone, department, date joined.',
    'Tasks currently assigned to you.',
  ] },
  '31-menu-tai-khoan': { title: 'The account menu', notes: [
    'My profile, Change password, Language, Sign out.',
  ] },
  '32-ho-tro': { title: 'Sending a support request', notes: [
    'Describe your question or the problem (with a screenshot if you have one).',
    'Send it to the developer; the answer comes back as a notification.',
  ] },
  '33-di-dong': { title: 'On a phone', notes: [
    'Bottom bar: 3 main sections, Reminders and More.',
  ] },
  '34-di-dong-them': { title: 'On a phone: the "More" menu', notes: [
    'The other sections: Reports, Tools, Admin, Support.',
  ] },
  '35-chi-xem': { title: 'A board you may only view', notes: [
    'You may only view this board: no adding, editing or dragging cards.',
    'Only cards of the projects and clients you may see are shown.',
    'The menu has only the sections you may open (no Admin here).',
  ] },
};
