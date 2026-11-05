import {test} from 'node:test';import assert from 'node:assert/strict';
import {gmailIssue,gmailEnableUrl} from '../shared/gmail-errors.ts';
test('Gmail errors distinguish disabled API, missing send scope and Workspace policy',()=>{
 const disabled=gmailIssue(403,{error:{errors:[{reason:'accessNotConfigured'}],details:[{reason:'SERVICE_DISABLED',metadata:{consumer:'projects/595756180895',activationUrl:'https://invalid.example/ignore'}}]}});
 assert.equal(disabled.code,'API_DISABLED');assert.equal(disabled.helpUrl,'https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=595756180895');
 assert.equal(gmailIssue(403,{error:{details:[{reason:'ACCESS_TOKEN_SCOPE_INSUFFICIENT'}]}}).code,'SCOPE_REQUIRED');
 assert.equal(gmailIssue(403,{error:{errors:[{reason:'domainPolicy'}]}}).code,'DOMAIN_POLICY');
 assert.equal(gmailIssue(429,{}).code,'RATE_LIMIT');assert.equal(gmailIssue(401,{}).code,'AUTH_EXPIRED');
 assert.equal(gmailEnableUrl('evil/?token=bad'),'https://console.cloud.google.com/apis/library/gmail.googleapis.com');
});
