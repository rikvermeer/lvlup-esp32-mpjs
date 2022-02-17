declare global {
    interface Navigator {
        readonly serial: Serial
    }
    interface WorkerNavigator {
        readonly serial: Serial
    }
    interface Serial extends EventTarget {
        onconnect: EventHandlerNonNull
        ondisconnect: EventHandlerNonNull
        getPorts: () => Promise<Array<SerialPort>>
        requestPort: (options?: SerialPortRequestOptions) => Promise<SerialPort>;
        addEventListener: (event: string, cb: ({target}: { target: any }) => void) => void
        removeEventListener: (event: String, cb: ({target}: { target: any }) => void) => void
    }
    interface SerialPort extends EventTarget {
        onconnect: EventHandlerNonNull
        ondisconnect: EventHandlerNonNull
        readonly readable: ReadableStream
        readonly writable: WritableStream

        getInfo: () => SerialPortInfo

        open: (options: SerialOptions) => Promise<undefined>
        setSignals(signals: SerialOutputSignals): Promise<void>
        getSignals: () => Promise<SerialInputSignals>
        close: () => Promise<void>
    }
    interface SerialPortInfo {
        usbVendorId: number
        usbProductId: number
    }
    enum ParityType {
        NONE = "none",
        EVEN = "even",
        ODD = "odd"
    }
    enum FlowControlType {
        NONE = "none",
        HARDWARE = "hardware"
    }
    interface SerialOptions {
        baudRate: number
        dataBits?: number
        stopBits?: number
        parity?: ParityType
        bufferSize?: number
        flowControl?: FlowControlType
    }
    interface SerialInputSignals {
        dataCarrierDetect: boolean
        clearToSend: boolean
        ringIndicator: boolean
        dataSetReady: boolean
    }
    interface SerialOutputSignals {
        dataTerminalReady?: boolean
        requestToSend?: boolean
        break?: boolean
    }
    interface SerialPortRequestOptions {
        filters: ArrayLike<SerialPortFilter>
    }
    interface SerialPortFilter {
        usbVendorId?: number
        usbProductId?: number
    }
    interface EventHandlerNonNull {
        (event: Event): any
    }
}
export const DefaultSerialOptions = <SerialOptions>{baudRate: 115200}

export const getSerialPorts = async () => {
    return navigator.serial.getPorts()
}

export const getSerialPortFromUser = (options?: SerialPortRequestOptions) => {
    return navigator.serial.requestPort(options)
}

// export const getSerialPortFromUser = (usbVendorId: number) => {
//     return navigator.serial.requestPort({ filters: [{ usbVendorId: usbVendorId }]} as SerialPortOptions)
// }

export const addSerialPortListener = (event: string, callback: (port: SerialPort) => void) => {
    navigator.serial.addEventListener(event, ({target: port}) => { callback(port) })
}