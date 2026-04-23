const W=parseInt(process.env.NOTIFICATION_MERGE_WINDOW_MS||"10000",10);
class NotificationMerger { private m=new Map<string,number>(); shouldNotify(sid:string):boolean { const t=this.m.get(sid); return !t||Date.now()-t>=W; } markNotified(sid:string):void { this.m.set(sid,Date.now()); } }
export const notificationMerger = new NotificationMerger();
