import test from 'node:test';
import assert from 'node:assert/strict';
import {allowsProjectedDetailRead} from './access.ts';
const url='http://localhost:3121/api/monitors/listing/alerts/record';
test('same-origin browser GET without Origin works; explicit foreign origin and cross-site metadata never do',()=>{
 const request=(headers:Record<string,string>,method='GET')=>new Request(url,{method,headers});
 assert.equal(allowsProjectedDetailRead(request({'sec-fetch-site':'same-origin'})),true);
 assert.equal(allowsProjectedDetailRead(request({origin:'http://localhost:3121'})),true);
 const deniedHeaders:Record<string,string>[]=[{},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'},
  {origin:'http://foreign.test','sec-fetch-site':'same-origin'},
  {origin:'http://localhost:3121','sec-fetch-site':'cross-site'},
  {origin:'null','sec-fetch-site':'same-origin'}];
 for(const headers of deniedHeaders)assert.equal(allowsProjectedDetailRead(request(headers)),false);
 assert.equal(allowsProjectedDetailRead(request({'sec-fetch-site':'same-origin'},'POST')),false);
});
