import {SerialEvent, MultireadSerialPortDevice, readableIterator} from './dom/Serial';
import {ProtocolTransformStream} from "./ProtocolTransformer";
import {Repl} from "./Repl";
import {ESPLoader, SlipSource} from "./Flasher";

let el = document.createElement('pre')
el.appendChild(document.createTextNode(JSON.stringify({'asd': 23})))
document.body.appendChild(el)

const global: { repl?: Repl, portWrapper?: MultireadSerialPortDevice,loader?: ESPLoader, logger: ({detail}: any) => void}  = {
    repl: undefined,
    portWrapper: undefined,
    loader: undefined,
    logger: ({detail}: any) => {
        const td = new TextDecoder()
        console.log('SerialEvent.data', td.decode(detail))
    }
};

/*
const portWrapper = new MultireadSerialPortDevice()
portWrapper.addEventListener(SerialEvent.open, (result: any) => {})

portWrapper.addEventListener(SerialEvent.data, function listener(ev) {
    console.log("Printing ONCE", ev.detail);
    (this as unknown as MultireadSerialPortDevice).removeEventListener("data", listener)
});

portWrapper.addEventListener("open", function listener(ev) {
    return
    console.log('Starting REPl');
    (this as unknown as MultireadSerialPortDevice).removeEventListener("open", listener)
    global.repl = new Repl(portWrapper);
    (async () => {
        await global.repl?.isRunning()
        console.log('calling interrupt')
        const buffer = await global.repl?.interrupt()
        console.log('buffer:', buffer)
    })()
});

portWrapper.addEventListener(SerialEvent.data, ({detail: result}: any) => {
    const td = new TextDecoder()
    console.log('SerialEvent.data', td.decode(result))
});
*/
const consoleLogger = (portWrapper: MultireadSerialPortDevice) => {
    const t = new ProtocolTransformStream();
    (async () => {
        for await (let line of readableIterator(portWrapper.getReadableTeed().pipeThrough(t))) {
            console.log(line)
        }
    })()
    t.characterDevice = false
}

const interrupt = async () => {
    const te = new TextEncoder()
    const writer = global.portWrapper!.writable?.getWriter()
    try {
        await writer!.write(te.encode(`\x0d\x03\x03`))
    } catch(e) {
        console.warn(e)
        await writer!.close()
    } finally {
        writer!.releaseLock()
    }
}

const addButton = (name: string, target:(e: MouseEvent) => void) => {
    const btn = document.createElement('button')
    btn.onclick = target
    document.body.appendChild(btn)
    btn.appendChild(document.createTextNode(name));
}
addButton('log On', () => {
    console.log(global)
    global.portWrapper!.addEventListener(SerialEvent.data, global.logger);
})
addButton('log Off', () => {
    console.log(global)
    global.portWrapper!.removeEventListener(SerialEvent.data, global.logger);
})
addButton('portWrapper', async () => {
    global.portWrapper ??= new MultireadSerialPortDevice()
    if(!global.portWrapper.connected)
        await global.portWrapper.requestPort()
    global.loader ??= new ESPLoader(global.portWrapper.port!, global.portWrapper.getReadableTeed())
})
addButton('interruptRaw', async () => {
    await interrupt()
})
addButton('downloadMode', async () => {
    await global.loader!.downloadMode()
})

addButton('sync', async () => {
    await global.loader!.sync()
})
addButton('exitDownloadMode', async () => {
    await global.loader!.exitDownloadMode()
})
addButton('stop portWrapper running', () => {
    global.portWrapper!.running = false
})
addButton('scan', () => {
    global.portWrapper!.requestPort()
})
addButton('repl', () => {
    global.repl ??= new Repl(global.portWrapper!);
})
addButton('interruptRepl', () => {
    global.repl!.interrupt().then(console.log).catch(console.warn)
})
addButton('interruptRaw', async () => {
    await interrupt()
})
addButton('enterRaw', () => global.repl!.enterRawREPL().then(console.log).catch(console.warn))
addButton('exitRaw', () => global.repl!.exitRawREPL().then(console.log).catch(console.warn))
addButton('enterPaste', () => global.repl!.enterPaste().then(console.log).catch(console.warn))
addButton('exitPaste', () => global.repl!.exitPaste().then(console.log).catch(console.warn))

addButton('testFlasher', async () => {
    if(!global.portWrapper!.connected)
        await global.portWrapper!.requestPort()

    global.portWrapper!.running = false

    const port = global.portWrapper!.port
    const readable = global.portWrapper!.readable
    const writable = global.portWrapper!.writable

    if(readable?.locked || writable?.locked) {
        throw new Error("Stream locked")
    } // Ok, both unlocked
    //await port!.close()
    const espLoader = new ESPLoader(port!)


    await espLoader.downloadMode()
    await espLoader.sync()
    await espLoader.exitDownloadMode()

    console.log(espLoader, port, readable, writable)
})



//console.log(c.readable)
/*(async () => {
    const td = new TextDecoder()
    for await (const line of c.iterator()) {
        console.log('LINE: ', td.decode(line))
    }
})()*/
