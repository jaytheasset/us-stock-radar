import test from 'node:test';
import assert from 'node:assert/strict';
import {alertPresentation} from './alertPresentation.ts';
test('existing delivery lanes retain their distinct user-facing causes',()=>{
 assert.deepEqual(alertPresentation('calendar_follow'),{kind:'calendar_alert',label:'Calendar alerts'});
 assert.deepEqual(alertPresentation('listing_monitor'),{kind:'monitor_match_alert',label:'Custom alerts'});
 for(const lane of ['watchlist','market_discovery'])assert.deepEqual(alertPresentation(lane),{kind:'primary_analysis_alert',label:'News & filing alerts'});
});
