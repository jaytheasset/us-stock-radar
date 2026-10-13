/** Display concepts only. Storage lanes, policy and APIs retain their existing identities. */
export function alertPresentation(alertLane:string){
 if(alertLane==='calendar_follow')return {kind:'calendar_alert',label:'Calendar alerts'} as const;
 if(alertLane==='listing_monitor')return {kind:'monitor_match_alert',label:'Custom alerts'} as const;
 return {kind:'primary_analysis_alert',label:'News & filing alerts'} as const;
}
