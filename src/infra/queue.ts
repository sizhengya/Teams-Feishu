import{feishuLimiter}from"./rate-limit";import{retryWithBackoff}from"./retry";
export interface QueueItem{targetKey:string;execute:()=>Promise<any>;}
export class OutboundQueue{private items:QueueItem[]=[];private running=false;enqueue(i:QueueItem):void{this.items.push(i);}get pending():number{return this.items.length;}start():void{if(this.running)return;this.running=true;this.worker();}stop():void{this.running=false;}private async worker():Promise<void>{while(this.running){if(!this.items.length){await new Promise(r=>setTimeout(r,200));continue;}const it=this.items.shift()!;try{await feishuLimiter.waitForToken(it.targetKey);await retryWithBackoff(it.execute);}catch(e){console.error("[queue]",e);}}}}
export const outboundQueue=new OutboundQueue();
