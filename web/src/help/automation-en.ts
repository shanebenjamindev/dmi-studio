// Help › Automation in English: the same articles as automation.ts (same addresses), for the English interface.
import type { Article } from './types';

const cat = 'Automation';
export const AUTOMATION_EN: Article[] = [
  {
    slug: 'tu-dong-hoa-khai-niem', cat, title: '1. Concepts and rules',
    html: `
<p>Automation lets the app <b>do repetitive work for you</b>: hand out tasks, remind people of due dates, tell reviewers, share new clients among sales staff, create recurring tasks, send data to n8n or Zapier… Each such job is a <b>rule</b>.</p>
<h3>What a rule is made of</h3>
<p>A rule works like an <b>“if … then …”</b>, much like Excel's IF function:</p>
<ol>
  <li><b>Trigger</b> (when): an event, such as “Task created”, “New client”, “Due soon”, “Scheduled every Monday at 8:30”.</li>
  <li><b>Conditions</b> (for which record, optional): for example only tasks of client X, only tasks nobody does yet.</li>
  <li><b>Steps</b> (what to do), run in order from left to right: actions (notify, assign…), an <b>If / Then</b> block that splits into two branches, and a <b>Wait</b> block that pauses and then goes on.</li>
</ol>
<p>On screen a rule is a chain of <b>nodes</b> (squares) joined by lines, as in n8n: the first node (rounded on the left, with a lightning mark) is the Trigger.</p>
<h3>Three kinds of rules</h3>
<table>
  <tr><th>Kind</th><th>Triggers</th><th>Works on</th></tr>
  <tr><td>Task rules</td><td>Created, moved to a step, field changed, new comment, overdue, due soon</td><td>One task: can assign, comment, change the due date, move the step…</td></tr>
  <tr><td>Client rules</td><td>New client, status changed, owner changed</td><td>One client: can share out owners, change the status…</td></tr>
  <tr><td>Scheduled / webhook rules</td><td>Schedule, Incoming webhook</td><td>No record: usually create recurring tasks, notify, call a webhook.</td></tr>
</table>
<h3>Important rules</h3>
<ul>
  <li><b>A rule runs with the rights of whoever saved it.</b> The person who pressed Save last is the one who “does” its actions: comments appear under their name, and the rule can do only what they may do. If that account is locked, the rule fails; open it and save it again from another account.</li>
  <li><b>Rules do not start other rules.</b> A change made by one rule (say rule A assigns a task) does not set off other rules, so there are no endless loops.</li>
  <li><b>Only events after a rule is turned on count.</b> Existing data does not run by itself; use <b>Run on existing records</b> for that (article 8).</li>
  <li>A rule can be <b>turned on / off</b> at any time with the switch in the rule list or on the editor's top bar.</li>
</ul>
<aside class="tip"><b>Who can use it</b> — Admin › Automation needs <b>Automation › View</b>; creating, editing, test runs and deleting need <b>Automation › Manage</b>. Super Admin and Admin have both; others are given them in Admin › Permissions.</aside>`,
  },
  {
    slug: 'tu-dong-hoa-cach-tao', cat, title: '2. Making a rule, step by step',
    html: `
<ol>
  <li>Go to <b>Admin › Automation › Rules</b>.</li>
  <li>Press <b>New rule</b> (or press a <b>Template</b> under the list to start from a ready-made rule). The editor opens full screen.</li>
  <li>Click the name “Luật mới” at the top left and give the rule a clear name, such as “Share new clients among sales”.</li>
  <li>Press <b>Add first step…</b> and pick a <b>trigger</b> in the panel on the right. The node's details open for you to fill in (article 3).</li>
  <li>Press <b>Back to canvas</b>. At the end of the line there is a <b>+</b>: press it to add the next step. The “What happens next?” panel is grouped: Logic (Filter, If/Then, Wait), Messages, Staff, Data, Apps. Type in its search box to narrow it down.</li>
  <li>Each new step opens its details straight away. Fill in the boxes, then press <b>Back to canvas</b>. Repeat for the other steps.</li>
  <li>Press <b>Save</b> at the top right. The top bar shows “Unsaved” while there are changes not saved.</li>
  <li>Press <b>Test rule</b> (the blue button at the bottom centre) to try it now on a task or client (paste its id or link). See the result in the <b>Run history</b> tab.</li>
</ol>
<h3>Working on the canvas</h3>
<table>
  <tr><th>To</th><th>Do</th></tr>
  <tr><td>Open / edit a step</td><td>Click its node.</td></tr>
  <tr><td>Move a node</td><td>Hold the mouse (or your finger) on it and drag; the lines follow. Places are saved with the rule.</td></tr>
  <tr><td>Move the whole canvas</td><td>Drag an empty spot of the dotted grid.</td></tr>
  <tr><td>Zoom</td><td>The + / − buttons at the bottom left; the diagonal arrow centres the view; the grid button <b>tidies</b> every node back into rows.</td></tr>
  <tr><td>Insert a step in between</td><td>Hover the canvas and press the small + in the middle of the line between two steps.</td></tr>
  <tr><td>Change the order</td><td>Open the step and press ‹ / › at the top of its window (one step earlier / later).</td></tr>
  <tr><td>Delete a step</td><td>Hover the node and press the bin above it, or open the step and press the bin.</td></tr>
</table>
<h3>A node's details</h3>
<p>As in n8n, the window has three columns:</p>
<ul>
  <li><b>Input</b> (left): the <b>fields</b> you can insert into text, such as <code>{{task.title}}</code>. Click the text box first, then the field: it goes in at the cursor. The full list is in article 6.</li>
  <li><b>Parameters</b> (middle): the boxes of the step. Each has a line of explanation right under it.</li>
  <li><b>Output</b> (right): the result of the rule's last run (success or error, what each step did).</li>
</ul>
<p>The <b>Guide</b> button at the top of the window opens the help article for that kind of step in a new tab.</p>
<h3>Rule options</h3>
<p>Press the gear on the top bar (next to the On switch): <b>Run once per task / client</b> and <b>Run only in working hours</b>. See article 7.</p>`,
  },
  {
    slug: 'tu-dong-hoa-kich-hoat', cat, title: '3. Triggers: when a rule runs',
    html: `
<p>The Trigger node always comes first. Click it to change its kind or settings.</p>
<aside class="warn"><b>Changing the trigger</b> — Switching to a trigger of another group (say from “Task created” to “New client” or “Schedule”) <b>clears the conditions and steps</b>, as they work on another kind of data. Within the same group they are kept.</aside>
<h3>Tasks</h3>
<table>
  <tr><th>Trigger</th><th>Runs when</th><th>Boxes</th></tr>
  <tr><td>Task created</td><td>A task is made: on the Tasks page, as a card on a board, or by Claude.</td><td>None.</td></tr>
  <tr><td>Task moves to a step</td><td>A task enters a workflow step (ACCOUNT, EXECUTION, REVIEW, COMPLETED, REJECTED), from its page or by dragging its card.</td><td><b>To step</b>: only that step; “Any step” runs on every move.</td></tr>
  <tr><td>Field changed</td><td>A task field changes value.</td><td><b>Field</b>: Due date (set, changed, removed), Assignee (given, changed), Service.</td></tr>
  <tr><td>New comment</td><td>Someone comments on a task.</td><td>None. Use the condition “Comment contains …” to narrow it, e.g. the word “urgent”.</td></tr>
  <tr><td>Task overdue</td><td>An unfinished task has just passed its due date.</td><td>None. Checked every minute.</td></tr>
  <tr><td>Due soon</td><td>Some hours before an unfinished task's due date.</td><td><b>Before due</b>: hours, e.g. 24 = a day before.</td></tr>
</table>
<h3>Clients</h3>
<table>
  <tr><th>Trigger</th><th>Runs when</th><th>Boxes</th></tr>
  <tr><td>New client</td><td>A client is added (on the Clients page or in Drive).</td><td>None.</td></tr>
  <tr><td>Client status changed</td><td>A client's status changes.</td><td><b>To status</b>: only that status; “Any” runs on every change.</td></tr>
  <tr><td>Client owner changed</td><td>A client is given to another owner.</td><td>None.</td></tr>
</table>
<h3>Other</h3>
<table>
  <tr><th>Trigger</th><th>Runs when</th><th>Boxes</th></tr>
  <tr><td>Schedule</td><td>The set time comes.</td><td><b>Repeat</b>: daily / weekly / monthly. <b>On</b>: the weekday or the day of the month (1–28). <b>At</b>: Vietnam time. The rule list shows “Next …”.</td></tr>
  <tr><td>Incoming webhook</td><td>Another system (n8n, Zapier, Make, a website form…) sends a POST to the rule's own address.</td><td>Nothing to fill in. After <b>Save</b> the node shows the webhook address and a <b>Copy</b> button. JSON sent with it can be used in text as <code>{{body.field_name}}</code>.</td></tr>
</table>
<aside class="tip"><b>Calling the webhook</b> — From n8n: add an HTTP Request node, Method POST, URL = the copied address, JSON body <code>{"msg": "New order", "client": "Garage A"}</code>. In the rule, write a notification “{{body.msg}} from {{body.client}}”. Keep the address secret: anyone who has it can run the rule.</aside>`,
  },
  {
    slug: 'tu-dong-hoa-dieu-kien', cat, title: '4. Conditions: Filter and If / Then',
    html: `
<p>There are two places for conditions:</p>
<ul>
  <li><b>Filter</b> (the orange node right after the trigger): general conditions. A record that does not meet them <b>does not run</b> the rule and leaves no history. Add it with the first + and pick “Filter”.</li>
  <li><b>If / Then</b> (a step in the chain): splits into <b>two branches</b>. Its node has two outputs: <b>True</b> (green, above) and <b>False</b> (red, below). Each branch has its own + to add steps. When a branch is done, the rule goes on with the steps after the If/Then block. An If/Then may sit inside a branch (two levels at most).</li>
</ul>
<h3>Filling in a condition</h3>
<p>Each condition line has three boxes: <b>field</b> — <b>comparison</b> — <b>value</b>.</p>
<table>
  <tr><th>Field (task rules)</th><th>Comparison</th><th>Value</th></tr>
  <tr><td>Client</td><td>is / is not / is empty / is set</td><td>Pick a client</td></tr>
  <tr><td>Service</td><td>is / is not / is empty / is set</td><td>Pick a service (client · brand · service)</td></tr>
  <tr><td>Assignee</td><td>is / is not / is empty / is set</td><td>Pick a person. “Is empty” = not given to anyone.</td></tr>
  <tr><td>Step</td><td>is / is not</td><td>ACCOUNT, EXECUTION, REVIEW, COMPLETED, REJECTED</td></tr>
  <tr><td>Due date</td><td>is / is not</td><td>Overdue, Due today, In the next 7 days, No due date</td></tr>
  <tr><td>Task name</td><td>contains / does not contain</td><td>Type a keyword (any case)</td></tr>
  <tr><td>Comment</td><td>contains / does not contain</td><td>Type a keyword. Only meaningful with “New comment”.</td></tr>
</table>
<table>
  <tr><th>Field (client rules)</th><th>Comparison</th><th>Value</th></tr>
  <tr><td>Client status</td><td>is / is not / is empty / is set</td><td>Pick a status</td></tr>
  <tr><td>Client owner</td><td>is / is not / is empty / is set</td><td>Pick a person. “Is empty” = no owner yet.</td></tr>
  <tr><td>Client name</td><td>contains / does not contain</td><td>Type a keyword</td></tr>
</table>
<h3>All or any</h3>
<p>The first line “Run when <b>all</b> / <b>any</b> of these are true” decides how several conditions combine: <b>all</b> = AND (every line true), <b>any</b> = OR (one line is enough).</p>
<aside class="tip"><b>Latest data</b> — If/Then checks the task / client <b>as it is when the run reaches it</b>, including changes by earlier steps and after a Wait. For example “Wait 8 hours → If Step is ACCOUNT” knows whether the task has been handed out after 8 hours.</aside>`,
  },
  {
    slug: 'tu-dong-hoa-hanh-dong', cat, title: '5. Actions: every box',
    html: `
<p>Actions are what a rule does. Some exist only in task rules or client rules; the step picker shows only those you can use.</p>
<h3 id="notify">Send notification</h3>
<ul>
  <li><b>Send to</b>: pick roles so the rule finds the right people of each record — Assignee, Creator, Reviewer, Followers, Client owner — or pick named people. Several allowed.</li>
  <li><b>Title</b>: the bold line, e.g. “Waiting for your review: <code>{{task.title}}</code>”.</li>
  <li><b>Body</b>: the small line under it (optional), e.g. “<code>{{customer}}</code> · Due <code>{{task.due}}</code>”.</li>
</ul>
<p>The notification shows under the recipient's bell and opens the task / client; anyone with email turned on in their Profile gets an email too.</p>
<h3 id="comment">Add comment</h3>
<p><b>Comment</b>: the text written on the task, under the name of whoever saved the rule. People on the task are notified as for any comment.</p>
<h3 id="assign">Assign task / Assign client owner</h3>
<ul>
  <li><b>How to share</b>:
    <ul>
      <li><b>Fixed</b>: always the first person on the list (the next one if they are on leave).</li>
      <li><b>Round robin</b>: in turn A → B → C → A…</li>
      <li><b>By weight</b>: each person gets a number of “shares”; A with 4 and B with 1 means A gets about 80%, B 20%.</li>
      <li><b>Fewest tasks</b>: whoever has the fewest unfinished tasks.</li>
    </ul>
  </li>
  <li><b>Staff</b>: the people who may be given it. Anyone on the <b>Leave list</b> today is skipped; if everyone is, the step fails.</li>
</ul>
<p>“Assign task” replaces the task's assignee. “Assign client owner” changes the client's owner.</p>
<h3 id="follow">Add followers</h3>
<p><b>Add</b>: the people added to the followers; those already following stay.</p>
<h3 id="reviewer">Set reviewer</h3>
<p><b>Reviewer</b>: who grades PASS / REDO / FAIL at the REVIEW step.</p>
<h3 id="update_task">Update due date</h3>
<ul>
  <li><b>Due date</b>: “Set in some days” or “Remove the due date”.</li>
  <li><b>In</b>: days from when the rule runs; the due time is 23:59 of that day. For example 2 = the end of the day after tomorrow.</li>
</ul>
<h3 id="flow">Move workflow step</h3>
<p><b>Move</b>: Hand out (ACCOUNT → EXECUTION, the task needs an assignee), Submit for review (→ REVIEW), Pass (→ COMPLETED). Whoever saved the rule must be allowed that move (passing needs the reviewer or an Admin); otherwise the step fails.</p>
<h3 id="customer_status">Change client status</h3>
<p><b>Status</b>: the client's new status.</p>
<h3 id="create_task">Create task</h3>
<ul>
  <li><b>Task name</b> (required), fields allowed: “Call <code>{{customer}}</code> back”.</li>
  <li><b>Description</b> (optional).</li>
  <li><b>Service</b>: the service the new task belongs to (and the board it goes on); empty = a general task.</li>
  <li><b>Assign to</b>: who does it; empty = it waits at ACCOUNT.</li>
  <li><b>Due</b>: days after it is made; empty = no due date.</li>
</ul>
<h3 id="webhook">Call webhook</h3>
<ul>
  <li><b>URL</b>: where to send, starting with <code>https://</code>.</li>
</ul>
<p>The rule sends a POST with JSON: <code>rule</code>, <code>by</code> (who saved the rule), <code>from</code> / <code>to</code> (values before / after a change), <code>body</code> (data of an incoming webhook), <code>comment</code>, <code>at</code>, <code>task</code> (id, title, stage, dueAt, customer, service, assignees, link) and <code>customer</code> (id, name, status, owner, link). An error reply (4xx/5xx) or no reply within 8 seconds fails the step.</p>`,
  },
  {
    slug: 'tu-dong-hoa-doi-hen-gio', cat, title: '6. Wait, and the {{…}} fields',
    html: `
<h3>The Wait block</h3>
<ul>
  <li><b>Wait</b>: how long, in minutes, hours or days.</li>
  <li><b>Working hours only</b>: counts only time within working hours (General settings). With working hours 8:00–17:30, waiting 2 working hours from 16:30 on Friday goes on at 9:00 on Monday.</li>
</ul>
<p>At a Wait, the rule stops and queues a <b>resume</b>. These are listed in the rule's <b>Waiting</b> tab (when it resumes, which record, at which step), each can be cancelled. On resuming, the rule reads the record's latest data. A rule turned off does not resume.</p>
<h3>Fields in text</h3>
<p>In text boxes (title, body, comment, task name), type a field or insert it from the <b>Input</b> column. When the rule runs it becomes the real value.</p>
<table>
  <tr><th>Field</th><th>Becomes</th><th>In rules on</th></tr>
  <tr><td><code>{{task.title}}</code></td><td>Task name</td><td>Tasks</td></tr>
  <tr><td><code>{{task.link}}</code></td><td>Link to the task</td><td>Tasks</td></tr>
  <tr><td><code>{{task.due}}</code></td><td>Due date and time</td><td>Tasks</td></tr>
  <tr><td><code>{{task.stage}}</code></td><td>Current step (ACCOUNT…)</td><td>Tasks</td></tr>
  <tr><td><code>{{assignee}}</code></td><td>Assignee's name</td><td>Tasks</td></tr>
  <tr><td><code>{{customer}}</code></td><td>Client name</td><td>Tasks, clients</td></tr>
  <tr><td><code>{{service}}</code></td><td>Service name</td><td>Tasks</td></tr>
  <tr><td><code>{{customer.link}}</code>, <code>{{customer.status}}</code>, <code>{{customer.owner}}</code></td><td>The client's link, status and owner</td><td>Clients</td></tr>
  <tr><td><code>{{from}}</code>, <code>{{to}}</code></td><td>Value before and after a change (step, status)</td><td>Step moves, status changes</td></tr>
  <tr><td><code>{{comment}}</code></td><td>The comment's text</td><td>New comment</td></tr>
  <tr><td><code>{{body.name}}</code></td><td>A field of the JSON sent in</td><td>Incoming webhook</td></tr>
  <tr><td><code>{{rule}}</code></td><td>The rule's name</td><td>Every rule</td></tr>
</table>`,
  },
  {
    slug: 'tu-dong-hoa-cai-dat', cat, title: '7. General settings and rule options',
    html: `
<h3>General settings</h3>
<p>The <b>General settings</b> button at the top of the Automation page. For every rule:</p>
<ul>
  <li><b>Working days</b>: pick the days worked (Monday – Friday by default).</li>
  <li><b>Working hours</b>: start and end, Vietnam time (08:00 – 17:30 by default).</li>
  <li><b>Leave list</b>: one line per person and their days off (from – to). On those days they are not given tasks or clients automatically.</li>
</ul>
<h3>Options of each rule</h3>
<p>Press the gear on the editor's top bar:</p>
<ul>
  <li><b>Run once per task / client</b>: a record that already ran this rule is skipped next time. Good for sharing clients, welcoming new clients…</li>
  <li><b>Run only in working hours</b>: an event outside working hours waits for the start of the next working time (the wait shows in the Waiting tab).</li>
</ul>`,
  },
  {
    slug: 'tu-dong-hoa-theo-doi', cat, title: '8. Monitoring, test runs and existing records',
    html: `
<h3>In the rule list</h3>
<p>Each line shows the trigger, when it was updated, its last run (or <b>Next</b> for scheduled rules), how many runs are <b>waiting</b>, and a red <b>last run failed</b> when it did. The <b>⋯</b> menu: Open, Run history, Waiting, Test run, Run on existing records, Duplicate, Delete.</p>
<h3>Counts on each node</h3>
<p>The bottom right of each node shows how many times that step <b>succeeded</b> (green) and <b>failed</b> (red). An If/Then's True / False outputs show how many runs took each branch, so you can see how well a rule works and which step fails.</p>
<h3>Run history</h3>
<p>The <b>Run history</b> tab lists the last 100 runs: time, record, success or error. Click a run to see what each step did (e.g. “If: True → Assigned to Huy → Wait until 09:00 …”). The <b>CSV</b> button downloads the list.</p>
<h3>Test run</h3>
<p><b>Test rule</b> (or ⋯ › Test run): the rule runs now, skipping its Filter, on the task / client whose id or link you paste. It is a real run (notifications really go out, tasks are really assigned), so try it on test data.</p>
<h3>Run on existing records</h3>
<p>⋯ › <b>Run on existing records</b>: runs the rule for up to the 300 newest open tasks (or clients), through its conditions and the “run once” option. Use it when you want a new rule applied to older data.</p>`,
  },
  {
    slug: 'tu-dong-hoa-vi-du', cat, title: '9. Real examples',
    html: `
<h3>Share new clients among sales, round robin</h3>
<ol>
  <li>Trigger: <b>New client</b>. Option: turn on <b>Run once per client</b>.</li>
  <li>Step 1: <b>If / Then</b>, condition “Client owner — is empty”.</li>
  <li>True branch: <b>Assign client owner</b>, How to share “Round robin”, Staff: the sales people.</li>
  <li>Step 2 (after the If/Then): <b>Send notification</b> to “Client owner”, title “You have a new client: <code>{{customer}}</code>”.</li>
</ol>
<p>New clients without an owner go to each sales person in turn (skipping those on leave), and the owner is told.</p>
<h3>Remind about tasks not handed out after one working day</h3>
<ol>
  <li>Trigger: <b>Task created</b>.</li>
  <li><b>Wait</b>: 8 hours, “Working hours only” on.</li>
  <li><b>If / Then</b>: “Step — is — ACCOUNT”. True branch: <b>Send notification</b> to the Creator “Not handed out after a day: <code>{{task.title}}</code>”.</li>
</ol>
<h3>Tell the reviewer as soon as a task waits for review</h3>
<ol>
  <li>Trigger: <b>Task moves to a step</b>, To step: REVIEW.</li>
  <li><b>Send notification</b> to the Reviewer: “Waiting for your review: <code>{{task.title}}</code>”, body “<code>{{customer}}</code> · <code>{{service}}</code>”.</li>
</ol>
<h3>Overdue tasks: tell and extend</h3>
<ol>
  <li>Trigger: <b>Task overdue</b>. Filter (optional): Client is …</li>
  <li><b>Send notification</b> to the Assignee and the Creator.</li>
  <li><b>Update due date</b>: set in 2 days.</li>
</ol>
<h3>A weekly report task every Monday</h3>
<ol>
  <li>Trigger: <b>Schedule</b>, Weekly, Monday, 08:30.</li>
  <li><b>Create task</b> “Weekly report”, assigned to the team lead, due in 4 days.</li>
</ol>
<h3>Send new tasks to n8n for Telegram / Google Sheets</h3>
<ol>
  <li>In n8n: make a workflow starting with a <b>Webhook</b> node (POST) and copy its Production URL.</li>
  <li>In DMI: trigger <b>Task created</b> → <b>Call webhook</b> with that URL.</li>
  <li>In n8n: use <code>{{$json.body.task.title}}</code>… to send a Telegram message or add a Google Sheets row.</li>
</ol>`,
  },
  {
    slug: 'tu-dong-hoa-luu-y', cat, title: '10. Notes and troubleshooting',
    html: `
<ul>
  <li><b>A rule does not run?</b> Check: it is On; the event happened after it was turned on; the record meets the Filter; with “run once” a record that ran before is skipped; with “working hours only” look in the Waiting tab.</li>
  <li><b>Changes made by a rule do not start other rules.</b> Rule A assigning a task does not run a “Field changed — Assignee” rule.</li>
  <li><b>“You do not have permission …”</b> in the run history: whoever saved the rule has no access to that task / client. Give them access, or have someone who does open the rule and save it.</li>
  <li><b>“The person who saved the rule is no longer active”</b>: that account is locked. Open the rule and save it from another account.</li>
  <li><b>“Everyone picked is on leave”</b>: add people to Staff or edit the Leave list.</li>
  <li><b>When a step fails, the later steps of that run are skipped</b>; the run history says which step failed and why.</li>
  <li><b>Time triggers</b> (overdue, due soon, schedule, wait) are checked every minute, so they may run up to about a minute late.</li>
  <li><b>A test run is a real run</b>: notifications and changes are real. Try it on test data, then look at the run history.</li>
  <li><b>Broad rules</b> (say every “Field changed”) may run very often; use a Filter to narrow them.</li>
</ul>`,
  },
];
