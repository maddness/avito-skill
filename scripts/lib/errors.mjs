export class AvitoError extends Error {
 constructor(code,details={}){super(code);this.name='AvitoError';this.code=code;this.details=details;}
}
export function safeError(e){return {ok:false,code:e instanceof AvitoError?e.code:'UNEXPECTED_ERROR',details:e instanceof AvitoError?e.details:{}};}
