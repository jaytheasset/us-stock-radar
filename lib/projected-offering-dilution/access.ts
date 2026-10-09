import {isSameOriginRequest} from '../auth/authPolicy.ts';

/** Browser GETs normally omit Origin. Fetch metadata still excludes cross-site reads. */
export function allowsProjectedDetailRead(request:Request){
 if(request.method!=='GET')return false;
 if(request.headers.has('origin'))return isSameOriginRequest(request);
 return request.headers.get('sec-fetch-site')==='same-origin';
}
