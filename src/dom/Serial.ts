import {addSerialPortListener, getSerialPortFromUser, getSerialPorts, DefaultSerialOptions} from "./SerialNavigator";
import {readableEventStream} from "../Streams";
import {doOrTimeout} from "../Promises";

export enum SerialEvent {
    initialize = 'initialize',
    //destroy = 'destroy',
    select = 'select',
    connect = 'connect',
    disconnect = 'disconnect',
    open = 'open',
    close = 'close',
    data = 'data'
}

export enum VendorId {
    default = 4292
}

export enum BaudRate {
    default = 115200
}

export const str2ab = (str:string) => {
    var buf = new ArrayBuffer(str.length * 2); // 2 bytes for each char
    var bufView = new Uint16Array(buf);
    for (var i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
}

export const abortableWriter = (writable: WritableStream) => {
    const controller = new AbortController();
    const tes = new TransformStream({
        start(controller) {},
        async transform(chunk, controller) {
            chunk = await chunk

            controller.enqueue(str2ab(chunk));
        },
        flush() {}
    })
    try {
        const pipe = tes.readable.pipeTo(writable, {preventAbort: true, signal: controller.signal}).catch(() => {/*expected*/});

        return {
            writer: tes.writable.getWriter(),
            done: async function () {
                controller.abort();
                try {
                    await pipe;
                } catch (e) {
                    // Swallow "AbortError" DOMExceptions as expected, but rethrow any unexpected failures.
                    if ((e as Error).name !== "AbortError") {
                        //throw e;
                        console.warn(e)
                    }
                }
            }
        }
    } catch (e) {
        console.warn(e)
    }
}

export const textWriter = (writable: WritableStream): { writer?: WritableStreamDefaultWriter<string>; done?: () => Promise<void> }  => {
    // eslint-disable-next-line no-undef
    const tes = new TextEncoderStream();
    const controller = new AbortController();
    try {
        const pipe = tes.readable.pipeTo(writable, {preventAbort: true, signal: controller.signal}).catch(() => {/*expected*/});

        return {
            writer: tes.writable.getWriter(),
            done: async function () {
                controller.abort();
                try {
                    await pipe;
                } catch (e) {
                    // Swallow "AbortError" DOMExceptions as expected, but rethrow any unexpected failures.
                    if ((e as Error).name !== "AbortError") {
                        //throw e;
                        console.warn(e)
                    }
                }
            }
        }
    } catch (e) {
        console.warn(e)
        return {writer: undefined, done: undefined}
    }
}
export class WriteController {
    private _cancelled: boolean = false
    private _lastWill?: string[]
    get cancelled() {
        return this._cancelled
    }
    get lastWill() {
        return this._lastWill
    }
    cancel(...lastWill: string[]) {
        this._lastWill = lastWill
        this._cancelled = true
    }
}


export const writeTo = async (controller: WriteController, writable: WritableStream, ...strings: string[]) => {
    console.log('strings to write:: ', strings);
    try {
        // const writer = writable.getWriter()
        const {writer, done} = textWriter(writable);
        //const {writer, done} = abortableWriter(writable);
        for (const chars of strings) {
            if (controller.cancelled) {
                console.warn('Write aborted by WriteController', controller)
                if (controller.lastWill) {
                    for (const chars of controller.lastWill) {
                        await writer?.write(chars);
                    }
                }
                break
            }
            await writer?.write(chars);
        }
        await done?.();
        //await writer.abort();
        // writer.releaseLock()
    } catch (e) {
        console.warn(e)
    }
}

export const readableIterator = async function*(readable: ReadableStream) {
    const reader = readable.getReader()
    try {
        while (true) {
            const {done, value} = await reader.read()
            if(done || !value) break
            yield value
        }
    } finally {
        reader.releaseLock()
    }
}

export const readableIteratorWithTimeout = async function*(readable: ReadableStream, timeout: number = 1000) {
    const reader = readable.getReader()
    try {
        while (true) {
            const {done, value} = await doOrTimeout(timeout, reader.read())
            if(done || !value) break
            yield value
        }
    } finally {
        try {
            reader.releaseLock()
        } catch (e) {
            console.warn("Cant release lock")
        }
    }
}

export class IterableStream {

    constructor(public readable: ReadableStream) {

    }

    async *iterator() {
        const reader = this.readable.getReader()
        try {
            while (true) {
                const {done, value} = await reader.read()
                if(done || !value) break
                yield value
            }
        } finally {
            reader.releaseLock()
        }
    }
}

/**
 * @class ReadLoop
 *
 * Datasinking reader with callbacks onData and onEnd
 * @param ReadableStream
 * @param onData
 * @param onEnd
 */
export class ReadLoop {

    private stopped: boolean = false
    private reader?: ReadableStreamReader<any>

    private _running: boolean = false
    // @ts-ignore
    public get running() { return this._running}
    // @ts-ignore
    private set running(running: boolean) { this._running = running }

    constructor(private readable: ReadableStream, private onData?: (value: any) => void, private onEnd?: () => void) {
        this.readLoop().then(this.onEnd)
    }
    stop() {
        this.stopped = true
    }
    async readLoop() {
        if(this.running) throw new Error(`Readloop is already reading`)
        this.stopped = false
        while (this.readable && !this.stopped) {
            this.running = true
            this.reader = this.readable.getReader()
            try {
                while (true) {
                    const {value,done} = await this.reader.read()
                    if(done || !value) break
                    this.onData?.(value)
                }
            } finally {
                this.reader.releaseLock()
            }
        }
        this.running = false
    }
}



interface CustomEventMap {
    "initialize": CustomEvent<ArrayLike<SerialPort>>
    "connect": CustomEvent<SerialPort>
    "select": CustomEvent<SerialPort>
    "deselect": CustomEvent<void>
    "open": CustomEvent<void>
    "data": CustomEvent<any>
    "close": CustomEvent<SerialPort>
    "disconnect": CustomEvent<SerialPort>
    "destroy": CustomEvent<void>
}

//export type addEventListener = (event: string, listener: (event: CustomEvent) => void) => void
export interface DeviceEvents {
    addEventListener<K extends keyof CustomEventMap>(type: K,
                                                     listener: (this: this, ev: CustomEventMap[K]) => void): void;
    removeEventListener<K extends keyof CustomEventMap>(type: K,
                                                     listener: (this: this, ev: CustomEventMap[K]) => void): void;
    dispatchEvent<K extends keyof CustomEventMap>(ev: CustomEventMap[K]): void;
}

class CustomEventTarget implements DeviceEvents {
    readonly eventTarget = new EventTarget()
    addEventListener<K extends keyof CustomEventMap>(type: K, listener: (this: this, ev: CustomEventMap[K]) => void): void {
        this.eventTarget.addEventListener(type, listener as EventListener)
    }
    dispatchEvent<K extends keyof CustomEventMap>(ev: CustomEventMap[K]): void {
        this.eventTarget.dispatchEvent(ev)
    }

    removeEventListener<K extends keyof CustomEventMap>(type: K, listener: (this: this, ev: CustomEventMap[K]) => void): void {
        this.eventTarget.removeEventListener(type, listener as EventListener)
    }
}


export type initialize = {
    initialize: (options?: object) => Promise<void>
    oninitialize: () => void
}

export type select = {
    select: (port: SerialPort) => void
    onselect: () => void
}

export type connect = {
    connect: (port: SerialPort) => void
    onconnect: (port: SerialPort) => void
}

export type open = {
    open: (options?: object) => Promise<void>
    onopen: () => void
}

export type data = {
    data: (options?: object) => Promise<void>
    ondata: (data: any) => void
}

export type close = {
    close: () => Promise<void>
    onclose: () => void
}

export type disconnect = {
    disconnect: (port: SerialPort) => void
    ondisconnect: (port: SerialPort) => void
}

export type deselect = {
    deselect: () => void
    ondeselect: () => void
}

export type destroy = {
    destroy: (options?: object) => void
    ondestroy: () => void
}

export type DeviceEventDispatcher = initialize & connect & select & open & data & close & disconnect & deselect & destroy

class SerialPortWrapper {
    private _ports: ArrayLike<SerialPort> = []
    private _port?: SerialPort

    // @ts-ignore
    public get ports() {
        return this._ports
    }
    // @ts-ignore
    protected set ports(ports: ArrayLike<SerialPort>) {
        this._ports = ports
    }

    // @ts-ignore
    public get port(): SerialPort | undefined {
        return this._port
    }
    // @ts-ignore
    protected set port(port: SerialPort | undefined) {
        this._port = port
    }

    get readable(): ReadableStream | undefined {
        return this._port?.readable
    }
    get writable(): WritableStream | undefined {
        return this._port?.writable
    }
    get connected() {
        return Boolean(this.port && this.readable && this.writable)
    }
    get reader(): ReadableStreamDefaultReader | undefined {
        return this.readable?.getReader()
    }
}


/**
 * To register/unregister:
 * dispatchingSerial.addEventListener("data", function listener(ev) {
    console.log("Printing ONCE", ev.detail);
    (this as unknown as MultireadSerialPortDevice).removeEventListener("data", listener)
});
 */
abstract class DispatchingSerialPortWrapper extends SerialPortWrapper implements DeviceEvents, DeviceEventDispatcher {

    readonly eventTarget = new EventTarget()
    addEventListener<K extends keyof CustomEventMap>(type: K, listener: (this: this, ev: CustomEventMap[K]) => void): void {
        this.eventTarget.addEventListener(type, listener as EventListener)
    }
    dispatchEvent<K extends keyof CustomEventMap>(ev: CustomEventMap[K]): void {
        this.eventTarget.dispatchEvent(ev)
    }

    removeEventListener<K extends keyof CustomEventMap>(type: K, listener: (this: this, ev: CustomEventMap[K]) => void): void {
        this.eventTarget.removeEventListener(type, listener as EventListener)
    }

    abstract initialize(options: object | undefined): Promise<void>

    abstract connect(port: SerialPort): void

    abstract select(port: SerialPort): void

    abstract open(options: object | undefined): Promise<void>

    abstract data(options: object | undefined): Promise<void>

    abstract close(): Promise<void>

    abstract disconnect(port: SerialPort): void

    abstract deselect(): void

    abstract destroy(): void

    oninitialize(): void {
        this.dispatchEvent(new CustomEvent("initialize", {detail: this.ports}))
    }

    onconnect(port: SerialPort): void {
        this.dispatchEvent(new CustomEvent("connect", {detail: port}))
    }

    onselect(): void {
        this.dispatchEvent(new CustomEvent("select", {detail: this.port}))
    }

    onopen(): void {
        this.dispatchEvent(new CustomEvent("open", {detail: this.port}))
    }

    ondata(data: any): void {
        this.dispatchEvent(new CustomEvent("data", {detail: data}))
    }

    onclose(): void {
        this.dispatchEvent(new CustomEvent("close", {detail: this.port}))
    }

    ondisconnect(port: SerialPort): void {
        this.dispatchEvent(new CustomEvent("disconnect", {detail: port}))
    }

    ondeselect(): void {
        this.dispatchEvent(new CustomEvent("deselect"))
    }

    ondestroy(): void {
        this.dispatchEvent(new CustomEvent("destroy"))
    }
}

// export interface SerialPortDeviceSettings {
//     usbVendorId: VendorId.default,
//     autoConnect: true,
//     autoOpen: true,
//     autoRead: true,
//     baudRate: BaudRate.default
// };

class SerialPortDevice extends DispatchingSerialPortWrapper {

    constructor(
            public usbVendorId= VendorId.default,
            public autoConnect = true,
            public autoOpen = true,
            public autoRead = true,
            public baudRate = BaudRate.default) {
        super()
        this.initialize().then(() => {
            // Device attach
            addSerialPortListener('connect', port => this.connect(port))
            // Device detach
            addSerialPortListener('disconnect', port => this.disconnect(port))
        })
    }

    async initialize() {
        this.ports = await getSerialPorts()
        this.oninitialize()
    }

    oninitialize() {
        super.oninitialize()
        if(this.autoConnect) {
            if(this.ports?.[0]) {
                this.select(this.ports?.[0])
            } else {
                //todo: needs user permission
                //this.requestPort().then(this.select)
            }
        }
    }

    async requestPort(autoSelect: boolean = false) {
        const port = await getSerialPortFromUser({filters: [{usbVendorId:this.usbVendorId}]})
        if(autoSelect) this.select(port)
        return port
    }

    // Listener for Navigator.Serial.onconnect events
    connect(port: SerialPort): void {
        this.onconnect(port)
    }

    onconnect(port: SerialPort) {
        super.onconnect(port);
        if(!this.port && this.autoConnect) {
            this.select(port)
        }
    }

    select(port: SerialPort): void {
        if(this.port !== port) {
            this.deselect()
            if(port) {
                this.port = port
                this.onselect()
            }
        }
    }

    onselect() {
        super.onselect();
        if(this.autoOpen) this.open({baudRate: this.baudRate}).catch(console.warn)
    }

    async open(options: SerialOptions = DefaultSerialOptions) {
        if(!this.port) throw new Error(`No port selected to open`)
        try {
            await this.port.open(options)
        } catch (e) {
            console.warn(e)
            //todo: check if e is of already open exception, otherwise throw up
        }
        this.onopen()
    }

    onopen() {
        super.onopen();
        if(this.autoRead) this.data().catch(console.warn)
    }

    public running: boolean = false
    async data() {
        this.running = true
        while (this.readable && this.running) {
            let reader = this.readable.getReader()
            try {
                while (this.running) {
                    const {value, done} = await reader.read()
                    this.ondata(value)
                    if (done || !value) break
                }
            } catch (e) {
                console.warn(e)
            } finally {
                reader.releaseLock()
            }
        }
    }

    async close() {
        await this.port?.close()
        this.onclose()
    }

    //EventListener for Navigator.Serial.ondisconnect
    disconnect(port: SerialPort) {
        super.ondisconnect(port)
        if(this.port === port) {
            this.deselect()
        }
    }

    deselect(): void {
        if(this.port) {
            this.close().catch(console.warn)
            this.port = undefined
        }
        this.ondeselect()
    }

    destroy() {
        // @ts-ignore
        navigator.serial.removeEventListener('connect')
        // @ts-ignore
        navigator.serial.removeEventListener('disconnect')
        this.deselect()
        this.ondestroy()
    }
}

export class MultireadSerialPortDevice extends SerialPortDevice {
    private readableTees: Array<ReadableStream> = []

    getReadableTeed(): ReadableStream {
        const rs = readableEventStream(this as unknown as EventTarget, 'data')

        // let callback : (event: CustomEventMap["data"]) => void
        //
        // const rs = new ReadableStream({
        //     start(controller) {
        //         callback = ({detail}) => controller.enqueue(detail)
        //         parent.addEventListener(SerialEvent.data, callback)
        //     },
        //     pull(controller) {
        //
        //     },
        //     cancel(reason?) {
        //         parent.removeEventListener(SerialEvent.data, callback)
        //     },
        // })
        this.readableTees.push(rs)
        return rs
    }

    async *iterator() {
        return readableIterator(this.getReadableTeed())
    }

    async close() {
        try {
            for(const rd of this.readableTees) {
                //todo: Cannot cancel a locked stream; request reader abort?
                await rd.cancel(`Serial.close called`)
            }
        } finally {
            await super.close();
        }
    }
}


