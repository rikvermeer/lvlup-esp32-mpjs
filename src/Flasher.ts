import {CharacterTransformer} from "./ProtocolTransformer";
import {readableIterator} from "./dom/Serial";
import {BootloaderCommand} from "./constants/bootloader";
import {pack, unpack} from "python-struct"
import {Buffer} from "buffer/";

// import {Buffer} from "buffer/"

declare global {
    interface ReadableByteStreamController {
        readonly byobRequest: ReadableStreamBYOBRequest | undefined;
        readonly desiredSize: number | null;
        close(): void;
        enqueue(chunk: ArrayBufferView): void;
        error(error?: any): void;
    }
    interface ReadableStreamBYOBRequest {
        readonly view: ArrayBufferView;
        respond(bytesWritten: number): void;
        respondWithNewView(view: ArrayBufferView): void;
    }
}

export enum SLIP {
    END = 0xC0,
    ESC = 0xDB,
    ESC_END = 0xDC,
    ESC_ESC= 0xDD
}

export class CharTransformer implements Transformer<Buffer, Buffer | number> {
    constructor(public enabled: boolean = true) {
    }
    async transform(chunk: Buffer, controller: TransformStreamDefaultController<Buffer | number>) {
        if(this.enabled) {
            for(let char of chunk) {
                controller.enqueue(char)
            }
        } else {
            controller.enqueue(chunk)
        }
    }
}
export class CharTransformStream extends TransformStream<Buffer, Buffer | number> {
    transformer: CharTransformer;

    constructor() {
        const _transformer = new CharTransformer()
        super(_transformer);
        this.transformer = _transformer
    }

    get enabled() { return this.transformer.enabled}
    set enabled(enabled: boolean) { this.transformer.enabled = enabled}
}
class SLIPError extends Error {}
class InvalidChunkError extends SLIPError {
    constructor(message: string, chunk?: number | Buffer, buffer? : Buffer) {
        super(`${message}\nReading ${chunk}\nRead so far: ${buffer?.toString()}`);
    }
}
class SLIPInTransformer implements Transformer<number, Buffer> {
    private escaping: boolean = false
    private cache: any[] | null = null

    constructor(
        public runOnce= false,
        public errorOnSkip = true,
        public enabled = true) {
    }

    private get reading() {
        return this.cache !== null
    }

    async transform(chunk: number | Buffer, controller: TransformStreamDefaultController<Buffer>) {
        if(this.enabled) {
            if (!this.reading) {
                if (chunk === SLIP.END) {
                    //package start
                    this.cache = Array()
                } else {

                    if(this.errorOnSkip) {
                        throw new InvalidChunkError('Header not seen yet.', chunk)
                    } else console.warn('Skipping data. Header not seen yet.', chunk)
                }
            } else if (this.escaping) {
                this.escaping = false
                if (chunk === SLIP.ESC_END) {
                    this.cache?.push(SLIP.END)
                } else if (chunk === SLIP.ESC_ESC) {
                    this.cache?.push(SLIP.ESC)
                } else {
                    if(this.errorOnSkip) {
                        throw new InvalidChunkError('Escaping but no char type to escape.', chunk)
                    } else console.warn('Skipping data. Escaping but no char type to escape.', chunk)

                }
            } else if (chunk === SLIP.ESC) {
                this.escaping = true
            } else if (chunk === SLIP.END) {
                console.log('Package complete: ', this.cache)
                controller.enqueue(new Buffer(this.cache!))
                if (this.runOnce) controller.terminate()
                else this.cache = null
            } else {
                this.cache?.push(chunk)
            }
        } else {
            const data = typeof chunk === 'number' ? new Buffer([chunk]) : chunk
            controller.enqueue(data)
            this.cache = null
            this.escaping = false
        }
    }
}
export class SLIPInTransformStream extends TransformStream<number, Buffer> {
    private transformer: SLIPInTransformer;
    constructor(runOnce: boolean = false, errorOnSkip: boolean = true) {
        const slipInTransformer = new SLIPInTransformer(runOnce, errorOnSkip)
        super(slipInTransformer);
        this.transformer = slipInTransformer
    }
    get enabled() { return this.transformer.enabled}
    set enabled(enabled: boolean) { this.transformer.enabled = enabled}
    get runOnce() { return this.transformer.runOnce }
    set runOnce(runOnce) { this.transformer.runOnce = runOnce}
    get errorOnSkip() { return this.transformer.errorOnSkip }
    set errorOnSkip(errorOnSkip) { this.transformer.errorOnSkip = errorOnSkip}
}

export class SlipSource extends ReadableStream<Buffer> {

    autoAllocateChunkSize?: number | undefined = undefined
    type: "bytes" = "bytes"

    // private source?: ReadableStream
    private abortController?: AbortController = new AbortController()
    private characterStream?: CharTransformStream = new CharTransformStream()
    private slipStream?: SLIPInTransformStream = new SLIPInTransformStream()
    private readable?: ReadableStream
    public _enabled: boolean = true
    // constructor(private readableStream: ReadableStream) {
    private reader?: ReadableStreamDefaultReader<Buffer>;
    constructor(public source?: ReadableStream) {
        //this.attach(readableStream)
        super()
    }

    get enabled() {
        return this._enabled
    }
    set enabled(enabled: boolean) {
        this._enabled = enabled
        this.characterStream!.enabled = this._enabled
        this.slipStream!.enabled = this._enabled
    }

    detach() {
        if(this.abortController) {
            this.abortController.abort()
        }
        // this.source = undefined
        this.readable = undefined
    }

    attach(readableStream?: ReadableStream) {
        this.detach()
        this.source = readableStream
        if(!this.abortController) this.abortController = new AbortController()
        if(!this.characterStream) this.characterStream = new CharTransformStream()
        if(!this.slipStream) this.slipStream = new SLIPInTransformStream()

        this.characterStream.enabled = this._enabled
        this.slipStream.enabled = this._enabled

        this.readable = this.source!.pipeThrough(this.characterStream!, {
            // If this is set to true, the source ReadableStream closing will no longer cause the destination WritableStream to be closed.
            // The method will return a fulfilled promise once this process completes, unless an error is encountered while closing
            // the destination in which case it will be rejected with that error.
            preventClose: false,
            // If this is set to true, errors in the source ReadableStream will no longer abort the destination WritableStream.
            // The method will return a promise rejected with the source’s error, or with any error that occurs during aborting
            // the destination.
            preventAbort: false,
            // If this is set to true, errors in the destination WritableStream will no longer cancel the source ReadableStream.
            // In this case the method will return a promise rejected with the source’s error, or with any error that occurs
            // during canceling the source. In addition, if the destination writable stream starts out closed or closing,
            // the source readable stream will no longer be canceled. In this case the method will return a promise rejected with
            // an error indicating piping to a closed stream failed, or with any error that occurs during canceling the source.
            preventCancel: true,
            // If set to an AbortSignal object, ongoing pipe operations can then be aborted via the corresponding AbortController.
            signal: this.abortController.signal
        }).pipeThrough(this.slipStream)
    }

    //ReadableByteStreamControllerCallback
    start(controller: ReadableByteStreamController) {
        this.attach(this.source!)
        this.reader = this.readable?.getReader()
    }
    //ReadableByteStreamControllerCallback;
    async pull(controller: ReadableByteStreamController) {
        const {done, value} = (await this.reader?.read())!
        if(value) controller.enqueue(value!)
        if(done) controller.close()
    }
    //ReadableStreamErrorCallback
    async cancel(reason?: any) {
        this.reader?.releaseLock()
        this.reader = undefined
        this.detach()
    }
}

export const slipOutTransformer = (chunk: Buffer) => {
    return new Buffer([SLIP.END, ...
        chunk.reduce<Array<number>>((pv, cv) => {
            if(cv === SLIP.ESC) { pv.push(SLIP.ESC); pv.push(SLIP.ESC_ESC)}
            else if(cv === SLIP.END) {  pv.push(SLIP.ESC);  pv.push(SLIP.ESC_END); }
            else pv.push(cv)
            return pv
        }, []), SLIP.END])
}

export class SLIPOutTransformer implements Transformer<Buffer, Buffer> {
    async transform(chunk: Buffer, controller: TransformStreamDefaultController<Buffer>) {
        const slipBuffer = slipOutTransformer(chunk)
        controller.enqueue(slipBuffer)
    }
}

export class SLIPOutTransformStream extends TransformStream {
    constructor() {
        super(new SLIPOutTransformer());
    }
}

export const responseTransformer = (chunk: Buffer) => {
    // @ts-ignore
    const [resp, op_ret, len_ret, val] = unpack('<BBHI', chunk.slice(0, 8))
    if(resp == 1) {
        const data = chunk.slice(8)
        return {val, data}
    }
}

export class ResponseTransformer implements Transformer<Buffer, {val: any, data: any}> {
    async transform(chunk: Buffer, controller: TransformStreamDefaultController<{val: any, data: any}>) {
        const {val, data} = responseTransformer(chunk)!
        controller.enqueue({val, data})
    }
}

export class ResponseTransformStream extends TransformStream {
    private transformer: ResponseTransformer;
    constructor() {
        const transformer = new ResponseTransformer()
        super(transformer);
        this.transformer = transformer
    }
}

export enum ConnectionMode {
    DEFAULT_RESET = 'default_reset',
    NO_RESET = 'no_reset',
    NO_RESET_NO_SYNC = 'no_reset_no_sync'
}
export const readOnce = (readable: ReadableStream, resolve: (result: any) => {}, reject: (reason: any) => {}) => {
    readOnceAsync(readable).then(resolve).catch(reject)
}
export const readOnceAsync = async (readable: ReadableStream) => {
    const reader = readable.getReader()
    let result
    try {
        console.log('Reading...')
        const {value} = await reader.read()
        console.log(value.toString())
        result = value
    } catch (e) {
        await reader.cancel(e)
    } finally {
        reader.releaseLock()
    }
    return result
}

export class TimeoutException extends Error {}

export class ESPLoader {
    CHIP_NAME = "Espressif device"
    IS_STUB = false
    static STATUS_BYTES_LENGTH = 2
    static SYNC_TIMEOUT = 100

    // Response to ESP_SYNC might indicate that flasher stub is running instead of the ROM bootloader
    sync_stub_detected = false

    //flag is set to True if esptool detects the ROM is in Secure Download Mode
    secure_download_mode = false

    textEncoder = new TextEncoder()
    lastError = null
    static DEFAULT_BAUDRATE = 115200
    baudRate = ESPLoader.DEFAULT_BAUDRATE
    opened = false
    slipSource = new SlipSource()
    readable?: ReadableStream
    writable?: WritableStream
    lastResult?: Buffer;
    readPromise?: Promise<void>;

    constructor(private port: SerialPort, readable? : ReadableStream, writable? : WritableStream) {
        if(!port.readable || !port.writable) {
            this.open().then(r => {
                this.init(port, readable, writable)
            }).catch(console.warn)
        } else {
            this.opened = true
            this.init(port, readable, writable)
            //this.readable = new ReadableStream(this.slipSource)
        }

    }
    async open(baudRate=ESPLoader.DEFAULT_BAUDRATE) {
        if(this.opened) {
            await this.port.close()
            this.opened = false
        }
        await this.port.open({baudRate})
        this.baudRate = baudRate
        this.opened = true
    }

    init(port: SerialPort, readable? : ReadableStream, writable? : WritableStream) {
        if(readable)
            this.slipSource.attach(readable)
        else {
            this.slipSource.attach(port.readable)
        }
        //this.readable = new ReadableStream(this.slipSource)
        if(writable) {
            this.writable = writable
        } else {
            this.writable = port.writable
        }
        this.readable = this.slipSource
    }

    connect(mode: ConnectionMode.DEFAULT_RESET, detecting = false) {
        if(mode in [ConnectionMode.NO_RESET, ConnectionMode.NO_RESET_NO_SYNC]) {
            console.warn(`Pre-connection option ${mode} was selected.\n` +
            `Connection may fail if the chip is not in bootloader of flasher stub mode`)
        }
        this.lastError = null
    }

    async downloadMode() {
        await this.port.setSignals({ dataTerminalReady: false, requestToSend: true});
        await new Promise<void>(r=>setTimeout(()=>r(),100))
        await this.port.setSignals({ dataTerminalReady: true, requestToSend: false});
        await new Promise<void>(r=>setTimeout(()=>r(),50))
        await this.port.setSignals({ dataTerminalReady: false})
    }

    async exitDownloadMode() {
        await this.port.setSignals({ requestToSend: true});
        await new Promise<void>(r=>setTimeout(()=>r(),200))
        await this.port.setSignals({ requestToSend: false});
    }

    async write(packet: Buffer) {
        const writer = this.port.writable.getWriter()
        try {
            await writer.write(packet)
        } catch (e) {
            await writer.abort(e)
        } finally {
            writer.releaseLock()
        }
    }

    async readOne(timeout = 500) {
        if(!this.readPromise) {
            if(this.lastResult) {
                console.warn('Orphaned result found: ', this.lastResult)
                return this.getAndClearLastResult()
            } else {
                this.readPromise = readOnceAsync(this.readable!).then(result=>{this.lastResult = result})
            }
        }
        // Set the last result so Promise.race can reject but the pending read can still resolve
        await Promise.race([
            this.readPromise,
            new Promise((resolve, reject) => setTimeout(() => reject(TimeoutException), timeout))
        ])
        // There was no timeout rejection, return and clear the last result
        return this.getAndClearLastResult()
    }

    getAndClearLastResult() {
        const result = this.lastResult
        this.readPromise = undefined
        this.lastResult = undefined
        return result
    }

    readReg(address: BootloaderCommand) {
        return this.command(BootloaderCommand.ESP_READ_REG, pack('<I', address))
    }

    // writeReg() {
    //
    // }

    async command(op: BootloaderCommand | null = null, data = new Uint8Array(0), chk=0, waitResponse = true, timeout: number = 1000) {
        try {
            if(op !== null) {
                const pkt = new Buffer([...pack('<BBHI', 0x00, op, data.length, chk), ...data])
                const wrapped = slipOutTransformer(pkt)
                await this.write(wrapped)
                if(waitResponse) {
                    // read
                    const result = await this.readOne(timeout)
                    return responseTransformer(result!)
                }
            }
        } catch (e) {
            console.warn(e)
            throw e
        }
    }

    async checkCommand(description: String, op: BootloaderCommand | null = null, data = new Uint8Array(0), chk=0) {
        const {val, data: _data} = (await this.command(op, data, chk))!

        const statusBytes = _data!.slice(-ESPLoader.STATUS_BYTES_LENGTH)
        if(statusBytes[0] === 0) {
            if(data.length > ESPLoader.STATUS_BYTES_LENGTH) {
                return data.slice(0, -ESPLoader.STATUS_BYTES_LENGTH)
            } else {
                return val
            }
        }
    }

    sync = async () => {
        //HE    OP LN CH ??       D1       D2 (32)                                                          HE
        //c0 00 08 24 00 00000000 07071220 5555555555555555555555555555555555555555555555555555555555555555 c0
        console.log('Running sync')
        const data = this.textEncoder.encode(`\x07\x07\x12\x20` + '\x55'.repeat(32))
        console.log(data, data.length)
        try {
            let {val} = (await this.command(BootloaderCommand.ESP_SYNC, data, 0, true, ESPLoader.SYNC_TIMEOUT))!
            console.log('Got val: ', val)
            this.sync_stub_detected = val === 0
            console.log('sync_stub_detected: ', this.sync_stub_detected)
            for(let i =0;i<7;i++) {
                console.log('Running sync, empty command')
                let {val} = (await this.command())!
                this.sync_stub_detected = val === 0
                console.log('sync_stub_detected: ', this.sync_stub_detected)
            }
        } catch (e) {

        }

    }
}
