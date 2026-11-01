// Older Node (<22) lacks Promise.withResolvers, which pi-durable uses; import this first in Node scripts.
if (!(Promise as any).withResolvers) (Promise as any).withResolvers = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
