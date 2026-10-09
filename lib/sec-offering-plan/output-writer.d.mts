export function sha256(bytes:string|Buffer):string;
export function decode(bytes:Uint8Array):string;
export function atomicCreate(path:string,bytes:Buffer):Promise<void>;
export function freezeOutput(inputPath:string,outputPath:string,freezePath:string):Promise<{value:unknown;freeze:{protocol:string;sha256:string;bytes:number;frozenAt:string;strictUtf8:boolean;byteIdentical:boolean;semanticIdentical:boolean}}>;
