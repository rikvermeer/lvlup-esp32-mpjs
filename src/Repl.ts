// export type Repl = {
//     readable: ReadableStream,
//     writable: WritableStream,
//     readonly isOpen: boolean
// };

import {ProtocolTransformer, ProtocolTransformStream, ProtocolType, ReadAfterTransformer} from "./ProtocolTransformer";
import {
    MultireadSerialPortDevice,
    readableIterator,
    readableIteratorWithTimeout,
    ReadLoop,
    WriteController,
    writeTo
} from "./dom/Serial";
import {doOrTimeout} from "./Promises";
import WaitQueue from "wait-queue";

export enum ReplState {
    UNKNOWN = -1,
    FRIENDLY_REPL,
    RAW_REPL,
    PASTE_MODE
}

export enum BusyState {
    UNKNOWN = -1,
    FALSE,
    TRUE
}

export enum RawReplState {
    TEXT,
    BINARY,
    JSON,
    NDJSON
}

/*export class Forwarder {
    private static _nextId: number = 0
    static get nextId() {
        return this._nextId++
    }
    readonly id: number = Forwarder.nextId
    buffer: string = ""

    async readUntil(end: string) {

    }
}*/

export const readUntil = async (readable: ReadableStream, end: string, timeout=10000) => {
    console.log(timeout)
    let buffer = ""
    try {
        // @ts-ignore
        for await(const data of readableIteratorWithTimeout(readable, timeout)) {
            buffer += data
            if (buffer.endsWith(end)) {
                break
            }
        }
    } catch (e) {
        console.warn(e)
        console.log(buffer)
    }
    return buffer
}

/*export const readUntilOrTimeout = (timeout: number = 1000, readable: ReadableStream, end: string) => {
    let buffer = ""
    const run = async () => {
        for await(const data of readableIterator(readable)) {
            buffer += data
            if (buffer.endsWith(end)) {
                break
            }
        }
    }
    doOrTimeout(timeout, run())
    return {}
}*/

export const readUntilMatch = async (readable: ReadableStream, match: RegExp, timeout=10000) => {
    let buffer = ""
    try {
        // @ts-ignore
        for await(const data of readableIteratorWithTimeout(readable, timeout)) {
            buffer += data
            if (buffer.match(match)) {
                return buffer
            }
        }
    } catch (e) {
        console.warn(e)
    }
    return buffer
}

const raw_repl = `\x0d\x01`; //ctrl-A: enter raw REPL
const friendly_repl = `\x0d\x02`; //ctrl-B: enter friendly REPL
const cmd_interrupt = `\x0d\x03\x03` //ctrl-C twice: interrupt any running program
const soft_reset = `\x04`; //ctrl-D: soft reset in friendly REPL
const EOF = `\x04`; //ctrl-D: execute in raw REPL
const exit_paste = `\x0d\x04`; //ctrl-D: done in paste mode
const enter_paste = `\x0d\x05`; //ctrl-E: enter paste mode
const raw_execute_ok = `OK`

export const commands = {
    raw_repl, friendly_repl, cmd_interrupt, soft_reset, EOF, exit_paste, enter_paste, raw_execute_ok
}

export interface CommandExecutor {
    command: string[],
    timeout: 1000,
    dequeuePromise: Promise<void>
    runPromise: Promise<string>
    dequeueResolve?: () => void,
    runResolve?: (value: (string | PromiseLike<string>)) => void,
    dequeueReject?: (reason: any) => void,
    runReject?: (reason: any) => void,
}

export class Repl {
    private state: ReplState = ReplState.UNKNOWN
    private busyState: BusyState = BusyState.UNKNOWN

    private readable?: ReadableStream
    private writable?: WritableStream
    private _readLoop?: ReadLoop
    private protocolTansformer?: ProtocolTransformStream;

    // private forwarders: Array<Forwarder> = []

    constructor(
            private _serial: MultireadSerialPortDevice,
            private waitMs: number = 2000
    ){
        //console.log(serial)
        /*if(serial.readable && serial.writable) {
            this.protocolTansformer = new ProtocolTransformStream()
            this.readable = serial.getReadableTeed().pipeThrough(this.protocolTansformer)
            this.writable = serial.writable!
            if (this.writable.locked) {
                throw new Error("REPL unusable, writable stream already locked")
            }
        }*/
        //Make sure to nullify read/write on close event and re-attach them on open event.
        this.attachToSerialEvents()

        //Schedule run()
        /*this.scheduleRun()*/
    }

    get connected() {
        return this._serial.connected
    }

    get serial() {
        return this._serial
    }

    private attachToSerialEvents() {
        // Attach to serial port events in case of a reconnect
        const repl = this
        this._serial.addEventListener("close", function listener(ev) {
            console.log('Stopping readloop, serial device closed')
            repl.readLoop?.stop()
            repl.readable = undefined
            repl.writable = undefined
            repl.commandQueueRunning = false
        })
        this._serial.addEventListener("open", function listener(ev) {
            console.log('Starting readloop again, serial device reconnected')
            repl.protocolTansformer = new ProtocolTransformStream()
            repl.readable = repl._serial.getReadableTeed().pipeThrough(repl.protocolTansformer)
            repl.writable = repl._serial.writable
            setTimeout(repl.run.bind(repl), repl.waitMs)
        })
    }

    // Create Promises that resolve when the main readloop is running
    private readLoopWaits: Array<(val: unknown) => void> = []
    private set readLoop(readLoop: ReadLoop | undefined) {
        this._readLoop = readLoop
        // Resolve waiting promises
        while(this.readLoopWaits.length) this.readLoopWaits.pop()?.(null)
    }
    private get readLoop(): ReadLoop | undefined {
        return this._readLoop
    }
    async isRunning() {
        if(this.readLoop) return true
        return new Promise((res, rej) => {
            this.readLoopWaits.push(res)
        })
    }

    private scheduleRun() {
        setTimeout(this.run.bind(this), this.waitMs)
    }

    /**
     * Mainloop, consumes and calls onData
     * @private
     */
    private async run() {
        console.log('starting run', this)
        this.readLoop = new ReadLoop(this.readable!, this.onData.bind(this), this.onEnd.bind(this))
        this.runCommandQueue()
    }

    public async readFromUntil(from: string, end: string, timeout=10000): Promise<string> {
        return readUntil(this._serial.getReadableTeed().pipeThrough(new ProtocolTransformStream(new ProtocolTransformer(ProtocolType.BINARY, ProtocolType.TEXT, true))).pipeThrough(new ReadAfterTransformer(from)), end, timeout)
    }

    public async readUntil(end: string, timeout=10000) {
        return readUntil(this._serial.getReadableTeed().pipeThrough(new ProtocolTransformStream(new ProtocolTransformer(ProtocolType.BINARY, ProtocolType.TEXT, true))), end, timeout)
    }

    public async readUntilMatch(pattern: RegExp, timeout=10000) {
        return readUntilMatch(this._serial.getReadableTeed().pipeThrough(new ProtocolTransformStream(new ProtocolTransformer(ProtocolType.BINARY, ProtocolType.TEXT, true))), pattern, timeout)
    }

    public async timeout(timoutMs: number) {
        return new Promise((resolve, reject) => {setTimeout(reject, timoutMs, 'timeout')})
    }

    public async doOrTimeout(timoutMs: number, ...promises: Promise<unknown>[]) {
        return Promise.race([this.timeout(timoutMs), ...promises])
    }

    // async execute(command = cmd_interrupt) {
    //
    // }

    async interrupt(friendly = true) {
        await this.write(cmd_interrupt)
        if(friendly)
            return await doOrTimeout(1000, this.readUntil('>>>'))
        //await this.readUntil('>>>')
    }

    enterRawREPL = async () => {
        //await write(cmd_interrupt, raw_repl, soft_reset)
        await this.write(cmd_interrupt, raw_repl);
    }

    exitRawREPL = async () => {
        await this.write(friendly_repl);
    }

    enterPaste = async () => {
        await this.write(cmd_interrupt, enter_paste);
    }

    exitPaste = async () => {
        await this.write(exit_paste);
    }

    /* todo: looks like this function isn't removed but does nothing. I liked the concept of interrupting things though...

     */
    cancelWrite(lastWill: string[] = [cmd_interrupt]) {
        if(this.currentWritePromise && this.currentWritePromise.writeController) {
            //this.currentWritePromise.writeController.cancel(...lastWill)
        } else {
            //this.write(...lastWill)
        }
    }



    private currentWritePromise?: {writeController: WriteController, executor: (resolve: (result: any) => void, reject: (reason?: any) => void) => void}
    write = async (...strings: string[]) => {
        // if(typeof timeout === 'string') {
        //     strings = [timeout ,...strings]
        //     timeout = 10000
        // }
        const writeController = new WriteController()
        const executor: (resolve: (result: any) => void, reject: (reason?: any) => void) => void = (resolve, reject) => {
            writeTo(writeController, this.writable!, ...strings).then(resolve).catch(reject)
        }
        this.currentWritePromise = {writeController, executor}

        return new Promise(this.currentWritePromise.executor)
    }

    private prepareRawWrite = async () => {
        await this.interrupt(false)
        //await this.exitPaste()
        await this.exitRawREPL()
        await this.enterRawREPL()
        await doOrTimeout(2000, this.readUntil(`CTRL-B to exit\r\n`))
    }


    // todo: add read timeouts that reset protocol against starvation
    writeRaw = async (timeout=10000, ...strings: string[]) => {
        if(typeof timeout === 'string') {
            strings = [timeout ,...strings]
            timeout = 10000
        }
        try {
            console.log("Preparing REPL for raw write")
            await this.prepareRawWrite()
        } catch (e) {
            console.warn("Couldn't prepare REPL for raw write", e)
        }
        let promise = this.readFromUntil(raw_execute_ok, EOF, timeout)
        console.log('REPL: writing')
        await this.write(...strings, EOF)
        console.log('REPL: reading')
        //let result = (await doOrTimeout(500, promise)).slice(0, -1)
        let result = (await promise).slice(0, -1)
        console.log('REPL read result:', result)
        await this.exitRawREPL()
        await this.exitRawREPL()
        return result
    }
    private readonly executionQueue = new WaitQueue<CommandExecutor>();

    scheduleExecution = async (timeout=5000, ...command: string[]) => {
        if(typeof timeout === 'string') {
            command = [timeout ,...command]
            timeout = 5000
        }
        const executor = {
            timeout,
            command
        } as CommandExecutor
        await this.isRunning()
        executor.dequeuePromise = new Promise<void>((resolve, reject) => {
            executor.dequeueResolve = resolve
            executor.dequeueReject = reject
        })
        executor.runPromise = new Promise<string>((resolve, reject) => {
            executor.runResolve = resolve
            executor.runReject = reject
        })

        this.executionQueue.push(executor)
        return [executor.runPromise, executor.dequeuePromise]
    }

    private commandQueueRunning = false
    private async runCommandQueue() {
        if(this.commandQueueRunning) throw Error('Command queue is already running')
        this.commandQueueRunning = true
        while(this.commandQueueRunning) {
            const executor = await this.executionQueue.shift();
            executor.dequeueResolve!()
            try {
                const result = await this.writeRaw(executor.timeout, ...executor.command)
                executor.runResolve!(result)
            } catch (e) {
                executor.runReject!(e)
            }

        }
    }

    private onData(data: any): void {
        // this.forwarders.forEach((forwarder) => {
        //     forwarder.buffer += data
        // })
        //console.log(data)
    }

    private onEnd(): void {
        console.log('In REPL ENDinG')
    }

    get readLocked(): boolean {
        return this.readable!.locked
    }

    get writeLocked(): boolean {
        return this.writable!.locked
    }
}
