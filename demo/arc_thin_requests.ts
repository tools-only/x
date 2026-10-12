/** Host-only request stages. No prompt, delta text, authentication or headers are logged. */
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';

export function usageRecord(message: any) {
  const u=message?.usage ?? {}, stop=message?.stopReason;
  const status = stop === 'aborted' ? 'aborted' : stop === 'error' ? 'failed' : message ? 'completed' : 'unsettled';
  // Pi initializes usage to zeros even when the provider never returns usage.
  const known = Number.isFinite(u.totalTokens) && u.totalTokens > 0;
  const value = (key:string) => Number.isFinite(u[key]) && (known || u[key]>0) ? u[key] : null;
  return {status, cost_status:known ? status==='completed' ? 'reported' : 'partial' : 'unknown',
    input:value('input'),output:value('output'),cache_read:value('cacheRead'),cache_write:value('cacheWrite'),
    reasoning:value('reasoning'),total:known ? u.totalTokens : null,stop_reason:stop ?? null};
}

export class RequestTrace {
  private active = new Map<string, any>();
  private attempts = new Map<string,number>();
  private replies = new WeakMap<object,string>();
  constructor(private emit:(row:any)=>void) {}
  private event(row:any) { this.emit({t:new Date().toISOString(),monotonic_ms:performance.now(),...row}); }
  start(kind:string, decision:number):string {
    const request_id=randomUUID(), logical_request=`${kind}:${decision}`;
    const attempt=(this.attempts.get(logical_request) ?? 0)+1; this.attempts.set(logical_request,attempt);
    const row={request_id,logical_request,attempt,kind,decision,stream_chars:0,stream_events:0,last_stream_ms:null};
    this.active.set(request_id,row);
    this.event({...row,stage:'request_prepared',http_send:'unobserved',http_headers:'unobserved',raw_transport_chunk:'unobserved'});
    return request_id;
  }
  chunk(id:string, chars:number) {
    const row=this.active.get(id); if (!row) return;
    row.stream_chars+=chars; row.stream_events++; row.last_stream_ms=performance.now();
    if (row.stream_events===1) this.event({...row,stage:'first_stream_event'});
  }
  note(id:string, stage:string) { const row=this.active.get(id); if (row) this.event({...row,stage}); }
  headers(id:string, status:number) {
    const row=this.active.get(id); if (!row) return;
    row.http_headers='observed';row.response_status=status;
    this.event({...row,stage:'response_headers'});
  }
  finish(id:string, message?:any) {
    const row=this.active.get(id); if (!row) return;
    this.event({...row,stage:'request_settlement',...usageRecord(message)}); this.active.delete(id);
    if (message && typeof message==='object') this.replies.set(message,id);
  }
  idFor(message:any) { return message && typeof message==='object' ? this.replies.get(message) : undefined; }
  async run(kind:string, decision:number, create:(onResponse:(response:any)=>void)=>any) {
    const id=this.start(kind,decision);
    try {return await this.result(kind,decision,create(response=>this.headers(id,response.status)),id);}
    catch(error) {this.finish(id,{stopReason:'error'});throw error;}
  }
  async result(kind:string, decision:number, stream:any, id=this.start(kind,decision)) {
    try {
      if (stream[Symbol.asyncIterator]) for await (const event of stream) {
        this.chunk(id,typeof event.delta==='string' ? event.delta.length : 0);
      }
      const reply=await stream.result(); this.finish(id,reply); return reply;
    } catch (error) { this.finish(id,{stopReason:'error'}); throw error; }
  }
}
