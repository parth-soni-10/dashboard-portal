import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('../functions/_router.js',import.meta.url),'utf8')).replace('export default {','module.exports = {');
const sandbox={module:{exports:{}},Request,Response,URL,AbortController,setTimeout,clearTimeout,console,crypto:globalThis.crypto,fetch:globalThis.fetch};
vm.runInNewContext(source,sandbox);
const handler=sandbox.module.exports;

function request(path, method='GET', body) {
  return new Request('https://portal.test'+path, { method, headers: body === undefined ? {} : {'content-type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body) });
}
test('feedback route rejects methods other than POST', async () => {
  const res=await handler.fetch(request('/api/feedback'),{SITE_FEEDBACK:{put(){}}});
  assert.equal(res.status,405);
});
test('feedback route fails closed until the shared KV binding exists', async () => {
  const res=await handler.fetch(request('/api/feedback','POST',{message:'broken link'}),{});
  assert.equal(res.status,503);
});
test('feedback route validates, honeypots, and writes 90-day prefixed records', async () => {
  const records=[]; const env={SITE_FEEDBACK:{async put(key,value,options){records.push({key,value,options});}}};
  assert.equal((await handler.fetch(request('/api/feedback','POST',{message:''}),env)).status,400);
  assert.equal((await handler.fetch(request('/api/feedback','POST',{message:'spam',website:'bot'}),env)).status,202);
  assert.equal(records.length,0);
  assert.equal((await handler.fetch(request('/api/feedback','POST',{message:'Please check this link'}),env)).status,201);
  assert.match(records[0].key,/^fb:portal:/); assert.equal(records[0].options.expirationTtl,7776000);
  assert.equal(JSON.parse(records[0].value).message,'Please check this link');
});
