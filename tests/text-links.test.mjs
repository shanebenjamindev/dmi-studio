import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textLinks} from '../shared/text-links.ts';
test('plain text URLs, domains and emails become safe links while punctuation and text stay intact',()=>{
 const input='Drive: https://drive.google.com/a?q=1, web www.example.com. Email giang@example.com và detailersmovement.com/path (https://example.com/a).';
 const parts=textLinks(input);
 assert.equal(parts.map(p=>p.text).join(''),input);
 assert.deepEqual(parts.filter(p=>p.href).map(p=>p.href),['https://drive.google.com/a?q=1','https://www.example.com','mailto:giang@example.com','https://detailersmovement.com/path','https://example.com/a']);
 assert.equal(textLinks('javascript:alert(1) <script>bad()</script>').some(p=>p.href),false);
 assert.equal(textLinks('https://example.com/a_(b)')[0].href,'https://example.com/a_(b)');
});
