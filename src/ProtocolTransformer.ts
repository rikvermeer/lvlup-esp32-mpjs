import {SLIP} from "./Flasher";

declare global {
    interface TransformStream {

    }
}

export const enum ProtocolType {
    TEXT,
    BINARY,
}

const binToU8Array = (chunk: any) => {
    if (ArrayBuffer.isView(chunk))
        return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    else if (Array.isArray(chunk) && chunk.every(value => typeof value === 'number'))
        return new Uint8Array(chunk)
    return chunk
}

export class CharacterTransformer extends TransformStream {
    async transform(chunk: any, controller: TransformStreamDefaultController) {
        for(const c of chunk) {
            controller.enqueue(c)
        }
    }
}



// Transforms binary to text or vise versa
export class ProtocolTransformer implements Transformer<ReadableStream, WritableStream> {
    textEncoder: TextEncoder = new TextEncoder()
    textDecoder: TextDecoder = new TextDecoder()

    constructor(
        public inType: ProtocolType = ProtocolType.BINARY,
        public outType: ProtocolType = ProtocolType.TEXT,
        public characterDevice = false) {
    }

    start() {
    } // required.

    async transform(chunk: any, controller: TransformStreamDefaultController) {
        chunk = await chunk
        if (chunk === null) controller.terminate()
        if(this.inType === ProtocolType.BINARY) {
            chunk = binToU8Array(chunk)
            if(this.outType === ProtocolType.TEXT) {
                chunk = this.textDecoder.decode(chunk)
            }
        } else {
            if(this.outType === ProtocolType.BINARY) {
                chunk = this.textEncoder.encode(chunk)
            }
        }
        if(this.characterDevice) {
            for(const c of chunk) {
                controller.enqueue(c)
            }
        } else {
            controller.enqueue(chunk)
        }
    }

    flush() { /* do any destructor work here */
    }
}

export class ProtocolTransformStream extends TransformStream<ReadableStream, WritableStream> {
    constructor(public transformer: ProtocolTransformer = new ProtocolTransformer()) {
        super(transformer)
    }
    get inType() {
        return this.transformer.inType
    }
    set inType(protocolType: ProtocolType) {
        this.transformer.inType = protocolType
    }
    get outType() {
        return this.transformer.outType
    }
    set outType(protocolType: ProtocolType) {
        this.transformer.outType = protocolType
    }
    get characterDevice() {
        return this.transformer.characterDevice
    }
    set characterDevice(characterDevice: boolean) {
        this.transformer.characterDevice = characterDevice
    }
}

export class ReadAfterTransformer extends TransformStream {
    constructor(public after: string, public reading = false, public buffer = "") {
        super({
            start() {}, // required.
            async transform(chunk, controller) {
                chunk = await chunk
                if(reading) {
                    controller.enqueue(chunk)
                } else  {
                    buffer += chunk
                    if(buffer.startsWith(after)) {
                        reading = true
                    }
                }
            },
            flush() {}
        })
    }
}

export class LoggingTransformer extends TransformStream {
    constructor() {
        super({
            start() {}, // required.
            async transform(chunk, controller) {
                chunk = await chunk
                console.log(chunk)
                controller.enqueue(chunk);
            },
            flush() {}
        })
    }
}